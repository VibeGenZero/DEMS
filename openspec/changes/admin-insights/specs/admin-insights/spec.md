# Spec Delta

## Purpose

Gives admins evaluations of past events over a chosen time range: how many accepted members showed up, how full events were, who the most active members are and which categories draw people.

## ADDED Requirements

### Requirement: Evaluations are for admins only
The evaluations SHALL require an admin session: a logged-in non-admin SHALL get HTTP 403, a visitor without session HTTP 401. The admin dashboard header SHALL have a button "Auswertungen" that opens `#insights`; there SHALL be no navbar link of its own, and on `#insights` the navbar SHALL mark "Admin". Opening `#insights` without admin rights SHALL lead to the event overview.

#### Scenario: Member asks for evaluations
- **WHEN** a logged-in member without admin rights requests the evaluations
- **THEN** the server answers 403 and sends no numbers

#### Scenario: Admin opens the page
- **WHEN** an admin clicks "Auswertungen" in the admin dashboard
- **THEN** `#insights` shows the evaluations for the last 90 days and the navbar marks "Admin"

### Requirement: Time range decides which events count
The admin SHALL choose the range "30 Tage", "90 Tage" (default), "12 Monate" or "Alles". An event SHALL be evaluated when it is over (ended or archived), is not cancelled and, unless the range is "Alles", its start lies within the range before now. Events without a start date SHALL only count for "Alles". The server SHALL answer an unknown range with HTTP 400 "Ungültiger Zeitraum.".

#### Scenario: Older event outside the range
- **WHEN** an event ended 120 days ago and the range is 90 days
- **THEN** it is not evaluated; with "12 Monate" or "Alles" it is

#### Scenario: Upcoming and cancelled events
- **WHEN** one event starts tomorrow and another one was cancelled last week
- **THEN** neither is evaluated in any range

#### Scenario: Unknown range
- **WHEN** the evaluations are requested with range `7`
- **THEN** the server answers 400 "Ungültiger Zeitraum."

### Requirement: Attendance and no-show rates
Teilnahmequote SHALL be the checked-in share of accepted registrations and No-Show-Quote the remaining share, both over evaluated events with tracked attendance only (check-in switched on or at least one check-in), so that both add up to 100 %. Rates SHALL be shown as whole percent. Without a tracked event in the range both SHALL show a dash and a hint that no attendance was recorded.

#### Scenario: Two tracked events
- **WHEN** the range holds a tracked event with 10 accepted and 8 checked in, and one with 5 accepted and 2 checked in
- **THEN** Teilnahmequote is 67 % and No-Show-Quote 33 %

#### Scenario: Untracked event is left out
- **WHEN** a third evaluated event has 6 accepted registrations and nobody checked in, and check-in was off
- **THEN** both rates stay unchanged and the event still counts as evaluated

#### Scenario: Nothing tracked
- **WHEN** no evaluated event has tracked attendance
- **THEN** both rates show "–" and the page says that no attendance was recorded in this range

### Requirement: Occupancy
Auslastung SHALL be the places taken by accepted registrations (the member plus their guests, as the places display counts them) divided by the places offered, summed over evaluated events with a participant limit. Events without a limit SHALL be left out; without any such event the occupancy SHALL show a dash.

#### Scenario: Two events with a limit
- **WHEN** one event offers 10 places and 8 are taken, another one 20 places with 12 taken, and a third event has no limit
- **THEN** the occupancy is 67 %

### Requirement: Key figures
The page SHALL show four key figures for the range: Teilnahmequote, No-Show-Quote, number of evaluated events and Auslastung.

#### Scenario: Empty range
- **WHEN** no event of the range is evaluated
- **THEN** the page shows 0 events, dashes for the rates and an empty state "Keine vergangenen Events in diesem Zeitraum" instead of the lists

### Requirement: Most active members
The page SHALL list up to 10 members with the most Teilnahmen (accepted registrations of evaluated events) in the range, with their number of check-ins; ties SHALL be ordered by check-ins, then by name. Members without a Teilnahme SHALL not be listed. A member with a stored profile SHALL link to their member page `#member/<id>`; the name SHALL come from the profile, else from the registration.

#### Scenario: Ranking with a tie
- **WHEN** Lena and Tom both have 3 Teilnahmen in the range and Lena has 3 check-ins, Tom 1
- **THEN** Lena is listed before Tom, and each name links to their member page

### Requirement: Categories
The page SHALL group evaluated events by category (trimmed, case-insensitive, shown in its first spelling; empty as "Ohne Kategorie") and show per category: number of events, number of registrations of any status, average accepted registrations per event (one decimal) and the Teilnahmequote over its tracked events (dash without). Categories SHALL be ordered by number of events, then registrations, and each SHALL carry a bar relative to the largest category.

#### Scenario: Same category in two spellings
- **WHEN** one evaluated event has the category "Gaming" and another one "gaming "
- **THEN** both count under one category "Gaming" with 2 events

#### Scenario: Event without category
- **WHEN** an evaluated event has no category
- **THEN** it counts under "Ohne Kategorie"

### Requirement: Table of evaluated events
The page SHALL list every evaluated event with date, title, category, accepted registrations, check-ins, no-shows, Teilnahmequote (dash when untracked) and Auslastung (dash without limit), newest first. The admin SHALL be able to sort by date, title, accepted, check-ins, no-shows, quote and occupancy; a second click on the same column SHALL reverse the order. Each title SHALL link to its event page.

#### Scenario: Untracked event in the table
- **WHEN** an evaluated event had check-in off and nobody checked in
- **THEN** its row shows "–" for check-ins, no-shows and quote

#### Scenario: Sort by quote
- **WHEN** the admin sorts by quote
- **THEN** the event with the highest quote comes first and untracked events come last

### Requirement: Evaluations expose no secrets and change nothing
The evaluations endpoint SHALL be read-only, write no audit entry and change no data. It SHALL NOT return check-in codes, form answers, guest lists or DM settings.

#### Scenario: Event with check-in code
- **WHEN** an evaluated event has a generated check-in code and registrations with form answers
- **THEN** the evaluations answer contains neither the code nor any form answer
