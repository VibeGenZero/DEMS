# Spec Delta

## Purpose

Lets a member act on an event reminder directly in Discord: open the event, or unregister after a confirmation so the waitlist can move up.

## ADDED Requirements

### Requirement: Reminder DM carries actions
The reminder DM SHALL keep its text and SHALL carry a link button „Zum Event“ to the event page and a button „Ich kann doch nicht“. It SHALL NOT carry a calendar button.

#### Scenario: Reminder before an event
- **WHEN** a reminder for "Raid-Nacht" is due and the member can still unregister
- **THEN** the DM says "⏰ Erinnerung! Das Event Raid-Nacht startet am …" and shows „Zum Event“ and „Ich kann doch nicht“

### Requirement: Unregistering asks first
A click on „Ich kann doch nicht“ SHALL answer privately with „Wirklich von <Titel> abmelden?“ and the buttons „Ja, abmelden“ and „Abbrechen“. Nothing SHALL change before „Ja, abmelden“.

#### Scenario: Member clicks
- **WHEN** a member clicks „Ich kann doch nicht“ in the reminder
- **THEN** a private question „Wirklich von **Raid-Nacht** abmelden?“ with „Ja, abmelden“ and „Abbrechen“ appears and the registration is unchanged

#### Scenario: Member cancels
- **WHEN** the member clicks „Abbrechen“
- **THEN** the answer reads "Abmeldung abgebrochen." and the registration is unchanged

### Requirement: Confirming unregisters and lets the waitlist move up
„Ja, abmelden“ SHALL unregister the member with the same rules and effects as on the website: role removed, the first waitlisted member moves up, the announcement is refreshed.

#### Scenario: Full event with waitlist
- **WHEN** an accepted member of a full event confirms „Ja, abmelden“
- **THEN** the answer reads "✅ Du wurdest von **Raid-Nacht** abgemeldet." and the first waitlisted member moves up

### Requirement: No unregister button after the unregister deadline
When the event's unregister deadline has passed at the time the reminder is sent, the reminder SHALL show only „Zum Event“. A click on an older reminder after the deadline SHALL change nothing and answer with the existing refusal.

#### Scenario: Deadline already passed
- **WHEN** a reminder is sent one hour before start and the unregister deadline was the evening before
- **THEN** the DM shows „Zum Event“ and no „Ich kann doch nicht“

#### Scenario: Old reminder clicked after the deadline
- **WHEN** a member confirms „Ja, abmelden“ from a reminder after the unregister deadline has passed
- **THEN** the answer is "❌ Abmelden ist nicht mehr möglich. Wende dich an einen Admin." and the registration stays
