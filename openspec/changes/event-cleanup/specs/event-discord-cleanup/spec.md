# Spec Delta

## Purpose

Tidies up Discord once an event is over for good — archived, cancelled or deleted — so its private channels and the event role do not stay behind on the server.

## ADDED Requirements

### Requirement: Clean-up when an event is archived or cancelled
When an event becomes `archived` or `cancelled` — by the automatic archive, „Jetzt beenden“, a status change, saving it with that status or absagen — DEMS SHALL delete its event channels and take its event role from every member with an `accepted` registration. The status change SHALL NOT wait for or fail because of Discord.

#### Scenario: Automatic archive
- **WHEN** the scheduler archives an event 24 hours after its end that has a voice channel, a text channel and the event role „Event-Teilnehmer“ held by two accepted members
- **THEN** both channels are deleted and both members lose „Event-Teilnehmer“

#### Scenario: Ended by hand
- **WHEN** an admin clicks „Jetzt beenden“ on a running event with an event role
- **THEN** the accepted members lose the event role and the event channels are deleted

#### Scenario: Cancelled
- **WHEN** an admin cancels an active event with an event role
- **THEN** the accepted members lose the event role and the event channels are deleted

#### Scenario: Only accepted members
- **WHEN** an archived event has an accepted, a pending and a waitlisted registration
- **THEN** only the accepted member's role is taken back

#### Scenario: Nothing to clean up
- **WHEN** an event without event role and without channels is archived
- **THEN** nothing is sent to Discord and no clean-up entry is written

#### Scenario: Back to draft
- **WHEN** an admin sets an active event back to draft
- **THEN** the members keep the event role

### Requirement: Shared role stays while still needed
A member SHALL keep the event role when they hold an `accepted` registration for another event that is `draft` or `active` and hands out the same role.

#### Scenario: Next date of a series
- **WHEN** the first date of a series is archived and a member is accepted for the first and the second date, both with the role „Event-Teilnehmer“
- **THEN** the member keeps „Event-Teilnehmer“, a member accepted only for the first date loses it

#### Scenario: Other event already over for good
- **WHEN** the other event with the same role is archived or cancelled
- **THEN** it does not protect the role

### Requirement: Deleting an event takes the role back
Deleting an event or a whole series SHALL take the event role from the accepted members of each deleted event (with the shared-role rule) and delete its channels, before its registrations are removed.

#### Scenario: Event deleted
- **WHEN** an admin deletes an event with an event role and one accepted member
- **THEN** the member loses the event role

### Requirement: Clean-up catches up after an offline bot
A clean-up the bot could not run because it was not ready SHALL stay pending, and the archive scheduler SHALL run it again on its next pass (at start and every 5 minutes) while the event is still `archived` or `cancelled`. A finished clean-up SHALL NOT run again.

#### Scenario: Bot offline at archive time
- **WHEN** the scheduler archives an event with an event role while the bot is offline, and the bot is online at the next pass
- **THEN** the next pass takes the role from the accepted members

#### Scenario: Done once
- **WHEN** a clean-up has run and the scheduler passes again
- **THEN** nothing is sent to Discord for that event

#### Scenario: Reactivated before the catch-up
- **WHEN** an event with a pending clean-up is set active again before the bot is back
- **THEN** the scheduler does not take the role later

### Requirement: Reactivating hands the role back
Setting a cleaned-up `archived` or `cancelled` event back to `active` SHALL give the event role to its `accepted` members again.

#### Scenario: Wieder aktivieren
- **WHEN** an admin reactivates an archived event whose clean-up took „Event-Teilnehmer“ from two accepted members
- **THEN** both members get „Event-Teilnehmer“ again

### Requirement: Clean-up is logged
Every clean-up that ran SHALL write the audit entry `DISCORD_CLEANUP` by „System“ with the number of members who lost the role and whether channels were deleted. Failures for a single member (e.g. a member who left the server) SHALL be logged and SHALL NOT stop the clean-up.

#### Scenario: Audit entry
- **WHEN** the clean-up of an archived event takes the role from three members and deletes its channels
- **THEN** the audit log shows `DISCORD_CLEANUP` by „System“ naming three members and the deleted channels

#### Scenario: Member left the server
- **WHEN** one of three accepted members has left the Discord server
- **THEN** the other two lose the role and the clean-up counts as done
