# Spec Delta

## Purpose

Lets the operator of a DEMS installation publish their own privacy policy and makes every member accept its current version before using the website.

## ADDED Requirements

### Requirement: Privacy policy document
DEMS SHALL keep at most one privacy policy as Markdown (at most 50000 characters) with a version number, the time of the last change and the admin who changed it. Saving a changed text SHALL increase the version by one; saving the unchanged text SHALL keep it. Saving an empty text SHALL remove the policy.

#### Scenario: First policy
- **WHEN** an admin saves a policy for the first time
- **THEN** the policy has version 1

#### Scenario: Changed text
- **WHEN** an admin saves a changed text of the version-3 policy
- **THEN** the policy has version 4 and the audit log has `UPDATE_PRIVACY_POLICY` with the new version

#### Scenario: Unchanged text
- **WHEN** an admin saves the policy without changing the text
- **THEN** the version stays the same

### Requirement: Editing the policy
Admins SHALL edit the policy in the setup wizard (optional step) and in the admin "System" view with a Markdown editor and a preview. `PUT /api/admin/privacy` SHALL be admin-only.

#### Scenario: Non-admin edit
- **WHEN** a member without admin rights calls `PUT /api/admin/privacy`
- **THEN** the response is 403

### Requirement: Public privacy page
`GET /api/privacy` SHALL return the current policy (Markdown, version, last change) without login, or 404 when none exists. The SPA SHALL show it at `#privacy` without login, rendered as safe Markdown. While a policy exists, the login page and the info view SHALL show a "Datenschutz" link to it.

#### Scenario: Logged-out visitor
- **WHEN** a logged-out visitor opens the login page and a policy exists
- **THEN** a "Datenschutz" link is visible and opens `#privacy` with the policy

#### Scenario: No policy
- **WHEN** no policy exists
- **THEN** the login page shows no "Datenschutz" link and `GET /api/privacy` answers 404

#### Scenario: Script in the policy
- **WHEN** the policy contains `<script>` or an inline event handler
- **THEN** the page shows it without running it

### Requirement: Consent required
While a policy exists, a logged-in member whose accepted version is lower than the current version, or who never accepted, SHALL get `privacyRequired: true` from `/auth/me`. Every other authenticated `/api/*` request of that member SHALL answer 403 with `privacyRequired: true`. Admins SHALL be treated the same.

#### Scenario: First login with a policy
- **WHEN** a member logs in for the first time and a policy exists
- **THEN** `/auth/me` answers `privacyRequired: true`, `GET /api/events` answers 403 with `{ error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true }`, and the SPA shows only the consent dialog

#### Scenario: No policy, no gate
- **WHEN** no policy exists and a member logs in
- **THEN** `/auth/me` answers `privacyRequired: false` and the website works as before

#### Scenario: New version
- **WHEN** a member accepted version 2 and an admin saves version 3
- **THEN** the member's next request to `/auth/me` answers `privacyRequired: true` and other API requests answer 403 until they accept version 3

### Requirement: Accepting or declining
`POST /api/user/privacy/accept` with the current version SHALL store that version and the acceptance time on the member's profile and lift the gate at once. A version that is not the current one SHALL answer 409. Declining in the consent dialog SHALL log the member out.

#### Scenario: Accept
- **WHEN** a member with `privacyRequired: true` accepts the current version
- **THEN** the profile stores `privacyAcceptedVersion` and `privacyAcceptedAt`, and `GET /api/events` answers 200

#### Scenario: Stale version
- **WHEN** a member accepts version 2 while version 3 is current
- **THEN** the response is 409 with a German error and the dialog reloads the policy

#### Scenario: Decline
- **WHEN** a member chooses "Ablehnen" in the consent dialog
- **THEN** the member is logged out and sees the login page

#### Scenario: Acceptance survives a new login
- **WHEN** a member accepted the current version, logs out and logs in again
- **THEN** `/auth/me` answers `privacyRequired: false`
