# Spec Delta

## MODIFIED Requirements

### Requirement: Other DMs are not affected
The choices SHALL NOT affect any other DM: request received, accepted, rejected, moved up from the waitlist, guest invitations and their answers, date poll messages, and messages an admin sends to the participants of an event. Guest invitations stay governed by the existing setting "Einladungen erhalten".

#### Scenario: Everything off
- **WHEN** a member switched all three kinds off and an admin accepts the member's pending registration
- **THEN** the member receives the accepted DM

#### Scenario: Message from the team
- **WHEN** a member switched all three kinds off and an admin sends a message to the accepted participants of the member's event
- **THEN** the member receives that message
