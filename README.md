# FillMe

FillMe is a local-first Chrome extension for keeping a personal form profile and automatically filling common fields as pages load. The popup also has a manual fill button for forms that appear later.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin Fillflow, open a page with a form, and click the extension.

The profile is stored in `chrome.storage.local`. The first pass recognizes common names, email, phone, company, address, city, state, postal code, country, and website fields through labels, `name`, `id`, placeholders, and standard autocomplete attributes.

Optional AI answers use a local server:

```sh
cp .env.example .env
# edit .env and add OPENAI_API_KEY and/or OPENROUTER_API_KEY
npm run server
```

Then choose **OpenAI / ChatGPT** or **OpenRouter** in the FillMe popup. The browser extension never receives the provider key. Clicking “Answer with AI” sends the detected unanswered questions and profile context to the local server, which forwards them to the selected provider and inserts drafts into the page for you to review. Provider model IDs vary, so set `OPENAI_MODEL` or `OPENROUTER_MODEL` in `.env` when `gpt-5.6-luna` is not a valid ID for that provider.

## Product boundary

The extension fills editable text fields, textareas, and select inputs. It intentionally skips passwords, file uploads, disabled/read-only fields, and submitting forms. “Learn from this page” only reads non-empty fields after an explicit click.
