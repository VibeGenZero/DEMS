---
id: ai-integration
title: AI integration — event assistant for members, drafting for admins
type: concept
tags: [ai, ki, assistant, event-assistant, llm, provider, ollama, openai, anthropic, gemini, openrouter, ask, chat, draft, editor, setup, mock]
sources: [ai/client.js, ai/errors.js, ai/settings.js, ai/limits.js, ai/usage.js, ai/eventContext.js, ai/memberAssistant.js, ai/eventDraft.js, ai/draftFields.js, ai/providers/openaiCompatible.js, ai/providers/anthropic.js, ai/providers/mock.js, ai/providers/sse.js, ai/providers/jsonHint.js, routes/eventAsk.js, routes/adminAi.js, routes/aiConnection.js, routes/setup.js, bot/ask.js, bot/commands.js, utils/askRefresh.js, utils/systemConfig.js, utils/systemValues.js, public/js/events/assistant.js, public/js/events/assistant-stream.js, public/js/admin/editor-assist.js, public/js/admin/system-ai.js, public/js/pages/setup.js, dev/mockMode.js]
depends_on: [configuration, data-model, security]
see_also: [bot, discord-integration, frontend-app, frontend-markup, routes-admin, routes-events, dev-mock-mode, testing]
---
# AI integration — event assistant for members, drafting for admins

> TL;DR: Optional (3.2.0). With `AI_PROVIDER` empty nothing changes: no bubble, no button, no `/ask`, no outgoing request. When a provider is set, members ask questions about **one** event — chat bubble on the event page (streamed), `/ask` (German `/frage`) and „Frage stellen“ in Discord — and the answer comes only from that event's data. Admins describe an event in free text in the editor's „KI-Assistent“ panel; the AI returns a **patch for the form**, DEMS validates it like a manual save, and nothing is stored until the admin saves. Connection values are managed system keys (System › KI, setup step „KI (optional)“, or `.env`); behaviour lives in `aiSettings/config`. The browser only ever talks to DEMS; DEMS talks to the provider through global `fetch`. Dev mock mode uses the provider `mock` (no network).

## Providers (`ai/client.js`, `ai/providers/`)

| id | adapter | default base URL | key |
|---|---|---|---|
| `ollama` | OpenAI-compatible | `http://localhost:11434/v1` | not needed |
| `openrouter` | OpenAI-compatible | `https://openrouter.ai/api/v1` | needed |
| `openai` | OpenAI-compatible | `https://api.openai.com/v1` | needed |
| `gemini` | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | needed |
| `anthropic` | Anthropic Messages | `https://api.anthropic.com/v1` | needed |
| `mock` | `ai/providers/mock.js` | — | only with `DEV_MOCK=true` |

- `getAiClient({ admin, overrides })` → `{ chat({ system, messages, maxTokens, timeoutMs, json, onToken, signal }), listModels() }`. `admin: true` uses `AI_MODEL_ADMIN` (fallback `AI_MODEL`). `isAiConfigured()` = provider + model + key (except ollama). Env keys are read at call time.
- The OpenAI adapter sends `max_completion_tokens` and retries once with `max_tokens` after a 400; streaming is SSE (`ai/providers/sse.js`). JSON is asked for by prompt only (`jsonHint.js`), never by a provider JSON mode.
- Errors are `AiError` with a code; `AI_ERROR_MESSAGES` (`ai/errors.js`) holds the German sentence per code. Logs carry the code, never text.
- `POST /api/admin/ai/test` / `models` and `POST /api/setup/ai/test` / `models` share `routes/aiConnection.js`: they try typed, unsaved values. A stored key is only reused for the stored provider **and** the stored endpoint (a typed different base URL gets no key).

## Settings

- **Connection** (managed keys, group `ai`, applies live; [configuration](../ops/configuration.md)): `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY` (secret), `AI_MODEL`, `AI_MODEL_ADMIN`. Saved in System › KI (password dialog like the other groups) or by the setup wizard; `.env` locks them. A stored key belongs to its provider and address: a save that changes `AI_PROVIDER` (also to empty = AI off) or `AI_BASE_URL` without typing a new key removes it (`dropsStoredAiKey`, `utils/systemValues.js`), so it never follows to a new host; a key from `.env` stays.
- **Behaviour** (`aiSettings/config`, `ai/settings.js`, `GET/PUT /api/admin/ai/settings`, audit `UPDATE_AI_SETTINGS` with the changed keys only): `memberWeb`, `memberDiscord`, `adminAssistant`, `teaserEnabled` (all default on), `teaserText` (≤ 120), `assistantName` (default „Event-Assistent“), `extraInstructions` (≤ 1000), `memberQuestionsPerHour` (default 20), `dailyQuestionLimit` (default 500, 0 = none).
- `isFeatureOn(name)` = configured **and** the switch is on. `GET /api/server-info` carries `ai: { memberAssistant, assistantName, teaserText, adminAssistant }` (never a key or model) → `state.aiInfo` in the browser.
- Event field `aiNotes` (≤ 4000, editor step 1 „Zusatzinfos für den Event-Assistenten“): extra facts only the assistant reads; admin-only in answers, but **not a secret** — the assistant may pass it on.

## A member question

1. Web: `POST /api/events/:id/ask` `{ question ≤ 500, history ≤ 6 turns }` (`routes/eventAsk.js`, login + CSRF). Discord: `/ask` or the button → modal (`bot/ask.js`).
2. `prepareEventQuestion()` (`ai/memberAssistant.js`) runs every check that can refuse — feature on, event `active` and visible to the asker, limits (`ai/limits.js`: one question at a time, per hour, per day; web and Discord share them by user id) — and builds the prompt from `buildEventContext()` (`ai/eventContext.js`), in the sections „Beschreibung“, „Teilnahmebedingungen“ (access, roles, approval, deadlines), „Termin“ (dates in `TIMEZONE`, location), „Plätze“ (places, waitlist, slots), „Formular“ and „Zusatzinfos“ (`aiNotes`); the model names the section it used. Never other members, never the asker's name or id, never check-in codes.
3. `run({ onToken, signal })` calls the provider (≤ 400 output tokens, 60 s). An answer that is only a „Quelle:“ line (or nothing) is refused with the „nicht erreichbar“ sentence on both channels, never shown empty. The web streams `token` events, then `done` with `source` (the model's last line „Quelle: …“ is cut off and shown as a chip); refusals before the stream are JSON (400/404/429), errors after it an `error` event with one German sentence. A closed tab aborts the upstream request; the busy lock is always released.
4. Discord answers ephemerally, cut to 2000 characters, with `allowedMentions: { parse: [] }` and a link via `buildEventUrl(id)`.
5. `recordUsage()` counts per day (`aiUsage/<YYYY-MM-DD>`, kept 90 days). No question or answer text is stored or logged.

## An admin draft

1. Editor panel (`public/js/admin/editor-assist.js`) → `POST /api/admin/ai/event-draft` `{ message ≤ 2000, draft, history }` (60 requests per admin and hour; feature off → 404).
2. `draftEvent()` (`ai/eventDraft.js`) gives the model today's date and time zone, the field description of `describeDraftFields()` (from the validators' own limits), guild roles and channels, templates, the last 10 events and the current draft — admin-visible data only, marked as data. Answer: `{ patch, reply, questions ≤ 3 }`.
3. `sanitizePatch()` (`ai/draftFields.js`) keeps own keys of `ALLOWED_DRAFT_FIELDS` (template fields without the banner + the four dates + `aiNotes`; never `status`, `checkinCode`, series fields — a dropped one adds „Felder wie Status oder Banner setze ich nicht …“ to the reply), converts local `YYYY-MM-DDTHH:mm` to ISO, drops unknown role and channel ids. The merged draft runs through `checkEventFields`, and dates of the patch must not lie in the past; one repair call gets the German errors; whatever still fails is removed and named („Nicht übernommen: …“).
4. The browser applies the patch with `applyDraft` over a snapshot of the form, marks changed fields („von KI“, accent outline) until they are edited or saved, and offers one „Rückgängig“. Field helpers: `POST /api/admin/ai/text` with `improve-description` or `suggest-ai-notes`.

## Where it lives

| Part | Files |
|---|---|
| provider layer, settings, limits, usage | `ai/` |
| web question (stream) | `routes/eventAsk.js` (mounted before `routes/events.js`; does not inherit its `router.param('id')`, the service checks the event), `public/js/events/assistant.js`, `assistant-stream.js` |
| Discord | `bot/ask.js`, `/ask` in `bot/commands.js`, button in the announcement (`bot/messages.js`); `refreshAskFeature` re-registers commands and announcements when `memberDiscord` flips (`utils/askRefresh.js`, in the background) |
| admin API | `routes/adminAi.js`, `routes/aiConnection.js` |
| editor | `public/js/admin/editor-assist.js` (panel `#event-editor-assist`) |
| System › KI | `public/js/admin/system-ai.js` + the `ai` group of `system.js` |
| setup step | `routes/setup.js` (`/ai/test`, `/ai/models`, AI fields of `/complete`), `public/js/pages/setup.js` (step `ai`) |

## Testing

- Dev mock mode sets `AI_PROVIDER=mock`, `AI_MODEL=mock-1`: member answers are „Mock-Antwort: <question>“ with the source „Beschreibung“; a draft answers `{ patch: { title: <message> }, reply: 'Entwurf ist im Formular.' }`.
- Unit and route tests: `test/ai*.test.js`, `test/eventAssistantView.test.js`, `test/editorAssistView.test.js`, `test/systemAiView.test.js`, `test/setupRoutes.test.js`, `test/setupView.test.js`. Adapters are tested against a local `http.createServer` fake.
- Browser: `e2e/eventPage.spec.js` (chat, teaser, phone), `e2e/wizard.spec.js` (editor panel), `e2e/admin.spec.js` (System › KI; the switch test starts its own server because the switch is shared state), `e2e/csp.spec.js` (open chat), `e2e/setup.spec.js` (skip the step).

## Gotchas

- An admin-set `AI_BASE_URL` may point at a private address (Ollama on the LAN is the point); only admins and the setup session can set or test it ([security](security.md)).
- The key is stored in plain text in `systemSettings/config` like the other secrets; it never appears in an answer, a log line or the audit log.
- An old „Frage stellen“ button or an open event page after the AI was switched off gets „Der Event-Assistent ist gerade ausgeschaltet.“ (web: 404 with that sentence as a toast); the bubble is gone on the next page load.
- Prefer models without reasoning („thinking“): for OpenAI o-series/gpt-5, Gemini 2.5 and Ollama thinking models the token limit includes the reasoning, so the member cap of 400 tokens can leave no answer („nicht erreichbar“). The connection test counts a successful answer without text as connected for that reason.
