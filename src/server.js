// HTTP server: Intercom webhook, Slack slash command and health check.
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

function createServer({ intercom, queue, commands, config, log = console }) {
  function slackCommand(req, res) {
    readBody(req, res, async (raw) => {
      const ok = verifySlackSignature({
        secret: config.slack.signingSecret,
        rawBody: raw.toString("utf8"),
        timestamp: req.headers["x-slack-request-timestamp"],
        signature: req.headers["x-slack-signature"],
      });
      if (!ok) {
        log.warn("Slack command with a bad signature");
        res.writeHead(401).end();
        return;
      }
      const params = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
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

  return http.createServer((req, res) => {
    const path = req.url.split("?")[0];

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (req.method === "POST" && path === "/slack/commands" && commands && config.slack.signingSecret) {
      slackCommand(req, res);
      return;
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
