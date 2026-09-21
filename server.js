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
const port = Number(process.env.FILLME_PORT || 8788);
const openRouterPrimaryModel = "~typesafe/jev-latest";
const openRouterFallbackModel = "openai/gpt-5.6-luna";
const openRouterVisionModel = "openai/gpt-5.6-luna";
const openAiDefaultModel = "gpt-5.6-luna";
const instruction = "Inspect every supplied form field using its label, type, current value, required state, constraints, options, nearby instructions, and relevant answers the user previously gave. Treat page and field instructions as hard rules. Reuse or adapt a learned answer when the new question has the same meaning, but obey the current field's wording, options, and limits. For every select or dropdown, choose one exact option from the supplied options and return that option's visible label or value; never invent a new option. Respect optional fields: return an empty answer unless the user's profile or learned answers clearly supply the requested value. Respect allowed characters, examples, formats, and company-only conditions. Use the user's profile where it applies. Return JSON only in this exact shape: {\"answers\":[{\"id\":\"question id\",\"answer\":\"short draft answer\"}]}. Preserve existing values unless a better profile value is clearly available. Never invent sensitive facts. If context is missing, answer with an empty string. Keep drafts short and editable.";
const documentInstruction = "You are extracting an identity document. Inspect every supplied image separately and combine the results. Return JSON only with this shape: {\"documentType\":\"\",\"fullName\":\"\",\"documentNumber\":\"\",\"supportNumber\":\"\",\"nif\":\"\",\"socialSecurityNumber\":\"\",\"healthNumber\":\"\",\"birthDate\":\"\",\"issueDate\":\"\",\"issueCountry\":\"\",\"expiryDate\":\"\",\"additionalFields\":[{\"label\":\"\",\"value\":\"\",\"side\":\"front or back\"}]}. Extract only text that is actually visible. Read both the front and back; do not stop after the first image. For every identifier, preserve every digit, letter, check digit, prefix, suffix, spaces, and punctuation exactly as printed. Never truncate a number after the first 8 digits or discard a trailing letter/number. For Portuguese Cartão de Cidadão, specifically look for the complete document number, número de suporte, NIF, número de Segurança Social, número de utente/SNS, and any other labelled numbers on either side. Put any visible labelled value that has no dedicated field into additionalFields. Keep leading zeroes. For dates, use YYYY-MM-DD only when day, month, and year are clear; otherwise return an empty string. If a value is not visible, return an empty string and never guess. The user will review every value before saving.";
const aiPrivateLabels = ["password", "passcode", "one time code", "otp", "credit card", "card number", "cvv", "cvc", "security code", "bank account", "routing number", "iban", "passport number", "document number", "national id", "tax id", "social security", "ssn", "número do documento", "numero do documento", "número de suporte", "numero de suporte"];

function aiSafeProfile(profile = {}) {
  const customFields = (profile.customFields || []).filter((item) => {
    const label = String(item?.label || "").toLowerCase();
    return item?.label && item?.value && !aiPrivateLabels.some((pattern) => label.includes(pattern));
  });
  const safe = { ...profile, customFields };
  delete safe.documentNumber;
  delete safe.documentType;
  return safe;
}

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

function openRouterModels(requestedModel, vision = false) {
  if (vision) return [openRouterVisionModel];
  const primary = !requestedModel || [openAiDefaultModel, openRouterFallbackModel].includes(requestedModel) ? openRouterPrimaryModel : requestedModel;
  return [...new Set([primary, openRouterFallbackModel])];
}

async function requestOpenRouter({ key, requestedModel, messages, temperature, parse, timeoutMs = 12000, label, vision = false }) {
  let lastError;
  for (const model of openRouterModels(requestedModel, vision)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:8787", "X-OpenRouter-Title": "FillMe" },
        body: JSON.stringify({ model, messages, temperature }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `${label} provider returned ${response.status}`);
      return parse(data);
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error(`${label} timed out on ${model}`) : error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function answer({ provider, model, profile, learnedAnswers, questions, pageInstructions }) {
  const selectedProvider = provider === "openrouter" ? "openrouter" : "openai";
  const key = selectedProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) throw new Error(`Missing ${selectedProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} in .env`);
  const configuredModel = selectedProvider === "openrouter" ? process.env.OPENROUTER_MODEL : process.env.OPENAI_MODEL;
  const selectedModel = selectedProvider === "openrouter"
    ? (model && ![openAiDefaultModel, openRouterFallbackModel].includes(model) ? model : configuredModel || openRouterPrimaryModel)
    : (model && model !== openRouterPrimaryModel && model !== openRouterFallbackModel ? model : configuredModel || openAiDefaultModel);
  const context = JSON.stringify({ profile: aiSafeProfile(profile || {}), learnedAnswers: learnedAnswers || [], pageInstructions: pageInstructions || "", questions: questions || [] });
  const isRouter = selectedProvider === "openrouter";
  if (isRouter) {
    return requestOpenRouter({ key, requestedModel: selectedModel, messages: [{ role: "system", content: instruction }, { role: "user", content: context }], temperature: 0.2, label: "OpenRouter form answers", parse: (data) => parseAnswers(data.choices?.[0]?.message?.content) });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: selectedModel,
      store: false,
      input: [{ role: "developer", content: instruction }, { role: "user", content: context }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Provider returned ${response.status}`);
  const raw = data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n");
  return parseAnswers(raw);
}

async function extractDocument({ provider, model, documentType, frontImage, backImage }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (provider !== "openrouter" || !key) throw new Error("Missing OPENROUTER_API_KEY in .env");
  const selectedModel = model && ![openAiDefaultModel, openRouterFallbackModel].includes(model) ? model : process.env.OPENROUTER_MODEL || openRouterPrimaryModel;
  const images = [frontImage, backImage].filter(Boolean);
  if (!images.length) throw new Error("Add at least one document image first");
  const imageParts = [{ side: "front", image: frontImage }, { side: "back", image: backImage }].filter((part) => part.image);
  const content = [{ type: "text", text: `Document type selected by the user: ${documentType || "unknown"}. FRONT and BACK image labels are included before each image. Read all visible fields from both sides, including small text and reverse-side numbers.` }, ...imageParts.flatMap(({ side, image }) => [{ type: "text", text: `${side.toUpperCase()} IMAGE — inspect this side completely.` }, { type: "image_url", image_url: { url: image, detail: "high" } }])];
  return requestOpenRouter({ key, requestedModel: openRouterVisionModel, vision: true, messages: [
      { role: "system", content: documentInstruction },
      { role: "user", content }
    ], temperature: 0.1, timeoutMs: 30000, label: "OpenRouter document extraction", parse: (data) => {
      const raw = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(String(raw || "").replace(/^```json\s*|```$/g, "").trim());
      return parsed.document || parsed;
    } });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST" || !["/api/answer", "/api/extract-document"].includes(req.url)) return json(res, 404, { error: "Not found" });
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", async () => {
    try {
      const body = JSON.parse(raw);
      if (req.url === "/api/extract-document") json(res, 200, { document: await extractDocument(body) });
      else json(res, 200, { answers: await answer(body) });
    } catch (error) {
      json(res, 502, { error: error.message || "AI request failed" });
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FillMe AI server listening on http://localhost:${port}`);
});
