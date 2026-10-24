# registration-bulk-actions Specification

## Purpose

Lets admins handle many registrations of one event at once — accept, put on the waitlist or reject a selection — while keeping the capacity, slot and notification rules of the single actions.

## Requirements

### Requirement: Admins change several registrations of an event in one request
The system SHALL let admins send one request with the ids of up to 200 registrations of one event and an action `accept`, `waitlist` or `reject`. Duplicate ids SHALL count once. Ids that do not belong to the event SHALL be skipped. Only admins SHALL be allowed, the request SHALL need the CSRF token, and the whole request SHALL write one audit entry with the action and the counts.

#### Scenario: Three pending registrations accepted
- **WHEN** an admin accepts three pending registrations of an event with free places
- **THEN** all three are accepted, the answer reports 3 accepted, and one audit entry is written

#### Scenario: Wrong input
- **WHEN** the action is not one of `accept`, `waitlist`, `reject`, or the id list is empty or has more than 200 entries
- **THEN** the answer is 400 with a German error and nothing changes

#### Scenario: Member without admin rights
- **WHEN** a member without admin rights sends the request
- **THEN** the answer is 403 and nothing changes

#### Scenario: Id of another event
- **WHEN** one selected id belongs to a different event
- **THEN** that registration is not changed and counts as skipped

### Requirement: Each action applies only to fitting statuses
Accept SHALL apply to pending and waitlisted registrations, waitlist to pending and accepted ones, and reject to pending, waitlisted and accepted ones. A selected registration whose status the action does not apply to, including every rejected registration, SHALL stay unchanged and count as skipped.

#### Scenario: Mixed selection rejected
- **WHEN** an admin rejects a selection of one pending, one accepted and one already rejected registration
- **THEN** the first two are rejected and the answer reports 2 rejected and 1 skipped

#### Scenario: Accepting an accepted registration
- **WHEN** an accepted registration is part of a selection that is accepted
- **THEN** it stays as it is and counts as skipped

### Requirement: Accepting fills the event up to its capacity
Accept SHALL handle the selected registrations in registration order, oldest first. On an event with a participant limit a registration SHALL be accepted only while its places (the member plus guests and open guest invitations) still fit next to the places every unselected pending or accepted registration holds; the others SHALL be put on or stay on the waitlist. An event without a limit SHALL accept all. The answer SHALL report how many went to the waitlist for lack of places.

#### Scenario: More selected than free
- **WHEN** an event has 10 places, 8 are taken by unselected registrations and an admin accepts three pending registrations without guests
- **THEN** the two oldest are accepted, the newest goes on the waitlist, and the answer reports 2 accepted and 1 waitlisted for lack of places

#### Scenario: Guests do not fit
- **WHEN** a selected registration brings two guests and only two places are left
- **THEN** it goes on the waitlist and a later selected registration without guests is still accepted

#### Scenario: No limit
- **WHEN** an event has no participant limit and an admin accepts twenty registrations
- **THEN** all twenty are accepted

### Requirement: Accepting on slot events gives every registration a free slot
On events with role slots, accept SHALL give each selected registration, oldest first, its main role or the first fallback role with a free place, counting the places of unselected pending and accepted registrations and of those accepted before it in the same request. A registration without a free wanted slot SHALL go on or stay on the waitlist without a slot. Accept SHALL never overbook a slot.

#### Scenario: Slot full
- **WHEN** the "Tank" slot has one free place and an admin accepts two pending registrations that both want only "Tank"
- **THEN** the older one gets "Tank", the newer one goes on the waitlist without a slot

#### Scenario: Fallback role
- **WHEN** a selected registration wants "Tank" (full) with fallback "Heiler" (free)
- **THEN** it is accepted into "Heiler"

### Requirement: Waitlisting and rejecting free the place
Waitlist and reject SHALL clear the slot of a registration on slot events and its check-in. After a request that rejected at least one registration, the waitlist SHALL move up once as after a single rejection. Waitlisting SHALL NOT move anyone up by itself.

#### Scenario: Accepted registration put on the waitlist
- **WHEN** an admin waitlists an accepted, checked-in registration with a slot
- **THEN** it is waitlisted without slot and without check-in

#### Scenario: Rejection lets someone move up
- **WHEN** an admin rejects two accepted registrations of a full event that has a waitlist
- **THEN** waitlisted members move up into the freed places as after single rejections

### Requirement: Members are told as with single actions
Every registration whose status changed SHALL lead to the same DM as the single action: accepted (with the event's custom or global template and the slot line, plus the event role), rejected (template), and for a registration newly put on the waitlist the waitlist DM, which a member who switched "Warteliste" off SHALL NOT get. Unchanged and skipped registrations SHALL get no DM. A failed DM SHALL NOT stop the other changes.

#### Scenario: Waitlist DM switched off
- **WHEN** a pending registration of a member who switched "Warteliste" off goes on the waitlist through a bulk accept without room
- **THEN** that member gets no DM, while the accepted members get their accepted DM

#### Scenario: Skipped registration
- **WHEN** an already accepted registration is skipped in a bulk accept
- **THEN** its member gets no DM

### Requirement: The registrations dialog offers selection and an action bar
The registrations dialog SHALL show a checkbox in every row with a pending, waitlisted or accepted registration and a header checkbox "Alle auswählen" for these rows. While at least one row is selected, an action bar SHALL show "<n> ausgewählt" with the buttons "Annehmen", "Warteliste" and "Ablehnen"; a button SHALL be disabled while no selected row fits its action.

#### Scenario: Nothing selected
- **WHEN** no row is selected
- **THEN** the action bar is hidden

#### Scenario: Only accepted rows selected
- **WHEN** an admin selects two accepted rows
- **THEN** the bar shows "2 ausgewählt", "Annehmen" is disabled, "Warteliste" and "Ablehnen" are enabled

#### Scenario: Select all
- **WHEN** an admin ticks "Alle auswählen" in a dialog with one rejected and four other rows
- **THEN** the four other rows are selected and the rejected row has no checkbox

### Requirement: Bulk actions in the dialog confirm and report their result
Reject SHALL ask for confirmation naming the number of selected registrations; accept and waitlist SHALL run at once. After the answer a German toast SHALL sum up the result, the selection SHALL be cleared, and the dialog, the admin event table and the stats SHALL reload once.

#### Scenario: Select and accept
- **WHEN** an admin ticks three pending rows and clicks "Annehmen"
- **THEN** one request is sent, a toast like "3 angenommen." appears and the dialog shows the new statuses with no row selected

#### Scenario: Partial accept
- **WHEN** the answer reports 2 accepted and 1 waitlisted for lack of places
- **THEN** the toast reads "2 angenommen, 1 auf die Warteliste (keine freien Plätze)."

#### Scenario: Reject asks first
- **WHEN** an admin selects four rows and clicks "Ablehnen"
- **THEN** a confirmation asks "4 Anmeldungen ablehnen?" and nothing is sent unless the admin confirms
