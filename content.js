const FIELD_ALIASES = {
  firstName: ["first name", "given name", "firstname", "fname", "nome próprio", "primeiro nome"],
  lastName: ["last name", "family name", "surname", "lastname", "lname", "apelido", "sobrenome"],
  fullName: ["full name", "your name", "nome completo"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "telephone", "mobile", "tel", "telemóvel", "telefone", "telemovel"],
  company: ["company", "organization", "organisation", "employer"],
  jobTitle: ["job title", "title", "role", "position", "cargo", "função"],
  address: ["address", "street address", "address line 1", "endereço", "endereço postal", "morada"],
  city: ["city", "town", "cidade", "município", "municipio"],
  state: ["state", "province", "region", "estado", "província", "provincia"],
  postalCode: ["zip", "postal", "postcode", "zip code", "código postal", "codigo postal"],
  country: ["country", "país", "pais"],
  website: ["website", "url", "portfolio", "linkedin"]
};

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

function fieldText(field) {
  const id = field.id;
  const labels = id ? [...document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)] : [];
  const wrappingLabel = field.closest("label");
  const container = field.closest("[class*='InputContainer'], [role='group'], fieldset");
  const nearbyLabel = container?.querySelector("label, legend");
  const described = field.getAttribute("aria-label") || field.getAttribute("placeholder") || "";
  return normalize([
    field.name, id, field.getAttribute("autocomplete"), field.getAttribute("data-testid"),
    described, ...labels.map((label) => label.textContent), wrappingLabel?.textContent, nearbyLabel?.textContent
  ].join(" "));
}

function fieldKey(field) {
  const autocomplete = normalize(field.getAttribute("autocomplete"));
  const autocompleteMap = {
    given: "firstName", "family": "lastName", "name": "fullName", email: "email",
    tel: "phone", organization: "company", "street-address": "address", "address-level2": "city",
    "address-level1": "state", "postal-code": "postalCode", country: "country", url: "website"
  };
  if (autocompleteMap[autocomplete]) return autocompleteMap[autocomplete];

  const text = fieldText(field);
  const match = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return text === normalizedAlias || text.includes(normalizedAlias);
  }));
  return match?.[0];
}

function setNativeValue(field, value) {
  const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";

function ignoredField(field) {
  return field.closest("#fillme-widget") || field.disabled || field.readOnly || ["hidden", "submit", "button", "file", "password"].includes(field.type);
}

function fieldValue(field) {
  if (field.type === "radio" || field.type === "checkbox") return field.checked ? field.value || field.labels?.[0]?.textContent || "yes" : "";
  if (field.isContentEditable) return field.innerText || "";
  return field.value || "";
}

function fieldOptions(field) {
  if (field.tagName === "SELECT") return [...field.options].map((option) => option.textContent.trim()).filter(Boolean);
  if (field.type === "radio" || field.type === "checkbox") {
    const group = field.name ? [...document.querySelectorAll(`input[name="${CSS.escape(field.name)}"]`)] : [field];
    return group.map((option) => option.labels?.[0]?.textContent?.trim() || option.value).filter(Boolean);
  }
  return undefined;
}

function fill(profile) {
  let count = 0;
  document.querySelectorAll(EDITABLE_SELECTOR).forEach((field) => {
    if (ignoredField(field)) return;
    const key = fieldKey(field);
    const value = key && profile[key];
    if (!value) return;
    if (fieldValue(field) && field.tagName !== "SELECT") return;
    if (field.tagName === "SELECT") {
      const option = [...field.options].find((item) => normalize(item.value) === normalize(value) || normalize(item.textContent) === normalize(value));
      if (option) field.value = option.value;
      else return;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (field.isContentEditable) {
      field.textContent = value;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setNativeValue(field, value);
    }
    field.style.transition = "background-color 240ms ease";
    field.style.backgroundColor = "#fff6cc";
    window.setTimeout(() => { field.style.backgroundColor = ""; }, 900);
    count += 1;
  });
  return count;
}

function collectFields() {
  const values = {};
  document.querySelectorAll(EDITABLE_SELECTOR).forEach((field) => {
    if (ignoredField(field) || !fieldValue(field)) return;
    const key = fieldKey(field);
    if (key && !values[key]) values[key] = field.value;
  });
  return values;
}

function questionLabel(field) {
  const parent = field.closest("fieldset, [role='group'], .question, .form-group") || field.parentElement;
  const legend = parent?.querySelector("legend, .question-title, .label, h1, h2, h3, h4, p");
  return normalize([fieldText(field), legend?.textContent].filter(Boolean).join(" "));
}

function collectQuestions() {
  const questions = [];
  const radioGroups = new Set();
  document.querySelectorAll(EDITABLE_SELECTOR).forEach((field, index) => {
    if (ignoredField(field) || field.getClientRects().length === 0) return;
    const isRadio = ["radio", "checkbox"].includes(field.type);
    if (isRadio && field.name) {
      if (radioGroups.has(field.name)) return;
      radioGroups.add(field.name);
    }
    const text = questionLabel(field);
    const id = `ff-question-${index}`;
    field.dataset.fillflowQuestionId = id;
    questions.push({
      id,
      question: text || field.getAttribute("name") || `Field ${index + 1}`,
      type: field.tagName === "SELECT" ? "select" : field.isContentEditable ? "contenteditable" : field.type || "text",
      value: fieldValue(field),
      answered: Boolean(fieldValue(field)),
      required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
      options: fieldOptions(field)
    });
  });
  return questions;
}

function applyAnswers(answers = []) {
  let count = 0;
  answers.forEach(({ id, answer }) => {
    const field = document.querySelector(`[data-fillflow-question-id="${CSS.escape(id)}"]`);
    if (!field || !answer || (fieldValue(field) && field.type !== "checkbox")) return;
    const group = field.type === "radio" || field.type === "checkbox" ? [...document.querySelectorAll(`input[name="${CSS.escape(field.name)}"]`)] : [field];
    const target = group.find((item) => normalize(item.value) === normalize(answer) || normalize(item.labels?.[0]?.textContent).includes(normalize(answer)) || normalize(answer).includes(normalize(item.labels?.[0]?.textContent)));
    if (field.type === "radio" || field.type === "checkbox") {
      if (!target) return;
      target.checked = true;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.closest("label")?.classList.add("fillflow-ai-answer");
    } else if (field.tagName === "SELECT") {
      const option = [...field.options].find((item) => normalize(item.value) === normalize(answer) || normalize(item.textContent) === normalize(answer));
      if (!option) return;
      field.value = option.value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (field.isContentEditable) {
      field.textContent = answer;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: answer }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setNativeValue(field, answer);
    }
    field.style.backgroundColor = "#f0e7ff";
    field.style.outline = "2px solid #b99be8";
    count += 1;
  });
  return count;
}

let fillmeWidget;
let fillmeButton;

function editableFieldsPresent() {
  return [...document.querySelectorAll(EDITABLE_SELECTOR)].some((field) => !ignoredField(field) && field.getClientRects().length > 0);
}

function setWidgetText(text, busy = false) {
  if (!fillmeButton) return;
  fillmeButton.textContent = text;
  fillmeButton.disabled = busy;
}

function createFillmeWidget() {
  if (fillmeWidget || !document.body || !editableFieldsPresent()) return;
  fillmeWidget = document.createElement("div");
  fillmeWidget.id = "fillme-widget";
  fillmeWidget.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;font:600 13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;filter:drop-shadow(0 7px 16px rgba(29,41,38,.18))";
  const shadow = fillmeWidget.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{all:initial}button{border:0;border-radius:999px;padding:12px 17px;color:#fff;background:#2c725b;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:hover{background:#245e4b}button:disabled{opacity:.7;cursor:wait}</style><button type="button">✦ FillMe</button>`;
  fillmeButton = shadow.querySelector("button");
  fillmeButton.addEventListener("click", fillFromPage);
  document.body.appendChild(fillmeWidget);
}

async function fillFromPage() {
  setWidgetText("Working…", true);
  try {
    const { profile = {}, settings = {} } = await chrome.storage.local.get(["profile", "settings"]);
    const profileCount = fill(profile);
    const questions = collectQuestions();
    if (!questions.length) {
      setWidgetText(profileCount ? `Filled ${profileCount} fields` : "No fields found");
      return;
    }
    const response = await fetch("http://127.0.0.1:8787/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: settings.provider || "openai", model: settings.aiModel || "gpt-5.6-luna", profile, questions })
    });
    if (!response.ok) throw new Error("AI request failed");
    const data = await response.json();
    const aiCount = applyAnswers(data.answers || []);
    setWidgetText(`Filled ${profileCount + aiCount} fields`);
  } catch (error) {
    setWidgetText(error.message === "Failed to fetch" ? "Start FillMe server" : "AI fill failed");
  } finally {
    window.setTimeout(() => setWidgetText("✦ FillMe"), 2800);
  }
}

function updateFillmeWidget() {
  if (editableFieldsPresent()) createFillmeWidget();
}

let autoFillTimer;
function autoFill() {
  clearTimeout(autoFillTimer);
  autoFillTimer = window.setTimeout(async () => {
    const { profile = {} } = await chrome.storage.local.get("profile");
    if (Object.values(profile).some(Boolean)) fill(profile);
  }, 250);
}

autoFill();
updateFillmeWidget();
if (document.body) {
  new MutationObserver(() => { autoFill(); updateFillmeWidget(); }).observe(document.body, { childList: true, subtree: true });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.profile) autoFill();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "fillForm") {
    chrome.storage.local.get("profile").then(({ profile = {} }) => {
      sendResponse({ count: fill(profile) });
    });
    return true;
  }
  if (message.type === "collectForm") {
    sendResponse({ values: collectFields() });
  }
  if (message.type === "collectQuestions") {
    sendResponse({ questions: collectQuestions() });
  }
  if (message.type === "applyAnswers") {
    sendResponse({ count: applyAnswers(message.answers) });
  }
  return false;
});
