# Doctor CRM

A full clinic CRM for the Telenow dashboard, built with React on the Telenow App
Platform. The **voice agent** and the **dashboard** work on the same records.

## Agent tools (used during calls)

All eight are pure **declarative** handlers — no server, no code:

| Tool | Does | Handler |
|---|---|---|
| `find_patient` | Recognise the caller by phone (or name) | `object.query patient` |
| `register_patient` | Create a new patient | `object.create patient` |
| `book_appointment` | Book an appointment with the problem/reason | `object.create appointment` |
| `list_appointments` | List appointments (by patient phone) | `object.query appointment` |
| `log_visit` | Record diagnosis / prescription / follow-up | `object.create visit` |
| `cancel_appointment` | Cancel the caller's **most recent** appointment (soft) | `object.update appointment` (match phone) |
| `delete_appointment` | **Permanently delete** the most recent appointment | `object.delete appointment` (match phone) |
| `update_patient` | Update status / condition / notes | `object.update patient` (match phone) |

This app uses **all of declarative CRUD** — `object.create`, `object.query`,
`object.update`, and `object.delete` — with no developer code. On the dashboard,
Visit logs also have a **Delete** action.

## Dashboard pages (menu UI)

- **Patients** — register, search, and per-patient detail (their appointments + visit history); edit condition/notes and active/inactive status.
- **Appointments** — book, filter by date, and mark **Visited / No-show / Cancel**.
- **Visits** — log a consultation outcome and browse the visit history.
- **Activity** — a live feed of what the agent did on recent calls.
- **Reports** — a comprehensive dashboard across **all three** record types: patient counts, appointment status + visit-rate %, an appointments-per-day chart, top diagnoses, and follow-ups due.

Everything the agent does on a call shows up live on these pages, and vice-versa
— it's one shared store, read/written through the Telenow bridge (no API keys).

## Build & install

```bash
npm install
npm run build          # → clinic-crm-2.2.1.telenow.zip
```

Upload the ZIP in **Apps → Upload custom app**, then **install** it (this version
is 2.2.1 — re-install to pick up the new tools + pages). The five pages appear in
the sidebar.
