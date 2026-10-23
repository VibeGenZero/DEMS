# Spec Delta

## Purpose

Tells members what changed in DEMS: a short popup with the top new features once per version after login, a "Was ist neu" page with every release, and a small badge until the latest notes were read.

## ADDED Requirements

### Requirement: Release notes cover every version
The release notes SHALL list every published release, newest first, each with version, date and its entries (title and text, optionally marked as highlight). The current version SHALL be the newest release. The notes SHALL contain the releases 1.1.0 to 2.6.0 that were published before this change.

#### Scenario: History is kept
- **WHEN** the release notes are requested
- **THEN** they contain the current version 2.6.0 first and the older releases down to 1.1.0 after it

#### Scenario: Old single-release format
- **WHEN** the notes only describe one release without a list (old format)
- **THEN** the app treats that release as the only one and still works

### Requirement: Popup only after login, once per version
The news popup SHALL NOT open while nobody is logged in. After login it SHALL open once when the browser has not seen the current version yet. Closing it in any way SHALL mark the version as seen, so it does not return on the next page load; there SHALL be no "Nicht erneut anzeigen" checkbox. A member who logs in for the first time SHALL get the welcome dialog instead, and the current version SHALL count as seen for them.

#### Scenario: Login page
- **WHEN** a visitor who is not logged in opens the app with a version they have never seen
- **THEN** the login page shows without the news popup

#### Scenario: Seen after closing
- **WHEN** a member closes the popup with the close button and reloads the page
- **THEN** the popup does not open again until the next version

#### Scenario: New member
- **WHEN** a member logs in for the first time
- **THEN** the welcome dialog opens and the news popup does not, neither now nor on the next page load of the same version

### Requirement: Popup shows the top features
The popup SHALL show at most 3 entries of the current version: those marked as highlight in their order, or the first 3 entries when none is marked. It SHALL show the version, each entry's title and text, a button "Alle Neuigkeiten" that opens the "Was ist neu" page, and a button "Verstanden". The version effect (confetti, power-up or bugs) SHALL play as before.

#### Scenario: Highlights marked
- **WHEN** the current version has 6 entries and entries 2 and 5 are marked as highlight
- **THEN** the popup shows exactly entries 2 and 5

#### Scenario: Nothing marked
- **WHEN** the current version has 5 entries and none is marked
- **THEN** the popup shows entries 1 to 3

#### Scenario: All news
- **WHEN** the member clicks "Alle Neuigkeiten"
- **THEN** the popup closes, the version counts as seen and the "Was ist neu" page opens

### Requirement: "Was ist neu" page
The page `#news` SHALL list every release, newest first, with version, date (German format) and all entries; the newest release SHALL be open and the older ones collapsed but openable. The page SHALL be reachable without login, from a link on the info page and from the version badge of the info page, which SHALL be a link to it.

#### Scenario: Logged out
- **WHEN** a visitor who is not logged in opens `#news`
- **THEN** the page shows all releases instead of the login page

#### Scenario: Older release
- **WHEN** a member opens the entry "2.3.0" on the page
- **THEN** its date and all its entries are shown

#### Scenario: Version badge
- **WHEN** a member clicks the version badge "v2.6.0" on the info page
- **THEN** the "Was ist neu" page opens

### Requirement: Unread badge on the info link
While the "Was ist neu" page has not been opened for the current version in this browser, the navbar link "Info" SHALL carry a small badge marked for screen readers as "Neuigkeiten ungelesen". Opening `#news` SHALL remove it until the next version; the popup alone SHALL NOT remove it.

#### Scenario: New version
- **WHEN** a new version is published and the member has not opened `#news` since
- **THEN** the Info link shows the badge

#### Scenario: Read
- **WHEN** the member opens `#news`
- **THEN** the badge disappears and stays away after a reload

### Requirement: Entries are shown as text
Titles and texts of the release notes SHALL be shown as plain text (escaped), in the popup and on the page; emojis written in the notes SHALL appear as written.

#### Scenario: Markup in a note
- **WHEN** an entry text contains `<b>fett</b>`
- **THEN** the page shows the characters `<b>fett</b>` and no bold text
