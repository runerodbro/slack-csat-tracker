// Rating pipeline: read a conversation's current rating from Intercom, save it,
// post or update the Slack message, and post or update the streak break.
//
// Every step can run again safely. A failed Slack call is retried by the queue
// and picks up where it stopped.

const { nowSeconds } = require("./time");
const { isNegative, computeStreak, breakInfo } = require("./streak");
const messages = require("./messages");
const { closedBy, teamAtClose, COUNTS_SQL } = require("./closer");
const { topicFields, hasTopic } = require("./topic");

function createRatings({ db, intercom, slack, clock, config, prefs, log = console }) {
  const q = {
    get: db.prepare("SELECT * FROM ratings WHERE conversation_id = ?"),
    insert: db.prepare(`
      INSERT INTO ratings (conversation_id, score, remark, admin_id, admin_name, admin_email,
                           contact_id, contact_name, contact_email, rated_at, source, closed_by,
                           team_id, team_name, category, product_area, outcome)
      VALUES (:conversation_id, :score, :remark, :admin_id, :admin_name, :admin_email,
              :contact_id, :contact_name, :contact_email, :rated_at, :source, :closed_by,
              :team_id, :team_name, :category, :product_area, :outcome)`),
    update: db.prepare(`
      UPDATE ratings SET score = :score, remark = :remark, admin_id = :admin_id, admin_name = :admin_name,
             admin_email = :admin_email, contact_id = :contact_id, contact_name = :contact_name,
             contact_email = :contact_email, rated_at = :rated_at, source = :source, closed_by = :closed_by,
             team_id = :team_id, team_name = :team_name, category = :category, product_area = :product_area,
             outcome = :outcome, updated_at = unixepoch()
      WHERE conversation_id = :conversation_id`),
    posted: db.prepare("UPDATE ratings SET slack_ts = ?, slack_channel = ?, posted_at = ? WHERE conversation_id = ?"),
    negPosted: db.prepare("UPDATE ratings SET neg_slack_ts = ?, neg_slack_channel = ? WHERE conversation_id = ?"),
    negatives: db.prepare(`SELECT rated_at FROM ratings WHERE score <= 3 AND ${COUNTS_SQL} AND conversation_id IS NOT ?`),
    firstRating: db.prepare(`SELECT MIN(rated_at) AS first FROM ratings WHERE ${COUNTS_SQL}`),
    getBreak: db.prepare("SELECT * FROM streak_breaks WHERE conversation_id = ?"),
    saveBreak: db.prepare(`
      INSERT INTO streak_breaks (conversation_id, broken_at, length_days, was_record, previous_record_days,
                                 posted_at, slack_ts, slack_channel, restored_at, neg_slack_ts, neg_slack_channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      ON CONFLICT (conversation_id) DO UPDATE SET
        broken_at = excluded.broken_at, length_days = excluded.length_days, was_record = excluded.was_record,
        previous_record_days = excluded.previous_record_days, posted_at = excluded.posted_at,
        slack_ts = excluded.slack_ts, slack_channel = excluded.slack_channel, restored_at = NULL,
        neg_slack_ts = NULL, neg_slack_channel = NULL`),
    negBreak: db.prepare("UPDATE streak_breaks SET neg_slack_ts = ?, neg_slack_channel = ? WHERE conversation_id = ?"),
    restoreBreak: db.prepare("UPDATE streak_breaks SET restored_at = ? WHERE conversation_id = ?"),
    setTopic: db.prepare("UPDATE ratings SET category = ?, product_area = ?, outcome = ? WHERE conversation_id = ?"),
  };

  // The separate 1–3 channel, if one is set and it is not the posting channel.
  function negativeChannel() {
    const channel = prefs.negativeChannel();
    return channel && channel !== slack.channel() ? channel : null;
  }

  function negativeDates(excludeConversationId = null) {
    return q.negatives.all(excludeConversationId).map((r) => clock.localDate(r.rated_at));
  }

  function streakStartDate() {
    if (config.streakStartDate) return config.streakStartDate;
    const { first } = q.firstRating.get();
    return first == null ? null : clock.localDate(first);
  }

  function currentStreak(today = clock.localDate(nowSeconds())) {
    return computeStreak({ negativeDates: negativeDates(), startDate: streakStartDate(), today });
  }

  async function contactFields(conversation, rating) {
    const id = rating.contact?.id || conversation.source?.author?.id || null;
    if (!id) return { contact_id: null, contact_name: null, contact_email: null };
    try {
      const c = await intercom.getContact(id);
      return { contact_id: id, contact_name: c.name || null, contact_email: c.email || null };
    } catch (err) {
      log.warn(`Contact ${id}: ${err.message}`);
      const a = conversation.source?.author || {};
      return { contact_id: id, contact_name: a.name || null, contact_email: a.email || null };
    }
  }

  // The team inbox the conversation was closed in (closer.js). Without a team
  // assignment in its history, the conversation's current team. A failed name
  // lookup keeps the ID.
  async function teamFields(conv) {
    const id = teamAtClose(conv) ?? conv.team_assignee_id;
    if (id == null || id === "" || Number(id) === 0) return { team_id: "none", team_name: null };
    try {
      const team = await intercom.getTeam(id);
      return { team_id: String(id), team_name: team?.name || null };
    } catch (err) {
      log.warn(`Team ${id}: ${err.message}`);
      return { team_id: String(id), team_name: null };
    }
  }

  async function syncBreak(row, url) {
    const brk = q.getBreak.get(row.conversation_id);
    const active = brk && !brk.restored_at;

    if (isNegative(row.score) && !active) {
      const info = breakInfo({
        otherNegativeDates: negativeDates(row.conversation_id),
        startDate: streakStartDate(),
        date: clock.localDate(row.rated_at),
      });
      if (!info) return; // Another negative rating already broke the streak today.
      const details = {
        length: info.length,
        previousRecordDays: info.previousRecord ? info.previousRecord.length : null,
        isRecord: info.isRecord,
      };
      // Main channel (if break posts are on) and the 1–3 channel. Saved after
      // the main post, so a retry never posts it twice.
      const message = messages.breakMessage({ info: details, rating: row, url });
      const posted = prefs.get().breaks ? await slack.post(message) : null;
      q.saveBreak.run(
        row.conversation_id,
        row.rated_at,
        details.length,
        details.isRecord ? 1 : 0,
        details.previousRecordDays,
        nowSeconds(),
        posted?.ts ?? null,
        posted?.channel ?? null,
      );
      const negChannel = negativeChannel();
      if (negChannel) {
        const copy = await slack.post(message, negChannel);
        q.negBreak.run(copy.ts, copy.channel, row.conversation_id);
      }
    } else if (!isNegative(row.score) && active) {
      const stillBroken = negativeDates(row.conversation_id).includes(clock.localDate(brk.broken_at));
      const info = { length: brk.length_days };
      const message = messages.restoredMessage({ info, rating: row, url, stillBroken });
      if (brk.slack_ts) await slack.update(brk.slack_ts, message, brk.slack_channel);
      if (brk.neg_slack_ts) await slack.update(brk.neg_slack_ts, message, brk.neg_slack_channel);
      q.restoreBreak.run(nowSeconds(), row.conversation_id);
    }
  }

  // post: false saves the rating without Slack messages (history import).
  async function processConversation(conversationId, { post = true, conversation = null } = {}) {
    let conv = conversation?.conversation_rating ? conversation : await intercom.getConversation(conversationId);
    const rating = conv.conversation_rating;
    if (!rating || rating.rating == null) return "no-rating";

    const id = String(conv.id || conversationId);
    const score = Number(rating.rating);
    const remark = rating.remark || null;
    const existing = q.get.get(id);
    const changed = Boolean(existing) && (existing.score !== score || (existing.remark || null) !== remark);
    const now = nowSeconds();

    // Who closed the conversation. Search results come without the parts, so
    // load the full conversation for a new or changed rating.
    let closer = existing?.closed_by ?? null;
    if (!existing || changed) {
      if (closedBy(conv) === undefined) conv = await intercom.getConversation(id);
      closer = closedBy(conv) ?? "unknown";
    }
    const byBot = closer === "bot";

    // Silent history rows only get Slack messages when the rating changes later.
    // Ratings on conversations closed by a bot never get Slack messages.
    // The main channel gets a post when the settings allow it (prefs.js); an
    // existing post is always updated. The 1–3 channel gets every 1–3 rating,
    // and its copy is updated too, also when the rating becomes positive.
    const active = post && !byBot && (!existing || changed || existing.source !== "backfill");
    const negChannel = negativeChannel();
    const needsPost = active && !existing?.slack_ts && prefs.allowsMain(score, remark);
    const needsUpdate = active && changed && Boolean(existing?.slack_ts);
    const needsNegPost = active && Boolean(negChannel) && isNegative(score) && !existing?.neg_slack_ts;
    const needsNegUpdate = active && changed && Boolean(existing?.neg_slack_ts);
    const needsMessage = needsPost || needsUpdate || needsNegPost || needsNegUpdate;

    let row = existing;
    if (!existing || changed) {
      const admin = await intercom.getAdmin(rating.teammate?.id ?? conv.admin_assignee_id);
      const contact =
        needsMessage
          ? await contactFields(conv, rating)
          : {
              contact_id: rating.contact?.id || existing?.contact_id || null,
              contact_name: existing?.contact_name || null,
              contact_email: existing?.contact_email || null,
            };
      row = {
        conversation_id: id,
        score,
        remark,
        admin_id: admin ? String(admin.id) : null,
        admin_name: admin?.name || null,
        admin_email: admin?.email || null,
        ...contact,
        // A changed score counts from when we saw the change, so a late change
        // breaks today's streak and does not rewrite history.
        rated_at: existing ? (existing.score !== score ? now : existing.rated_at) : rating.created_at || now,
        // A silent history row that changes becomes a normal row, so a failed
        // post is retried.
        source: post ? "webhook" : existing?.source || "backfill",
        closed_by: closer,
        ...(await teamFields(conv)),
        ...topicFields(conv),
      };
      if (existing) q.update.run(row);
      else q.insert.run(row);
      row = { ...existing, ...row };
    }

    if (byBot) return existing ? "unchanged (closed by a bot)" : "saved (closed by a bot)";
    if (!active) return existing ? "unchanged" : "saved";

    const url = await intercom.conversationUrl(id);
    if (needsMessage) {
      const assigneeSlackId = await slack.userIdByEmail(row.admin_email);
      const change = existing && changed ? { from: existing.score } : null;
      const message = messages.ratingMessage({ rating: row, url, assigneeSlackId, change });
      if (needsPost) {
        const posted = await slack.post(message);
        q.posted.run(posted.ts, posted.channel, nowSeconds(), id);
      } else if (needsUpdate) {
        await slack.update(existing.slack_ts, message, existing.slack_channel);
      }
      if (needsNegPost) {
        const posted = await slack.post(message, negChannel);
        q.negPosted.run(posted.ts, posted.channel, id);
      } else if (needsNegUpdate) {
        await slack.update(existing.neg_slack_ts, message, existing.neg_slack_channel);
      }
    }
    await syncBreak(row, url);
    if (needsPost || needsNegPost) return "posted";
    if (needsUpdate || needsNegUpdate) return "updated";
    return active && !existing?.slack_ts ? "saved (no post: settings)" : "unchanged";
  }

  // Intercom can set the topic attributes after the rating was posted. When a
  // posted rating has no topic yet and the conversation now has one, save it
  // and update the Slack post once. Returns true when the post was updated.
  async function refreshTopic(conv) {
    const id = String(conv.id);
    const row = q.get.get(id);
    if ((!row?.slack_ts && !row?.neg_slack_ts) || row.closed_by === "bot" || hasTopic(row)) return false;
    const topic = topicFields(conv);
    if (!hasTopic(topic)) return false;
    q.setTopic.run(topic.category, topic.product_area, topic.outcome, id);
    const url = await intercom.conversationUrl(id);
    const assigneeSlackId = await slack.userIdByEmail(row.admin_email);
    const message = messages.ratingMessage({ rating: { ...row, ...topic }, url, assigneeSlackId });
    if (row.slack_ts) await slack.update(row.slack_ts, message, row.slack_channel);
    if (row.neg_slack_ts) await slack.update(row.neg_slack_ts, message, row.neg_slack_channel);
    return true;
  }

  return { processConversation, currentStreak, streakStartDate, teamFields, refreshTopic };
}

module.exports = { createRatings };
