# Twenty People API Notes

Source: `/home/ec2-user/App/GehirnRepo/docs/knowledge_base/twenty/core.json`

## Base URL and Auth

- Server URL in schema: `https://api.twenty.com/rest/`
- Send header: `Authorization: Bearer <token>`
- Helper script default base URL: `https://api.twenty.com/rest`

## Endpoints Used by This Skill

- `GET /people`
  - Purpose: list/search people
  - Query params: `filter`, `order_by`, `limit`, `depth`, `starting_after`, `ending_before`
  - Response key: `.data.people[]`
- `GET /people/{id}`
  - Purpose: fetch a single person
  - Query params: `depth`
  - Response key: `.data.person`
- `PATCH /people/{id}`
  - Purpose: update a single person
  - Query params: `depth`
  - Request schema: `PersonForUpdate`
  - Response key: `.data.updatePerson`

## Filter Syntax Reminders

- Format: `field[COMPARATOR]:value`
- Composite fields use dot notation, for example: `name.firstName[ilike]:"%jane%"`
- Combine conditions with:
  - `and(...)`
  - `or(...)`
  - `not(...)`

Examples:

- One token name search:
  - `or(name.firstName[ilike]:"%jane%",name.lastName[ilike]:"%jane%")`
- Full name search:
  - `and(name.firstName[ilike]:"%jane%",name.lastName[ilike]:"%doe%")`
- Email search:
  - `emails.primaryEmail[eq]:"jane@example.com"`

## Common Person Fields for Updates

- `name.firstName`
- `name.lastName`
- `emails.primaryEmail`
- `emails.additionalEmails`
- `jobTitle`
- `phones.primaryPhoneNumber`
- `city`
- `companyId`
- `persona`
- `interactionTips`
- `volunteerRoles`
- `category`
- `warmth`

Use minimal patch payloads and re-fetch the record after update.
