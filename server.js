const http = require("node:http");
const fs = require("node:fs");

function loadDotEnv() {
  const path = ".env";
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadDotEnv();
const port = Number(process.env.FILLME_PORT || 8787);
const instruction = "Inspect every supplied form field using its label, type, current value, required state, and options. Use the user's profile where it applies. Return JSON only in this exact shape: {\"answers\":[{\"id\":\"question id\",\"answer\":\"short draft answer\"}]}. Preserve existing values unless a better profile value is clearly available. Never invent sensitive facts. If context is missing, answer with an empty string. Keep drafts short and editable.";

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

function parseAnswers(raw) {
  const text = String(raw || "").replace(/^```json\s*|```$/g, "").trim();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.answers || [];
}

async function answer({ provider, model, profile, questions }) {
  const selectedProvider = provider === "openrouter" ? "openrouter" : "openai";
  const key = selectedProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) throw new Error(`Missing ${selectedProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} in .env`);
  const configuredModel = selectedProvider === "openrouter" ? process.env.OPENROUTER_MODEL : process.env.OPENAI_MODEL;
  const selectedModel = model && model !== "gpt-5.6-luna" ? model : configuredModel || model || "gpt-5.6-luna";
  const context = JSON.stringify({ profile: profile || {}, questions: questions || [] });
  const isRouter = selectedProvider === "openrouter";
  const response = await fetch(isRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(isRouter ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:8787", "X-OpenRouter-Title": "FillMe" } : {})
    },
    body: JSON.stringify(isRouter ? {
      model: selectedModel,
      messages: [{ role: "system", content: instruction }, { role: "user", content: context }],
      temperature: 0.2
    } : {
      model: selectedModel,
      store: false,
      input: [{ role: "developer", content: instruction }, { role: "user", content: context }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Provider returned ${response.status}`);
  const raw = isRouter ? data.choices?.[0]?.message?.content : data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n");
  return parseAnswers(raw);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST" || req.url !== "/api/answer") return json(res, 404, { error: "Not found" });
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", async () => {
    try {
      const answers = await answer(JSON.parse(raw));
      json(res, 200, { answers });
    } catch (error) {
      json(res, 502, { error: error.message || "AI request failed" });
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FillMe AI server listening on http://localhost:${port}`);
});
