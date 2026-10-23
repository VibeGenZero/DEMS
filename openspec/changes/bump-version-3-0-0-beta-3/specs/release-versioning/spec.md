# Spec Delta

## Purpose

Defines where the DEMS version lives, what a version jump changes, and how a pre-release is tagged, published and deployed.

## ADDED Requirements

### Requirement: One version in every source
A release SHALL carry the same SemVer version string in `package.json`, `package-lock.json` and `updates.json`, and the git tag of the release SHALL use the same text without a leading "v".

#### Scenario: Version jump
- **WHEN** the version jumps to a new release
- **THEN** `package.json`, `package-lock.json` and `updates.json` carry the new version and the git tag has the same text without a leading "v"

### Requirement: Pre-release versions keep their suffix
The version of a pre-release SHALL keep its pre-release suffix (e.g. `3.0.0-beta.3`); the app SHALL show and store it exactly as written wherever it reads a version.

#### Scenario: Beta version
- **WHEN** the current release is `3.0.0-beta.3`
- **THEN** the version badge, the news popup and the "Was ist neu" page show `3.0.0-beta.3`

### Requirement: Image tags by release type
A pre-release image SHALL be published with its version tag and the moving tag `beta`; it SHALL NOT carry the tag `latest`. A final release SHALL carry `latest`. Every image SHALL also carry the tag of its commit sha.

#### Scenario: Beta image
- **WHEN** the image of `3.0.0-beta.3` is published
- **THEN** it carries the tags `3.0.0-beta.3`, `beta` and its commit sha, and it does not carry `latest`

### Requirement: Pre-releases run on the test environment only
A pre-release SHALL be deployed on the test environment only; the live system SHALL receive the final releases only.

#### Scenario: Beta deployment
- **WHEN** `3.0.0-beta.3` is deployed
- **THEN** it runs on the test environment and the live system keeps its current version