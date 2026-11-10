# discord-approvals Specification

## Purpose
Lets admins accept, reject or waitlist pending registrations directly in a Discord channel chosen in the bot center, with the same effects as on the website, and keeps each request message in step with the registration.

## Requirements

### Requirement: Pending registrations are posted to the approval channel
When an approval channel is set, every registration that becomes pending SHALL get one message in that channel: a new registration for an event with manual approval and a registration that moves up from the waitlist of such an event. Without an approval channel nothing SHALL be posted and approvals SHALL stay on the website. Posting failures SHALL NOT block the registration.

#### Scenario: New request
- **WHEN** an approval channel is set and a member registers for an event with manual approval
- **THEN** the registration is pending and one request message appears in the approval channel

#### Scenario: Moving up into a manual event
- **WHEN** a place frees up in an event with manual approval and a waitlisted member moves up to pending
- **THEN** a request message for that member appears in the approval channel

#### Scenario: No approval channel
- **WHEN** no approval channel is set and a member registers for an event with manual approval
- **THEN** nothing is posted and the request can be decided on the website as before

#### Scenario: Instant event
- **WHEN** a member registers for an event with instant approval
- **THEN** nothing is posted

### Requirement: Content of a request message
A request message SHALL show the event title and start, the member as a mention that does not notify them, the wished slot for slot events, the invited guests, and the form answers by field label. Long answers SHALL be cut so the message stays within Discord's limits. It SHALL carry the buttons „Annehmen“, „Ablehnen“, „Warteliste“ and the link „Zum Event“.

#### Scenario: Request with form and slot
- **WHEN** a member wishing "Tank" with the answers "Charakter: Thrall" and "Erfahrung: 2 Jahre" is posted
- **THEN** the message names the event, mentions the member, shows "Wunsch: 🛡️ Tank", both answers with their labels and the four buttons

#### Scenario: Very long answer
- **WHEN** a form answer has 3000 characters
- **THEN** Discord accepts the message and the answer ends with "…"

### Requirement: Only admins decide, checked at the click
A click on „Annehmen“, „Ablehnen“ or „Warteliste“ SHALL be carried out only when the clicking member is a DEMS admin at that moment: they hold the admin role or the Discord permission „Administrator“ (the owner included). Everybody else SHALL get the private answer "⛔ Nur Admins können Anmeldungen freigeben." and nothing SHALL change.

#### Scenario: Member without the admin role
- **WHEN** a member without the admin role clicks „Annehmen“
- **THEN** they get the private refusal and the registration stays pending

#### Scenario: Admin role removed
- **WHEN** an admin loses the admin role in Discord and then clicks „Ablehnen“
- **THEN** the click is refused although their website session still says admin

#### Scenario: Discord Administrator without the admin role
- **WHEN** a member with the Discord permission „Administrator“ but without the admin role clicks „Ablehnen“
- **THEN** the registration is rejected

### Requirement: A decision in Discord equals the decision on the website
„Annehmen“, „Ablehnen“ and „Warteliste“ SHALL change the registration exactly like the matching status change on the website: acceptance picks a slot when needed and may warn about an overbooked slot, the member gets the same DM, a rejection lets the waitlist move up, the announcement is refreshed and the audit log names the deciding admin.

#### Scenario: Accept
- **WHEN** an admin clicks „Annehmen“ on a pending request
- **THEN** the registration is accepted, the member gets the acceptance DM and the event role, and the audit log lists the admin

#### Scenario: Reject
- **WHEN** an admin clicks „Ablehnen“ on a pending request of a full event
- **THEN** the registration is rejected, the member gets the rejection DM and the next waitlisted member moves up

#### Scenario: Waitlist
- **WHEN** an admin clicks „Warteliste“
- **THEN** the registration is waitlisted

### Requirement: The message follows the request
As soon as a request is no longer pending — decided in Discord, on the website (single or bulk action), withdrawn by the member, or its event is cancelled or deleted — its message SHALL lose the buttons and name the result: "✅ Angenommen von <Name>", "❌ Abgelehnt von <Name>", "🕒 Auf die Warteliste gesetzt von <Name>", "↩️ Vom Mitglied zurückgezogen", "🚫 Event abgesagt" or "🗑️ Event gelöscht". A message deleted in Discord SHALL be ignored.

#### Scenario: Decided on the website
- **WHEN** an admin accepts a request on the website
- **THEN** its Discord message shows "✅ Angenommen von <Admin>" and has no buttons

#### Scenario: Member withdraws
- **WHEN** the member unregisters while the request is pending
- **THEN** the message shows "↩️ Vom Mitglied zurückgezogen" and has no buttons

#### Scenario: Message deleted
- **WHEN** someone deleted the request message in Discord and the request is then decided
- **THEN** the decision succeeds without an error

### Requirement: Clicks on decided requests
A click on a request that is no longer pending SHALL change nothing, answer privately with the current status, and close the message as described above.

#### Scenario: Two admins click at once
- **WHEN** one admin accepts a request and a second admin clicks „Ablehnen“ on the same message right after
- **THEN** the registration stays accepted and the second admin is told it was already accepted
