const form = document.querySelector("#profile-form");
const savedCount = document.querySelector("#saved-count");
const customFields = document.querySelector("#custom-fields");
const addCustomField = document.querySelector("#add-custom-field");
const status = document.querySelector("#status");
const settingsForm = document.querySelector("#settings-form");
const mode = document.querySelector("#mode");
const apiKeyRow = document.querySelector("#api-key-row");
const apiKeyLabel = document.querySelector("#api-key-label");
const modeHelp = document.querySelector("#mode-help");
const answerMemoryStatus = document.querySelector("#answer-memory-status");
const clearAnswerMemory = document.querySelector("#clear-answer-memory");
const vaultLocked = document.querySelector("#vault-locked");
const vaultUnlocked = document.querySelector("#vault-unlocked");
const vaultState = document.querySelector("#vault-state");
const vaultPassword = document.querySelector("#vault-password");
const vaultAction = document.querySelector("#vault-action");
const vaultStatus = document.querySelector("#vault-status");
const vaultUnlockedStatus = document.querySelector("#vault-unlocked-status");
const vaultEntryForm = document.querySelector("#vault-entry-form");
const vaultEntries = document.querySelector("#vault-entries");
const vaultLock = document.querySelector("#vault-lock");
const vaultKind = vaultEntryForm.elements.namedItem("kind");
const loginFields = document.querySelector("#login-fields");
const cardFields = document.querySelector("#card-fields");
const pendingLoginBox = document.querySelector("#pending-login");
const documentForm = document.querySelector("#document-form");
const documentFront = document.querySelector("#document-front");
const documentBack = document.querySelector("#document-back");
const documentStatus = document.querySelector("#document-status");
const documentEntries = document.querySelector("#document-entries");
const documentSection = document.querySelector(".document-section");
const documentExtraFields = document.querySelector("#document-extra-fields");
const addDocumentField = document.querySelector("#add-document-field");
let activeVaultPassword = "";
let pendingLoginCandidate = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (firstError) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      throw firstError;
    }
  }
}

function renderProfile(profile) {
  Object.entries(profile).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (input && typeof value === "string") input.value = value;
  });
  renderCustomFields(profile.customFields || []);
  const standardCount = Object.entries(profile).filter(([key, value]) => key !== "customFields" && Boolean(value)).length;
  const customCount = (profile.customFields || []).filter((item) => item?.label && item?.value).length;
  savedCount.textContent = `${standardCount + customCount} saved`;
}

function renderCustomFields(fields = []) {
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  customFields.innerHTML = fields.map((item) => `<div class="custom-field-row"><label>Field name<input data-custom-label value="${escapeHtml(item.label)}" placeholder="e.g. VAT number" /></label><label>Value<input data-custom-value value="${escapeHtml(item.value)}" placeholder="Saved value" /></label><button class="text-button custom-field-remove" type="button">Remove</button></div>`).join("");
}

function collectCustomFields() {
  return [...customFields.querySelectorAll(".custom-field-row")].map((row) => ({
    label: row.querySelector("[data-custom-label]")?.value.trim() || "",
    value: row.querySelector("[data-custom-value]")?.value.trim() || ""
  })).filter((item) => item.label && item.value);
}

addCustomField.addEventListener("click", () => {
  const fields = collectCustomFields();
  fields.push({ label: "", value: "" });
  renderCustomFields(fields);
  customFields.querySelector(".custom-field-row:last-child [data-custom-label]")?.focus();
});

customFields.addEventListener("click", (event) => {
  if (!event.target.matches(".custom-field-remove")) return;
  event.target.closest(".custom-field-row")?.remove();
});

async function load() {
  const { profile = {}, settings = {}, answerMemory = [] } = await chrome.storage.local.get(["profile", "settings", "answerMemory"]);
  renderProfile(profile);
  renderAnswerMemory(answerMemory);
  const current = fillmeSettings(settings);
  mode.value = current.mode;
  settingsForm.elements.namedItem("aiApiKey").value = current.apiKey;
  settingsForm.elements.namedItem("aiModel").value = current.model;
  updateModeHelp();
  loadVaultStatus();
  loadPendingLogin();
  try {
    const tab = await activeTab();
    const websiteInput = vaultEntryForm.elements.namedItem("website");
    if (websiteInput && !websiteInput.value) websiteInput.value = siteScope("", tab).website;
    const result = await sendToPage(tab, { type: "collectForm" });
    document.querySelector("#field-count").textContent = `${Object.keys(result.values || {}).length} fields found`;
  } catch {
    document.querySelector("#field-count").textContent = "Open a webpage to get started";
  }
}

function renderAnswerMemory(answerMemory = []) {
  answerMemoryStatus.textContent = `${answerMemory.length} learned answer${answerMemory.length === 1 ? "" : "s"}`;
}

clearAnswerMemory.addEventListener("click", async () => {
  await chrome.storage.local.set({ answerMemory: [] });
  renderAnswerMemory([]);
  status.textContent = "Learned answers cleared";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

function renderVaultEntries(entries = []) {
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  vaultEntries.innerHTML = entries.length ? entries.map((entry) => `<div class="vault-entry"><span>${escapeHtml(entry.name || "Unnamed entry")}<small>${escapeHtml(entry.website || entry.hostname || "site not set")}</small></span><small>${escapeHtml(entry.kind)}</small></div>`).join("") : "<p class='mode-help'>No encrypted entries yet.</p>";
}

function renderDocumentEntries(entries = []) {
  const documents = entries.filter((entry) => entry.kind === "document");
  documentEntries.innerHTML = documents.length ? documents.map((entry) => `<div class="vault-entry"><span>${String(entry.name || entry.documentType || "Document").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]))}</span><small>encrypted</small></div>`).join("") : "<p class='mode-help'>No saved documents yet.</p>";
}

function showVaultUnlocked(entries) {
  vaultLocked.hidden = true;
  vaultUnlocked.hidden = false;
  vaultState.textContent = "unlocked";
  renderVaultEntries(entries);
  renderDocumentEntries(entries);
  renderPendingLogin();
}

function readImage(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read document image"));
    reader.onload = async () => {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        resolve(String(reader.result || ""));
      }
    };
    reader.readAsDataURL(file);
  });
}

function applyDocumentExtraction(values) {
  ["documentType", "fullName", "documentNumber", "supportNumber", "issueDate", "issueCountry", "expiryDate", "nif", "socialSecurityNumber", "healthNumber", "birthDate"].forEach((key) => {
    const input = documentForm.elements.namedItem(key);
    if (input && values?.[key]) input.value = values[key];
  });
  renderDocumentExtraFields(values?.additionalFields || []);
}

function renderDocumentExtraFields(fields = []) {
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  documentExtraFields.innerHTML = fields.map((item) => `<div class="custom-field-row"><label>Label<input data-document-label value="${escapeHtml(item.label)}" placeholder="e.g. SNS number" /></label><label>Value<input data-document-value value="${escapeHtml(item.value)}" placeholder="Extracted value" /></label><button class="text-button custom-field-remove" type="button">Remove</button></div>`).join("");
}

function collectDocumentExtraFields() {
  return [...documentExtraFields.querySelectorAll(".custom-field-row")].map((row) => ({
    label: row.querySelector("[data-document-label]")?.value.trim() || "",
    value: row.querySelector("[data-document-value]")?.value.trim() || ""
  })).filter((item) => item.label && item.value);
}

addDocumentField.addEventListener("click", () => {
  const fields = collectDocumentExtraFields();
  fields.push({ label: "", value: "" });
  renderDocumentExtraFields(fields);
  documentExtraFields.querySelector(".custom-field-row:last-child [data-document-label]")?.focus();
});

documentExtraFields.addEventListener("click", (event) => {
  if (!event.target.matches(".custom-field-remove")) return;
  event.target.closest(".custom-field-row")?.remove();
});

document.querySelector("#extract-document").addEventListener("click", async () => {
  try {
    if (!documentFront.files[0] && !documentBack.files[0]) throw new Error("Add a front or back image first");
    documentStatus.textContent = "Reading document images…";
    const { settings = {} } = await chrome.storage.local.get("settings");
    const [frontImage, backImage] = await Promise.all([readImage(documentFront.files[0]), readImage(documentBack.files[0])]);
    const result = await requestDocumentExtraction({ documentType: documentForm.elements.namedItem("documentType").value, frontImage, backImage, settings });
    applyDocumentExtraction(result);
    const extractedCount = ["documentType", "fullName", "documentNumber", "supportNumber", "nif", "socialSecurityNumber", "healthNumber", "birthDate", "issueDate", "issueCountry", "expiryDate"].filter((key) => result?.[key]).length + (result?.additionalFields || []).filter((item) => item?.label && item?.value).length;
    documentStatus.textContent = extractedCount ? `Extracted ${extractedCount} fields. Review every value before saving.` : "No readable fields found. Try clearer front and back images.";
  } catch (error) {
    documentStatus.textContent = error.message || "Could not extract document details";
  }
});

documentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeVaultPassword) {
    documentSection.open = true;
    documentStatus.textContent = "Unlock the private vault above before saving a document.";
    return;
  }
  const values = Object.fromEntries(new FormData(documentForm).entries());
  if (!values.documentNumber && !values.supportNumber && !values.nif && !values.socialSecurityNumber && !values.healthNumber && !collectDocumentExtraFields().length && !documentFront.files[0] && !documentBack.files[0]) {
    documentStatus.textContent = "Add an image or at least one document number.";
    return;
  }
  try {
    documentStatus.textContent = "Encrypting document locally…";
    const [frontImage, backImage] = await Promise.all([readImage(documentFront.files[0]), readImage(documentBack.files[0])]);
    const result = await chrome.runtime.sendMessage({ type: "vaultSaveEntry", entry: { name: values.documentType, kind: "document", ...values, additionalFields: collectDocumentExtraFields(), frontImage, backImage }, password: activeVaultPassword });
    if (!result?.ok) throw new Error(result?.error || "Could not save document");
    documentForm.reset();
    renderDocumentExtraFields([]);
    documentStatus.textContent = "Encrypted document saved locally.";
    const current = await chrome.runtime.sendMessage({ type: "vaultStatus" });
    renderDocumentEntries(current.entries || []);
  } catch (error) {
    documentStatus.textContent = error.message || "Could not save document";
  }
});

function renderPendingLogin() {
  if (!pendingLoginCandidate) {
    pendingLoginBox.hidden = true;
    pendingLoginBox.innerHTML = "";
    return;
  }
  pendingLoginBox.hidden = false;
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const action = vaultUnlocked.hidden ? "<span>Unlock the vault above to save it securely.</span>" : '<button id="save-pending-login" class="save" type="button">Save encrypted login ✓</button>';
  pendingLoginBox.innerHTML = `<strong>Login detected for ${escapeHtml(pendingLoginCandidate.site)}</strong><span>${escapeHtml(pendingLoginCandidate.username)}</span>${action}<button id="dismiss-pending-login" class="text-button" type="button">Dismiss</button>`;
  pendingLoginBox.querySelector("#save-pending-login")?.addEventListener("click", savePendingLogin);
  pendingLoginBox.querySelector("#dismiss-pending-login").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "clearPendingLogin" });
    pendingLoginCandidate = null;
    renderPendingLogin();
  });
}

async function loadPendingLogin() {
  const result = await chrome.runtime.sendMessage({ type: "pendingLogin" });
  pendingLoginCandidate = result?.candidate || null;
  renderPendingLogin();
}

async function savePendingLogin() {
  if (!activeVaultPassword || !pendingLoginCandidate) return;
  const candidate = pendingLoginCandidate;
  const result = await chrome.runtime.sendMessage({ type: "vaultSaveEntry", entry: { name: `${candidate.site} login`, kind: "login", username: candidate.username, password: candidate.password, website: candidate.origin, origin: candidate.origin, hostname: candidate.hostname }, password: activeVaultPassword });
  if (!result?.ok) { vaultUnlockedStatus.textContent = result?.error || "Could not save the detected login"; return; }
  await chrome.runtime.sendMessage({ type: "clearPendingLogin" });
  pendingLoginCandidate = null;
  vaultUnlockedStatus.textContent = `Encrypted login for ${candidate.site} saved locally.`;
  const current = await chrome.runtime.sendMessage({ type: "vaultStatus" });
  renderVaultEntries(current.entries || []);
  renderPendingLogin();
}

async function loadVaultStatus() {
  const result = await chrome.runtime.sendMessage({ type: "vaultStatus" });
  if (result?.unlocked) showVaultUnlocked(result.entries || []);
  else {
    vaultLocked.hidden = false;
    vaultUnlocked.hidden = true;
    vaultState.textContent = result?.configured ? "locked" : "not set up";
    vaultAction.textContent = result?.configured ? "Unlock private vault ⌁" : "Create private vault ⌁";
  }
}

vaultAction.addEventListener("click", async () => {
  const password = vaultPassword.value;
  if (password.length < 10) { vaultStatus.textContent = "Use at least 10 characters for the vault password."; return; }
  const current = await chrome.runtime.sendMessage({ type: "vaultStatus" });
  const result = current.configured ? await chrome.runtime.sendMessage({ type: "vaultUnlock", password }) : await chrome.runtime.sendMessage({ type: "vaultCreate", password });
  if (!result?.ok) { vaultStatus.textContent = result?.error || "Could not unlock the vault"; return; }
  activeVaultPassword = password;
  vaultPassword.value = "";
  showVaultUnlocked(result.entries || []);
  vaultUnlockedStatus.textContent = "Unlocked for this extension session. Lock it when you are done.";
});

vaultKind.addEventListener("change", () => {
  const card = vaultKind.value === "card";
  loginFields.hidden = card;
  cardFields.hidden = !card;
});

function siteScope(website, tab) {
  const fallback = tab?.url || "";
  const raw = String(website || fallback).trim();
  if (!raw) return { website: "", origin: "", hostname: "" };
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported website protocol");
    return { website: parsed.origin, origin: parsed.origin, hostname: parsed.hostname };
  } catch {
    return { website: "", origin: "", hostname: "" };
  }
}

vaultEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeVaultPassword) return;
  const values = Object.fromEntries(new FormData(vaultEntryForm).entries());
  const tab = await activeTab();
  const scope = siteScope(values.website, tab);
  const entry = values.kind === "card" ? { name: values.name, kind: "card", cardholderName: values.cardholderName, cardNumber: values.cardNumber, expiry: values.expiry, cvc: values.cvc, ...scope } : { name: values.name, kind: "login", username: values.username, password: values.password, ...scope };
  if (!entry.hostname) { vaultUnlockedStatus.textContent = "Add a valid website, such as https://example.com."; return; }
  const result = await chrome.runtime.sendMessage({ type: "vaultSaveEntry", entry, password: activeVaultPassword });
  if (!result?.ok) { vaultUnlockedStatus.textContent = result?.error || "Could not save the entry"; return; }
  vaultEntryForm.reset();
  loginFields.hidden = false;
  cardFields.hidden = true;
  vaultUnlockedStatus.textContent = "Encrypted entry saved locally.";
  const status = await chrome.runtime.sendMessage({ type: "vaultStatus" });
  renderVaultEntries(status.entries || []);
  renderDocumentEntries(status.entries || []);
});

vaultLock.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "vaultLock" });
  activeVaultPassword = "";
  vaultUnlocked.hidden = true;
  vaultLocked.hidden = false;
  vaultState.textContent = "locked";
  vaultAction.textContent = "Unlock private vault ⌁";
  vaultStatus.textContent = "Vault locked.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { profile = {} } = await chrome.storage.local.get("profile");
  const next = { ...profile, ...Object.fromEntries(new FormData(form).entries()), customFields: collectCustomFields() };
  await chrome.storage.local.set({ profile: next });
  renderProfile(next);
  status.textContent = "Saved locally";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(settingsForm).entries());
  await chrome.storage.local.set({ settings });
  status.textContent = "AI settings saved locally";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

function updateModeHelp() {
  const usingOwnKey = mode.value === "openai-key";
  const usingOwnOpenRouterKey = mode.value === "openrouter-key";
  const usingPersonalKey = usingOwnKey || usingOwnOpenRouterKey;
  const modelInput = settingsForm.elements.namedItem("aiModel");
  if (usingOwnKey && [OPENROUTER_PRIMARY_MODEL, OPENROUTER_FALLBACK_MODEL].includes(modelInput.value)) modelInput.value = OPENAI_DEFAULT_MODEL;
  if (!usingOwnKey && [OPENAI_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODEL].includes(modelInput.value)) modelInput.value = OPENROUTER_PRIMARY_MODEL;
  apiKeyRow.hidden = !usingPersonalKey;
  apiKeyLabel.textContent = usingOwnOpenRouterKey ? "Your OpenRouter API key" : "Your OpenAI API key";
  modeHelp.textContent = usingOwnKey ? "Your key stays in Chrome storage and calls OpenAI directly." : usingOwnOpenRouterKey ? "Your key stays in Chrome storage and calls OpenRouter directly." : "FillMe AI uses the FillMe backend and its OpenRouter key. This can become a paid plan later.";
}

mode.addEventListener("change", updateModeHelp);

document.querySelector("#fill-button").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const result = await sendToPage(tab, { type: "fillForm" });
    status.textContent = result.count ? `Filled ${result.count} field${result.count === 1 ? "" : "s"}` : "No matching fields found";
  } catch { status.textContent = "This page cannot be filled"; }
});

document.querySelector("#answer-button").addEventListener("click", async () => {
  const { profile = {}, settings = {}, answerMemory = [] } = await chrome.storage.local.get(["profile", "settings", "answerMemory"]);
  try {
    const tab = await activeTab();
    const learnedResult = await sendToPage(tab, { type: "applyLearnedAnswers", answerMemory });
    let { questions = [], pageInstructions = "" } = await sendToPage(tab, { type: "collectQuestions" });
    questions = questions.filter((question) => !question.answered);
    if (!questions.length) { status.textContent = learnedResult.count ? `Filled ${learnedResult.count} learned answer${learnedResult.count === 1 ? "" : "s"}` : "No unanswered questions found"; return; }
    status.textContent = `Drafting ${questions.length} answer${questions.length === 1 ? "" : "s"}…`;
    let count = learnedResult.count || 0;
    for (let pass = 0; pass < 2 && questions.length; pass += 1) {
      const answers = await requestFillmeAnswers({ profile, questions, pageInstructions, settings, answerMemory });
      const dropdownAnswer = answers.some((answer) => questions.find((question) => question.id === answer.id)?.type === "dropdown" || questions.find((question) => question.id === answer.id)?.type === "select");
      const result = await sendToPage(tab, { type: "applyAnswers", answers });
      count += result.count || 0;
      if (!dropdownAnswer) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
      ({ questions, pageInstructions } = await sendToPage(tab, { type: "collectQuestions" }));
      questions = questions.filter((question) => !question.answered);
    }
    status.textContent = count ? `Drafted ${count} answer${count === 1 ? "" : "s"} — review before submitting` : "AI returned no usable answers";
  } catch (error) {
    status.textContent = error.message.includes("Failed to fetch") ? "FillMe AI server is unavailable" : error.message;
  }
});

document.querySelector("#learn-button").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const remembered = await sendToPage(tab, { type: "rememberCurrentAnswers" });
    const result = await sendToPage(tab, { type: "collectForm" });
    const { profile = {} } = await chrome.storage.local.get("profile");
    const next = { ...profile, ...result.values };
    await chrome.storage.local.set({ profile: next });
    renderProfile(next);
    const { answerMemory = [] } = await chrome.storage.local.get("answerMemory");
    renderAnswerMemory(answerMemory);
    status.textContent = `${remembered.count || Object.keys(result.values || {}).length} answers learned locally`;
  } catch { status.textContent = "This page cannot be read"; }
});

load();
