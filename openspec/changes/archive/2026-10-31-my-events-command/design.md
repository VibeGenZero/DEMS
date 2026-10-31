# Design

## Context

- The profile page already builds the list this command needs: `routes/user.js` (`GET /api/user/profile`) loads the member's registrations and events, adds waitlist places with `waitlistPositions` (`utils/capacity.js`) and splits them with the pure helper `buildProfileEvents` (`utils/profileEvents.js`) into `upcoming` (next first) and `history`. An entry carries `status`, `slot` (`{ name, emoji, wish }`), `waitlistPosition` and a reduced `event`, but not the slot ID.
- The slot answer of an announcement has `slot_switch:<eventId>:<slotId>` (`handleSlotSwitchButton` → `switchOwnSlot`) and `slot_leave:<eventId>` (`handleSlotLeaveButton` → `unregisterUserFromEvent`); both defer with `deferUpdate` and answer with `editReply({ content, components: [] })`.
- `/register` and `/unregister` get their German names in `buildSlashCommands` (`bot/commands.js`, B-03). `bot/commands.js` has ~290 lines; area modules are capped at 500 lines by `test/botModules.test.js`.
- Free places per slot: `countSlotOccupancy` + `hasFreePlace` (`utils/slotService.js`), as in `buildRegisteredSlotReply`.

## Goals / Non-Goals

**Goals:**
- Reuse the profile list and the existing switch/leave handlers; the overview adds only display and two small intermediate answers.

**Non-Goals:**
- No refresh of an overview that is already open after a switch or leave (it is private and short-lived; running the command again shows the new state).
- No new export through `bot.js`, so no twin in `dev/mockBot.js`; no env variables; no API change.

## Decisions

1. **New area module `bot/myEvents.js`.** Holds `loadUpcomingRegistrations(userId)`, `buildMyEventsMessage(entries)`, `handleMyEventsCommand`, `handleMyLeaveButton`, `handleMyLeaveCancelButton`, `handleMySwitchButton`. `bot/commands.js` only defines the command and routes `my-events` to it; `bot/interactions.js` routes the new prefixes. *Alternative:* everything in `bot/commands.js` — rejected, it would approach the 500-line cap and mix list rendering with command routing.

2. **Data: same rules as the profile page.** `loadUpcomingRegistrations` queries `registrations` by `userId`, loads each event with `getDoc`, adds waitlist places for waitlisted registrations of active events (same loop as `routes/user.js`) and calls `buildProfileEvents(…).upcoming`. It returns the entries joined with their raw registration (needed for `slotId`). The loop is duplicated rather than extracted: `utils/profileEvents.js` is kept free of database access, and the route also needs the documents for its badges. *Alternative:* a shared loader in `utils/` — possible later if a third caller appears.

3. **Overview as Components V2.** Ephemeral `flags: IsComponentsV2 | Ephemeral`, one container in the DEMS accent `#8b5cf6`: heading `## 📅 Deine Events`, then per entry a text display (`**Titel**`, start via `toLocaleString('de-DE', { timeZone: TIMEZONE })`, status line, slot) and an action row with the buttons. Budget: container 1 + heading 1 + 5 × (text 1 + row 1 + ≤3 buttons) + closing line 1 = 29 of Discord's 40 components. At most `MY_EVENTS_MAX = 5` entries; the closing line reads "… und N weitere — alle auf deiner Profilseite: <link>". Empty list → classic ephemeral text "📭 Du bist für kein kommendes Event angemeldet. Zur Übersicht: <link>".
   Status texts: accepted "✅ Angemeldet", pending "📋 Anfrage ausstehend", waitlisted "🕒 Warteliste – Platz N von M" ("🕒 Warteliste" without a known place), rejected "❌ Abgelehnt". Slot: `formatSlotLabel`-style "emoji name", a wish as "Wunsch: emoji name".

4. **Buttons and custom IDs** (new constants in `bot/constants.js`):
   - `my_leave:<eventId>` „Abmelden“ (Danger) — only when `!isUnregisterClosed(event)` and status ≠ rejected.
   - `my_switch:<eventId>` „Slot wechseln“ (Secondary) — only for slot events, registration with `slotId`, status ≠ rejected/waitlisted, `!isRegistrationClosed(event)`.
   - „Zum Event“ link button via `buildEventUrl`.
   The overview needs the event data for the deadline checks, so `loadUpcomingRegistrations` keeps the full event documents next to the entries.

5. **Confirmation and slot choice are new classic ephemeral replies, not updates of the overview.** `my_leave` → `reply({ content: 'Wirklich von **<Titel>** abmelden?', components: [row(slot_leave:<id> „Ja, abmelden“ Danger, my_leave_cancel:<id> „Abbrechen“ Secondary)] })`. „Ja, abmelden“ reuses `handleSlotLeaveButton` unchanged; it edits this confirmation with its result. `my_leave_cancel` → `update({ content: 'Abmeldung abgebrochen.', components: [] })`.
   `my_switch` → load the event and its registrations, offer `slot_switch:<id>:<slotId>` buttons „Zu <name> wechseln“ (emoji set) for every other slot with `hasFreePlace`, ≤5 per row; none → "Gerade ist kein anderer Slot frei.". The click runs `handleSlotSwitchButton` unchanged.
   Classic messages are required here: `handleSlotLeaveButton`/`handleSlotSwitchButton` answer with `content`, which a V2 message refuses. Replying (instead of updating the overview) keeps the overview usable for the other events. *Alternative:* a Discord confirmation modal — rejected, modals cannot hold only a yes/no.

6. **Command name.** `buildSlashCommands` adds `my-events` with `setNameLocalizations({ de: 'meine-events' })` and the German description "Zeigt deine kommenden Anmeldungen" (base and `de`). No options.

7. **Links.** `utils/eventUrl.js` gets `buildSiteUrl(page)` → `${BASE_URL}/#<page>` for `profile` and `events` (same base URL logic as `buildEventUrl`; event links keep using `buildEventUrl`).

8. **Mock data stays as it is.** The seed already covers the overview: persona `admin` (Mori) holds "Schaden" in the raid (`EVENT_ID.ROLE`) where "Heiler" has a free place and "Tank" is full, so „Slot wechseln“ offers exactly „Zu Heiler wechseln“; persona `member` (Tom) has a pending, a waitlisted and a rejected upcoming registration; persona `raider` (Lena) has plain accepted ones. Lena deliberately has no raid registration (`test/seed.test.js`: she picks a raid role herself in the browser tour), so the originally planned "Lena as Tank" entry is dropped — Tank is also already full with Ben. `test/seed.test.js` pins the coverage through `loadUpcomingRegistrations`.

## Risks / Trade-offs

- [The overview goes stale after an action] → each action answers on its own with the result; the overview's buttons re-check everything on click (`switchOwnSlot`, `unregisterUserFromEvent`).
- [One read per event and per waitlisted event] → members have few upcoming registrations; same cost as the profile page.
- [V2 component limit] → capped at five entries with a fixed budget of 29 components; a test pins that seven registrations render five.
- [Archive order] → the delta adds to `discord-slash-commands`, created by `register-command-in-discord`; archive that change first so the main spec keeps its Purpose.
