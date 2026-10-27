# Tasks

Test first in every group (node:test + node:assert/strict): write the test, see it fail for the expected reason, then implement. Frontend tests run with `node --experimental-vm-modules --test …`.

## 1. Shared V2 helpers (`bot/layout.js`)

- [ ] 1.1 Write `test/botLayout.test.js`: `toAccentColor` (`#f59e0b` → 0xf59e0b, '', `red`, `#fff` → 0x8b5cf6), `fitText` (cuts to max with "…", never leaves half a surrogate pair, keeps short text), `buildAnnouncementIntro` (roles + `@everyone` + text in that order, '' when empty, trims text); see them fail
- [ ] 1.2 Create `bot/layout.js` (pure, ≤ 500 lines) with these helpers and a `countComponents(payload)` helper for tests; verify 1.1 passes and `test/botModules.test.js` still passes (module size and require rules)

## 2. Event announcement layout (`bot/messages.js`)

- [ ] 2.1 Rewrite the event message tests (existing `buildEventEmbed`/`buildEventComponents` tests and `test/botBanner.test.js`) against `buildEventAnnouncement(event, eventId, roster, intro)`: V2 flag; intro text display only with pings; container accent from `accentColor` and fallback; banner as media gallery with the `BASE_URL` rule; heading + description, "Keine Beschreibung."; facts lines (places sentence, waitlist, category, both deadlines, time zone); slot sections with button accessory and "(voll)"; closed registration → plain text blocks, last row only "Zum Event"; non-slot row "Anmelden" + "Zum Event"; form too big → only "Zum Event"; 5000-char description → total text ≤ 4000 and ends with "…"; 10 slots + banner + intro → `countComponents` ≤ 40; see them fail
- [ ] 2.2 Implement `buildEventAnnouncement` in `bot/messages.js` reusing `formatParticipantCount`, `formatRosterSlotTitle`, `formatRosterMembers`, `canRegisterViaDiscord`, `buildSlotButton`; remove `buildEventEmbed`, `buildEventComponents`, `cutForEmbed`; verify 2.1 passes
- [ ] 2.3 Change `sendChannelMessage(channelId, payload, { roleIds, pingEveryone })` to send the payload with today's `allowedMentions` and return `{ channelId, messageId, guildId }`; extend `test/botRealExports.test.js` for the neutral value while not ready; verify it passes
- [ ] 2.4 Write tests for `editStoredMessages(records, buildPayload)` with a fake client: per-record payload, edit gets `content: null`, `embeds: []`, `allowedMentions: { parse: [] }`; a record without `intro` takes `message.content` as intro and is returned updated; gone message dropped; other error keeps the record unchanged; see them fail, implement, verify they pass
- [ ] 2.5 Update `refreshEventAnnouncements` to build per record with the stored intro and write records back when the list or an intro changed; cover with a fake-client test; verify it passes

## 3. Poll layout (`bot/polls.js`)

- [ ] 3.1 Rewrite the poll message tests against `buildPollMessage(poll, tally, intro)` and `buildPollDeletedMessage(poll)`: container colours (open accent, decided green, closed and deleted grey), title variants ("Termin steht", "Abstimmung beendet", "Abstimmung gelöscht"), options with counts, favourite/winner marker and names, footer with deadline and vote count, buttons as today, description cut to the text budget; see them fail
- [ ] 3.2 Implement them, switch `refreshPollMessages` and `markPollMessagesDeleted` to the per-record `editStoredMessages`; remove `buildPollEmbed`/`buildPollComponents`; verify 3.1 passes

## 4. Thread helper (`bot/threads.js`) and exports

- [ ] 4.1 Write `test/botThreads.test.js` with a fake client/state: not ready → null; existing thread fetchable → returns existing, no `startThread`; existing gone (10003 or null) → new thread on the message named after the title cut to 100, one week auto archive, returns `{ guildId, threadId }`; other fetch error → existing unchanged; `startThread` throws → null and logged; see them fail
- [ ] 4.2 Implement `bot/threads.js` (`ensureAnnouncementThread`, `isReady` guard, try/catch); verify 4.1 passes
- [ ] 4.3 Update `bot.js` exports (drop `buildEventEmbed`, `buildEventComponents`, `buildPollEmbed`, `buildPollComponents`; add `buildEventAnnouncement`, `buildPollMessage`, `buildAnnouncementIntro`, `ensureAnnouncementThread`) and the pinned list in `test/botModules.test.js`; verify it passes
- [ ] 4.4 Add `CreatePublicThreads` to `utils/botPermissions.js` with a German reason; extend `test/botPermissions.test.js`; verify it passes
- [ ] 4.5 Update `dev/mockBot.js`: `sendChannelMessage(channelId, payload, options)` logs the V2 JSON and returns `guildId`; refresh twins log the new payloads; new `ensureAnnouncementThread` twin (keeps existing, else mock guild id + fake snowflake); extend `test/mockBot.test.js`; verify it passes

## 5. Routes and settings

- [ ] 5.1 Write `test/botSettings.test.js` cases: missing `announcementThreads` → true, stored false stays false; and a `test/devServer.test.js` case that `PUT /api/admin/bot/settings` saves and returns it; see them fail
- [ ] 5.2 Add `announcementThreads` to `utils/botSettings.js` defaults/`ON_BY_DEFAULT` and the settings route whitelist in `routes/admin.js`; verify 5.1 passes
- [ ] 5.3 Write `test/devServer.test.js` cases (admin persona): announce stores `{ channelId, messageId, intro }` and a `discordThread` with the switch on; announcing again keeps the same thread; with the switch off no thread is stored; `GET /api/events/:id` as member returns `discordThread`; duplicate of an event with a thread has `discordThread: null`; poll announce stores `intro` and no thread; see them fail
- [ ] 5.4 Update `POST /events/:id/announce` and `POST /polls/:id/announce` in `routes/admin.js` (D7), set `discordThread: null` in duplicate and both series creation paths; verify 5.3 passes
- [ ] 5.5 Update `POST /events/preview` to return `{ message: { components }, places, bot }`; adjust `test/eventPreview.test.js`; verify it passes
- [ ] 5.6 Update the wiki: `docs/wiki/modules/bot.md` (module table with `layout.js`/`threads.js`, exports, gotchas: V2 limits, stored intro, conversion), `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md` (`announcements[].intro`, `discordThread`, bot setting), `docs/wiki/modules/routes-admin.md` (announce, preview, settings), `docs/wiki/modules/dev-mock-mode.md`; run `npm run wiki`; verify `npm test` wiki checks pass

## 6. Frontend: wizard preview, bot center, event page

- [ ] 6.1 Rewrite `test/discordPreview.test.js` for the V2 renderer: container with border colour data attribute, text display via markdown, section with its button, media gallery image, separator, action row with link icon, escaping of labels and URLs; see them fail
- [ ] 6.2 Rewrite `public/js/admin/discord-preview.js` to render the component tree and adapt its caller in the wizard preview module; extend the "DISCORD PREVIEW" block in `public/css/style.css` with tokens only; verify 6.1 passes and `test/cssRules.test.js` stays green
- [ ] 6.3 Write a test for the bot center switch (load/save of `#bot-announcement-threads`, static markup check like `test/botSwitchesView.test.js`); see it fail, add the switch to `public/index.html` and `public/js/admin/bot-control.js`; verify it passes
- [ ] 6.4 Write tests for the event page row: row shown with `https://discord.com/channels/<guild>/<thread>` for valid snowflakes, hidden without a thread or with non-numeric ids, hidden again by `resetEventDetailAreas` (`test/eventDetailReset.test.js`); see them fail, add `#sidebar-thread-row` (`is-hidden`) to `public/index.html` and `renderThreadRow` in `public/js/events/detail.js`; verify they pass
- [ ] 6.5 Update `docs/wiki/modules/frontend-app.md` and `docs/wiki/modules/frontend-markup.md` (preview renderer, bot center switch, sidebar row); run `npm run wiki`

## 7. Seed data

- [ ] 7.1 Give the announced sample event in `dev/seedData.js` `announcements` with `intro` and a `discordThread` from the mock guild; adjust `test/seed.test.js` if it pins counts; verify `npm run dev:reset` + `npm run dev:mock` shows the "Diskussion" row and a registration logs the V2 payload with `[MOCK-DISCORD]`

## 8. Integration checks

- [ ] 8.1 Run `npm test` and verify it is green
- [ ] 8.2 Run `npm run test:e2e` (three times, shared-DB races) and adjust `e2e/wizard.spec.js` if it asserts embed markup; verify it is green
- [ ] 8.3 Browser check in mock mode on a scratch DB: wizard preview shows the container in the event colour with slot sections; bot center shows the new switch; event page shows the "Diskussion" link; screenshot for the MR
- [ ] 8.4 Search the repo for leftovers of the removed builders (`buildEventEmbed`, `buildEventComponents`, `buildPollEmbed`, `buildPollComponents`, `cutForEmbed`) outside `data/` and `docs/superpowers/`; verify none remain
- [ ] 8.5 If a real bot token is configured: announce a test event on the real server once and check the V2 message, the thread, and the conversion of an older embed announcement; otherwise list this as a manual check in the MR

## Workflow follow-up

- Commit planning and code separately, push, MR "B-05/B-14: …" with German description (Closes #88, Closes #97).
- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch (sync the new specs `discord-announcements`, `announcement-threads`; replace the MODIFIED blocks of `bot-center-settings` and `event-banners` whole).
