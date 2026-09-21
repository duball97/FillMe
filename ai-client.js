const FILLME_AI_SERVER_URL = "http://127.0.0.1:8788";
const OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
const OPENROUTER_PRIMARY_MODEL = "~typesafe/jev-latest";
const OPENROUTER_FALLBACK_MODEL = "openai/gpt-5.6-luna";
const OPENROUTER_VISION_MODEL = "openai/gpt-5.6-luna";

function fillmeSettings(settings = {}) {
  const mode = settings.mode || (settings.aiApiKey ? "openai-key" : "fillme-openrouter");
  const savedModel = settings.aiModel || "";
  const savedOpenRouterFallback = [OPENAI_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODEL].includes(savedModel);
  const model = mode === "openai-key"
    ? (savedModel && savedModel !== OPENROUTER_PRIMARY_MODEL ? (savedModel === OPENROUTER_FALLBACK_MODEL ? OPENAI_DEFAULT_MODEL : savedModel) : OPENAI_DEFAULT_MODEL)
    : (savedModel && !savedOpenRouterFallback ? savedModel : OPENROUTER_PRIMARY_MODEL);
  return { mode, model, apiKey: settings.aiApiKey || "" };
}

function openRouterModels(requestedModel, vision = false) {
  if (vision) return [OPENROUTER_VISION_MODEL];
  const primary = !requestedModel || [OPENAI_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODEL].includes(requestedModel) ? OPENROUTER_PRIMARY_MODEL : requestedModel;
  return [...new Set([primary, OPENROUTER_FALLBACK_MODEL])];
}

async function requestOpenRouter({ apiKey, requestedModel, messages, temperature, parse, timeoutMs = 12000, label, vision = false }) {
  let lastError;
  for (const model of openRouterModels(requestedModel, vision)) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://fillme.local", "X-OpenRouter-Title": "FillMe" },
        body: JSON.stringify({ model, messages, temperature }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `${label} provider returned ${response.status}`);
      return parse(data);
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error(`${label} timed out on ${model}`) : error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function openAiText(data) {
  return data.output_text || data.output?.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n") || "";
}

function parseFillmeAnswers(raw) {
  const parsed = JSON.parse(String(raw || "").replace(/^```json\s*|```$/g, "").trim());
  return Array.isArray(parsed) ? parsed : parsed.answers || [];
}

function parseDocumentExtraction(raw) {
  const parsed = JSON.parse(String(raw || "").replace(/^```json\s*|```$/g, "").trim());
  return parsed.document || parsed;
}

const AI_PRIVATE_LABELS = ["password", "passcode", "one time code", "otp", "credit card", "card number", "cvv", "cvc", "security code", "bank account", "routing number", "iban", "passport number", "document number", "national id", "tax id", "social security", "ssn", "número do documento", "numero do documento", "número de suporte", "numero de suporte"];

function aiSafeProfile(profile = {}) {
  const customFields = (profile.customFields || []).filter((item) => {
    const label = String(item?.label || "").toLowerCase();
    return item?.label && item?.value && !AI_PRIVATE_LABELS.some((pattern) => label.includes(pattern));
  });
  const safe = { ...profile, customFields };
  ["documentNumber", "documentType"].forEach((key) => { delete safe[key]; });
  return safe;
}

function relevantLearnedAnswers(answerMemory = [], questions = []) {
  const targets = questions.map((question) => String(question.question || "").toLowerCase());
  const targetTokens = new Set(targets.flatMap((text) => text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2)));
  return answerMemory
    .filter((item) => item?.question && item?.answer && !AI_PRIVATE_LABELS.some((pattern) => String(item.question).toLowerCase().includes(pattern)))
    .map((item) => {
      const question = String(item.question).toLowerCase();
      const exact = targets.includes(question);
      const overlap = question.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && targetTokens.has(token)).length;
      return { item, score: exact ? 1000 : overlap + Math.min(Number(item.uses || 0), 5) / 10 };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 24)
    .map(({ item }) => ({ question: item.question, answer: item.answer, type: item.type, hostname: item.hostname }));
}

async function requestDocumentExtraction({ documentType, frontImage, backImage, settings }) {
  const selected = fillmeSettings(settings);
  const instruction = "You are extracting an identity document. Inspect every supplied image separately and combine the results. Return JSON only with this shape: {\"documentType\":\"\",\"fullName\":\"\",\"documentNumber\":\"\",\"supportNumber\":\"\",\"nif\":\"\",\"socialSecurityNumber\":\"\",\"healthNumber\":\"\",\"birthDate\":\"\",\"issueDate\":\"\",\"issueCountry\":\"\",\"expiryDate\":\"\",\"additionalFields\":[{\"label\":\"\",\"value\":\"\",\"side\":\"front or back\"}]}. Extract only text that is actually visible. Read both the front and back; do not stop after the first image. For every identifier, preserve every digit, letter, check digit, prefix, suffix, spaces, and punctuation exactly as printed. Never truncate a number after the first 8 digits or discard a trailing letter/number. For Portuguese Cartão de Cidadão, specifically look for the complete document number, número de suporte, NIF, número de Segurança Social, número de utente/SNS, and any other labelled numbers on either side. Put any visible labelled value that has no dedicated field into additionalFields. Keep leading zeroes. For dates, use YYYY-MM-DD only when day, month, and year are clear; otherwise return an empty string. If a value is not visible, return an empty string and never guess. The user will review every value before saving.";
  const prompt = `Document type selected by the user: ${documentType || "unknown"}. FRONT and BACK image labels are included before each image. Read all visible fields from both sides, including small text and reverse-side numbers.`;
  const imageParts = [{ side: "front", image: frontImage }, { side: "back", image: backImage }].filter((part) => part.image);
  if (!imageParts.length) throw new Error("Add at least one document image first");
  const openAiContent = [{ type: "input_text", text: prompt }, ...imageParts.flatMap(({ side, image }) => [{ type: "input_text", text: `${side.toUpperCase()} IMAGE — inspect this side completely.` }, { type: "input_image", image_url: image, detail: "high" }])];
  const openRouterContent = [{ type: "text", text: prompt }, ...imageParts.flatMap(({ side, image }) => [{ type: "text", text: `${side.toUpperCase()} IMAGE — inspect this side completely.` }, { type: "image_url", image_url: { url: image, detail: "high" } }])];

  if (selected.mode === "openai-key") {
    if (!selected.apiKey) throw new Error("Add your OpenAI API key in FillMe settings");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${selected.apiKey}` },
      body: JSON.stringify({ model: selected.model, store: false, input: [
        { role: "developer", content: instruction },
        { role: "user", content: openAiContent }
      ] })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI document extraction failed");
    return parseDocumentExtraction(openAiText(data));
  }

  if (selected.mode === "openrouter-key") {
    if (!selected.apiKey) throw new Error("Add your OpenRouter API key in FillMe settings");
    return requestOpenRouter({ apiKey: selected.apiKey, requestedModel: OPENROUTER_VISION_MODEL, vision: true, messages: [
      { role: "system", content: instruction },
      { role: "user", content: openRouterContent }
    ], temperature: 0.1, timeoutMs: 30000, label: "OpenRouter document extraction", parse: (data) => parseDocumentExtraction(data.choices?.[0]?.message?.content) });
  }

  const response = await fetch(`${FILLME_AI_SERVER_URL}/api/extract-document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", model: selected.model, documentType, frontImage, backImage })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "FillMe document extraction failed");
  return data.document || {};
}

async function requestFillmeAnswers({ profile, questions, pageInstructions = "", settings, answerMemory = [] }) {
  const selected = fillmeSettings(settings);
  const instruction = "Inspect every supplied form field using its label, type, current value, required state, constraints, options, nearby instructions, and relevant answers the user previously gave. Treat page and field instructions as hard rules. Reuse or adapt a learned answer when the new question has the same meaning, but obey the current field's wording, options, and limits. For every select or dropdown, choose one exact option from the supplied options and return that option's visible label or value; never invent a new option. Respect optional fields: return an empty answer unless the user's profile or learned answers clearly supply the requested value. Respect allowed characters, examples, formats, and company-only conditions. Use the user's profile where it applies. Return JSON only in this exact shape: {\"answers\":[{\"id\":\"question id\",\"answer\":\"short draft answer\"}]}. Preserve existing values unless a better profile value is clearly available. Never invent sensitive facts. If context is missing, answer with an empty string. Keep drafts short and editable.";
  const safeProfile = aiSafeProfile(profile || {});
  const learnedAnswers = relevantLearnedAnswers(answerMemory, questions || []);
  const context = JSON.stringify({ profile: safeProfile, learnedAnswers, pageInstructions, questions: questions || [] });
  if (selected.mode === "openai-key") {
    if (!selected.apiKey) throw new Error("Add your OpenAI API key in FillMe settings");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${selected.apiKey}` },
      body: JSON.stringify({ model: selected.model, store: false, input: [{ role: "developer", content: instruction }, { role: "user", content: context }] })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI request failed");
    return parseFillmeAnswers(openAiText(data));
  }

  if (selected.mode === "openrouter-key") {
    if (!selected.apiKey) throw new Error("Add your OpenRouter API key in FillMe settings");
    return requestOpenRouter({ apiKey: selected.apiKey, requestedModel: selected.model, messages: [{ role: "system", content: instruction }, { role: "user", content: context }], temperature: 0.2, label: "OpenRouter form answers", parse: (data) => parseFillmeAnswers(data.choices?.[0]?.message?.content) });
  }

  const response = await fetch(`${FILLME_AI_SERVER_URL}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", model: selected.model, profile: safeProfile, learnedAnswers, questions, pageInstructions })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "FillMe AI request failed");
  return data.answers || [];
}
