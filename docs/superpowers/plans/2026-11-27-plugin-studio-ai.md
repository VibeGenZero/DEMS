# Plugin Studio AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat assistant „KI“ next to the studio editor that writes and changes DEMS plugins from a German prompt, shows its changes as a diff and writes them only after „Übernehmen“.

**Architecture:** The studio process (`scripts/studio/`) gets an `ai/` folder: local settings (`ai.json`), a prompt builder with SDK knowledge and a token budget, a streaming parser for file blocks, a proposal checker (paths, manifest, syntax, permission scan; repair once on new problems) and routes for chat (fetch stream), apply and undo. It calls providers through the existing `ai/client.js` with an `env` built from its own settings. The page gets a chat column, a settings dialog and a Monaco diff view.

**Tech Stack:** Node ≥ 22 (`node:test`, `node:http`, `node:vm`), existing `ai/` adapters, Monaco (already vendored), plain ES modules.

**Spec:** `docs/superpowers/specs/2026-11-27-plugin-studio-ai-design.md` (read it with this plan; part 2 spec `docs/superpowers/specs/2026-11-26-plugin-studio-design.md` for the studio's security model).

## Global Constraints

- No new npm dependency; no build step; no TypeScript toolchain.
- German UI text and `{ error }` messages; English code, comments, commits, wiki.
- Studio code only under `scripts/studio/` (kept out of the image by `.dockerignore`; the part-2 guard test must stay green).
- DEMS's own AI behaviour must not change: every change in `ai/` is optional and off by default.
- The provider key never reaches the page, the preview origin, the DEMS child, a log line, a `.dems` or the repo. `GET` answers `apiKeySet` only.
- Nothing proposed by the AI is written to disk before `POST /api/ai/apply`.
- Every new route sits behind the existing studio checks (Host, `X-Studio-Token`, Origin on non-GET) — add routes only through the `routes` table of `createActions`.
- No inline styles or handlers on the studio page; new styles only in `scripts/studio/public/studio.css`.
- Defaults pinned by the spec: `maxTokens` 8192 (1024–64000); `contextTokens` 32768 for `ollama`, 128000 otherwise (8192–1000000); file text cap 200 kB; history 10 turns; idle timeout 120 s; total cap 20 min; at most 20 error lines; one repair round; one chat at a time (409 „Die KI arbeitet noch.“).
- Tests: `node:test` + `node:assert/strict`, test first. `npm test` must pass after every task.

## Review Focus

1. A model writes a file block for `../x.js`, `plugin.json5`, `index.html` or `assets/logo.png` → dropped and named in `dropped`, never written (test in Task 5).
2. The author edits a file in the editor while the AI is answering → apply reports that file as changed instead of overwriting it (test in Task 6).
3. A stream breaks off mid file block (provider limit reached, network) → German „unvollständig“ error, no proposal, no partial file (tests in Tasks 3 and 6).
4. Undo after the author saved the same file again by hand → undo refuses that file with „Datei wurde inzwischen geändert“ instead of throwing the hand edit away (test in Task 6).
5. A provider answer contains the key or a model echoes the system prompt → the key is never in any studio response or console line (test in Task 6 asserts the key string is absent from every captured body and `console.error` call).

---

### Task 1: Idle timeout in the adapters, `env` for `testConnection`

**Files:**
- Modify: `ai/providers/openaiCompatible.js`, `ai/providers/anthropic.js`, `ai/client.js`
- Test: `test/aiProviders.test.js`, `test/aiClient.test.js`

**Interfaces:**
- Produces: `chat({ …, idleTimeoutMs })` on both adapters — when set, the request aborts with `AiError('timeout')` after `idleTimeoutMs` without a stream chunk (timer reset on every chunk, also before the first byte); `timeoutMs` stays the total cap. `getAiClient(...).chat` passes it through. `testConnection(overrides = null, { env = process.env } = {})`.

- [ ] **Step 1: Write the failing tests** (local `http.createServer` fake as in the existing file):
  - `idleTimeoutMs aborts a stalled stream` — fake sends one chunk then nothing; `chat({ onToken, idleTimeoutMs: 100, timeoutMs: 5000 })` rejects with `err.code === 'timeout'` in < 1 s. Both adapters.
  - `a slow steady stream passes the idle timeout` — fake sends a chunk every 60 ms for 600 ms; `idleTimeoutMs: 150` → resolves with the full text.
  - `without idleTimeoutMs the total timeout applies as before` — existing timeout tests unchanged.
  - `testConnection uses the given env` — `testConnection(null, { env: { AI_PROVIDER: 'ollama', AI_BASE_URL: <fake>, AI_MODEL: 'm' } })` → `{ ok: true }` while `process.env.AI_PROVIDER` is empty.
- [ ] **Step 2: Run** `node --test test/aiProviders.test.js test/aiClient.test.js` — expected: FAIL.
- [ ] **Step 3: Implement.** An `AbortController` per call combined with the existing signal via `AbortSignal.any`; the stream readers call a `touch()` per chunk. An idle abort maps to `timeout`, not to the caller-abort path.
- [ ] **Step 4: Run** the two files, then `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Let AI calls time out on silence instead of total time when asked".

### Task 2: Studio AI settings

**Files:**
- Create: `scripts/studio/ai/settings.js`
- Test: `test/studioAiSettings.test.js`

**Interfaces:**
- Consumes: `PROVIDERS`, `getAiClient`, `testConnection` (Task 1) from `ai/client.js`; `normalizeSystemValue` from `utils/systemValues.js`; `StudioError` from `scripts/studio/files.js`.
- Produces:
  - `STUDIO_PROVIDERS = ['openrouter', 'ollama', 'anthropic', 'openai', 'gemini']`, `OLLAMA_PRESETS = { local: 'http://localhost:11434/v1', cloud: 'https://ollama.com/v1' }`.
  - `load(configDir) → { provider, baseUrl, apiKey, model, maxTokens, contextTokens }` (missing/broken file → defaults with `provider: ''`).
  - `publicView(settings) → { provider, baseUrl, model, maxTokens, contextTokens, apiKeySet, providers: [{ id, label, defaultBaseUrl, keyRequired }], ollamaPresets }`.
  - `save(configDir, input) → settings` — validates, drops the stored key when provider or base URL changes without a new key, writes `ai.json` (`mode: 0o600`, atomic). Throws `StudioError(message, 400)`.
  - `toEnv(settings) → { AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL }`.
  - `isConfigured(settings) → boolean` (= `isAiConfigured(toEnv(settings))`).
  - `routes(configDir) → { 'GET /api/ai/settings', 'PUT /api/ai/settings', 'POST /api/ai/test', 'POST /api/ai/models' }` in the shape of the studio route table (`(req, body) → { json, status }`). `test`/`models` take typed `{ provider, baseUrl, apiKey, model }` and use `env: toEnv(load(configDir))` so the stored-key rules of `settingsFrom` apply.
- German messages: unknown provider „Unbekannter KI-Anbieter.“; `maxTokens` out of range „Die maximale Antwortlänge muss zwischen 1024 und 64000 liegen.“; `contextTokens` „Die Kontextlänge muss zwischen 8192 und 1000000 liegen.“; `maxTokens >= contextTokens` „Die Antwortlänge muss kleiner als die Kontextlänge sein.“; base URL errors from `normalizeSystemValue`.

- [ ] **Step 1: Write the failing tests** (temp `configDir`):
  - `load returns defaults without a file`, `save then load round-trips`, `contextTokens defaults to 32768 for ollama and 128000 for openai`.
  - `publicView never contains the key` — `JSON.stringify(publicView(s))` does not include the key, `apiKeySet === true`.
  - `changing provider without a new key drops it`, `changing baseUrl without a new key drops it`, `same provider and url keep the key`.
  - `maxTokens 1023 and 64001 are refused`, `maxTokens >= contextTokens is refused`, `a link-local baseUrl (http://169.254.169.254/v1) is refused`.
  - `GET route answers publicView`, `POST /api/ai/test against a fake ollama server answers { ok: true }`, `POST /api/ai/models answers the fake ids`.
  - POSIX only (`skip` on win32): file mode is `0o600`.
- [ ] **Step 2: Run** `node --test test/studioAiSettings.test.js` — expected: FAIL.
- [ ] **Step 3: Implement** `scripts/studio/ai/settings.js`.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — "Give the plugin studio its own AI connection settings".

### Task 3: Streaming parser for file blocks

**Files:**
- Create: `scripts/studio/ai/answer.js`
- Test: `test/studioAiAnswer.test.js`

**Interfaces:**
- Produces:
  - `FILE_START = '<<<DATEI '`, `FILE_END = '>>>DATEI'` (markers at the start of a line).
  - `createAnswerParser() → { push(chunk) → { text: string, writing: string|null }, end() → { reply: string, files: [{ path, content }] } }` — `push` returns only the **new** explanation text since the last call and the path of the block currently being written (or `null`). `end()` throws `AnswerError` with `code: 'incomplete'` when a block is still open.
  - `compactTurn(text) → string` — replaces each file block with `[Dateien: a.js, b.js]` (one line per run of blocks).
  - `AnswerError extends Error` with `code`.
- Content rule: the lines between the markers, joined with `\n`, plus a trailing `\n`. A later block for the same path wins. Paths are returned as written (trimmed); checking them is Task 5.

- [ ] **Step 1: Write the failing tests:**
  - `plain reply without blocks` → `files: []`, `reply` equals the text.
  - `two blocks and text around them` → `reply` contains only the text, both files exact.
  - `markers split across chunks` — feed the answer one character at a time; same result as one chunk; `push` never returns marker or code characters in `text`; `writing === 'server.js'` while inside the block.
  - `unterminated block` → `end()` throws `code === 'incomplete'`.
  - `a marker in the middle of a line is ordinary text`.
  - `compactTurn` turns two blocks into `[Dateien: server.js, client.js]`.
- [ ] **Step 2: Run** `node --test test/studioAiAnswer.test.js` — expected: FAIL.
- [ ] **Step 3: Implement.** Line-buffered state machine: hold back an incomplete last line only while it could still become a marker.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — "Parse file blocks from streamed AI answers in the studio".

### Task 4: SDK guide and prompt builder with budget

**Files:**
- Create: `scripts/studio/ai/sdk-guide.md`, `scripts/studio/ai/prompt.js`
- Test: `test/studioAiPrompt.test.js`

**Interfaces:**
- Consumes: `compactTurn` (Task 3); `PERMISSIONS` (`plugin-sdk/manifest.js`), `HOOK_NAMES` (`plugin-sdk/permissionScan.js`); `FILE_START`/`FILE_END` (Task 3) for the format rules in the prompt.
- Produces:
  - `loadKnowledge(repoRoot) → { guide: string, types: string }` (reads `scripts/studio/ai/sdk-guide.md` and `plugin-sdk/types/dems-plugin.d.ts` at call time).
  - `buildPrompt({ knowledge, files: [{ path, content, open }], history: [{ role: 'user'|'assistant', text }], message, errors: string[], contextTokens, maxTokens }) → { system, messages: [{ role, text }], omitted: { turns: number, files: string[], errors: number } }`.
  - `estimateTokens(text) = Math.ceil(text.length / 3)`; `FILE_TEXT_CAP = 200 * 1024`; `MAX_TURNS = 10`; `MAX_ERRORS = 20`.
  - Throws `PromptError` (`code: 'context_too_small'`, message „Die Kontextlänge reicht nicht für das SDK-Wissen. Erhöhe sie in den KI-Einstellungen (und in Ollama).“) when rules + guide + types exceed `contextTokens − maxTokens`.
- Layout: `system` = rules (spec „SDK knowledge“ point 1, incl. the file-block format) + guide + types. `messages` = compacted history (last 10 turns) + one user message with the files (each `### <path>` + fenced content), the error lines under „Aktuelle Fehler:“ and the author's message last. Cut order when over budget: oldest history turns → largest files with `open: false` (listed under „Nicht mitgeschickt: …“) → errors beyond the first 5. `omitted` reports what was cut; the chat shows it.
- `sdk-guide.md` ≤ 12 kB, English or German at the builder's choice, covering the spec's list (layout, manifest, `register(ctx)`/`register(ui)`, permission table, hooks with payloads, settings, routes, storage, Discord helpers, views/`ui`, common mistakes). Write it from `docs/wiki/howto/write-plugin.md`, `docs/wiki/concepts/plugin-sdk.md` and the two official plugins.

- [ ] **Step 1: Write the failing tests:**
  - `sdk-guide.md mentions every permission and hook` — every key of `PERMISSIONS` and every `HOOK_NAMES` entry appears; file size ≤ 12 * 1024 bytes.
  - `system contains the guide, the types and both markers`.
  - `files and message go into the last user message, message last`.
  - `history keeps the last 10 turns and compacts file blocks of assistant turns`.
  - `files beyond 200 kB are listed by name only`.
  - `budget cuts history before closed files before errors` — tiny `contextTokens` that fits system + 1 file: `omitted.turns > 0`, open file kept, closed large file in `omitted.files`.
  - `refuses when guide and types do not fit` → `code === 'context_too_small'`.
- [ ] **Step 2: Run** `node --test test/studioAiPrompt.test.js` — expected: FAIL.
- [ ] **Step 3: Write** `sdk-guide.md` and **implement** `prompt.js`.
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — "Teach the studio AI the plugin SDK within a context budget".

### Task 5: Checking a proposal

**Files:**
- Create: `scripts/studio/ai/proposal.js`
- Test: `test/studioAiProposal.test.js`

**Interfaces:**
- Consumes: `packageEntryError`, `LIMITS`, `isJsFile` (`plugin-sdk/files.js`); `validateManifest` (`plugin-sdk/manifest.js`); `scanPlugin`, `comparePermissions`, `requiredSdk` (`plugin-sdk/permissionScan.js`).
- Produces:
  - `checkSet(files: Map<string, string>) → problems: [{ key, file, message }]` — `key` is stable across runs (`${kind}:${file}:${message}`) so old and new can be compared. Problems: manifest invalid; JS syntax error (server files: `new vm.Script` around the CommonJS wrapper; client files and `assets/*.js` are ES modules, which `vm.Script` refuses — `vm.SourceTextModule` needs a flag, so use `node --check --input-type=module` on stdin via `child_process.spawnSync(process.execPath, …)` or an equivalent that never runs the code; message with file and line); missing permission; `sdk: 1.1` needed.
  - `evaluate({ current: Map<string,string>, proposed: [{ path, content }] }) → { files: [{ path, before, after, isNew }], dropped: [{ path, reason }], newProblems, oldProblems, permissionChanges: { added: string[], sdk: string|null } }` — drops proposed paths that fail `packageEntryError`, contain `..`, are absolute, are binary-asset paths, or exceed `LIMITS`; unchanged files are not in `files`.
  - `needsRepair(result) → result.newProblems.length > 0`.
  - `repairMessage(result) → string` — German, lists `newProblems` and `dropped` („Bitte korrigiere: …“).

- [ ] **Step 1: Write the failing tests** (in-memory maps built from `plugins/event-feedback`):
  - `a clean change has no problems and lists only changed files`.
  - `a new ctx.discord.sendDM without discord:dm is a new problem` and `permissionChanges.added` contains `discord:dm`.
  - `an SDK-1.1 permission without sdk 1.1 is a problem`.
  - `a syntax error in server.js is found and the code does not run` — the file contains `globalThis.__ran = true; (` → problem, `globalThis.__ran` stays undefined.
  - `an ES module client file with import/export passes the syntax check`.
  - `an error that existed before is old, not new` → `needsRepair` false.
  - `../x.js, /abs.js, index.html, assets/logo.png are dropped with a reason`.
  - `repairMessage names each new problem`.
- [ ] **Step 2: Run** `node --test test/studioAiProposal.test.js` — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** — "Check AI proposals in memory before the author sees them".

### Task 6: Chat, apply and undo routes

**Files:**
- Create: `scripts/studio/ai/routes.js`
- Modify: `scripts/studio/actions.js` (merge the AI routes into `routes`; clear AI state in the open/close path), `scripts/studio/index.js` only if `configDir`/`repoRoot` must be passed on
- Test: `test/studioAiRoutes.test.js`

**Interfaces:**
- Consumes: Tasks 2–5; `files.listFiles/readFile/fileHash/writeFile/createFile/deleteFile` (`scripts/studio/files.js`); `log.list()` (event log of `createActions`) for error events; `getAiClient` with `env: toEnv(settings)`.
- Produces: `createAiRoutes({ configDir, repoRoot, requireOpen, log, refresh, getAiClient = require('../../../ai/client').getAiClient }) → { routes, reset() }`; `reset()` clears chat lock, proposal and undo (called by `createActions` when a plugin is opened or closed).
  - `POST /api/ai/chat` (raw route; fetch stream, `Content-Type: text/event-stream`): body `{ message ≤ 4000, history ≤ 20 entries, buffers: [{ path, content, hash }], open: [path], includeErrors: boolean }`. Events: `token` `{ text }`, `status` `{ text }` („Prüfe den Vorschlag …“, „Bessere nach …“, `writing` → „Schreibt <path> …“, `omitted` notice), `proposal` `{ id, reply, files, dropped, newProblems, oldProblems, permissionChanges, unsaved: [path] }`, `done` `{ reply }` (no files), `error` `{ error }`. Refusals before the stream are JSON: not configured 409 „Die KI ist noch nicht eingerichtet.“, busy 409 „Die KI arbeitet noch.“, message too long 400. Calls `chat` with `maxTokens`, `timeoutMs: 20 * 60 * 1000`, `idleTimeoutMs: 120000`, `signal` aborted on `req` close. Repair: if `needsRepair`, one more call with the assistant answer + `repairMessage` appended. `unsaved` = paths of `buffers` not in the proposal's files.
  - `POST /api/ai/apply` `{ id, save: [path], skip: [path] }` → for each proposal file: compare the current disk hash with the hash the proposal was built from (buffer hash if a buffer was sent, else disk hash at request time); mismatch and not in `skip` → 409 `{ error: 'Datei wurde inzwischen geändert', conflicts: [path] }` and nothing written. Else write (create when `isNew`), also write the listed `save` buffers, store undo `{ path, before: content|null, afterHash }`, call `refresh()` when `plugin.json` changed. Answer `{ ok: true, written: [path] }`.
  - `POST /api/ai/undo` → restores every undo entry whose disk hash still equals `afterHash` (`before === null` → delete), lists the others in `conflicts`; clears undo. 409 „Nichts zum Rückgängigmachen.“ without one.
  - Errors in the stream: `AI_ERROR_MESSAGES[code]`; `AnswerError` „Die Antwort der KI war unvollständig — eventuell ist die maximale Antwortlänge zu klein.“; `PromptError` its message. Console line `Studio-KI fehlgeschlagen: <code> [HTTP <status>]` — never prompt, answer or key.

- [ ] **Step 1: Write the failing tests** — `createActions` with a fake child (as in `test/studioActions.test.js`), a temp plugin folder from the scaffold, a temp `configDir` with `ollama` settings pointing at a local fake provider that streams scripted answers; drive the routes table directly and through `createStudioServer` for the header checks:
  - `every AI route needs token, Host and Origin` (401/403 like the other routes).
  - `chat before settings → 409 „Die KI ist noch nicht eingerichtet.“`.
  - `chat streams tokens and a proposal; nothing is on disk yet`.
  - `a reply without blocks ends with done`.
  - `a new missing permission triggers exactly one repair call` (fake counts calls; second answer clean → proposal without problems).
  - `an unterminated block ends with the incomplete error and no proposal`.
  - `a second chat while one runs → 409`; `closing the request aborts the fake upstream` (fake sees the socket close).
  - `apply writes the files, creates new ones and calls refresh for plugin.json`.
  - `apply refuses a file changed on disk since the proposal` (409 + `conflicts`), `skip` writes the rest.
  - `apply also saves the listed unsaved buffers`.
  - `undo restores replaced files and deletes created ones`; `undo keeps a file saved by hand afterwards` (in `conflicts`).
  - `opening another plugin clears proposal and undo`.
  - `the key never appears` — collect every response body, SSE frame and `console.error` argument; none contains the key string.
- [ ] **Step 2: Run** `node --test test/studioAiRoutes.test.js` — expected: FAIL.
- [ ] **Step 3: Implement** `routes.js` and wire it into `actions.js`.
- [ ] **Step 4: Run** the file, then `npm test` — expected: PASS.
- [ ] **Step 5: Commit** — "Let the studio AI propose, apply and undo plugin changes".

### Task 7: Chat column, settings dialog and diff view

**Files:**
- Create: `scripts/studio/public/ai.js`, `scripts/studio/public/ai-diff.js`, `scripts/studio/public/ai-settings.js`
- Modify: `scripts/studio/public/api.js` (`aiSettings()`, `saveAiSettings(body)`, `testAi(body)`, `aiModels(body)`, `aiChat(body, { signal }) → Response`, `aiApply(body)`, `aiUndo()`), `scripts/studio/public/workspace.js` (column between editor and preview, toolbar button „KI“ toggles it; below 1200 px a tab „KI“ next to „Vorschau“), `scripts/studio/public/toolbar.js` (button „KI ⚙“ opens the settings), `scripts/studio/public/debug.js` (`onError` callback for plugin `error` events), `scripts/studio/public/studio.css`
- Test: `test/studioAiPage.test.js` (pure functions, like `test/studioPage.test.js`)

**Interfaces:**
- Consumes: Task 6 routes and event shapes; `escapeHtml`, `showDialog`, `showToast` (`ui.js`); `loadMonaco()` (`editor.js`) for `monaco.editor.createDiffEditor`; the editor's dirty buffers from `workspace.js`.
- Produces (pure, exported for tests):
  - `parseSse(text) → { events: [{ event, data }], rest }` (stream reader for the fetch body).
  - `renderMessage({ role, text, status, proposal, applied })` → HTML (escaped text; inline code spans only).
  - `renderProposalSummary(proposal)` → HTML: „N Dateien geändert“, `dropped`, „bestand schon vorher“ list, permission line „Neu: network — das Plugin darf ins Internet.“ (`network` and `discord:*` with class `is-risky`), buttons `data-action="ai-view"`, `"ai-apply"`, `"ai-discard"`, after apply `"ai-undo"`.
  - `renderApplyDialog({ unsaved, conflicts })` → HTML with one checkbox „mit speichern“ per unsaved path (checked) and the conflict note.
  - `renderSettingsForm(view)` → HTML: provider select, Ollama „Lokal“/„Cloud“ buttons, base URL, key field (placeholder „gespeichert“ when `apiKeySet`), model with „Modelle laden“, `maxTokens`, `contextTokens`, Ollama context hint (only for `ollama`), „Verbindung testen“.
  - `emptyStateHtml()` → „KI einrichten“ button (`data-action="ai-setup"`).
- Behaviour: send = `aiChat({ message, history, buffers: dirty buffers, open: open tab paths, includeErrors })`; „Stopp“ aborts the fetch; history lives in module memory per plugin (reset on open). „Fehler an KI schicken“ chip appears on a plugin `error` debug event and sends `includeErrors: true` with the message „Erkläre und behebe diesen Fehler.“. After apply the editor reloads the written files from disk (same path as an external change) and clears their dirty marks.

- [ ] **Step 1: Write the failing tests:**
  - `parseSse handles frames split across chunks`.
  - `renderMessage escapes HTML` (`<img onerror>` stays text).
  - `renderProposalSummary marks network and discord permissions as risky and lists old problems separately`.
  - `renderApplyDialog checks every unsaved file by default`.
  - `renderSettingsForm shows the ollama hint only for ollama and never a key value`.
  - The existing guards (`test/frontendCsp.test.js`, `test/cssRules.test.js` via `studioPageSources()` in `test/helpers.js`) must pick up the three new files; if `studioPageSources()` uses a fixed list, add them there.
- [ ] **Step 2: Run** `node --test test/studioAiPage.test.js test/studioPage.test.js` — expected: FAIL.
- [ ] **Step 3: Implement** modules, wiring and CSS (DEMS tokens only).
- [ ] **Step 4: Run** `npm test` — expected: PASS. Then by hand: `npm run plugin -- studio`, set Ollama or a cloud key, „Neues Plugin“, ask „Schick nach dem Check-in eine Danke-DM“, see the diff, „Übernehmen“, the preview restarts, the DM appears in the debug panel on „Check-in“.
- [ ] **Step 5: Commit** — "Add the AI chat column to the plugin studio".

### Task 8: Browser test and docs

**Files:**
- Modify: the studio Playwright spec of part 2 (`e2e/studio.spec.js`), `docs/wiki/howto/plugin-studio.md`, `docs/wiki/concepts/ai-integration.md`, `docs/wiki/index.md` (file → node table), `docs/wiki/graph.json` (via `npm run wiki`)

- [ ] **Step 1: Write the Playwright test** (optional in CI like part 2): start a fake provider (local `http` server streaming one answer with a `server.js` block), write `ai.json` into a temp `configDir`, open the studio, new plugin, open „KI“, send a message, the summary says „1 Datei geändert“, „Ansehen“ shows the diff, „Übernehmen“ → the editor shows the new `server.js`, „Rückgängig“ restores it; no CSP violation in the console.
- [ ] **Step 2: Run** `npm run test:e2e -- studio` — expected: PASS.
- [ ] **Step 3: Write the docs:** section „KI-Assistent“ in `howto/plugin-studio.md` (setup per provider incl. Ollama local/cloud and the context-length hint, what is sent to the provider, diff/apply/undo, repair round, limits, the key stays in `ai.json`); one line in `concepts/ai-integration.md` (studio reuses `ai/` with own settings, `idleTimeoutMs`); sources of both nodes; `npm run wiki`.
- [ ] **Step 4: Run** `npm test` — expected: PASS (wiki validation included).
- [ ] **Step 5: Commit** — "Document the studio AI assistant and cover it in the browser test".
