// Receives Intercom CSAT webhooks and posts each rating to Slack.
// Requires Node 18+ (built-in fetch). No dependencies.
//
// Env:
//   SLACK_WEBHOOK_URL  Slack incoming webhook URL (required)
//   PORT               HTTP port (default 3000)

const http = require("http");

const PORT = process.env.PORT || 3000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!SLACK_WEBHOOK_URL) {
  console.error("SLACK_WEBHOOK_URL is not set");
  process.exit(1);
}

const STARS = { 1: "😠", 2: "🙁", 3: "😐", 4: "🙂", 5: "🤩" };

function formatMessage(payload) {
  const conversation = payload?.data?.item || {};
  const rating = conversation.conversation_rating || {};
  const score = rating.rating;
  const remark = rating.remark ? `\n> ${rating.remark}` : "";
  const teammate = rating.teammate?.name || rating.teammate?.id || "unknown";

  return {
    text: `${STARS[score] || ""} CSAT ${score ?? "?"}/5 for ${teammate} (conversation ${conversation.id ?? "?"})${remark}`,
  };
}

async function postToSlack(message) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Slack responded ${res.status}`);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      if (payload.topic === "conversation.rating.added") {
        await postToSlack(formatMessage(payload));
      }
      res.writeHead(200).end();
    } catch (err) {
      console.error(err);
      res.writeHead(500).end();
    }
  });
});

server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
