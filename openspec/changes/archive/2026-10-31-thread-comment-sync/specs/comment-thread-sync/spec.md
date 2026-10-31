# Spec Delta

## Purpose

Keeps the comments of an event page and the event's Discord discussion thread in step, so members on the website and in Discord read and answer the same conversation.

## ADDED Requirements

### Requirement: Sync is opt-in through an environment variable
Comments and threads SHALL be mirrored only when `DISCORD_THREAD_SYNC` is `true`. Only then SHALL the bot request Discord's message content access. Without it, comments and threads SHALL behave exactly as before.

#### Scenario: Variable not set
- **WHEN** `DISCORD_THREAD_SYNC` is not set and a member writes a comment on an event with a thread
- **THEN** the comment is saved as before and nothing is posted in Discord

#### Scenario: Variable set
- **WHEN** `DISCORD_THREAD_SYNC=true` and a member writes a comment on an event with a thread
- **THEN** the comment is saved and also appears in the thread

### Requirement: Only events with a discussion thread are mirrored
Mirroring SHALL happen only for events that have a discussion thread. Messages in other channels or threads SHALL be ignored. Comments written before the sync was switched on SHALL NOT be posted afterwards.

#### Scenario: Event without thread
- **WHEN** sync is on and a member comments on an event without discussion thread
- **THEN** the comment is saved and nothing is posted in Discord

#### Scenario: Message in another channel
- **WHEN** a member writes in a channel or thread that is no event's discussion thread
- **THEN** no comment is created

### Requirement: Website comments appear in the thread
A new website comment SHALL be posted into the event's thread through a webhook of the bot, named „<display name> (Web)“ with the member's avatar. The post SHALL NOT notify anybody, also when the text contains `@everyone`, role or user mentions. The bot SHALL create the webhook itself when none exists. A failed post SHALL NOT fail the comment.

#### Scenario: Comment from the website
- **WHEN** Lena writes "Bin dabei!" on the event page
- **THEN** the thread shows "Bin dabei!" from „Lena (Web)“ with Lena's avatar

#### Scenario: Mentions in a website comment
- **WHEN** a website comment contains "@everyone"
- **THEN** the thread message shows the text and nobody is notified

#### Scenario: No webhook yet
- **WHEN** the announcement channel has no webhook of the bot and the first comment is mirrored
- **THEN** the bot creates its webhook and posts the comment

#### Scenario: Discord refuses
- **WHEN** the bot lacks the webhook permission and a member comments
- **THEN** the comment is saved and shown on the website, and the failure is logged

### Requirement: Website replies name the answered comment
A website reply SHALL be posted in the thread with the line „↪ Antwort an <name>“ above the text and, when the answered comment has a Discord message, a link to it.

#### Scenario: Reply to a Discord comment
- **WHEN** Tom replies on the website to a comment that came from Kira's Discord message
- **THEN** the thread message from „Tom (Web)“ starts with „↪ Antwort an Kira“ and links Kira's message

### Requirement: Thread messages appear as comments
A member's message in the thread SHALL become a comment of the event with the member's Discord display name, avatar, the admin badge when the member holds the admin role, and the mark „Discord“. Messages of bots, webhooks and Discord system messages SHALL NOT become comments.

#### Scenario: Message in the thread
- **WHEN** Kira writes "Wer bringt Snacks?" in the event's thread
- **THEN** the event page shows the comment "Wer bringt Snacks?" by Kira with her avatar and a „Discord“ chip

#### Scenario: Admin in the thread
- **WHEN** a member with the admin role writes in the thread
- **THEN** the comment shows the admin badge

#### Scenario: Own webhook message
- **WHEN** the bot's webhook posts a website comment into the thread
- **THEN** no second comment is created

### Requirement: Discord text is made readable and fits the comment limit
User, role and channel mentions SHALL become "@name" and "#name", custom emojis ":name:", attachments a link each. Text longer than 1000 characters SHALL be cut and end with "…". A message without text and without attachments SHALL NOT become a comment.

#### Scenario: Mention and attachment
- **WHEN** a thread message is "<@id> schau mal" with one image
- **THEN** the comment reads "@Lena schau mal" followed by a link to the image

#### Scenario: Very long message
- **WHEN** a thread message has 1800 characters
- **THEN** the comment has 1000 characters and ends with "…"

### Requirement: Discord replies become comment replies
A thread message that replies to a mirrored message SHALL become a reply to the matching comment. A reply to a reply SHALL attach to the top comment of that conversation. A reply to an unknown message SHALL become a normal comment.

#### Scenario: Reply to a website comment
- **WHEN** Kira replies in Discord to the thread message of „Lena (Web)“
- **THEN** Kira's comment is shown as a reply under Lena's comment

#### Scenario: Reply to an old message
- **WHEN** a member replies to a thread message from before the sync
- **THEN** the comment is shown as a normal comment

### Requirement: Deletions are mirrored
Deleting a comment on the website SHALL delete its message in the thread. Deleting a mirrored message in Discord SHALL delete its comment. A deletion that Discord refuses SHALL NOT fail the website deletion.

#### Scenario: Deleted on the website
- **WHEN** an admin deletes Lena's comment on the website
- **THEN** the matching message disappears from the thread

#### Scenario: Deleted in Discord
- **WHEN** Kira deletes her message in the thread
- **THEN** her comment disappears from the event page

#### Scenario: Missing permission to delete a member's message
- **WHEN** the bot may not manage messages and an admin deletes a comment that came from Discord
- **THEN** the comment is deleted on the website, the Discord message stays and the failure is logged

### Requirement: Discord edits update the comment
Editing a mirrored message in Discord SHALL update the comment's text with the same conversion rules and mark it as edited.

#### Scenario: Edited in Discord
- **WHEN** Kira edits "Wer bringt Snacks?" to "Wer bringt Getränke?"
- **THEN** the comment reads "Wer bringt Getränke?" and shows "(bearbeitet)"

### Requirement: The webhook stays secret
The webhook's token SHALL NOT be stored in the database or returned by any API. Comment answers SHALL NOT contain webhook data.

#### Scenario: Comment list
- **WHEN** a member loads the comments of a mirrored event
- **THEN** no answer contains a webhook id or token
