# Changelog

## 2.2.3
- Smoother data loading: the list no longer flashes "Loading…" on every write, so seeding sample data (and bulk edits) update the page instantly instead of flickering.

## 2.2.2
- **Add / Remove sample data** buttons in the dashboard header: one click seeds demo patients, appointments and visits; one click removes them again.
- Removal is scoped to seeded rows only (tagged internally), so it never touches real records.

## 2.2.1
- Added marketplace listing **screenshots** (Patients, Appointments, Visits, Reports).
- Set the app **icon** (stethoscope).
- No functional changes to tools, agents, data, or workflows since 2.2.0.

## 2.2.0
- New **Lead** object + inbound lead webhook and lead callback/notify workflows.
- **Bundled agents** (Front Desk, Smart Front Desk auto-lookup, Patient Intake flow) and a **Front Desk team** (triage → booking).
- **Clinic Info** knowledge base for the front-desk agent.
- Patient relations/views, computed display field, and `x-ui` widgets on tool inputs.
- `campaigns:read` / `campaigns:write` scopes; **Activity** page.
