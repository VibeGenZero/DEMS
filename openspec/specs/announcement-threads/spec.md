# announcement-threads Specification

## Purpose

Gives every announced event one Discord discussion thread on its announcement and links it from the event page, so talk about an event stays in one place instead of mixing in the announcement channel.

## Requirements

### Requirement: Announcing opens a discussion thread
When an admin announces an event and the bot center switch "Diskussions-Thread zu Ankündigungen" is on, the bot SHALL open a public thread on the announcement message, named after the event title (cut to Discord's 100 characters), and SHALL remember it on the event. Date polls SHALL NOT get a thread.

#### Scenario: First announcement
- **WHEN** the switch is on and an admin announces an event "Raid Night" for the first time
- **THEN** a public thread "Raid Night" hangs on the announcement message and the event knows it

#### Scenario: Poll announcement
- **WHEN** an admin posts a date poll
- **THEN** no thread is opened

### Requirement: One thread per event
An event SHALL have at most one discussion thread. Announcing it again SHALL keep the existing thread while it exists in Discord and SHALL NOT open another. When the stored thread no longer exists, the next announcement SHALL open a new thread on the new message and the event SHALL link that one.

#### Scenario: Announced twice
- **WHEN** an event with a thread is announced again
- **THEN** no new thread is opened and the event page still links the first thread

#### Scenario: Thread was deleted
- **WHEN** the event's thread was deleted in Discord and an admin announces the event again
- **THEN** a new thread is opened on the new announcement message and the event page links it

### Requirement: The bot center switch controls new threads
The bot center SHALL offer the switch "Diskussions-Thread zu Ankündigungen", on by default. With the switch off, announcing SHALL NOT open a thread; a thread an event already has SHALL stay linked.

#### Scenario: Switch off
- **WHEN** an admin turns the switch off and announces an event without a thread
- **THEN** the announcement is posted and no thread is opened

#### Scenario: Switch off with an existing thread
- **WHEN** the switch is off and an event that already has a thread is shown
- **THEN** the event page still links its thread

### Requirement: A failed thread never fails the announcement
When the thread cannot be opened (missing permission, channel type without threads, Discord error), the announcement SHALL still count as posted, the answer SHALL be the usual success and the failure SHALL be logged. The event SHALL keep no thread in that case.

#### Scenario: Bot lacks the thread permission
- **WHEN** the bot may post but not create threads in the announcement channel and an admin announces an event
- **THEN** the answer is "Event im Discord-Channel angekündigt!", the message is posted and the event has no thread

### Requirement: The event page links the thread
The event page SHALL show a row "Diskussion" with a link that opens the event's thread in Discord for everyone who can see the event, and SHALL show no such row for an event without thread.

#### Scenario: Event with thread
- **WHEN** a member opens an event that has a thread
- **THEN** the sidebar shows "Diskussion" with a link to `https://discord.com/channels/<server>/<thread>`

#### Scenario: Event without thread
- **WHEN** a member opens an event without thread after one with a thread
- **THEN** no "Diskussion" row is shown

### Requirement: Copies never inherit a thread
A duplicated event, the events of a new or extended series and a newly created event SHALL start without a thread, so their first announcement opens their own.

#### Scenario: Duplicate an announced event
- **WHEN** an admin duplicates an event that has a thread and announces the copy
- **THEN** the copy gets its own new thread

### Requirement: The bot asks for the thread permission
The bot's invite link SHALL include the permission to create public threads.

#### Scenario: Invite link
- **WHEN** the bot logs its invite link on start
- **THEN** the requested permissions include "Create Public Threads"
