# Spec Delta

## MODIFIED Requirements

### Requirement: Discord shows uploaded banners
For an uploaded banner the Discord event announcement SHALL show the image from the absolute URL formed from `BASE_URL` and the path, and the Discord scheduled event SHALL get the image file itself. External URLs SHALL be passed to Discord unchanged as before.

#### Scenario: Embed of an event with an uploaded banner
- **WHEN** the bot posts the announcement of an event whose banner is `/uploads/banners/<uuid>.png` and `BASE_URL` is `https://dems.example`
- **THEN** the announcement's banner image is `https://dems.example/uploads/banners/<uuid>.png`

#### Scenario: Scheduled event
- **WHEN** the bot creates the Discord scheduled event of that event
- **THEN** it sets the cover image from the stored file
