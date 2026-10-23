# Spec Delta

## MODIFIED Requirements

### Requirement: Release notes cover every version
The release notes SHALL list every published release, newest first, each with version, date and its entries (title and text, optionally marked as highlight). The current version SHALL be the newest release. Version identifiers with a pre-release suffix (e.g. `3.0.0-beta.3`) SHALL be valid releases that sort by their numeric major.minor.patch parts. The notes SHALL contain the releases 1.1.0 to 2.6.0 that were published before this change.

#### Scenario: History is kept
- **WHEN** the release notes are requested
- **THEN** they contain the current version `3.0.0-beta.3` first and the older releases down to 1.1.0 after it

#### Scenario: Pre-release version
- **WHEN** the newest release carries a pre-release suffix, e.g. `3.0.0-beta.3`
- **THEN** the release notes, the version badge and the seen-marker of the popup use that version string as written

#### Scenario: Old single-release format
- **WHEN** the notes only describe one release without a list (old format)
- **THEN** the app treats that release as the only one and still works