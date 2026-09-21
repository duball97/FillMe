(() => {
if (window.__fillmeContentLoaded) return;
window.__fillmeContentLoaded = true;
document.querySelectorAll("#fillme-widget").forEach((node) => node.remove());

// Chrome keeps an old content-script instance alive when an unpacked extension
// is reloaded. Its pending Chrome API promises can reject after the reload with
// this expected lifecycle error. Suppress only that known rejection so it does
// not become a page-level unhandled promise error; real errors still surface.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason || "");
  if (/extension context invalidated/i.test(message)) event.preventDefault();
});

const FIELD_ALIASES = {
  firstName: ["first name", "given name", "firstname", "fname", "nome próprio", "primeiro nome"],
  lastName: ["last name", "family name", "surname", "lastname", "lname", "apelido", "sobrenome"],
  middleName: ["middle name", "second name", "middle initial", "nome do meio", "apelido 2", "segundo apelido", "second surname"],
  preferredName: ["preferred name", "display name", "nickname", "nome preferido", "alcunha"],
  fullName: ["full name", "your name", "nome completo"],
  email: ["email", "e-mail", "email address"],
  phoneCountryCode: ["country code", "dial code", "indicativo", "código do país", "codigo do pais"],
  phone: ["phone", "telephone", "mobile", "tel", "telemóvel", "telefone", "telemovel"],
  company: ["company", "organization", "organisation", "employer"],
  jobTitle: ["job title", "title", "role", "position", "cargo", "função"],
  website: ["website", "url", "portfolio", "linkedin"],
  address: ["address", "street address", "address line 1", "endereço postal", "endereço", "morada"],
  addressLine2: ["address line 2", "apartment", "apt", "unit", "suite", "floor", "andar", "apartamento, quarto, piso", "apartamento"],
  city: ["city", "town", "cidade"],
  municipality: ["municipality", "município", "municipio", "concelho"],
  state: ["state", "province", "region", "estado/província", "estado", "província", "provincia"],
  postalCode: ["zip", "postal", "postcode", "zip code", "código postal", "codigo postal"],
  issueCountry: ["issuing country", "country of issue", "país de emissão", "pais de emissao", "país de emissao"],
  country: ["country", "país", "pais"],
  dateOfBirth: ["date of birth", "birth date", "birthday", "dob", "data de nascimento"],
  gender: ["gender", "sex", "género", "genero"],
  nationality: ["nationality", "nacionalidade"],
  documentType: ["document type", "tipo de documento", "id type"],
  documentNumber: ["document number", "id number", "passport number", "número do documento", "numero do documento"],
  supportNumber: ["support number", "número de suporte", "numero de suporte"],
  documentIssueDate: ["issue date", "date of issue", "data de emissão", "data de emissao"],
  documentExpiryDate: ["expiry date", "expiration date", "valid until", "data de validade"],
  checkInTime: ["check in time", "arrival time", "hora de entrada", "hora de check in"],
  emergencyContactName: ["emergency contact", "emergency contact name", "contacto de emergência", "contacto de emergencia"],
  emergencyContactPhone: ["emergency phone", "emergency contact phone", "telefone de emergência", "telefone de emergencia"]
};

/** Dropdowns that often unlock later fields — fill these before dependents. */
const UNLOCKER_KEYS = new Set(["documentType", "country", "issueCountry", "nationality", "gender", "state"]);
const DEPENDENT_KEYS = new Set(["documentNumber", "supportNumber", "documentIssueDate", "documentExpiryDate", "issueCountry", "state", "municipality"]);

let pageBusy = false;

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

const ANSWER_MEMORY_LIMIT = 250;

function answerMemoryKey(question) {
  return normalize(question).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function equivalentOption(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const groups = [
    ["cartão de cidadão", "cartao de cidadao", "documento de identidade", "dni", "id card", "identity card", "identity document"],
    ["passport", "passaporte"],
    ["residence permit", "autorização de residência", "autorizacao de residencia", "nie"],
    ["cpf"],
    ["male", "masculino", "man", "m"],
    ["female", "feminino", "woman", "f"],
    ["portugal", "portuguese", "português", "portugues", "portuguesa"]
  ];
  if (groups.some((group) => group.includes(a) && group.includes(b))) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false;
  return longer === shorter || longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`) || longer.includes(` ${shorter} `) || longer.startsWith(shorter);
}

const DROPDOWN_SELECTOR = "select, [role='combobox'], [aria-haspopup='listbox'], [role='button'][aria-haspopup='true']";
const EDITABLE_SELECTOR = `input, textarea, select, [contenteditable='true'], ${DROPDOWN_SELECTOR}`;

function isDateLikeField(field) {
  if (!field) return false;
  if (["date", "datetime-local", "month"].includes(field.type)) return true;
  const placeholder = field.getAttribute("placeholder") || "";
  const text = `${ownLabel(field)} ${placeholder} ${field.getAttribute("aria-label") || ""}`;
  return /data de nascimento|date of birth|birth date|nascimento|data de emiss[aã]o|data de validade|dd\/mm\/yyyy|mm\/dd\/yyyy|yyyy-mm-dd/i.test(text);
}

function isDropdownControl(field) {
  try {
    if (!field?.matches?.(DROPDOWN_SELECTOR)) return false;
    if (isDateLikeField(field) || field.closest?.(".rs-picker-date, .rs-picker-daterange")) return false;
    return true;
  } catch {
    return false;
  }
}

function fillableControl(field) {
  if (!field) return field;
  if (field.matches?.("input, textarea, select, [contenteditable='true']")) return field;
  return field.querySelector?.("input:not([type='hidden']), textarea, select, [contenteditable='true']") || field;
}

function ownLabel(field) {
  if (!field) return "";
  try {
    const id = field.id;
    if (id) {
      const labels = [...document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)];
      if (labels.length) return labels.map((label) => label.textContent).join(" ");
    }
    const wrapping = field.closest("label");
    if (wrapping) return wrapping.textContent || "";
    const group = field.closest(".rs-form-group, .form-group, [class*='FormGroup'], [class*='form-field'], [class*='InputContainer']");
    const groupLabel = group?.querySelector(":scope > label, :scope > .rs-form-control-label, :scope > legend, label, .rs-form-control-label");
    if (groupLabel) return groupLabel.textContent || "";
    const pickerGroup = field.closest(".rs-picker")?.closest(".rs-form-group, .form-group");
    const pickerLabel = pickerGroup?.querySelector("label, .rs-form-control-label");
    if (pickerLabel) return pickerLabel.textContent || "";
    const sibling = field.parentElement?.previousElementSibling;
    if (sibling?.matches?.("label, .rs-form-control-label")) return sibling.textContent || "";
  } catch {
    return "";
  }
  return "";
}

function comboboxRoot(field) {
  return field?.closest?.("[data-scope='combobox'][data-part='root'], [role='combobox']") || null;
}

function comboboxParts(field) {
  const rsPicker = field?.closest?.(".rs-picker, .rs-picker-toggle-wrapper, .rs-picker-input");
  if (rsPicker) {
    return {
      root: rsPicker,
      input: rsPicker.querySelector("input:not([type='hidden'])") || (field?.matches?.("input") ? field : null),
      trigger: rsPicker.querySelector(".rs-picker-toggle, [role='combobox'], button, .rs-btn") || field
    };
  }
  const root = field?.closest?.("[data-scope='combobox'][data-part='root']") || (field?.getAttribute?.("role") === "combobox" ? field : field?.closest?.("[role='combobox']"));
  const input = root?.querySelector?.("[data-part='input'][role='combobox'], input[role='combobox'], input:not([type='hidden'])")
    || (field?.matches?.("input") ? field : null);
  const trigger = root?.querySelector?.("[data-part='trigger'], button[aria-haspopup='listbox']")
    || (field?.matches?.("[aria-haspopup='listbox']") ? field : null);
  return { root, input, trigger };
}

function duplicateComboboxPart(field) {
  const { input, trigger } = comboboxParts(field);
  return Boolean(input && trigger && field === trigger);
}

async function getLocal(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch {
    return null;
  }
}

function fieldText(field) {
  const described = field.getAttribute("aria-label") || "";
  const placeholder = field.getAttribute("placeholder") || "";
  return normalize([
    field.name, field.getAttribute("autocomplete"), field.getAttribute("data-testid"),
    described, ownLabel(field), placeholder.length <= 24 ? placeholder : ""
  ].join(" "));
}

const SECRET_FIELD_PATTERNS = [
  "credit card", "card number", "cc number", "cardholder", "cvv", "cvc", "security code",
  "card expiry", "bank account", "account number", "routing number",
  "iban", "swift", "password", "passcode", "one time code", "otp"
];

const IDENTITY_FIELD_PATTERNS = [
  "social security", "ssn", "tax id", "national id", "passport number", "document number",
  "número do documento", "numero do documento", "número de suporte", "numero de suporte"
];

function textMatchesPatterns(field, patterns) {
  const autocomplete = normalize(field.getAttribute("autocomplete"));
  const text = fieldText(field);
  return [autocomplete, text].some((value) => patterns.some((pattern) => value.includes(normalize(pattern))));
}

function secretField(field) {
  const autocomplete = normalize(field.getAttribute("autocomplete"));
  const text = fieldText(field);
  if (["cc-number", "cc-exp", "cc-csc", "new-password", "current-password"].includes(autocomplete)) return true;
  if (textMatchesPatterns(field, SECRET_FIELD_PATTERNS)) return true;
  return /expir|validade|expiry/.test(text) && /card|cart[aã]o|cvv|cvc|pagamento|payment/.test(text);
}

function identityField(field) {
  return textMatchesPatterns(field, IDENTITY_FIELD_PATTERNS);
}

function privateField(field) {
  return secretField(field);
}

function fieldKey(field) {
  const autocomplete = normalize(field.getAttribute("autocomplete"));
  const autocompleteMap = {
    given: "firstName", "family": "lastName", "name": "fullName", email: "email",
    tel: "phone", organization: "company", "street-address": "address", "address-level2": "city",
    "address-line2": "addressLine2", "address-level1": "state", "postal-code": "postalCode", country: "country", bday: "dateOfBirth", sex: "gender", url: "website"
  };
  if (autocompleteMap[autocomplete] && !/emiss[aã]o|issue|validade|expiry|nacionalidade|nationality/.test(fieldText(field))) return autocompleteMap[autocomplete];

  const text = fieldText(field);
  let bestKey = null;
  let bestLength = 0;
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalize(alias);
      if (!normalizedAlias || !(text === normalizedAlias || text.includes(normalizedAlias))) continue;
      if (normalizedAlias.length > bestLength) {
        bestKey = key;
        bestLength = normalizedAlias.length;
      }
    }
  }
  return bestKey;
}

function profileValueForKey(profile, key, field = null) {
  if (!key || !profile) return "";
  if (profile[key]) return adaptValueForField(profile[key], key, field);
  if (key === "issueCountry") return adaptValueForField(profile.country || "", key, field);
  if (key === "municipality") return profile.municipality || profile.city || "";
  if (key === "middleName") return profile.middleName || profile.lastName || "";
  if (key === "documentIssueDate") return profile.documentIssueDate || profile.issueDate || "";
  if (key === "documentExpiryDate") return profile.documentExpiryDate || profile.expiryDate || "";
  if (key === "supportNumber") return profile.supportNumber || "";
  if (key === "nationality") return profile.nationality || (profile.country ? (/portugal/i.test(profile.country) ? "Portuguese" : profile.country) : "");
  if (key === "phoneCountryCode") return dialCodeFromPhone(profile.phone || profile.phoneCountryCode || "");
  if (key === "checkInTime") return profile.checkInTime || profile.customFields?.find((item) => /hora de entrada|check.?in/i.test(item?.label || ""))?.value || "";
  return "";
}

function dialCodeFromPhone(phone) {
  const match = String(phone || "").trim().match(/^\s*(\+\d{1,4})/);
  return match ? match[1] : "";
}

function localPhoneFromProfile(phone) {
  const raw = String(phone || "").trim();
  const match = raw.match(/^\s*\+\d{1,4}[\s-]*(.*)$/);
  return match ? match[1].replace(/\s+/g, "") : raw.replace(/\s+/g, "");
}

function looksLikeDialCodeField(field) {
  if (!field) return false;
  const text = fieldText(field);
  const max = field.maxLength;
  if (/indicativo|country code|dial code|código do país|codigo do pais/.test(text)) return true;
  if (max > 0 && max <= 6) return true;
  if (field.placeholder === "+" || /^\+\d*$/.test(field.value || "")) return true;
  return false;
}

function adaptValueForField(value, key, field) {
  if (!value) return "";
  if (key === "phone" || key === "phoneCountryCode") {
    if (looksLikeDialCodeField(field) || key === "phoneCountryCode") return dialCodeFromPhone(value) || value;
    const label = fieldText(field);
    if (/telefone/.test(label) && !/telem[oó]vel|mobile/.test(label)) return localPhoneFromProfile(value);
    return String(value);
  }
  return String(value);
}

function customProfileField(field, profile) {
  const text = fieldText(field);
  if (!text) return null;
  const containsPhrase = (haystack, needle) => {
    const source = haystack.split(" ").filter(Boolean);
    const target = needle.split(" ").filter(Boolean);
    if (!target.length || target.length > source.length) return false;
    return source.some((_word, index) => target.every((part, offset) => source[index + offset] === part));
  };
  return (profile?.customFields || []).find((item) => {
    const label = normalize(item?.label);
    return label && (text === label || containsPhrase(text, label) || containsPhrase(label, text));
  }) || null;
}

function setNativeValue(field, value) {
  const text = String(value ?? "");
  try {
    const prototypes = [field.constructor?.prototype, window.HTMLInputElement?.prototype, window.HTMLTextAreaElement?.prototype, window.HTMLSelectElement?.prototype];
    let setter;
    for (const proto of prototypes) {
      setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
      if (setter) break;
    }
    if (setter) setter.call(field, text);
    else field.value = text;
  } catch {
    try { field.value = text; } catch { /* page may block writes */ }
  }
  try {
    field.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }));
  } catch {
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function fillTypedValue(field, value) {
  const target = fillableControl(field);
  if (!target) return false;
  const text = String(value);
  try {
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
  } catch { /* ignore */ }
  try {
    target.focus?.();
    clickNode(target);
  } catch { /* ignore */ }
  await wait(60);
  if (target.isContentEditable) {
    target.textContent = text;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (isDateLikeField(field) || isDateLikeField(target)) {
    setNativeValue(target, "");
    await wait(20);
    setNativeValue(target, text);
    if (normalize(target.value) !== normalize(text)) {
      target.select?.();
      for (const character of text) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
        try {
          target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: character }));
        } catch {
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
        target.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true }));
        await wait(12);
      }
      setNativeValue(target, text);
    }
  } else {
    setNativeValue(target, "");
    setNativeValue(target, text);
  }
  try { target.blur?.(); } catch { /* ignore */ }
  if (isDateLikeField(field) || isDateLikeField(target)) {
    await wait(30);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  return true;
}

function parseDateParts(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) || raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!match) return null;
  const yearFirst = match[1].length === 4;
  return {
    year: yearFirst ? match[1] : match[3],
    month: (yearFirst ? match[2] : match[2]).padStart(2, "0"),
    day: (yearFirst ? match[3] : match[1]).padStart(2, "0")
  };
}

function formatDateForField(field, value) {
  const parts = parseDateParts(value);
  if (!parts) return String(value || "").trim();
  const { year, month, day } = parts;
  const hint = `${field.getAttribute("placeholder") || ""} ${field.getAttribute("aria-label") || ""} ${field.name || ""} ${field.id || ""}`.toUpperCase();
  const splitRole = splitDateRole(field);
  if (splitRole === "year") return year;
  if (splitRole === "month") return month;
  if (splitRole === "day") return day;
  if (field.type === "date" || /YYYY[-/.]MM[-/.]DD/.test(hint)) return `${year}-${month}-${day}`;
  if (/MM[-/.]DD[-/.]YYYY/.test(hint)) return `${month}/${day}/${year}`;
  if (/DD[-/.]MM[-/.]YYYY/.test(hint) || field.type === "text" || field.type === "tel" || field.inputMode === "numeric") return `${day}/${month}/${year}`;
  return `${day}/${month}/${year}`;
}

function splitDateRole(field) {
  const placeholder = (field.getAttribute("placeholder") || "").trim();
  if (/^(dd[/. -]mm[/. -]yyyy|mm[/. -]dd[/. -]yyyy|yyyy[/. -]mm[/. -]dd)$/i.test(placeholder) || /dd.*mm.*yyyy|yyyy.*mm.*dd/i.test(placeholder) && placeholder.length > 4) return null;
  const hint = `${placeholder} ${field.getAttribute("aria-label") || ""} ${field.name || ""}`.toLowerCase();
  if (/^yyyy$|year|^ano$/.test(hint)) return "year";
  if (/^mm$|^month$|^mês$|^mes$/.test(hint)) return "month";
  if (/^dd$|^day$|^dia$/.test(hint)) return "day";
  const group = field.closest("[role='group'], [class*='date'], [class*='Date']");
  const inputs = [...(group?.querySelectorAll("input:not([type='hidden'])") || [])];
  if (inputs.length >= 3 && inputs.length <= 4) {
    const index = inputs.indexOf(field);
    if (index >= 0 && index <= 2 && !(field.getAttribute("placeholder") || "").includes("/")) return ["day", "month", "year"][index];
  }
  return null;
}

function dropdownSearchText(field, value) {
  const key = fieldKey(field);
  const text = String(value || "").trim();
  if ((key === "country" || key === "issueCountry") && /portugues/i.test(text)) return "Portugal";
  if (key === "nationality") {
    if (/^portugal$/i.test(text)) return "Portuguese";
    if (/portugues/i.test(text)) return "Portuguese";
  }
  if (key === "documentType") {
    if (/cart[aã]o de cidad[aã]o|citizen card|id card|identity/i.test(text)) return "Documento de identidade";
    if (/passaporte|passport/i.test(text)) return "Passaporte";
    if (/resid[eê]ncia|residence/i.test(text)) return "Autorização de residência";
  }
  return text;
}

function valueForField(field, value) {
  if (value == null || value === "") return "";
  const text = fieldText(field);
  const placeholder = field.getAttribute("placeholder") || "";
  if (field.type === "date" || splitDateRole(field) || /date|birth|nascimento|emiss[aã]o|validade|DD.?MM.?YYYY|YYYY.?MM.?DD/i.test(`${text} ${placeholder}`)) {
    return formatDateForField(field, value);
  }
  return dropdownSearchText(field, value);
}

function ignoredField(field) {
  const nonEditableType = ["hidden", "submit", "button", "file", "password"].includes(field.type);
  const allowReadonlyDate = field.readOnly && isDateLikeField(field);
  return field.closest("#fillme-widget") || duplicateComboboxPart(field) || secretField(field) || field.disabled || (field.readOnly && !allowReadonlyDate) || (nonEditableType && !isDropdownControl(field));
}

function skipForAi(field) {
  return ignoredField(field) || identityField(field);
}

const EMPTY_FIELD_VALUES = new Set(["", "-", "—", "/", ":", ".", "select", "select an option", "choose", "choose an option", "não especificado", "nao especificado", "unspecified", "n/a", "dd", "mm", "yyyy", "hh", "min", "mm:ss"]);

function fieldValue(field) {
  if (field.type === "radio" || field.type === "checkbox") return field.checked ? field.value || field.labels?.[0]?.textContent || "yes" : "";
  if (field.isContentEditable) return field.innerText || "";
  if (isDropdownControl(field) && field.tagName !== "SELECT") {
    const labelled = field.getAttribute("aria-valuetext") || field.getAttribute("data-value") || "";
    if (labelled) return labelled;
    if (field.value) return field.value;
    const visible = field.querySelector("[data-part='value-text'], [data-part='value'], [class*='singleValue'], [class*='placeholder']");
    if (visible) return cleanInstructionText(visible.textContent);
    const text = cleanInstructionText(field.textContent);
    return text.length > 80 ? "" : text;
  }
  return field.value || "";
}

function fieldHasUsableValue(field) {
  const value = normalize(fieldValue(field));
  if (!value || EMPTY_FIELD_VALUES.has(value)) return false;
  return true;
}

function fieldOptions(field) {
  try {
    if (field.tagName === "SELECT") return [...field.options].map((option) => String(option.textContent || "").trim()).filter(Boolean);
    if (field.type === "radio" || field.type === "checkbox") {
      const group = field.name ? [...document.querySelectorAll(`input[name="${CSS.escape(field.name)}"]`)] : [field];
      return group.map((option) => String(option.labels?.[0]?.textContent || option.value || "").trim()).filter(Boolean);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function visibleDropdownOptions() {
  return [...document.querySelectorAll([
    "[role='option']",
    "[data-scope='combobox'][data-part='item']",
    "[role='menuitem']",
    "[data-radix-collection-item]",
    ".rs-picker-select-menu-item",
    ".rs-picker-select-menu-items > *",
    ".rs-check-item",
    ".rs-dropdown-item",
    ".rs-picker-menu [data-key]"
  ].join(", "))]
    .filter((option) => option.getClientRects().length > 0)
    .map((option) => ({ node: option, text: cleanInstructionText(option.getAttribute("aria-label") || option.textContent), value: option.getAttribute("data-value") || option.getAttribute("data-key") || option.getAttribute("value") || "" }))
    .filter((option) => option.text && option.text.length < 120 && !EMPTY_FIELD_VALUES.has(normalize(option.text)));
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function clickNode(node) {
  if (!node) return;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  node.click();
}

async function waitForDropdownOptions(timeout = 900) {
  const started = Date.now();
  let options = visibleDropdownOptions();
  while (!options.length && Date.now() - started < timeout) {
    await wait(40);
    options = visibleDropdownOptions();
  }
  return options;
}

function isExpandedControl(node) {
  if (!node?.getAttribute) return false;
  return node.getAttribute("aria-expanded") === "true" || node.getAttribute("data-state") === "open";
}

async function openDropdown(field) {
  if (!field) return false;
  const { input, trigger } = comboboxParts(field);
  const control = trigger || input || field;
  if (!control) return false;
  if (!isExpandedControl(input || control)) {
    try {
      control.focus?.();
      clickNode(control);
    } catch {
      return false;
    }
  }
  await wait(80);
  return true;
}

async function closeDropdown(field) {
  if (!field) return;
  const { input, trigger } = comboboxParts(field);
  const control = input || trigger || field;
  if (isExpandedControl(control)) {
    try { clickNode(trigger || control); } catch { /* leave the control alone */ }
  }
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  } catch { /* ignore */ }
}

async function dropdownOptions(field) {
  try {
    if (!field) return undefined;
    const native = fieldOptions(field);
    if (native) return native;
    const control = comboboxParts(field).input || field;
    const expanded = isExpandedControl(control);
    const options = visibleDropdownOptions();
    if (expanded && options.length) return options.map((option) => option.text).filter((text, index, all) => all.indexOf(text) === index);
    return undefined;
  } catch {
    return undefined;
  }
}

function cleanInstructionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fieldInstructions(field) {
  const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent).filter(Boolean);
  const container = field.closest("[class*='InputContainer'], [class*='field'], [class*='form-group'], [role='group'], fieldset");
  const nearby = container ? [...container.querySelectorAll("small, p, [role='note'], [class*='help'], [class*='description'], [class*='hint']")].map((node) => node.textContent) : [];
  return [...described, ...nearby].map(cleanInstructionText).filter((text, index, all) => text && all.indexOf(text) === index).join(" ").slice(0, 700);
}

function pageInstructions() {
  const candidates = [...document.querySelectorAll("form p, form small, form li, form [role='note'], form [class*='help'], form [class*='description'], form [class*='hint']")];
  return candidates.map((node) => cleanInstructionText(node.textContent)).filter((text, index, all) => text && all.indexOf(text) === index && /optional|required|only|character|company|country|must|please|allowed|format|gmbh|ag|ug/i.test(text)).join(" ").slice(0, 3000);
}

function fieldConstraints(field) {
  return {
    required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
    pattern: field.getAttribute("pattern") || undefined,
    minLength: field.minLength > 0 ? field.minLength : undefined,
    maxLength: field.maxLength > -1 ? field.maxLength : undefined,
    type: field.type || field.tagName.toLowerCase(),
    inputMode: field.getAttribute("inputmode") || undefined
  };
}

function fillPriority(key, field) {
  if (key === "documentType") return 0;
  if (UNLOCKER_KEYS.has(key) && isDropdownControl(field)) return 1;
  if (DEPENDENT_KEYS.has(key)) return 3;
  if (isDropdownControl(field)) return 2;
  return 2;
}

function countableEditableFields() {
  return [...document.querySelectorAll(EDITABLE_SELECTOR)].filter((field) => {
    try {
      return !ignoredField(field) && field.getClientRects().length > 0;
    } catch {
      return false;
    }
  });
}

async function waitForFieldGrowth(previousCount, timeout = 900) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await wait(80);
    if (countableEditableFields().length > previousCount) return true;
  }
  return countableEditableFields().length > previousCount;
}

async function fillOneField(field, profile, allowDropdowns) {
  if (ignoredField(field) || field.getClientRects().length === 0) return { filled: false, unlocked: false };
  const key = fieldKey(field);
  const custom = customProfileField(field, profile);
  const raw = profileValueForKey(profile, key, field) || custom?.value;
  if (!raw) return { filled: false, unlocked: false };
  const value = valueForField(field, raw);
  if (!value) return { filled: false, unlocked: false };
  if (fieldHasUsableValue(field) && (!isDropdownControl(field) || equivalentOption(fieldValue(field), value))) {
    return { filled: false, unlocked: false };
  }
  if (isDropdownControl(field)) {
    if (!allowDropdowns) return { filled: false, unlocked: false };
    if (!await chooseDropdownOption(field, value)) return { filled: false, unlocked: false };
  } else {
    await fillTypedValue(field, value);
  }
  const painted = fillableControl(field);
  if (painted?.style) {
    painted.style.transition = "background-color 240ms ease";
    painted.style.backgroundColor = "#fff6cc";
    window.setTimeout(() => { painted.style.backgroundColor = ""; }, 900);
  }
  return { filled: true, unlocked: UNLOCKER_KEYS.has(key) || key === "documentType" };
}

async function fillPass(profile, allowDropdowns, { onlyUnlockers = false, skipDependents = false } = {}) {
  let count = 0;
  let unlocked = false;
  const fields = countableEditableFields()
    .map((field) => ({ field, key: fieldKey(field), priority: fillPriority(fieldKey(field), field) }))
    .filter(({ key, field }) => {
      if (onlyUnlockers) return UNLOCKER_KEYS.has(key) || key === "documentType" || (isDropdownControl(field) && /tipo de documento|document type|país|pais|nationality|nacionalidade|género|genero|gender/i.test(fieldText(field)));
      if (skipDependents) return !DEPENDENT_KEYS.has(key);
      return true;
    })
    .sort((left, right) => left.priority - right.priority || 0);

  for (const { field } of fields) {
    try {
      const result = await fillOneField(field, profile, allowDropdowns);
      if (result.filled) count += 1;
      if (result.unlocked) unlocked = true;
    } catch {
      continue;
    }
  }
  return { count, unlocked };
}

async function fill(profile, { allowDropdowns = true } = {}) {
  if (!profile || typeof profile !== "object" || fillInProgress) return 0;
  fillInProgress = true;
  let count = 0;
  try {
    // Pass 1: unlocker dropdowns first (document type, country, nationality…)
    const first = await fillPass(profile, allowDropdowns, { onlyUnlockers: true });
    count += first.count;
    if (first.unlocked || first.count) {
      const before = countableEditableFields().length;
      await waitForFieldGrowth(before, 1100);
      await wait(200);
    }

    // Pass 2: everything except late dependents
    const second = await fillPass(profile, allowDropdowns, { skipDependents: true });
    count += second.count;
    if (second.unlocked) {
      await waitForFieldGrowth(countableEditableFields().length, 800);
      await wait(150);
    }

    // Pass 3–4: dependents + leftovers (document number/dates after type is set)
    for (let pass = 0; pass < 3; pass += 1) {
      const before = countableEditableFields().length;
      const next = await fillPass(profile, allowDropdowns);
      count += next.count;
      if (!next.count && !next.unlocked) break;
      await waitForFieldGrowth(before, 700);
      await wait(120);
    }
  } finally {
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch { /* ignore */ }
    fillInProgress = false;
  }
  return count;
}

function collectFields() {
  const values = {};
  document.querySelectorAll(EDITABLE_SELECTOR).forEach((field) => {
    if (ignoredField(field) || !fieldHasUsableValue(field)) return;
    const key = fieldKey(field);
    if (key && !values[key]) values[key] = profileValue(field);
  });
  return values;
}

function profileValue(field) {
  try {
    if (field.tagName === "SELECT") return String(field.selectedOptions?.[0]?.textContent || fieldValue(field) || "").trim();
    if (field.type === "radio" || field.type === "checkbox") return String(field.labels?.[0]?.textContent || fieldValue(field) || "").trim();
    return String(fieldValue(field) || "").trim();
  } catch {
    return "";
  }
}

function storedAnswerMemory(stored) {
  return (Array.isArray(stored?.answerMemory) ? stored.answerMemory : []).filter((item) => item && item.key && item.answer);
}

async function rememberField(field) {
  try {
    if (!field || ignoredField(field) || !fieldHasUsableValue(field)) return;
    const key = fieldKey(field);
    const stored = await getLocal(["profile", "answerMemory"]);
    if (!stored) return;
    const profile = stored.profile || {};
    const custom = customProfileField(field, profile);
    const value = profileValue(field);
    if (!value) return;
    const question = questionLabel(field);
    const memoryKey = answerMemoryKey(question);
    const updates = {};
    if (memoryKey && question.length >= 3) {
      const previous = storedAnswerMemory(stored);
      const existing = previous.find((item) => item.key === memoryKey);
      updates.answerMemory = [{
        key: memoryKey,
        question,
        answer: String(value),
        type: isDropdownControl(field) ? "dropdown" : field.type || (field.isContentEditable ? "contenteditable" : "text"),
        hostname: location.hostname,
        updatedAt: new Date().toISOString(),
        uses: Number(existing?.uses || 0) + 1
      }, ...previous.filter((item) => item.key !== memoryKey)].slice(0, ANSWER_MEMORY_LIMIT);
    }
    if (custom) {
      const customFields = (profile.customFields || []).map((item) => item === custom ? { ...item, value } : item);
      if (custom.value !== value) updates.profile = { ...profile, customFields };
    } else if (key && profile[key] !== value) {
      updates.profile = { ...profile, [key]: value };
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  } catch {
    /* learning must never break fill */
  }
}

let rememberTimer;
function rememberEditedField(event) {
  const field = event.target?.closest?.(EDITABLE_SELECTOR);
  if (!field) return;
  clearTimeout(rememberTimer);
  rememberTimer = window.setTimeout(() => { rememberField(field).catch(() => {}); }, 350);
}

function questionLabel(field) {
  const own = ownLabel(field);
  const accessible = field.getAttribute("aria-label") || "";
  return normalize(own || accessible || field.name || field.id || fieldText(field));
}

async function collectQuestions() {
  const questions = [];
  const radioGroups = new Set();
  const fields = [...document.querySelectorAll(EDITABLE_SELECTOR)];
  for (const [index, field] of fields.entries()) {
    try {
      if (!field || skipForAi(field) || field.getClientRects().length === 0) continue;
      const isRadio = ["radio", "checkbox"].includes(field.type);
      if (isRadio && field.name) {
        if (radioGroups.has(field.name)) continue;
        radioGroups.add(field.name);
      }
      const text = questionLabel(field);
      const id = `ff-question-${index}`;
      field.dataset.fillflowQuestionId = id;
      questions.push({
        id,
        question: text || field.getAttribute("name") || `Field ${index + 1}`,
        type: isDropdownControl(field) ? "dropdown" : field.isContentEditable ? "contenteditable" : field.type || "text",
        value: fieldValue(field),
        answered: fieldHasUsableValue(field),
        required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
        options: isDropdownControl(field) ? await dropdownOptions(field) : fieldOptions(field),
        instructions: fieldInstructions(field),
        constraints: fieldConstraints(field)
      });
    } catch {
      continue;
    }
  }
  return { questions, pageInstructions: pageInstructions() };
}

async function chooseDropdownOption(field, answer) {
  if (!answer) return false;
  const wanted = dropdownSearchText(field, answer);
  const nativeSelect = field.tagName === "SELECT" ? field : null;
  if (nativeSelect) {
    const option = [...nativeSelect.options].find((item) => equivalentOption(item.value, wanted) || equivalentOption(item.textContent, wanted));
    if (!option) return false;
    setNativeValue(nativeSelect, option.value);
    nativeSelect.dispatchEvent(new Event("input", { bubbles: true }));
    nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (!await openDropdown(field)) return false;
  await wait(100);
  const matchWanted = (options) => options.find((option) => normalize(option.text) === normalize(wanted) || normalize(option.value) === normalize(wanted))
    || options.find((option) => equivalentOption(option.text, wanted) || equivalentOption(option.value, wanted));
  let options = await waitForDropdownOptions(1200);
  let target = matchWanted(options);
  const { input, trigger } = comboboxParts(field);
  const typeTarget = input || (field.matches?.("input, textarea") ? field : null);
  if (!target && typeTarget) {
    try {
      typeTarget.focus?.();
      setNativeValue(typeTarget, "");
      setNativeValue(typeTarget, wanted);
    } catch { /* ignore */ }
    options = await waitForDropdownOptions(1200);
    target = matchWanted(options);
  }
  if (!target && wanted) {
    // Type-ahead into the open menu for long country/nationality lists
    for (const character of String(wanted).slice(0, 12)) {
      document.activeElement?.dispatchEvent?.(new KeyboardEvent("keydown", { key: character, bubbles: true }));
      await wait(18);
    }
    options = await waitForDropdownOptions(800);
    target = matchWanted(options);
  }
  if (target) {
    try { target.node.scrollIntoView?.({ block: "nearest" }); } catch { /* ignore */ }
    clickNode(target.node);
    await wait(120);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  await closeDropdown(field);
  return false;
}

async function applyAnswers(answers = []) {
  let count = 0;
  for (const { id, answer } of answers) {
    const field = document.querySelector(`[data-fillflow-question-id="${CSS.escape(id)}"]`);
    if (!field || !answer) continue;
    if (fieldHasUsableValue(field) && field.type !== "checkbox" && (!isDropdownControl(field) || equivalentOption(fieldValue(field), answer))) continue;
    const previousValue = fieldValue(field);
    const group = field.type === "radio" || field.type === "checkbox" ? [...document.querySelectorAll(`input[name="${CSS.escape(field.name)}"]`)] : [field];
    const target = group.find((item) => normalize(item.value) === normalize(answer) || normalize(item.labels?.[0]?.textContent).includes(normalize(answer)) || normalize(answer).includes(normalize(item.labels?.[0]?.textContent)));
    if (field.type === "radio" || field.type === "checkbox") {
      if (!target) continue;
      target.checked = true;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.closest("label")?.classList.add("fillflow-ai-answer");
    } else if (isDropdownControl(field)) {
      if (!await chooseDropdownOption(field, answer)) continue;
    } else {
      await fillTypedValue(field, answer);
    }
    if (typeof field.checkValidity === "function" && !field.checkValidity()) {
      if (field.type === "radio" || field.type === "checkbox") target.checked = false;
      else if (field.tagName === "SELECT") field.value = previousValue;
      else setNativeValue(field, previousValue);
      continue;
    }
    field.style.backgroundColor = "#f0e7ff";
    field.style.outline = "2px solid #b99be8";
    await rememberField(target || field).catch(() => {});
    count += 1;
  }
  return count;
}

function learnedAnswersForQuestions(questions = [], answerMemory = []) {
  const byKey = new Map(storedAnswerMemory({ answerMemory }).map((item) => [item.key || answerMemoryKey(item.question), item]));
  return questions.filter((question) => !question.answered).flatMap((question) => {
    const learned = byKey.get(answerMemoryKey(question.question));
    if (!learned?.answer) return [];
    if (question.options?.length) {
      const option = question.options.find((item) => equivalentOption(item, learned.answer));
      if (!option) return [];
      return [{ id: question.id, answer: option }];
    }
    return [{ id: question.id, answer: learned.answer }];
  });
}

async function applyLearnedAnswers(answerMemory = []) {
  const { questions } = await collectQuestions();
  return applyAnswers(learnedAnswersForQuestions(questions, answerMemory));
}

async function rememberCurrentAnswers() {
  let count = 0;
  for (const field of document.querySelectorAll(EDITABLE_SELECTOR)) {
    if (ignoredField(field) || !fieldHasUsableValue(field) || field.getClientRects().length === 0) continue;
    await rememberField(field);
    count += 1;
  }
  return count;
}

function vaultFieldType(field) {
  const autocomplete = normalize(field.getAttribute("autocomplete"));
  const text = fieldText(field);
  if (text.includes("nif") || text.includes("tax number") || text.includes("tax identification") || text.includes("número de contribuinte") || text.includes("numero de contribuinte")) return "nif";
  if (text.includes("social security") || text.includes("segurança social") || text.includes("seguranca social") || text.includes("niss")) return "socialSecurityNumber";
  if (text.includes("health number") || text.includes("utente") || text.includes("sns number") || text.includes("número de utente") || text.includes("numero de utente")) return "healthNumber";
  if (text.includes("birth date") || text.includes("date of birth") || text.includes("data de nascimento")) return "birthDate";
  if (text.includes("full name") || text.includes("nome completo")) return "fullName";
  if (text.includes("support number") || text.includes("número de suporte") || text.includes("numero de suporte")) return "supportNumber";
  if (text.includes("document type") || text.includes("tipo de documento")) return "documentType";
  if (text.includes("document number") || text.includes("número do documento") || text.includes("numero do documento")) return "documentNumber";
  if (text.includes("issue date") || text.includes("date of issue") || text.includes("data de emissão") || text.includes("data de emissao")) return "issueDate";
  if (text.includes("issuing country") || text.includes("país de emissão") || text.includes("pais de emissao")) return "issueCountry";
  if (text.includes("expiry date") || text.includes("expiration date") || text.includes("data de validade")) return "expiryDate";
  if (field.type === "password" || text.includes("password") || autocomplete.includes("password")) return "password";
  if (["cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-name"].includes(autocomplete)) return autocomplete;
  if (text.includes("credit card") || text.includes("card number")) return "cc-number";
  if (text.includes("security code") || text.includes("cvv") || text.includes("cvc")) return "cc-csc";
  if (text.includes("expiry") || text.includes("expiration")) return "cc-exp";
  if (text.includes("cardholder") || text.includes("name on card")) return "cc-name";
  if (field.type === "email" || text.includes("username") || text.includes("user name")) return "username";
  return null;
}

async function applyVault(entries = [], retried = false) {
  const login = entries.find((entry) => (entry.kind === "login" || entry.password || entry.username) && (entry.origin || entry.website) === location.origin)
    || entries.find((entry) => (entry.kind === "login" || entry.password || entry.username) && entry.hostname === location.hostname);
  const card = entries.find((entry) => (entry.kind === "card" || entry.cardNumber) && (entry.origin || entry.website) === location.origin)
    || entries.find((entry) => (entry.kind === "card" || entry.cardNumber) && entry.hostname === location.hostname);
  const documentEntry = entries.find((entry) => entry.kind === "document" || entry.documentNumber || entry.supportNumber);
  let count = 0;
  let documentTypeChanged = false;

  const vaultValue = (type, extra) => type === "password" ? login?.password : type === "username" ? login?.username : type === "cc-number" ? card?.cardNumber : type === "cc-exp" ? card?.expiry : type === "cc-exp-month" ? card?.expiry?.split("/")[0] : type === "cc-exp-year" ? card?.expiry?.split("/")[1] : type === "cc-csc" ? card?.cvc : type === "cc-name" ? card?.cardholderName : type === "documentType" ? documentEntry?.documentType : type === "fullName" ? documentEntry?.fullName : type === "documentNumber" ? documentEntry?.documentNumber : type === "supportNumber" ? documentEntry?.supportNumber : type === "nif" ? documentEntry?.nif : type === "socialSecurityNumber" ? documentEntry?.socialSecurityNumber : type === "healthNumber" ? documentEntry?.healthNumber : type === "birthDate" ? documentEntry?.birthDate : type === "issueDate" ? documentEntry?.issueDate : type === "issueCountry" ? (documentEntry?.issueCountry || documentEntry?.country) : type === "expiryDate" ? documentEntry?.expiryDate : type === "documentExtra" ? extra?.value : null;

  const targets = countableEditableFields().map((field) => {
    const extra = documentEntry?.additionalFields?.find((item) => {
      const label = normalize(item?.label);
      const text = fieldText(field);
      return label && (text === label || text.includes(label) || label.includes(text));
    });
    const type = vaultFieldType(field) || (extra ? "documentExtra" : null);
    return { field, type, extra, priority: type === "documentType" ? 0 : type === "issueCountry" || type === "birthDate" ? 1 : 2 };
  }).filter((item) => item.type).sort((left, right) => left.priority - right.priority);

  for (const { field, type, extra } of targets) {
    if (field.closest("#fillme-widget") || duplicateComboboxPart(field) || field.disabled || field.getClientRects().length === 0) continue;
    if (field.readOnly && !isDateLikeField(field)) continue;
    const raw = vaultValue(type, extra);
    if (!raw) continue;
    const value = valueForField(field, raw);
    if (fieldHasUsableValue(field) && (!isDropdownControl(field) || equivalentOption(fieldValue(field), value))) continue;
    if (isDropdownControl(field)) {
      if (!await chooseDropdownOption(field, value)) continue;
      if (type === "documentType") documentTypeChanged = true;
    } else {
      await fillTypedValue(field, value);
      if (type === "documentType") documentTypeChanged = true;
    }
    field.style.backgroundColor = "#e9f0ff";
    field.style.outline = "2px solid #8aa9e6";
    count += 1;
  }
  if (documentTypeChanged && !retried) {
    await waitForFieldGrowth(countableEditableFields().length, 1000);
    await wait(200);
    const extra = await applyVault(entries, true);
    count += extra.count || 0;
  }
  return { ok: true, count };
}

function loginFormInfo() {
  const passwords = [...document.querySelectorAll("input[type='password']")].filter((field) => field.getClientRects().length && !field.disabled && !field.readOnly);
  const password = passwords[0];
  if (!password) return null;
  const form = password.form || password.closest("form") || document;
  const candidates = [...form.querySelectorAll("input")].filter((field) => field !== password && field.getClientRects().length && !field.disabled && !field.readOnly && ["text", "email", "tel", "url", ""].includes(field.type));
  const username = candidates.find((field) => /user|login|email|mail|account|username/i.test(field.name || field.id || field.autocomplete || field.placeholder)) || candidates[0];
  if (!username?.value || !password.value) return null;
  return { username: username.value.trim(), password: password.value, origin: location.origin, hostname: location.hostname, site: location.hostname };
}

function captureLoginCandidate() {
  const candidate = loginFormInfo();
  if (!candidate) return;
  try { chrome.runtime.sendMessage({ type: "loginCandidate", candidate }).catch(() => {}); } catch { /* page may be unloading */ }
}

function watchLoginForms() {
  document.addEventListener("submit", (event) => {
    if (event.target?.querySelector?.("input[type='password']")) captureLoginCandidate();
  }, true);
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button, input[type='submit']");
    if (button?.closest?.("form")?.querySelector?.("input[type='password']")) captureLoginCandidate();
  }, true);
}

let fillmeWidget;
let fillmeButton;
let widgetDismissed = false;

function isWidgetDismissed() {
  try { return sessionStorage.getItem("fillmeWidgetDismissed") === "1"; } catch { return false; }
}

function dismissWidget() {
  widgetDismissed = true;
  try { sessionStorage.setItem("fillmeWidgetDismissed", "1"); } catch { /* session storage may be unavailable */ }
  fillmeWidget?.remove();
  fillmeWidget = null;
  fillmeButton = null;
}

function editableFieldsPresent() {
  return [...document.querySelectorAll(EDITABLE_SELECTOR)].some((field) => !ignoredField(field) && field.getClientRects().length > 0);
}

function setWidgetText(text, busy = false) {
  if (!fillmeButton) return;
  fillmeButton.textContent = busy ? "…" : "✦";
  fillmeButton.title = text;
  fillmeButton.disabled = busy;
}

function createFillmeWidget() {
  if (widgetDismissed || isWidgetDismissed() || fillmeWidget || !document.body || !editableFieldsPresent()) return;
  fillmeWidget = document.createElement("div");
  fillmeWidget.id = "fillme-widget";
  fillmeWidget.style.cssText = "position:fixed;right:84px;bottom:22px;z-index:2147483647;width:44px;height:44px;font:600 13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;filter:drop-shadow(0 7px 14px rgba(20,34,29,.22))";
  const shadow = fillmeWidget.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{all:initial}.wrap{position:relative;width:44px;height:44px}button{display:grid;place-items:center;border:0;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}#fill{width:42px;height:42px;padding:0;border:1px solid rgba(255,255,255,.28);border-radius:50%;color:#fff;background:linear-gradient(135deg,#285b49,#183b31);box-shadow:0 3px 0 rgba(8,24,18,.18),inset 0 1px 0 rgba(255,255,255,.15);font-size:18px}#fill:hover{transform:translateY(-1px);filter:brightness(1.08);box-shadow:0 7px 15px rgba(8,24,18,.2),inset 0 1px 0 rgba(255,255,255,.2)}#fill:active{transform:translateY(0)}#fill:disabled{opacity:.72;cursor:wait}#close{position:absolute;top:-6px;right:-6px;width:17px;height:17px;padding:0;border:1px solid rgba(255,255,255,.9);border-radius:50%;color:#48635a;background:#fff;box-shadow:0 2px 7px rgba(20,34,29,.22);font-size:12px;line-height:1}#close:hover{color:#183b31;background:#eef8f1;transform:scale(1.08)}</style><div class="wrap"><button id="fill" type="button" aria-label="Fill Me" title="Fill Me">✦</button><button id="close" type="button" aria-label="Hide FillMe on this page" title="Hide on this page">×</button></div>`;
  fillmeButton = shadow.querySelector("#fill");
  fillmeButton.addEventListener("click", fillFromPage);
  shadow.querySelector("#close").addEventListener("click", (event) => { event.stopPropagation(); dismissWidget(); });
  document.body.appendChild(fillmeWidget);
}

async function fillFromPage() {
  if (pageBusy) return;
  pageBusy = true;
  setWidgetText("Working…", true);
  try {
    const stored = await getLocal(["profile", "settings", "answerMemory"]);
    if (!stored) throw new Error("Extension context invalidated");
    const { profile = {}, settings = {}, answerMemory = [] } = stored;

    // Profile first (unlockers → dependents), then vault document, then profile again for newly unlocked fields
    let profileCount = await fill(profile);
    const vaultResult = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "fillVaultFields", origin: location.origin, hostname: location.hostname }, (result) => resolve(result || { count: 0 }));
      } catch {
        resolve({ count: 0 });
      }
    });
    await wait(250);
    profileCount += await fill(profile);

    const learnedCount = await applyLearnedAnswers(answerMemory);
    await wait(150);
    profileCount += await fill(profile);

    let { questions, pageInstructions } = await collectQuestions();
    questions = questions.filter((question) => !question.answered);
    let aiCount = 0;
    if (questions.length) {
      for (let pass = 0; pass < 3 && questions.length; pass += 1) {
        const answers = await requestFillmeAnswers({ profile, questions, pageInstructions, settings, answerMemory });
        const dropdownAnswer = answers.some((answer) => {
          const question = questions.find((item) => item.id === answer.id);
          return question?.type === "dropdown" || question?.type === "select";
        });
        aiCount += await applyAnswers(answers);
        await wait(200);
        profileCount += await fill(profile);
        ({ questions, pageInstructions } = await collectQuestions());
        questions = questions.filter((question) => !question.answered);
        if (!dropdownAnswer && !questions.some((question) => question.type === "dropdown")) break;
      }
    }
    const count = (profileCount || 0) + (vaultResult.count || 0) + (learnedCount || 0) + aiCount;
    const leftover = (await collectQuestions()).questions.filter((question) => !question.answered).length;
    setWidgetText(leftover ? `Done — filled ${count}, ${leftover} left` : `Done — filled ${count} fields`);
  } catch (error) {
    setWidgetText(error.message === "Failed to fetch" ? "Start FillMe server" : "AI fill failed");
  } finally {
    pageBusy = false;
    window.setTimeout(() => setWidgetText("✦ FillMe"), 4000);
  }
}

function updateFillmeWidget() {
  if (!widgetDismissed && !isWidgetDismissed() && editableFieldsPresent()) createFillmeWidget();
}

let autoFillTimer;
let didInitialFill = false;
function autoFill() {
  if (pageBusy || fillInProgress) return;
  clearTimeout(autoFillTimer);
  autoFillTimer = window.setTimeout(async () => {
    if (pageBusy || fillInProgress) return;
    try {
      const stored = await getLocal("profile");
      if (!stored) return;
      const { profile = {} } = stored;
      const allowDropdowns = !didInitialFill;
      didInitialFill = true;
      if (Object.values(profile).some(Boolean)) await fill(profile, { allowDropdowns });
      try { chrome.runtime.sendMessage({ type: "fillVaultFields", origin: location.origin, hostname: location.hostname }).catch(() => {}); } catch { /* locked vault or a reloaded context */ }
    } catch {
      // A page can outlive a reloaded extension. The next page refresh gets a fresh context.
    }
  }, 250);
}

autoFill();
updateFillmeWidget();
watchLoginForms();
if (document.body) {
  new MutationObserver(() => { autoFill(); updateFillmeWidget(); }).observe(document.body, { childList: true, subtree: true });
}
try {
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.profile) autoFill();
  });
} catch {
  // The page can outlive a reloaded extension. Refreshing the page installs the new context.
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "fillForm") {
    getLocal("profile").then(async (stored) => {
      sendResponse({ count: await fill(stored?.profile || {}) });
    }).catch(() => sendResponse({ count: 0 }));
    return true;
  }
  if (message.type === "collectForm") {
    sendResponse({ values: collectFields() });
  }
  if (message.type === "collectQuestions") {
    collectQuestions().then(sendResponse).catch(() => sendResponse({ questions: [], pageInstructions: "" }));
    return true;
  }
  if (message.type === "applyAnswers") {
    applyAnswers(message.answers).then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
    return true;
  }
  if (message.type === "applyLearnedAnswers") {
    applyLearnedAnswers(message.answerMemory).then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
    return true;
  }
  if (message.type === "rememberCurrentAnswers") {
    rememberCurrentAnswers().then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
    return true;
  }
  if (message.type === "applyVault") {
    applyVault(message.entries).then(sendResponse).catch(() => sendResponse({ ok: false, count: 0 }));
    return true;
  }
  return false;
});

document.addEventListener("input", rememberEditedField, true);
document.addEventListener("change", rememberEditedField, true);
})();
