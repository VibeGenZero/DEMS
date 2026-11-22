# „Event-Feedback“ plugin — design

Builds on Plugin SDK 1.1 (`docs/superpowers/specs/2026-11-21-plugin-sdk-1-1-badges-design.md`)
and ships with it in DEMS 3.5.0. Branch `feature/event-feedback` from
`feature/plugin-sdk-1.1`; its PR targets `feature/plugin-sdk-1.1`.

## Intent

The team wants to learn which events go down well and what to change. Members who
took part get asked once, right after the event, and answer in a few seconds. To get
honest answers, admins see the answers without names.

## Goals

- After an event ends, ask everyone who took part for a rating (1–5 stars) and an
  optional comment: one DM with a link button, and a form on the website.
- Admins see, per past event, the average, the number of answers and the response
  rate, the star distribution and the comments without names; plus the average per
  event category.
- Members see their own feedback and which events still wait for it.

## Non-goals

- No rating inside Discord (buttons/modals need SDK 1.2).
- No feedback from guests, no feedback before the end or after the window.
- No editing or deleting of comments by admins, no replies, no export.
- No public results for members, no channel post of results.
- No custom questions per event (fixed: stars + comment).

## Anti-goals

- An admin can see who wrote which answer in the admin view (ids or names in any
  admin answer of the plugin).
- A member gets asked twice for the same event, or gets asked for an event they did
  not take part in.
- A member can rate someone else's event participation or rate twice.

Known limit, said in the wiki: „anonym“ means „ohne Namen“. With very few answers an
admin who knows the attendees can still guess; the view shows no times either.

## Approaches (decided)

| | How members answer | Trade-off |
|---|---|---|
| **A (chosen)** | DM with a link button → form on the plugin page | works with SDK 1.1 as it is; one click more than in Discord |
| B | Buttons and a modal right in the Discord DM | needs Discord buttons/modals for plugins (SDK 1.2), a much bigger project |

Purpose, anonymity, eligibility and the 7-day window were agreed in the conversation.

## Rules

- **Event end** = `endDate`, else start + 2 h (DEMS' `isEventOver` rule). Events with
  status `cancelled` or `draft` never take feedback.
- **Window:** from the end until 7 days after it.
- **Eligible:** the member's own registration with status `accepted`; when the event
  has `checkinEnabled`, additionally `checkedIn === true`. Guest places never.
- **One answer per member and event**, changeable within the window.
- Eligibility and window are checked live on every request: a member checked in by an
  admin after the end can still answer within the window (they just got no DM).
- **Answer:** `rating` integer 1–5 (required), `comment` trimmed, ≤ 1000 characters
  (optional).

## The plugin

`plugins/event-feedback/` with `plugin.json`, `rules.js` (pure), `server.js`,
`client.js`, `assets/view.js`, `client.css`. Node built-ins only, no DEMS imports.

```json
{
  "id": "event-feedback", "name": "Event-Feedback", "version": "1.0.0", "sdk": 1.1,
  "description": "Teilnehmer bewerten Events nach dem Ende – das Team sieht, was gut ankommt.",
  "permissions": ["events:read", "registrations:read", "discord:dm"],
  "settings": [
    { "key": "noDm", "type": "boolean", "label": "Keine Feedback-Anfragen per DM senden",
      "help": "Ohne DM finden Mitglieder offene Feedbacks nur im Tab „Feedback“." }
  ]
}
```

(Manifest settings have no defaults; the inverted key makes „DMs an“ the start state.)

### Data (`ctx.data`)

- `answers/<eventId>_<userId>` `{ eventId, userId, rating, comment, createdAt, updatedAt }`
  — `userId` is the reserved field, so account deletion purges it.
- `requests/<eventId>` `{ eventId, sentAt, count }` — an event's members were asked
  (also when the DM is off, so switching it on later sends nothing old).

### Triggers

- `event.ended` → once per event (no `requests` doc yet): list the eligible members,
  store `requests/<eventId>`, then unless `noDm` send each a DM in the background:
  „Wie war **<Titel>**? Gib dem Team kurz Feedback – das dauert nur ein paar Sekunden.“
  + link button „Feedback geben“ → `ctx.siteUrl('p/event-feedback/<eventId>')`.
  An event archived again later asks nobody again. More than the SDK's 200 DMs per
  10 minutes are dropped by the limit (logged); the tab still shows the open feedback.
- `event.deleted` → delete the event's answers and its request.

### Routes (`/api/plugins/event-feedback`)

| Method | Path | Access | Does |
|---|---|---|---|
| GET | `/mine` | member | `{ open: [event], done: [{ event, rating, comment, editable }] }` — events in the window the member may rate (open = no answer yet) and the member's answers, newest first; `event` = `{ id, title, startDate, category }` |
| GET | `/events/:eventId/mine` | member | the event (same shape), `editable`, and the member's answer or null; 403 „Für dieses Event kannst du kein Feedback geben.“ when not eligible |
| PUT | `/events/:eventId/mine` | member | `{ rating, comment }` → stores or replaces the member's answer; 400 „Bitte vergib 1 bis 5 Sterne.“ / „Der Kommentar darf höchstens 1000 Zeichen lang sein.“; 403 as above; 409 „Die Feedback-Zeit für dieses Event ist vorbei.“ outside the window |
| GET | `/summary` | admin | `{ events: [{ event, count, eligible, average }], categories: [{ category, count, average }] }` — ended events (not cancelled/draft) with at least one eligible member or answer, newest first, at most 100; `average` rounded to one decimal, null without answers |
| GET | `/events/:eventId/summary` | admin | `{ event, count, eligible, average, distribution: [n1, n2, n3, n4, n5], comments: [{ rating, comment }] }` — only answers with a comment, sorted by rating (low first), then text; **no ids, names or times** |

### Page

One page `#p/event-feedback[/<eventId>]`, `access: 'member'`, tab „Feedback“
(`bi-chat-heart`) for every member, tab badge = number of open feedbacks (set after
login and after each answer).

- `<eventId>` param → the form: title and date, 5 star buttons (`aria-pressed`,
  `aria-label` „1 Stern“ … „5 Sterne“), comment textarea (counter), „Feedback senden“ /
  „Feedback ändern“; toast „Danke für dein Feedback!“; outside the window or not
  eligible: an empty state with the server's message.
- No param → member view: „Offen“ (cards with „Feedback geben“) and „Deine Bewertungen“
  (stars + comment, „Ändern“ while editable); admins get a pill switch „Auswertung“ /
  „Mein Feedback“ like „Event einreichen“.
- Admin „Auswertung“: category averages as chips, then the event list (title, date,
  ★ average, „9 von 12 (75 %)“); a click opens the event detail inline: star bars and
  the comments with their stars, no names.

```
Feedback  [Auswertung] [Mein Feedback]
Raid ★ 4,2 · Quiz ★ 3,1
┌────────────────────────────────────────────┐
│ Raid-Abend · Do, 20.11.   ★ 4,3  9 von 12 (75 %) │
│   ★5 ████████ 5  ★4 ███ 2  ★3 ██ 1 …           │
│   „Gute Orga, nächstes Mal früher starten.“ ★4 │
└────────────────────────────────────────────┘
```

## Left to the builder

Module splits, exact markup within the core components (card, chip, button, empty
state), German copy beyond the strings above, the dev seed (one ended event with a few
answers and one open request for a persona).
