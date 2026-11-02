# Spec Delta

## Purpose

Lets a member who moves up from the waitlist confirm the freed place within a deadline, so places go to members who can still come instead of staying blocked.

## ADDED Requirements

### Requirement: A freed place is offered
When a place frees up and the bot center switch „Nachrücken bestätigen“ is on, the waitlist entry that would move up SHALL instead get the status `offered` with a deadline. An offered registration SHALL hold its place (and its slot on slot events) for the counts, places and further move-ups, and SHALL no longer count as waitlisted.

#### Scenario: Place freed
- **WHEN** an accepted member of a full event unregisters and Lena is first on the waitlist
- **THEN** Lena's registration is `offered` with a deadline and the event stays full

#### Scenario: Switch off
- **WHEN** „Nachrücken bestätigen“ is off in the bot center
- **THEN** members move up at once as before (accepted, or pending with manual approval)

### Requirement: Offer deadline
The deadline SHALL be now plus the bot center's „Bestätigungsfrist“ (hours, default 12, 1–72), but never later than one hour before the event start. When the start is less than one hour away, the member SHALL move up at once without an offer.

#### Scenario: Plenty of time
- **WHEN** a place is offered three days before the start with a 12-hour period
- **THEN** the deadline is 12 hours from now

#### Scenario: Close to the start
- **WHEN** a place is offered five hours before the start with a 12-hour period
- **THEN** the deadline is one hour before the start

#### Scenario: Very close to the start
- **WHEN** a place frees up 30 minutes before the start
- **THEN** the next member moves up at once without an offer

### Requirement: The member learns of the offer
The member SHALL get a DM with the event title, the deadline and the buttons „Platz annehmen“, „Doch nicht“ and „Zum Event“, also when they switched waitlist DMs off. The event page, the profile, `/meine-events` and `/event info` SHALL show „⏳ Platz angeboten – bestätigen bis <Zeit>“; the event page SHALL offer „Platz annehmen“ and „Doch nicht“.

#### Scenario: DM
- **WHEN** Lena gets an offer for „Koop-Abend“ until Friday 20:00
- **THEN** her DM names the event, the deadline and shows the three buttons

### Requirement: Confirming moves the member up
„Platz annehmen“ (Discord or web) before the deadline SHALL move the member up as an instant move-up does today: `accepted` (role, channel access, welcome DM) or, for events with manual approval, `pending` (approval request). After the deadline, or when the registration is no longer offered, it SHALL answer that the offer is no longer valid and change nothing.

#### Scenario: Confirm in Discord
- **WHEN** Lena clicks „Platz annehmen“ in the DM before the deadline
- **THEN** she is accepted and the DM shows „✅ Du bist dabei!“ with only „Zum Event“ left

#### Scenario: Too late
- **WHEN** Lena clicks „Platz annehmen“ after her offer expired
- **THEN** she reads „Das Angebot ist nicht mehr gültig.“ and nothing changes

### Requirement: Declining or expiry hands the place on
„Doch nicht“ SHALL remove the registration and offer the place to the next waitlist entry. An offer whose deadline passed SHALL be removed by the expiry pass (every 5 minutes) with the DM „Dein Platz bei <Event> ist verfallen.“, and the place SHALL go to the next entry.

#### Scenario: Decline
- **WHEN** Lena clicks „Doch nicht“ and Kira is next on the waitlist
- **THEN** Lena is no longer registered and Kira gets the offer

#### Scenario: Expiry
- **WHEN** Lena's offer expires without an answer
- **THEN** her registration is removed, she gets the DM, and the next entry gets the offer

### Requirement: Admins see and decide offers
The admin registrations dialog SHALL show an offered registration as „Angeboten“ with its deadline; admins SHALL be able to accept or reject it like a waitlisted one, which ends the offer.

#### Scenario: Admin accepts
- **WHEN** an admin accepts an offered registration
- **THEN** it is accepted and no expiry or DM button changes it afterwards

### Requirement: Bot center settings
The bot center SHALL have the switch „Nachrücken bestätigen“ (default on) and the number „Bestätigungsfrist (Stunden)“ (default 12). Values outside 1–72 SHALL be refused with „Die Bestätigungsfrist muss zwischen 1 und 72 Stunden liegen.“

#### Scenario: Invalid period
- **WHEN** an admin saves a period of 0 hours
- **THEN** the save is refused with the message and the old value stays
