// Post settings changed in the Home tab: which posts go out, which ratings
// get a post in the main channel, and the separate channel for 1–3 ratings.
//
// The switches and the rating filter apply to the main channel only. The 1–3
// channel always gets every 1–3 rating and every break post. The switches
// stop the automatic posts; CLI commands still post.

const { isNegative } = require("./streak");

const PREFS_KEY = "post_settings";
const { NEGATIVE_CHANNEL_KEY } = require("./channels");

const DEFAULTS = {
  ratings: true,
  morning: true,
  weekly: true,
  breaks: true,
  scores: [1, 2, 3, 4, 5],
  positiveNeedsComment: false,
  negativeNeedsComment: false,
};

function createPrefs(settings) {
  function get() {
    try {
      return { ...DEFAULTS, ...JSON.parse(settings.get(PREFS_KEY)?.value || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function set(changes, updatedBy) {
    settings.set(PREFS_KEY, JSON.stringify({ ...get(), ...changes }), updatedBy);
  }

  // Whether a rating gets a post in the main channel.
  function allowsMain(score, remark) {
    const p = get();
    if (!p.ratings || !p.scores.includes(score)) return false;
    const needsComment = isNegative(score) ? p.negativeNeedsComment : p.positiveNeedsComment;
    return !needsComment || Boolean(remark);
  }

  return {
    get,
    set,
    allowsMain,
    row: () => settings.get(PREFS_KEY),
    negativeChannel: () => settings.get(NEGATIVE_CHANNEL_KEY)?.value || null,
    negativeChannelRow: () => settings.get(NEGATIVE_CHANNEL_KEY),
    clearNegativeChannel: (updatedBy) => settings.set(NEGATIVE_CHANNEL_KEY, "", updatedBy),
  };
}

module.exports = { createPrefs, PREFS_KEY, NEGATIVE_CHANNEL_KEY, DEFAULTS };
