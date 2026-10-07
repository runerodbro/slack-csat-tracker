// HTTP server: Intercom webhook, Slack slash command, Slack events and
// interactions (the Home tab), and health check.
// Apache forwards https://<host>/csat/... to this server without the /csat prefix.

const http = require("http");
const { nowSeconds } = require("./time");
const { verifySlackSignature } = require("./slack");

const MAX_BODY = 1024 * 1024;

function readBody(req, res, onBody) {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
    } else {
      chunks.push(chunk);
    }
  });
  req.on("end", () => onBody(Buffer.concat(chunks)));
}

function createServer({ intercom, queue, commands, home, config, log = console }) {
  // Reads a Slack request and checks its signature; calls onBody with the raw text.
  function slackRequest(req, res, kind, onBody) {
    readBody(req, res, (raw) => {
      const body = raw.toString("utf8");
      const ok = verifySlackSignature({
        secret: config.slack.signingSecret,
        rawBody: body,
        timestamp: req.headers["x-slack-request-timestamp"],
        signature: req.headers["x-slack-signature"],
      });
      if (!ok) {
        log.warn(`Slack ${kind} with a bad signature`);
        res.writeHead(401).end();
        return;
      }
      onBody(body);
    });
  }

  function slackCommand(req, res) {
    slackRequest(req, res, "command", async (raw) => {
      const params = Object.fromEntries(new URLSearchParams(raw));
      let body;
      try {
        body = await commands.handle(params);
      } catch (err) {
        log.error(`Slack command: ${err.message}`);
        body = { response_type: "ephemeral", text: `Something went wrong: ${err.message}` };
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
  }

  // Events API: the URL check when the Request URL is saved, and app_home_opened.
  // Slack wants an answer within 3 seconds, so the Home tab is drawn afterwards.
  function slackEvent(req, res) {
    slackRequest(req, res, "event", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (payload.type === "url_verification") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ challenge: payload.challenge }));
        return;
      }
      res.writeHead(200).end();
      const event = payload.event;
      if (event?.type === "app_home_opened" && event.tab === "home" && event.user) {
        home.publish(event.user).catch((err) => log.error(`Home tab: ${err.message}`));
      }
    });
  }

  // Buttons and dropdowns in the Home tab.
  function slackInteraction(req, res) {
    slackRequest(req, res, "interaction", (raw) => {
      let payload;
      try {
        payload = JSON.parse(new URLSearchParams(raw).get("payload"));
      } catch {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(200).end();
      if (payload?.type === "block_actions") {
        home.action(payload).catch((err) => log.error(`Home tab action: ${err.message}`));
      }
    });
  }

  return http.createServer((req, res) => {
    const path = req.url.split("?")[0];

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (req.method === "POST" && config.slack.signingSecret) {
      if (path === "/slack/commands" && commands) return slackCommand(req, res);
      if (path === "/slack/events" && home) return slackEvent(req, res);
      if (path === "/slack/interactions" && home) return slackInteraction(req, res);
    }
    if (req.method !== "POST" || path !== "/webhooks/intercom") {
      res.writeHead(404).end();
      return;
    }

    readBody(req, res, (raw) => {
      if (!intercom.verifySignature(raw, req.headers["x-hub-signature"])) {
        log.warn("Webhook with a bad signature");
        res.writeHead(401).end();
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const conversationId = payload.data?.item?.id;
      if (payload.topic?.startsWith("conversation.rating") && conversationId) {
        queue.enqueue(conversationId, nowSeconds() + config.postDelaySeconds);
        log.info(`Webhook ${payload.topic}: conversation ${conversationId} queued`);
      }
      res.writeHead(200).end();
    });
  });
}

module.exports = { createServer };
