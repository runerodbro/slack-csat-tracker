// HTTP server: Intercom webhook and health check.
// nginx forwards https://<host>/csat/... to this server without the /csat prefix.

const http = require("http");
const { nowSeconds } = require("./time");

const MAX_BODY = 1024 * 1024;

function createServer({ intercom, queue, config, log = console }) {
  return http.createServer((req, res) => {
    const path = req.url.split("?")[0];

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (req.method !== "POST" || path !== "/webhooks/intercom") {
      res.writeHead(404).end();
      return;
    }

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
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
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
