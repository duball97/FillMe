const form = document.querySelector("#profile-form");
const savedCount = document.querySelector("#saved-count");
const status = document.querySelector("#status");
const settingsForm = document.querySelector("#settings-form");

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
    if (input) input.value = value;
  });
  savedCount.textContent = `${Object.values(profile).filter(Boolean).length} saved`;
}

async function load() {
  const { profile = {}, settings = {} } = await chrome.storage.local.get(["profile", "settings"]);
  renderProfile(profile);
  settingsForm.elements.namedItem("provider").value = settings.provider || "openai";
  settingsForm.elements.namedItem("aiModel").value = settings.aiModel || "gpt-5.6-luna";
  try {
    const tab = await activeTab();
    const result = await sendToPage(tab, { type: "collectForm" });
    document.querySelector("#field-count").textContent = `${Object.keys(result.values || {}).length} fields found`;
  } catch {
    document.querySelector("#field-count").textContent = "Open a webpage to get started";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { profile = {} } = await chrome.storage.local.get("profile");
  const next = { ...profile, ...Object.fromEntries(new FormData(form).entries()) };
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

document.querySelector("#fill-button").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const result = await sendToPage(tab, { type: "fillForm" });
    status.textContent = result.count ? `Filled ${result.count} field${result.count === 1 ? "" : "s"}` : "No matching fields found";
  } catch { status.textContent = "This page cannot be filled"; }
});

document.querySelector("#answer-button").addEventListener("click", async () => {
  const { profile = {}, settings = {} } = await chrome.storage.local.get(["profile", "settings"]);
  try {
    const tab = await activeTab();
    const { questions = [] } = await sendToPage(tab, { type: "collectQuestions" });
    if (!questions.length) { status.textContent = "No unanswered questions found"; return; }
    status.textContent = `Drafting ${questions.length} answer${questions.length === 1 ? "" : "s"}…`;
    const response = await fetch("http://127.0.0.1:8787/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: settings.provider || "openai",
        model: settings.aiModel || "gpt-5.6-luna",
        profile,
        questions
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || "AI request failed");
    }
    const data = await response.json();
    const result = await sendToPage(tab, { type: "applyAnswers", answers: data.answers || [] });
    status.textContent = result.count ? `Drafted ${result.count} answer${result.count === 1 ? "" : "s"} — review before submitting` : "AI returned no usable answers";
  } catch (error) {
    status.textContent = error.message.includes("Failed to fetch") ? "Start the local FillMe server first" : "AI request failed — check provider, model, and .env";
  }
});

document.querySelector("#learn-button").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const result = await sendToPage(tab, { type: "collectForm" });
    const { profile = {} } = await chrome.storage.local.get("profile");
    const next = { ...profile, ...result.values };
    await chrome.storage.local.set({ profile: next });
    renderProfile(next);
    status.textContent = `${Object.keys(result.values || {}).length} values learned locally`;
  } catch { status.textContent = "This page cannot be read"; }
});

load();
