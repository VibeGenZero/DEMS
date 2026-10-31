# Spec Delta

## ADDED Requirements

### Requirement: The bot center chooses the approval channel
The bot center SHALL offer "Freigabe-Kanal" with the text channels of the server and the entry "Keiner – Freigaben nur auf der Website", which is the default. Request messages for pending registrations SHALL go to the chosen channel; there SHALL be no environment variable for it.

#### Scenario: Channel chosen
- **WHEN** an admin chooses "#freigaben" as approval channel and saves
- **THEN** the setting is stored and new requests are posted in "#freigaben"

#### Scenario: Default
- **WHEN** the settings were saved before this change or the admin picks "Keiner"
- **THEN** the approval channel is empty and nothing is posted

### Requirement: The approval channel must be a text channel of the server
Saving the bot settings with an approval channel id that is not a text channel of the server SHALL be refused with 400 "Freigabe-Kanal nicht gefunden." and nothing SHALL be saved, as long as the bot can read the channel list. While the list cannot be read (bot offline), a saved id SHALL be kept as it is.

#### Scenario: Unknown channel
- **WHEN** an admin saves the settings with an approval channel id that is not a text channel of the server
- **THEN** the answer is 400 with "Freigabe-Kanal nicht gefunden." and nothing is saved

#### Scenario: Bot offline
- **WHEN** the bot is offline and an admin saves the settings without changing the approval channel
- **THEN** the settings are saved and the approval channel stays as it was
