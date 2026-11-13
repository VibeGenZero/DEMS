# AI integration: event assistant for members, event drafting for admins (3.2.0, part 3 of 3)

## Intent

Two recurring pains in a DEMS community:

1. **Members do not read everything.** They ask "Wann startet das Event?", "Was sind
   die Regeln?", "Welche Rolle brauche ich?", "Was muss ich ins Formular schreiben?" —
   all answered on the event page. They want to ask one quick question, on the website
   or in Discord, and get the answer.
2. **Creating an event is many fields.** An admin knows in one sentence what they want
   ("Raid am Samstag 20 Uhr, 20 Plätze, nur Raider, Slots wie letztes Mal") and then
   fills five wizard steps by hand.

DEMS gets an optional AI integration that answers member questions about an event and
drafts events for admins. DEMS is self-hosted, so the operator picks the provider:
a local model (Ollama) or a cloud API.

Parts 1 and 2 of 3.2.0 are prerequisites: the "KI" category lives in the new system
view (`2026-11-13-system-tab-categories-design.md`), the admin assistant lives in the
full-page editor (`2026-11-13-event-editor-page-design.md`).

## Decided by the owner

- Providers: **Ollama (local or cloud), OpenRouter, OpenAI, Claude API, Gemini.**
- **Member assistant:** answers questions about events (start time, rules, role
  requirements, form). Admins can optionally give **extra details per event that only
  the AI reads**.
- Members can ask **in Discord** too.
- **Website:** a chat window bottom right on the event page: round button (mockup A)
  with a **hint message that pops up** so people notice it; opened chat as in the
  mockup `chat-bubble.html` (suggested questions, source chip, error disclaimer).
- **Admin assistant** for creating events, working as the six-step flow below
  (describe → understand → ask back → self-check → admin decides → refine).
- **No LangGraph / LangChain.** The flow is a small fixed chain written in DEMS itself.
- Everything about the AI is configured in the **System view** (category "KI").
- The AI is an **optional step of the setup wizard**.

## Goals

- A member gets a short, correct German answer to a factual question about one event,
  on the event page and in Discord, grounded only in that event's data.
- An admin gets a complete, valid event draft in the editor from one free-text
  description and can refine it by chat; nothing is saved without the admin.
- One provider configuration serves both; switching the provider is a settings change.
- With the AI off (the default) DEMS behaves exactly as before: no bubble, no button,
  no command, no outgoing request.

## Non-goals (this release)

- No actions by the member assistant: it never registers, unregisters or changes
  anything. Read only.
- No general chat ("which events are there next month?") — every question belongs to
  one event. No questions about polls.
- No tool/function calling, no embeddings or vector search, no agent loop. An event's
  data fits into one prompt.
- No stored chat history on the server; no admin view of member questions.
- The admin assistant does not create series (`recurring*`), does not set `status`,
  does not announce, does not upload banners.
- No `@mention` of the bot (needs event guessing and answers in public; possible later
  as an option).
- No AI text for announcements or DMs (possible later as another field helper).
- No per-member language detection; answers are German.

## Anti-goals

- The assistant **invents** a rule, time or requirement. When the data does not say,
  it says so and points to the organisers.
- The assistant reveals anything the asking member could not see themselves (check-in
  code, other members' form answers, drafts, admin-only fields).
- A member, or a script, runs up the operator's API bill.
- An AI draft is saved or published without the admin pressing save.
- An API key shows up in an API response, a log line or the audit log.
- A new dependency tree for something `fetch` can do.

## Architecture

### Provider layer

A small own layer, built on Node's global `fetch`, no SDK:

| Provider id | Wire format | Default base URL | Key |
|---|---|---|---|
| `ollama` | OpenAI-compatible chat completions | `http://localhost:11434/v1` (editable; `https://ollama.com/v1` for Ollama Cloud) | optional (cloud only) |
| `openrouter` | OpenAI-compatible | `https://openrouter.ai/api/v1` | required |
| `openai` | OpenAI-compatible | `https://api.openai.com/v1` | required |
| `gemini` | OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | required |
| `anthropic` | Anthropic Messages API | `https://api.anthropic.com/v1` | required |
| `mock` | in-process, canned answers | — | only with `DEV_MOCK=true` and in tests |

So there are **two adapters** (OpenAI-compatible, Anthropic) plus the mock. They share
one interface, roughly `chat({ system, messages, maxTokens, signal, onToken? })` →
`{ text, usage: { inputTokens, outputTokens } }`, with token streaming when `onToken`
is given. Errors are mapped to a small set the UI can explain in German: `invalid_key`,
`model_not_found`, `unreachable`, `timeout`, `rate_limited`, `provider_error`.

The builder must verify each provider's current endpoint paths, auth headers and
streaming format against its documentation before coding the adapter; the table is the
design, not a guarantee of today's URLs.

JSON answers (admin flow) are requested **by prompt** and parsed leniently (first JSON
object in the text), then validated by DEMS — not through provider-specific structured
output features, so all five behave the same.

Timeouts: 60 s for member questions, 120 s for admin drafts (local models are slow).

### Configuration

Connection values are managed keys like the Discord values (`utils/systemConfig.js`,
`.env` wins and locks, otherwise stored in `systemSettings/config`, applied `live`):

| Key | Meaning |
|---|---|
| `AI_PROVIDER` | empty = AI off; else a provider id from the table |
| `AI_BASE_URL` | empty = the provider's default; http(s) only |
| `AI_API_KEY` | secret: never returned, only "set / not set"; empty input keeps the stored one |
| `AI_MODEL` | model for the member assistant and the default for everything |
| `AI_MODEL_ADMIN` | optional stronger model for the admin assistant; empty = `AI_MODEL` |

Saving them goes through the existing `PUT /api/admin/system/settings` (reset password,
audit log `UPDATE_SYSTEM_SETTINGS` with key names only).

Behaviour settings live in a new singleton `aiSettings/config` (read through a helper
with defaults, like `utils/botSettings.js`), saved by a plain admin request with audit
log `UPDATE_AI_SETTINGS`:

| Field | Default | Meaning |
|---|---|---|
| `memberWeb` | `true` | chat bubble on the event page |
| `memberDiscord` | `true` | `/ask` and the "Frage stellen" button |
| `adminAssistant` | `true` | AI panel and field helpers in the editor |
| `teaserEnabled` / `teaserText` | `true` / „Fragen zum Event? Frag mich einfach." | the hint message (≤ 120 chars) |
| `assistantName` | „Event-Assistent" | name in the chat header and in Discord answers |
| `extraInstructions` | `''` | community-wide tone/rules appended to the system prompt (≤ 1000 chars), e.g. "Duze alle." |
| `memberQuestionsPerHour` | `20` | per member, web and Discord together |
| `dailyQuestionLimit` | `500` | all members together per day; `0` = no limit |

All three features need `AI_PROVIDER` and `AI_MODEL` to be set; otherwise they are off
regardless of the switches.

### New event field `aiNotes`

- String, ≤ 4000 chars, Markdown-free plain text: "Zusatzinfos für den
  Event-Assistenten". In the editor in step "Grundlagen" below the description.
- Whitelisted in **both** `POST /events` and `PUT /events/:id`; part of
  `TEMPLATE_FIELDS` and `SERIES_FIELDS`; copied on duplicate.
- Admin-only: it never appears in a member-facing event response; only an admin's
  event detail answer carries it (the editor loads the event through that route).
- It is **not a secret store**: the assistant may quote it to any member who can see
  the event. The field's help text says so ("Die KI kann diese Infos an Mitglieder
  weitergeben. Keine Geheimnisse eintragen.").
- No migration needed (missing = empty).

## Member assistant

### What the model sees

One shared builder produces the event context for web and Discord, as plain labelled
text, from data the asking member may see:

- title, category, status, start/end, registration and unregister deadline — written
  out as local date-times in `TIMEZONE`, plus "today is …";
- description (Markdown as is), location;
- places: maximum, taken, free, waitlist length; slots with name and free places;
- access: open or role-required with the **role names**; approval mode; guests and
  "Vielleicht" allowed or not;
- form fields: label, type, required, options, description;
- `aiNotes`;
- about the asker: registration status for this event (incl. slot, waitlist place) and
  whether they hold a required role. **No name, no user id** is sent.

Never included: `checkinCode`, other members' data or form answers, Discord ids,
admin-only fields other than `aiNotes`.

The system prompt fixes the behaviour: answer in German, short (a few sentences),
only from the context; if the context does not answer the question, say so and refer
to the organisers; no answers to unrelated requests; end with a line
`Quelle: <section>` naming one of the fixed sections (Beschreibung,
Teilnahmebedingungen, Termin, Plätze, Formular, Zusatzinfos) when the answer came from
one. `extraInstructions` is appended. The member's question and history are passed as
user/assistant turns, never spliced into the system prompt.

Because the model only ever receives what this member may see and has no tools, a
prompt-injection attempt can at worst produce a silly answer.

### Website

- `POST /api/events/:id/ask`, `requireAuth`, body
  `{ question (≤ 500 chars), history: [{ role, text }] (≤ 6 turns, each ≤ 1000 chars) }`.
  404 when the event is not visible to the user (`isEventVisibleTo`) or not `active`;
  404 as well when the member assistant is off; 429 with a German message when a limit
  is hit; 502/504 with a German message for provider errors.
- The answer streams as `text/event-stream` (events: `token`, `done` with the source
  label, `error`). The frontend reads it with `fetch` + stream reader (CSRF header as
  for every mutating request). The CSP needs no change: the browser only talks to DEMS.
- Whether the bubble shows is part of the data the event page already loads (e.g.
  `ai: { memberAssistant, teaserText, assistantName }` on `/api/server-info`).
- UI (new module under `public/js/events/`, new block in `components.css`, styleguide
  entry): round button bottom right on the event page, only for logged-in members of a
  visible active event. Hint bubble after ~4 s; closing it or opening the chat stores
  "seen" in `localStorage` and it never returns for that browser. Chat panel as in the
  mockup: header with assistant name and event title, greeting, three suggested
  questions („Wann geht es los?", „Was sind die Regeln?", „Darf ich mitmachen?"),
  messages, input, disclaimer „KI-Antworten können Fehler enthalten. Im Zweifel gilt
  die Eventbeschreibung." On phones the panel fills the screen.
- While streaming the text is shown escaped; when done it is rendered with
  `renderMarkdownSafe`, and a trailing `Quelle:` line that names a known section
  becomes a chip (otherwise it is dropped). The conversation lives in memory for the
  page visit only.
- Accessible: button has a label, panel is a dialog region with focus handling, new
  answers are announced (`aria-live="polite"`), Esc closes; motion respects the
  existing reduced-motion handling.

### Discord

- Slash command `/ask` with options `event` (autocomplete like `/event info`: active,
  visible, not over) and `question` (≤ 500 chars). Like the existing commands the base
  name is English with a German localisation (`/frage`); descriptions are German.
- Button „Frage stellen" (`event_ask:<eventId>`) on event announcements next to the
  registration buttons → modal (`event_ask_modal:<eventId>`) with one paragraph input.
- Both: `deferReply` ephemeral, same context builder and limits as the web (identity
  and roles as in `/event info`), answer as an ephemeral message cut to Discord's
  length limit, with a „Zum Event" link from `buildEventUrl(id)`. Refusals and errors
  are German and ephemeral.
- The command is only registered and the button only built while `memberDiscord` is on
  and the AI is configured; changing that re-registers the commands and refreshes the
  announcements of active events. The announcement's component budget
  (`MESSAGE_COMPONENTS_MAX`) must still hold with the extra button (test).
- New area module `bot/ask.js`. It only answers interactions, so like `bot/tentative.js`
  it needs no `bot.js` export; dev mock mode answers through the mock provider.

### Limits

- Per member: `memberQuestionsPerHour` across web and Discord (in memory; a restart
  resets it, which is acceptable).
- All members: `dailyQuestionLimit` per calendar day in `TIMEZONE`.
- Answers are capped (~400 output tokens).
- One question at a time per member (a second one while the first runs is refused).

## Admin assistant

### Flow

1. **Describe.** In the editor the admin opens the "KI-Assistent" panel and writes what
   they plan, in free text.
2. **Understand.** DEMS sends the text with: the current form state, today's date and
   time zone, the guild's roles and channels (name + id), the event templates (name +
   settings), the last ~10 events (title, category, key settings) so "wie letztes Mal"
   works, and the description of every field the AI may set. The model answers with
   JSON: `{ patch: { field: value, … }, reply: "<German>", questions: ["…"] }`.
3. **Ask back, do not guess.** If something essential is missing (typically the date),
   the model sets what it knows and returns up to three questions; the panel shows
   them, the admin answers in the chat, the next request carries the history.
4. **Self-check.** DEMS validates the patch before the admin sees it:
   - only allowed fields: everything in `TEMPLATE_FIELDS` except `bannerUrl`, plus
     `startDate`, `endDate`, `registrationDeadline`, `unregisterDeadline`, `aiNotes`;
   - role and channel ids must exist in the guild lists, else the field is dropped;
   - dates come as local `YYYY-MM-DDTHH:mm` and are converted with
     `utils/localDateTime.js`;
   - the merged draft runs through the same checks as a manual save
     (`checkEventFields` / `validateEvent`, `normalizeSlots`, form field rules).
   On errors the model gets the German error sentences once and may repair its patch;
   fields still invalid after that are dropped and named in the reply.
5. **The admin decides.** The patch is applied to the form only. Changed fields get an
   accent ring and a "von KI" mark until the admin edits them or saves. The reply says
   what was filled ("Entwurf ist im Formular, 9 Felder gefüllt."). "Rückgängig" in the
   panel restores the form state from before the last patch. Saving is the normal save.
6. **Refine.** Further messages ("Beschreibung kürzer", "Feld Charaktername dazu")
   return a patch with only the fields that change.

The server is stateless here: `POST /api/admin/ai/event-draft` takes
`{ message, draft, history }` and returns `{ patch, reply, questions }`. Nothing is
written, so no audit log entry; the later save logs `CREATE_EVENT`/`UPDATE_EVENT` as
usual. Works for new events and when editing an existing one.

### Field helpers

Small buttons at two fields, same endpoint family (`POST /api/admin/ai/text`):

- **Beschreibung verbessern** — rewrites the description (clearer, structured Markdown,
  same facts); the result replaces the field with the same "von KI" mark and undo.
- **Zusatzinfos vorschlagen** — proposes `aiNotes` questions/answers the description
  leaves open, for the admin to edit.

### Limits

60 requests per admin and hour. The admin model is `AI_MODEL_ADMIN` or `AI_MODEL`.

## System view, category "KI"

- **Anbieter:** provider select; base URL (prefilled, mainly for Ollama); API key
  (password field, shows only "gesetzt"); model and optional admin model — a dropdown
  filled from the provider's model list (`POST /api/admin/ai/models`, which like the
  test takes the typed, not yet saved values), with free text as
  fallback; **„Verbindung testen"** (`POST /api/admin/ai/test`: one tiny request,
  answers ok + response time or the German explanation of the error class). Values
  locked by `.env` are shown locked like the Discord ones.
- **Event-Assistent für Mitglieder:** switches for website and Discord, assistant
  name, hint message on/off + text, questions per member and hour, daily limit.
- **KI für Admins:** switch for the editor assistant.
- **Verhalten:** `extraInstructions`.
- **Nutzung:** questions today / last 30 days and tokens in/out (see below).
- **Datenschutz-Hinweis** (static text): with a cloud provider, questions and event
  contents are sent to that provider — the operator should mention it in the privacy
  policy; with a local Ollama nothing leaves the server.
- "Übersicht" shows AI on/off and the provider.

## Setup wizard

A new step **„KI (optional)"** between "Sicherheit" and "Datenschutzerklärung": the
same provider/key/model fields and the connection test, and a clearly visible
"Überspringen". Skipping leaves the AI off; everything can be set later in the System
view. Uses the same validation (`normalizeSystemValue`) and the same test helper.

## Usage counters

Collection `aiUsage`, one document per day (id = `YYYY-MM-DD` in `TIMEZONE`):
`{ memberQuestions, adminRequests, inputTokens, outputTokens, errors }`. Written after
each request, read by the "Nutzung" block and the daily limit; documents older than
90 days are deleted by the existing periodic clean-up pattern. **No question or answer
text is stored anywhere**; logs carry at most the error class, never content or keys.

## Security and privacy

- Endpoints: member route `requireAuth`, admin routes in `routes/admin.js` or a guarded
  sibling like `routes/adminSystem.js`; CSRF as usual; each handler with its own
  `try/catch` and German `{ error }`.
- `AI_BASE_URL` is admin-set behind the reset password and must be allowed to point at
  localhost/private addresses (local Ollama) — document this in
  `docs/wiki/concepts/security.md` as an accepted admin-only capability.
- `AI_API_KEY` is stored in plain text like the other secrets (known limitation,
  already documented for the Discord token).
- `DEV_MOCK` stays impossible in production; the `mock` provider is refused outside
  dev mock mode and tests.

## Constraints

- `CLAUDE.md` rules throughout: data only through `firebaseAdmin.js`; German for
  everything users see, English for code/comments/commits/wiki; frontend actions via
  `data-*` + `registerActions`; tokens and existing components; no inline styles; no
  emojis in the web UI; no CDN; **no new dependency**.
- New env keys documented in `.env.example` (German comments) and
  `docs/wiki/ops/configuration.md`; keys are read at call time, never into a module
  constant.
- Tests first with `node:test`: adapters against a local fake HTTP server (request
  shape, streaming, error mapping), context builder (nothing private leaks —
  explicitly `checkinCode` and foreign form answers), limits, draft validation and
  repair loop with the mock provider, `aiNotes` whitelisting and privacy, routes via
  `test/devServer.test.js` personas, bot handlers like the existing command tests,
  Playwright smoke test for the bubble in dev mock mode.
- Dev mock mode ships with the mock provider switched on so `npm run dev:mock` shows
  every feature without a key.
- Wiki: new concept node for the AI integration, updates to data-model, api-index,
  bot, frontend-app, frontend-markup, configuration, security, known-issues if needed;
  `npm run wiki`. Release notes and version bump to 3.2.0 happen on the release branch.

## Left to the builder

- File layout (suggestion: a top-level `ai/` folder — `providers/`, client, settings,
  event context, member assistant, event draft, limits — each file ≤ ~500 lines).
- Exact prompts; exact JSON field description given to the model.
- Exact SSE event names and how the frontend module is split.
- Whether usage counters are written per request or batched.

## Calls made by Claude (not by the owner)

- Two adapters over plain `fetch`; JSON by prompt + own validation instead of
  provider-specific structured output.
- Separate optional admin model (`AI_MODEL_ADMIN`).
- Connection values as managed system keys, behaviour in `aiSettings/config`; the
  defaults in that table (20 per hour, 500 per day, all switches on).
- Members must be logged in; one event per question; `/ask` plus the announcement
  button; no `@mention`.
- Discord command is named `/ask` (English like the existing commands).
- The asker's name and id are never sent to the provider.
- `aiNotes` is hidden from member responses but may be quoted by the assistant, with
  the warning text; 4000 chars; part of templates and series.
- Streaming answers on the web; chat history only in the browser, nothing stored.
- Source chip via a trailing `Quelle:` line, best effort.
- Hint message shows once per browser.
- Admin assistant: stateless endpoint, allowed-field list, one repair round, undo, no
  series/status/banner; the two field helpers.
- Usage counters without content, 90 days.
- Setup step position.

## Branch

`114-ai-intigration` (exists on the remote, currently identical to `main`), based on
`release/3.2.0` after parts 1 and 2 are merged; PR into `release/3.2.0`. The work is
large enough to plan in stages: provider layer + settings + System category → member
assistant web → member assistant Discord → admin assistant → setup step.
