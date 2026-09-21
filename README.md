# FillMe

FillMe is a Chrome extension that keeps your personal details ready and helps you get through repetitive forms faster.

It combines ordinary profile autofill with an optional AI layer. FillMe recognizes fields by their labels, names, placeholders, autocomplete attributes, and surrounding form context. When a page needs more than a name or address, AI can inspect the visible fields and draft answers for you to review.

## What it does

- Shows a small floating **✦ FillMe** control near the lower-right corner when a page contains editable fields; close it with **×** for the current page session.
- Fills common profile details automatically as pages load.
- Stores broader personal details such as date of birth, nationality, gender, document type, and emergency contact information locally.
- Lets you add any extra profile label and value, such as a tax number, loyalty ID, or membership number. Custom values are matched to future field labels and stay in local Chrome storage.
- Learns profile values from a form when you explicitly choose **Learn from the form**.
- Learns recognizable values from your edits and AI answers, so correcting a date of birth once can improve future forms.
- Keeps up to 250 non-sensitive question-and-answer memories locally. Exact repeat questions fill instantly, while related past answers are included in later AI prompts for CV, application, and VC forms. The AI settings panel shows the learned-answer count and provides a clear button.
- Provides an encrypted private vault for login and card entries that stays separate from profile data and AI requests.
- Detects login forms on sites such as Reddit, captures a submitted login temporarily in extension memory, and asks you to save it to the encrypted vault.
- Scopes saved login autofill to the site where the credential was saved.
- Stores document front/back images and editable extracted fields in the encrypted vault.
- Supports explicit AI extraction for document images through OpenAI, OpenRouter, or the FillMe backend.
- Understands common field labels in English and Portuguese.
- Lets AI inspect each visible field, including its label, type, current value, required state, and available options.
- Understands native and accessible custom dropdowns, chooses an exact available option, opens custom controls, and clicks the matching option. It runs a second pass after a dropdown unlocks dependent fields.
- Passes field and page instructions to AI, including optional/required conditions, allowed characters, formats, examples, and native validation rules.
- Supports three AI access modes, with exactly one active at a time:
  - **Use my OpenAI API key**: your key stays in Chrome storage and is used directly from the extension.
  - **Use my OpenRouter API key**: your key stays in Chrome storage and is used directly from the extension.
  - **Use FillMe AI (OpenRouter)**: requests go through the FillMe backend, which keeps the provider key server-side.
- Highlights AI-generated drafts so you can change them before submitting.

FillMe never submits a form. Passwords, payment fields, bank details, one-time codes, and sensitive government ID fields are blocked from normal autofill, learning, and AI inspection. Document images are an explicit extraction flow that runs only after you click **Extract with AI**.

## Private vault

The private vault is separate from the AI context. Create a vault password in the popup, add login or card entries, and set the Website field so FillMe knows exactly where that entry may be used. Unlock it only when you want FillMe to use those values. Vault data is encrypted locally with Web Crypto AES-GCM and a PBKDF2-derived key. The vault password is never stored, and the encrypted record is the only vault data written to Chrome storage.

AI cannot read vault entries. The page scanner excludes payment, password, bank, one-time-code, and sensitive ID fields before building an AI request. When FillMe sees a login submission, it keeps the candidate only in the background service worker for up to ten minutes; open the extension, unlock the vault, and explicitly save it. The candidate is discarded if you dismiss it or do not save it. A user action is required to unlock the vault and fill those fields. A browser-only vault protects against ordinary storage inspection, but a compromised device, browser profile, or malicious extension with equivalent access can still access data while the vault is unlocked.

## Documents and identity extraction

Open the **Documents** dropdown in the popup, select a document type, and add its front and back images. Click **Extract with AI** only when you want the selected provider to inspect those images. FillMe reads both sides and returns document type, the complete document number, support number, NIF, social security number, health/SNS number, dates, issuing country, and other labelled values when they are visible. Review and correct the values, then click **Save encrypted document**.

The images and extracted values are encrypted together inside the private vault. They are not included in normal AI form-answer requests. When the vault is unlocked and you click **Fill Me**, document fields can be filled from the saved document. AI, vault, documents, and profile controls are separate dropdowns so the full profile is not shown at once.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Reload the FillMe card after code changes, then refresh the page you are testing.

## AI setup

OpenRouter uses the fast `~typesafe/jev-latest` model for text form answers. If that request fails or returns unusable output, FillMe tries `openai/gpt-5.6-luna` once as the backup. Document image extraction uses that vision-capable OpenRouter model directly because Jev is a text-only structured decision model. OpenAI key mode uses the provider-native `gpt-5.6-luna` model ID.

### Use your own OpenAI key

Open the FillMe popup, choose **Use my OpenAI API key**, paste your key, and save the AI settings. The key is stored locally in Chrome and is never sent to the FillMe backend. This mode is useful for personal use, but a browser extension cannot make a secret key fully inaccessible to the person who installed it.

### Use your own OpenRouter key

Open the FillMe popup, choose **Use my OpenRouter API key**, paste your key, and save the AI settings. The extension calls OpenRouter directly and does not use the FillMe backend in this mode. A browser extension cannot make a user-provided key fully inaccessible to the person who installed it.

### Use FillMe AI with OpenRouter

For local development, copy the environment template and start the backend:

```sh
cp .env.example .env
npm run server
```

Add your server-side key to `.env`:

```env
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=~typesafe/jev-latest
```

The extension currently calls `http://127.0.0.1:8788` to avoid common local development port conflicts. For a public release, deploy `server.js` behind HTTPS, change `FILLME_AI_SERVER_URL` in `ai-client.js` to your API domain, and add authentication, rate limits, usage limits, logging controls, and billing before allowing public access.

## Project structure

```text
manifest.json   Chrome Manifest V3 configuration
popup.html      Extension popup and settings UI
popup.js        Profile and settings interactions
content.js      Field detection, page button, autofill, and answer application
ai-client.js    OpenAI direct mode and FillMe AI client routing
server.js       Local/backend provider proxy and document extraction endpoint
background.js   Extension installation and message lifecycle
```

## Privacy model

Profile autofill and learned profile updates run inside the browser. AI requests are opt-in. In OpenAI key mode, selected non-sensitive page context goes directly from the extension to OpenAI. In FillMe AI mode, it goes to the FillMe backend and then the configured provider. Payment, password, bank, one-time-code, and sensitive ID fields are filtered out before normal AI or local learning sees them; document image extraction is a separate explicit action. FillMe never clicks a submit button.

## Development

There are no runtime dependencies for the current local server. Use Node.js 18 or newer, then run:

```sh
npm run server
```

Validate the scripts with:

```sh
node --check ai-client.js
node --check content.js
node --check popup.js
node --check server.js
```
