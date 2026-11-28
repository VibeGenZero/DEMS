# Plugin builder (part 3: AI in the studio) — design

Issue #165 „Plugin builder IDE“, part 3 of 3. Builds on part 1
(`docs/superpowers/specs/2026-11-25-plugin-builder-design.md`: permission scan, `.dems`,
CLI) and part 2 (`docs/superpowers/specs/2026-11-26-plugin-studio-design.md`: local
studio with Monaco, preview, debug panel). Reuses the provider layer of the AI
integration (`docs/superpowers/specs/2026-11-13-ai-integration-design.md`, `ai/`).
Branch `165-plugin-builder-ide`.

## Intent

The owner wants the studio's AI to **generate plugins**: the author describes in plain
German what the plugin should do, and the AI writes it, knowing the DEMS plugin SDK
well enough to get it right from a prompt. The AI is a **chat assistant next to the
editor**. It works with the providers the owner named: OpenRouter, Ollama (local or
cloud), Claude (Anthropic) and OpenAI (Gemini comes for free from `ai/`).

The same chat serves both ends of the work: a new plugin from a description („Nach dem
Check-in bekommt jeder eine Danke-DM, Admins sehen eine Liste“) and changes to an
existing one („Füg eine Einstellung für den DM-Text hinzu“, „Warum kommt dieser
Fehler?“).

## Goals

- A chat panel „KI“ in the studio workspace, next to the editor; streamed answers.
- The AI knows the SDK: every request carries the SDK type description, a compact SDK
  guide written for the model, and the plugin's current files.
- The AI answers with whole files; the studio shows each changed file as a diff
  (Monaco diff editor) and writes nothing until the author clicks „Übernehmen“.
  One „Rückgängig“ restores the files as they were before the last „Übernehmen“.
- Before the diff is shown, the studio checks the proposed files (manifest, syntax,
  permission scan) and, if something fails, sends the errors back to the model once
  for a repair. What still fails is shown with the diff.
- After „Übernehmen“ the normal save path runs (DEMS child restarts, preview reloads).
  When the debug panel reports a plugin error, the chat offers „Fehler an KI
  schicken“.
- Studio-own AI connection settings (provider, base URL, key, model, max answer
  length) in a dialog „KI-Einstellungen“, with „Verbindung testen“ and a model list.
  Stored locally in the user's config folder next to `recent.json`.

## Non-goals

- No inline code completion (Copilot-style ghost text).
- No AI on the start page as a separate flow: a new plugin is created as today
  („Neues Plugin“), then described in the chat. *(My call: one flow instead of two;
  the scaffold gives the model a valid starting point.)*
- The AI does not delete or rename files and does not touch binary assets; it creates
  and replaces text files the part-1 allow-list accepts.
- No AI in a production DEMS for plugins, no use of DEMS's own AI settings
  (`AI_*` system keys) by the studio.
- No stored chat history across studio restarts.

## Anti-goals

- AI-written code must never run before the author has seen it: nothing reaches the
  disk (and so the DEMS child) without „Übernehmen“.
- The provider key must never reach the studio page, the preview origin, the DEMS
  child, a log line, a `.dems` package or the repo.
- A model answer must never write outside the opened plugin folder or write a file
  type the build would refuse.
- The studio's security of part 2 (127.0.0.1 only, Host check, `X-Studio-Token`,
  Origin check on mutations, separate preview origin) must hold for the new routes.

## Constraints

- Node ≥ 22, no new npm dependency, no build step. German UI text, English code,
  comments, wiki.
- Reuse `ai/` (adapters, `AiError`/`AI_ERROR_MESSAGES`, address guard, SSE reader).
  Small changes to `ai/client.js` and the two adapters are allowed where the studio
  needs them (see Design); DEMS's own AI behaviour must not change.
- Studio code stays under `scripts/studio/` (outside the production image; the guard
  test of part 2 covers new files there).
- The studio page's CSP stays as defined in part 2; the provider is only ever called
  by the studio process.

## Approaches

**What the AI does** (decided with the owner): a chat assistant next to the editor that
generates and changes plugins — picked. Rejected: only „Plugin aus Beschreibung
erzeugen“ on the start page (no help once the author is stuck); inline completion
(small help per line, no whole plugins).

**How changes reach the files** (decided, owner took my proposal): diff per file +
„Übernehmen“ + one „Rückgängig“ — picked, because AI code runs in the DEMS child right
after saving, with network and file access on the author's machine. Rejected: direct
write with reload (faster, but errors and unwanted code are only seen afterwards).

**Where the provider is called** (decided, owner took my proposal): the studio process
calls the provider through `ai/client.js`; the page talks only to the studio API —
picked. Rejected: through the DEMS child's AI routes (child runs with `AI_PROVIDER=mock`,
restarts on every save and would break the stream, and DEMS would get a route that
generates plugin code, which part 2 rules out); browser → provider directly (key in
the browser, studio CSP would have to allow foreign origins).

## Design

### Connection settings (`scripts/studio/ai/settings.js`)

- File `<configDir>/ai.json` (same `configDir` as `recent.json`:
  `%APPDATA%/dems-studio/`, `~/.config/dems-studio/`), written with mode `0o600`
  where the OS supports it. Shape: `{ provider, baseUrl, apiKey, model, maxTokens }`.
- Providers offered: `openrouter`, `ollama`, `anthropic`, `openai`, `gemini` (labels from
  `PROVIDERS` of `ai/client.js`). The dialog prefills the base URL per provider and
  offers for Ollama two presets: „Lokal“ (`http://localhost:11434/v1`) and „Cloud“
  (`https://ollama.com/v1`, key needed).
- `maxTokens` (output limit per answer): default 8192, range 1024–64000.
  *(My call: a whole plugin of four files needs several thousand output tokens; the
  member assistant's 400 would cut it.)*
- The same key rules as DEMS: the key is never returned (`GET` answers `apiKeySet:
  true|false`); a save that changes provider or base URL without a new key drops the
  stored key; „Verbindung testen“ and „Modelle laden“ work with the typed, unsaved
  values and reuse the stored key only for the stored provider and endpoint.
- `ai/client.js`: `getAiClient` already takes `env`; `testConnection` gets the same
  `env` parameter so the studio can pass its settings mapped to `AI_PROVIDER`,
  `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. The studio never reads `process.env.AI_*`.
  The address guard stays on (loopback and LAN allowed, link-local/metadata refused).
- `contextTokens` (context window the studio may fill, input + output): default 32768
  for `ollama`, 128000 for the cloud providers, range 8192–1000000. *(Builder check,
  my call: Ollama's OpenAI endpoint cannot set `num_ctx` per request and counts the
  output inside the window, so the studio must budget itself.)*
- Hint in the dialog when the provider is `ollama`: „Lokale Modelle brauchen viel
  Kontext. Setze in Ollama die Kontextlänge mindestens auf den Wert „Kontextlänge“
  hier (Standard 32768, `OLLAMA_CONTEXT_LENGTH`), sonst schneidet Ollama das
  SDK-Wissen ab.“

### SDK knowledge for the model (`scripts/studio/ai/`)

The system prompt is built per request from, in this order:

1. Role and rules (German, short): you write DEMS plugins; answer in the file format
   below; only the files that change, each complete; German texts for users; no HTML
   or SVG files; no `style="…"`/inline handlers in client code (DEMS CSP); Bootstrap
   Icons not emojis; declare every permission you use and `sdk: 1.1` when an SDK-1.1
   permission is needed; never invent SDK methods — only what the type description
   lists.
2. `sdk-guide.md` — new, a compact guide written for the model (target ≤ 12 kB):
   folder layout and manifest fields, `register(ctx)` / `register(ui)`, permission
   table (same as part 1), hooks and their payloads, settings, routes, storage, Discord
   helpers, client views and `ui` helpers, common mistakes. Kept short on purpose; the
   full wiki pages (`howto/write-plugin.md`, `concepts/plugin-sdk.md`, ~60 kB) are too
   large for small models.
3. `plugin-sdk/types/dems-plugin.d.ts`, read at request time (≈ 19 kB).
4. The plugin's current text files (allow-listed, skipping `node_modules`, dot entries
   and binaries), each with its path. Unsaved editor buffers are sent by the page and
   win over the disk copy. Limit: 200 kB of file text in total; beyond that the
   largest files are listed by name only and the chat says so.
5. On request („Fehler an KI schicken“ or automatically in a repair round): the last
   errors — check/scan errors, or `error`/`lifecycle` debug events of the plugin
   (message, file:line), at most 20.

**Budget** *(builder check, my call)*: input budget = `contextTokens − maxTokens`,
counted as characters ÷ 3 (rough, safe side). Parts 1–3 are never cut; if they alone
exceed the budget, the chat refuses with „Die Kontextlänge reicht nicht für das
SDK-Wissen. Erhöhe sie in den KI-Einstellungen (und in Ollama).“ What does not fit is
cut in this order: older history turns first, then the largest plugin files not open
in the editor (listed by name only), then error lines beyond the first 5. The chat
names what was left out. The 200 kB cap above still applies on top.

Drift test: every permission of `PERMISSIONS` (`plugin-sdk/manifest.js`) and every hook
name of `HOOK_NAMES` (`plugin-sdk/permissionScan.js`) appears in `sdk-guide.md`.

### Answer format

The model answers in plain text with file blocks, not JSON:

```
Kurze Erklärung, was ich geändert habe.

<<<DATEI server.js
…vollständiger Inhalt…
>>>DATEI
<<<DATEI client.js
…
>>>DATEI
```

*(My call, changed from the JSON idea in the conversation: code inside JSON strings
needs escaping of every newline and quote, which smaller models get wrong; file blocks
also let the chat stream the explanation as readable text.)* While streaming, the page
shows the explanation live and, for an open file block, „schreibt server.js …“ instead
of the raw code. A reply without file blocks is a normal chat answer (explanation,
question back). A reply with an unterminated block is an error („Die Antwort der KI
war unvollständig — eventuell ist die maximale Antwortlänge zu klein.“).

### Checking a proposal (`scripts/studio/ai/proposal.js`)

A reply without file blocks skips the checks. For a reply with files, the studio runs
the checks below in memory twice — on the current file set (disk + sent buffers) and on
the merged set (current + proposed) — and only problems **new in the merged set**
trigger the repair round; problems that already existed are shown with the proposal as
„bestand schon vorher“. *(Builder check, my call: a half-typed buffer or an old missing
permission must not burn a repair call on every answer; fixing old errors is what
„Fehler an KI schicken“ asks for explicitly.)* The checks:

- path rules of the file API (inside the folder, `packageEntryError`, allow-list,
  size limits) — a refused path is dropped and named;
- `validateManifest` on the proposed `plugin.json` (if it changed);
- a syntax check of `.js` files, compile only, never run (CommonJS server files and
  ES-module client files need different checks; method is the builder's);
- `scanPlugin` + `comparePermissions` + `requiredSdk` of `plugin-sdk/permissionScan.js`:
  missing permissions and a needed `sdk: 1.1` count as errors for the repair round
  (part 1 would add them at build, but the AI should write a correct manifest).

Any error → one repair request with the German error lines appended to the
conversation. The result of the repair (or the first answer if it was clean) becomes
the proposal; remaining errors are shown with it.

### Studio API (new routes in `scripts/studio/`, same token/Origin/Host rules)

| Route | Purpose |
|---|---|
| `GET /api/ai/settings` | settings without key, `apiKeySet`, provider list |
| `PUT /api/ai/settings` | save (validates provider, URL via `normalizeSystemValue('AI_BASE_URL')`, model, `maxTokens`) |
| `POST /api/ai/test` / `POST /api/ai/models` | typed values → `{ ok, error }` / `{ models }` |
| `POST /api/ai/chat` | `{ messages, buffers, includeErrors }` → SSE stream: `token`, `status` („prüft …“, „bessert nach …“), `proposal` `{ reply, files: [{ path, before, after, isNew }], problems, permissionChanges }`, `error` |
| `POST /api/ai/apply` | `{ proposalId, base: { path: hash } }` → writes the files through the file API, returns the undo id |
| `POST /api/ai/undo` | restores the last apply (replaced files back, created files removed) |

- `POST /api/ai/chat` is a `fetch` stream (POST with body and headers; not
  `EventSource`). A closed tab or „Stopp“ aborts the provider request.
- One chat request at a time per studio; a second one gets 409 „Die KI arbeitet
  noch.“.
- Proposals live in studio memory (last one only); opening another plugin clears
  proposal, undo and chat.
- `apply` compares each file's current content (disk or the buffer hash the page
  sends) with the one the proposal was built from; a file changed in between is not
  written silently — the page shows „Datei wurde inzwischen geändert“ for it and the
  author skips that file or cancels the apply (controller ruling during implementation:
  no force overwrite, because overwriting would discard edits the AI never saw).
- Unsaved buffers at „Übernehmen“ *(builder check, my call)*: the proposal was built
  on the sent buffers, so the apply dialog lists every other file whose unsaved buffer
  was sent („Ungespeichert, die KI hat damit gearbeitet: client.js“) with a checkbox
  „mit speichern“, on by default; changed files are written with the proposal's
  content (which already contains their unsaved edits). Undo restores the disk state
  before the apply, including those saved buffers.
- Timeout *(builder check, my call)*: per provider call (first answer and repair each)
  an **idle timeout** of 120 s without a new token and a total cap of 20 minutes.
  Before the **first** stream chunk the idle limit is 300 s (optional
  `firstByteTimeoutMs`, off by default): a local Ollama on a CPU can need more than
  120 s to process a 20k-token prompt *(controller ruling during implementation)*.
  Today `timeoutMs` in both adapters is a total timeout; they get an optional
  `idleTimeoutMs` (reset on every stream chunk). DEMS's own calls do not pass it and
  keep their behaviour. Errors use `AI_ERROR_MESSAGES` and
  `logAiFailure`-style lines in the studio console (code, status — never prompt,
  answer or key).

### Chat panel (studio page)

```
┌ Plugin-Studio ─ mein-plugin 0.1.0  [Prüfen] [Bauen] [KI ⚙] [VS Code]           ┐
│ Dateien    │ server.js × client.js ×       │ KI                │ Vorschau        │
│ plugin.json│ 1 function register(ctx) {    │ Du: Nach dem Check-│ ┌─────────────┐ │
│ server.js  │ …                             │ in eine Danke-DM.  │ │ DEMS        │ │
│ client.js  │                               │ KI: Ich nutze den  │ └─────────────┘ │
│            │                               │ Hook registration. │ Debug …         │
│            │                               │ checkedIn …        │                 │
│            │                               │ ▸ 2 Dateien geänd. │                 │
│            │                               │ [Ansehen][Übernehm]│                 │
│            │                               │ [Nachricht…] [Send]│                 │
└────────────┴───────────────────────────────┴───────────────────┴─────────────────┘
```

- „KI“ is a column between editor and preview that can be collapsed (toolbar button);
  on narrow windows it becomes a tab next to „Vorschau“.
- Not configured → the panel shows an empty state „KI einrichten“ that opens the
  settings dialog.
- „Ansehen“ opens the diff view (Monaco diff editor, one tab per file, new files
  against empty) with the problems and permission changes above it („Neu: network —
  das Plugin darf ins Internet.“; `network` and `discord:*` are highlighted).
  Buttons: „Übernehmen“, „Verwerfen“. After „Übernehmen“: „Rückgängig“ on that
  message until the next apply.
- Messages are rendered as escaped text; Markdown only through the studio's own safe
  renderer if one exists, else plain text with code spans. *(Builder's call.)*
- When a debug `error` event of the plugin arrives, a chip „Fehler an KI schicken“
  appears above the input.
- Chat history: kept in page memory for the open plugin; the request sends the last
  10 turns, with file blocks of older assistant turns replaced by „[Dateien:
  server.js, client.js]“ (the current files are always sent in full anyway). A
  turn is one message (author and AI messages count together), matching
  `MAX_TURNS` of `prompt.js` *(controller ruling during the final review)*.

### Files

- `scripts/studio/ai/settings.js`, `prompt.js`, `sdk-guide.md`, `answer.js` (file-block
  parser, streaming-safe), `proposal.js` (check + repair), `routes.js`.
- `scripts/studio/public/ai.js` (panel), `ai-diff.js` (diff view), `ai-settings.js`
  (dialog); styles in `studio.css`.
- `ai/client.js`: `env` parameter for `testConnection`; `ai/providers/openaiCompatible.js`
  and `anthropic.js`: optional `idleTimeoutMs`.

### Tests

- Settings: file round-trip, key never in `GET`, key dropped on provider/URL change,
  `maxTokens` range, link-local base URL refused.
- Answer parser: plain reply, several blocks, block split across stream chunks,
  unterminated block, path with `..`, a block for `index.html`.
- Proposal: clean proposal → no repair; missing permission → one repair call, then
  shown; still failing → problems listed; syntax error found without running code.
- Routes (against a local `http.createServer` provider fake, provider `ollama` with
  base URL on 127.0.0.1): token/Origin/Host checks on every new route; stream shape;
  apply writes only after the call; undo restores replaced and removes created files;
  a file changed between proposal and apply is reported; 409 on a second chat; abort
  stops the upstream request; no response or log line contains the key.
- Prompt: contains the `.d.ts`, the guide, the buffers over disk, the 200 kB cut; the
  budget cuts history before files before errors and refuses when guide + `.d.ts` do
  not fit.
- Proposal: an error that existed before triggers no repair; a new one does.
- Adapters: `idleTimeoutMs` aborts a stalled stream, a slow but steady stream passes;
  without it the old total timeout applies (existing tests stay green).
- Drift test of `sdk-guide.md` (permissions, hooks).
- E2E (Playwright, optional like part 2): fake provider, open studio, new plugin, ask,
  see the diff, „Übernehmen“, the file in the editor changed, the preview restarted.

### Docs

`howto/plugin-studio.md` gets a section „KI-Assistent“ (setup per provider incl.
Ollama local/cloud and the context hint, what the AI is sent, diff/apply/undo, limits),
`concepts/ai-integration.md` a line that the studio reuses `ai/` with its own
settings, `index.md` tables; `npm run wiki`.

## Left to the builder

- The exact wording of `sdk-guide.md` (within the size target) and of the system
  prompt rules.
- Diff view details (side-by-side vs. inline, tab layout), panel widths, how the
  column collapses.
- Hashing for the base check of `apply`, SSE event framing over the `fetch` stream.
- Whether `vm.Script` or `new Function` wrapping is used for the syntax check, as long
  as no code runs.
