// Doctor CRM — a full clinic CRM that runs as dashboard pages inside Telenow
// (sandboxed iframe). It manages three record types — patients, appointments,
// and visit logs — the SAME records the voice agent reads/writes during calls
// via the app's tools (find_patient, book_appointment, log_visit, …). All data
// goes through the Telenow bridge: no API keys, scoped to this app + org.

import { Fragment, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  useAgents,
  useCall,
  useCallHistory,
  useObjects,
  useSoftphone,
  useTelenowContext,
  useUser,
  useWhatsapp,
} from 'telenow/react';

// ---------------------------------------------------------------------------
// types + helpers
// ---------------------------------------------------------------------------

type ApptStatus = 'scheduled' | 'visited' | 'not_visited' | 'cancelled';

// `_demo` is an internal marker written only by "Add sample data" so that
// "Remove sample data" can find and delete exactly those rows — never a real
// patient/appointment/visit. It's an extra JSONB field (not in the manifest
// schema) that the forms and voice tools ignore.
interface Patient {
  name: string;
  phone: string;
  status: 'active' | 'inactive';
  condition?: string;
  notes?: string;
  _demo?: boolean;
}
interface Appointment {
  patient_name: string;
  phone: string;
  problem?: string;
  start: string;
  status: ApptStatus;
  _demo?: boolean;
}
interface Visit {
  patient_name: string;
  phone: string;
  diagnosis?: string;
  prescription?: string;
  follow_up?: string;
  notes?: string;
  _demo?: boolean;
}
type Row<T> = { id: string; data: T; createdAt?: string };

const STATUS: Record<ApptStatus, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Scheduled', color: '#3730a3', bg: '#e0e7ff' },
  visited: { label: 'Visited', color: '#166534', bg: '#dcfce7' },
  not_visited: { label: 'No-show', color: '#9a3412', bg: '#ffedd5' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: '#f1f5f9' },
};

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : toDateInput(d);
};
const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export default function App() {
  const { page } = useTelenowContext();
  const { user, can } = useUser();
  const { agents } = useAgents();
  const { initiate } = useCall();
  const { channels, send } = useWhatsapp();
  const { dial } = useSoftphone();
  const patients = useObjects<Patient>('patient');
  const appointments = useObjects<Appointment>('appointment');
  const visits = useObjects<Visit>('visit');

  const now = new Date();
  const [from, setFrom] = useState(toDateInput(new Date(now.getTime() - 90 * DAY)));
  const [to, setTo] = useState(toDateInput(new Date(now.getTime() + 90 * DAY)));
  const [agentId, setAgentId] = useState('');
  const activeAgent = agentId || agents[0]?.id || '';

  // RBAC: viewers/members are read-only; owners/admins/staff can place calls.
  const canComm = can('manage_agents') || user?.role === 'owner' || user?.role === 'admin';

  // Communication helpers — relayed by the dashboard under the signed-in user.
  const call = (phone: string) => {
    if (!activeAgent) throw new Error('No agent available to place the call');
    return initiate(activeAgent, phone);
  };
  const whatsapp = async (phone: string, name: string) => {
    const chs = await channels();
    if (!chs.length) throw new Error('No WhatsApp channel is configured');
    await send(chs[0].id, phone, `Hi ${name || 'there'}, this is your clinic — how can we help?`);
  };
  const softphone = (phone: string) => dial(phone);
  const comm = canComm ? { call, whatsapp, softphone } : null;

  const loading = patients.loading || appointments.loading || visits.loading;
  const error = patients.error || appointments.error || visits.error;

  // One-click demo data (with a matching teardown) so an empty install has
  // something to look at. Records are created through the bridge (scoped to this
  // app + org), exactly like the forms — so they show on every page and feed the
  // Reports charts. Every seeded row is tagged `_demo` so "Remove sample data"
  // deletes exactly the rows "Add" created, never the user's real records.
  const [seeding, setSeeding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  const isDemo = (r: { data: { _demo?: boolean } }) => Boolean(r.data._demo);
  const hasDemo =
    patients.data.some(isDemo) || appointments.data.some(isDemo) || visits.data.some(isDemo);
  // Write-capable roles (owner/admin/developer). The bridge enforces the same
  // server-side, so this only hides controls a viewer couldn't use anyway.
  const canWrite = can('manage_agents') || user?.role === 'owner' || user?.role === 'admin';

  const addSample = async () => {
    setSeeding(true);
    setDemoErr(null);
    try {
      const at = (off: number) => `${toDateInput(new Date(now.getTime() + off * DAY))}T10:00`;
      const day = (off: number) => toDateInput(new Date(now.getTime() + off * DAY));
      const P: Patient[] = [
        { name: 'Aarav Sharma', phone: '+919876500001', status: 'active', condition: 'Hypertension', notes: 'Regular BP checkup' },
        { name: 'Priya Menon', phone: '+919876500002', status: 'active', condition: 'Diabetes Type 2', notes: 'Monitor sugar levels' },
        { name: 'Rohan Gupta', phone: '+919876500003', status: 'active', condition: 'Asthma', notes: '' },
        { name: 'Sara Khan', phone: '+919876500004', status: 'inactive', condition: 'Migraine', notes: 'Follow-up pending' },
      ];
      for (const p of P) await patients.create({ ...p, _demo: true });
      const A: Appointment[] = [
        { patient_name: 'Aarav Sharma', phone: '+919876500001', problem: 'Chest pain', start: at(-2), status: 'visited' },
        { patient_name: 'Priya Menon', phone: '+919876500002', problem: 'Sugar review', start: at(-1), status: 'visited' },
        { patient_name: 'Rohan Gupta', phone: '+919876500003', problem: 'Breathing difficulty', start: at(0), status: 'scheduled' },
        { patient_name: 'Sara Khan', phone: '+919876500004', problem: 'Severe headache', start: at(0), status: 'not_visited' },
        { patient_name: 'Aarav Sharma', phone: '+919876500001', problem: 'BP follow-up', start: at(1), status: 'scheduled' },
        { patient_name: 'Priya Menon', phone: '+919876500002', problem: 'Diet consultation', start: at(3), status: 'scheduled' },
        { patient_name: 'Rohan Gupta', phone: '+919876500003', problem: 'Inhaler refill', start: at(-3), status: 'cancelled' },
      ];
      for (const a of A) await appointments.create({ ...a, _demo: true });
      const V: Visit[] = [
        { patient_name: 'Aarav Sharma', phone: '+919876500001', diagnosis: 'Stable angina', prescription: 'Aspirin 75mg daily', follow_up: day(30), notes: 'ECG normal' },
        { patient_name: 'Priya Menon', phone: '+919876500002', diagnosis: 'Controlled diabetes', prescription: 'Metformin 500mg', follow_up: day(15), notes: 'HbA1c 6.8' },
        { patient_name: 'Sara Khan', phone: '+919876500004', diagnosis: 'Tension headache', prescription: 'Paracetamol 500mg', follow_up: '', notes: 'Stress related' },
      ];
      for (const v of V) await visits.create({ ...v, _demo: true });
    } catch (e) {
      setDemoErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  };

  const removeSample = async () => {
    setRemoving(true);
    setDemoErr(null);
    try {
      // Only rows tagged by addSample — the user's own records are untouched.
      for (const r of patients.data.filter(isDemo)) await patients.remove(r.id);
      for (const r of appointments.data.filter(isDemo)) await appointments.remove(r.id);
      for (const r of visits.data.filter(isDemo)) await visits.remove(r.id);
    } catch (e) {
      setDemoErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  const title =
    page === 'reports' ? 'Reports'
    : page === 'visits' ? 'Visits'
    : page === 'activity' ? 'Activity'
    : page === 'patients' ? 'Patients'
    : 'Appointments';
  const showDateFilter = page === 'appointments' || page === 'reports';

  return (
    <div style={wrap}>
      <header style={head}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{title}</h1>
          {user && (
            <p style={{ ...muted, margin: '2px 0 0' }}>
              {user.name ?? 'You'} · <span style={{ textTransform: 'capitalize' }}>{user.role ?? 'member'}</span>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canWrite && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => addSample()}
                disabled={seeding || hasDemo}
                title={hasDemo ? 'Sample data already loaded' : 'Insert demo patients, appointments and visits'}
                style={{ ...inp, cursor: seeding || hasDemo ? 'default' : 'pointer', background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 600, opacity: hasDemo ? 0.5 : 1 }}
              >
                {seeding ? 'Adding…' : 'Add sample data'}
              </button>
              {hasDemo &&
                (confirmRemove ? (
                  <>
                    <span style={{ ...muted, fontSize: 12 }}>Remove all?</span>
                    <button
                      onClick={() => {
                        setConfirmRemove(false);
                        removeSample();
                      }}
                      disabled={removing}
                      style={action('#dc2626')}
                    >
                      {removing ? 'Removing…' : 'Yes'}
                    </button>
                    <button onClick={() => setConfirmRemove(false)} disabled={removing} style={ghost}>
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(true)}
                    style={{ ...ghost, color: '#dc2626', borderColor: '#fecaca' }}
                  >
                    Remove sample data
                  </button>
                ))}
            </span>
          )}
          {canComm && agents.length > 0 && (page === 'patients' || page === 'activity') && (
            <select value={activeAgent} onChange={(e) => setAgentId(e.target.value)} style={inp} title="Agent that places calls">
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {showDateFilter && (
            <>
              <span style={muted}>From</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={inp} />
              <span style={muted}>To</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={inp} />
            </>
          )}
        </div>
      </header>

      {error && <div style={banner}>{error.message}</div>}
      {demoErr && <div style={banner}>{demoErr}</div>}

      {loading ? (
        <p style={muted}>Loading…</p>
      ) : page === 'patients' ? (
        <Patients patients={patients} appointments={appointments.data} visits={visits.data} comm={comm} />
      ) : page === 'visits' ? (
        <Visits visits={visits} patients={patients.data} />
      ) : page === 'activity' ? (
        <Activity />
      ) : page === 'reports' ? (
        <Reports patients={patients.data} appointments={appointments.data} visits={visits.data} from={from} to={to} />
      ) : (
        <Appointments appointments={appointments} from={from} to={to} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patients — list, search, register, and per-patient detail (appts + visits)
// ---------------------------------------------------------------------------

interface Comm {
  call: (phone: string) => Promise<unknown>;
  whatsapp: (phone: string, name: string) => Promise<unknown>;
  softphone: (phone: string) => Promise<unknown>;
}

function Patients({
  patients,
  appointments,
  visits,
  comm,
}: {
  patients: ReturnType<typeof useObjects<Patient>>;
  appointments: Row<Appointment>[];
  visits: Row<Visit>[];
  comm: Comm | null;
}) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', condition: '', notes: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [commBusy, setCommBusy] = useState<string | null>(null);
  const [commMsg, setCommMsg] = useState<string | null>(null);

  const doComm = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setCommBusy(key);
    setCommMsg(null);
    try {
      await fn();
      setCommMsg(okMsg);
    } catch (e) {
      setCommMsg(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setCommBusy(null);
    }
  };

  const rows = patients.data
    .filter((p) => {
      const s = q.trim().toLowerCase();
      return !s || p.data.name?.toLowerCase().includes(s) || (p.data.phone || '').includes(s);
    })
    .sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) return;
    setBusy('new');
    try {
      await patients.create({ ...form, status: 'active' });
      setForm({ name: '', phone: '', condition: '', notes: '' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <form onSubmit={register} style={card}>
        <div style={cardTitle}>Register patient</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inp, flex: '1 1 150px' }} />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ ...inp, flex: '1 1 130px' }} />
          <input placeholder="Condition (optional)" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...inp, flex: '1 1 160px' }} />
          <button type="submit" disabled={busy === 'new'} style={btn}>
            {busy === 'new' ? 'Saving…' : 'Register'}
          </button>
        </div>
      </form>

      <input placeholder="Search patients by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: '100%', marginBottom: 12 }} />

      {commMsg && (
        <div style={{ ...banner, background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}>{commMsg}</div>
      )}

      {rows.length === 0 ? (
        <p style={muted}>No patients{q ? ' match your search' : ' yet'}.</p>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Patient</th>
                <th style={th}>Phone</th>
                <th style={th}>Status</th>
                <th style={th}>Condition</th>
                <th style={{ ...th, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const open = openId === p.id;
                const theirAppts = appointments.filter((a) => a.data.phone && a.data.phone === p.data.phone);
                const theirVisits = visits.filter((v) => v.data.phone && v.data.phone === p.data.phone);
                return (
                  <Fragment key={p.id}>
                    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{p.data.name}</td>
                      <td style={td}>{p.data.phone}</td>
                      <td style={td}>
                        {(() => {
                          const active = (p.data.status ?? 'active') === 'active';
                          return (
                            <span style={pill(active ? '#166534' : '#9ca3af', active ? '#dcfce7' : '#f1f5f9')}>
                              {p.data.status ?? 'active'}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ ...td, color: '#475569' }}>{p.data.condition || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {comm && p.data.phone && (
                          <>
                            <button
                              onClick={() => doComm(`${p.id}:call`, () => comm.call(p.data.phone), `Calling ${p.data.phone}…`)}
                              disabled={commBusy === `${p.id}:call`}
                              style={action('#16a34a')}
                            >
                              {commBusy === `${p.id}:call` ? '…' : 'Call'}
                            </button>
                            <button
                              onClick={() => doComm(`${p.id}:wa`, () => comm.whatsapp(p.data.phone, p.data.name), `WhatsApp sent to ${p.data.phone}`)}
                              disabled={commBusy === `${p.id}:wa`}
                              style={action('#0891b2')}
                            >
                              {commBusy === `${p.id}:wa` ? '…' : 'WhatsApp'}
                            </button>
                            <button
                              onClick={() => doComm(`${p.id}:sp`, () => comm.softphone(p.data.phone), 'Softphone opened — press Dial')}
                              disabled={commBusy === `${p.id}:sp`}
                              style={action('#7c3aed')}
                            >
                              {commBusy === `${p.id}:sp` ? '…' : 'Softphone'}
                            </button>
                          </>
                        )}
                        <button onClick={() => setOpenId(open ? null : p.id)} style={ghost}>
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} style={{ ...td, background: '#f8fafc' }}>
                          <PatientDetail
                            patient={p}
                            appts={theirAppts}
                            visits={theirVisits}
                            onUpdate={(patch) => patients.update(p.id, patch)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PatientDetail({
  patient,
  appts,
  visits,
  onUpdate,
}: {
  patient: Row<Patient>;
  appts: Row<Appointment>[];
  visits: Row<Visit>[];
  onUpdate: (patch: Partial<Patient>) => Promise<unknown>;
}) {
  const [condition, setCondition] = useState(patient.data.condition || '');
  const [notes, setNotes] = useState(patient.data.notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onUpdate({ condition, notes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Condition" style={{ ...inp, flex: '1 1 160px' }} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" style={{ ...inp, flex: '2 1 220px' }} />
        <button onClick={save} disabled={saving} style={btnSm}>{saving ? 'Saving…' : 'Save'}</button>
        <button
          onClick={() => onUpdate({ status: patient.data.status === 'active' ? 'inactive' : 'active' })}
          style={ghost}
        >
          Mark {patient.data.status === 'active' ? 'inactive' : 'active'}
        </button>
      </div>

      <MiniList title={`Appointments (${appts.length})`} empty="No appointments.">
        {appts
          .sort((a, b) => (b.data.start || '').localeCompare(a.data.start || ''))
          .map((a) => (
            <li key={a.id} style={miniRow}>
              <span>{fmtDateTime(a.data.start)} · {a.data.problem || '—'}</span>
              <Badge status={a.data.status} />
            </li>
          ))}
      </MiniList>

      <MiniList title={`Visits (${visits.length})`} empty="No visit logs.">
        {visits
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .map((v) => (
            <li key={v.id} style={{ ...miniRow, display: 'block' }}>
              <strong>{v.data.diagnosis || 'Visit'}</strong>
              {v.data.prescription ? ` · Rx: ${v.data.prescription}` : ''}
              {v.data.follow_up ? ` · follow-up ${fmtDate(v.data.follow_up)}` : ''}
            </li>
          ))}
      </MiniList>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appointments — date filter, book, mark visited/no-show/cancel
// ---------------------------------------------------------------------------

function Appointments({
  appointments,
  from,
  to,
}: {
  appointments: ReturnType<typeof useObjects<Appointment>>;
  from: string;
  to: string;
}) {
  const [form, setForm] = useState({ patient_name: '', phone: '', problem: '', start: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const rows = appointments.data
    .filter((a) => {
      const k = dayKey(a.data.start);
      return k && k >= from && k <= to;
    })
    .sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));

  const book = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.patient_name || !form.start) return;
    setBusy('new');
    try {
      await appointments.create({ ...form, status: 'scheduled' });
      setForm({ patient_name: '', phone: '', problem: '', start: '' });
    } finally {
      setBusy(null);
    }
  };
  const mark = async (id: string, status: ApptStatus) => {
    setBusy(id);
    try {
      await appointments.update(id, { status });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <form onSubmit={book} style={card}>
        <div style={cardTitle}>New appointment</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Patient name" value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} style={{ ...inp, flex: '1 1 150px' }} />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ ...inp, flex: '1 1 130px' }} />
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={{ ...inp, flex: '1 1 180px' }} />
        </div>
        <textarea placeholder="Problem / reason for visit" value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} rows={2} style={{ ...inp, width: '100%', marginTop: 8, resize: 'vertical' }} />
        <button type="submit" disabled={busy === 'new'} style={{ ...btn, marginTop: 8 }}>{busy === 'new' ? 'Booking…' : 'Book appointment'}</button>
      </form>

      {rows.length === 0 ? (
        <p style={muted}>No appointments in this date range.</p>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Patient</th>
                <th style={th}>Problem</th>
                <th style={th}>When</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{r.data.patient_name}</div>
                    {r.data.phone && <div style={{ color: '#94a3b8', fontSize: 12 }}>{r.data.phone}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 220, color: '#475569' }}>{r.data.problem || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(r.data.start)}</td>
                  <td style={td}><Badge status={r.data.status} /></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.data.status !== 'visited' && r.data.status !== 'cancelled' && (
                      <button onClick={() => mark(r.id, 'visited')} disabled={busy === r.id} style={action('#16a34a')}>Visited</button>
                    )}
                    {r.data.status === 'scheduled' && (
                      <button onClick={() => mark(r.id, 'not_visited')} disabled={busy === r.id} style={action('#ea580c')}>No-show</button>
                    )}
                    {r.data.status !== 'cancelled' && r.data.status !== 'visited' && (
                      <button onClick={() => mark(r.id, 'cancelled')} disabled={busy === r.id} style={action('#94a3b8')}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Visits — log a consultation outcome + list
// ---------------------------------------------------------------------------

function Visits({
  visits,
  patients,
}: {
  visits: ReturnType<typeof useObjects<Visit>>;
  patients: Row<Patient>[];
}) {
  const [form, setForm] = useState({ patient_name: '', phone: '', diagnosis: '', prescription: '', follow_up: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);

  const del = async (id: string) => {
    setDelId(id);
    try {
      await visits.remove(id);
    } finally {
      setDelId(null);
    }
  };

  const log = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.phone || !form.diagnosis) return;
    setBusy(true);
    try {
      await visits.create({ ...form });
      setForm({ patient_name: '', phone: '', diagnosis: '', prescription: '', follow_up: '', notes: '' });
    } finally {
      setBusy(false);
    }
  };

  // Autofill the name when a known phone is typed.
  const onPhone = (phone: string) => {
    const p = patients.find((x) => x.data.phone === phone);
    setForm((f) => ({ ...f, phone, patient_name: p?.data.name ?? f.patient_name }));
  };

  const rows = [...visits.data].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return (
    <>
      <form onSubmit={log} style={card}>
        <div style={cardTitle}>Log a visit</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Phone" value={form.phone} onChange={(e) => onPhone(e.target.value)} style={{ ...inp, flex: '1 1 130px' }} />
          <input placeholder="Patient name" value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} style={{ ...inp, flex: '1 1 150px' }} />
          <input placeholder="Diagnosis" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} style={{ ...inp, flex: '1 1 160px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input placeholder="Prescription" value={form.prescription} onChange={(e) => setForm({ ...form, prescription: e.target.value })} style={{ ...inp, flex: '2 1 200px' }} />
          <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            Follow-up
            <input type="date" value={form.follow_up} onChange={(e) => setForm({ ...form, follow_up: e.target.value })} style={inp} />
          </label>
        </div>
        <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inp, width: '100%', marginTop: 8, resize: 'vertical' }} />
        <button type="submit" disabled={busy} style={{ ...btn, marginTop: 8 }}>{busy ? 'Saving…' : 'Log visit'}</button>
      </form>

      {rows.length === 0 ? (
        <p style={muted}>No visits logged yet.</p>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Patient</th>
                <th style={th}>Diagnosis</th>
                <th style={th}>Prescription</th>
                <th style={th}>Follow-up</th>
                <th style={th}>Logged</th>
                <th style={{ ...th, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{v.data.patient_name || '—'}</div>
                    {v.data.phone && <div style={{ color: '#94a3b8', fontSize: 12 }}>{v.data.phone}</div>}
                  </td>
                  <td style={td}>{v.data.diagnosis || '—'}</td>
                  <td style={{ ...td, color: '#475569' }}>{v.data.prescription || '—'}</td>
                  <td style={td}>{fmtDate(v.data.follow_up)}</td>
                  <td style={{ ...td, color: '#94a3b8', fontSize: 12 }}>{fmtDate(v.createdAt)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => del(v.id)} disabled={delId === v.id} style={action('#dc2626')}>
                      {delId === v.id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reports — comprehensive dashboard across all three record types
// ---------------------------------------------------------------------------

function Reports({
  patients,
  appointments,
  visits,
  from,
  to,
}: {
  patients: Row<Patient>[];
  appointments: Row<Appointment>[];
  visits: Row<Visit>[];
  from: string;
  to: string;
}) {
  const stats = useMemo(() => {
    const appts = appointments.filter((a) => {
      const k = dayKey(a.data.start);
      return k && k >= from && k <= to;
    });
    const by: Record<ApptStatus, number> = { scheduled: 0, visited: 0, not_visited: 0, cancelled: 0 };
    const perDay = new Map<string, { total: number; visited: number }>();
    for (const a of appts) {
      const s = (a.data.status || 'scheduled') as ApptStatus;
      by[s] = (by[s] ?? 0) + 1;
      const k = dayKey(a.data.start);
      if (k) {
        const d = perDay.get(k) ?? { total: 0, visited: 0 };
        d.total += 1;
        if (s === 'visited') d.visited += 1;
        perDay.set(k, d);
      }
    }
    const decided = by.visited + by.not_visited;
    const visitRate = decided ? Math.round((by.visited / decided) * 100) : null;

    // Visits + follow-ups respect the same date range as appointments.
    const rangedVisits = visits.filter((v) => {
      const k = dayKey(v.createdAt);
      return k && k >= from && k <= to;
    });
    const diag = new Map<string, number>();
    for (const v of rangedVisits) {
      const d = (v.data.diagnosis || '').trim().toLowerCase();
      if (d) diag.set(d, (diag.get(d) ?? 0) + 1);
    }
    const today = toDateInput(new Date());
    const followUps = visits
      .filter((v) => {
        const k = dayKey(v.data.follow_up);
        return k >= today && k <= to; // upcoming, within the range end
      })
      .sort((a, b) => (a.data.follow_up || '').localeCompare(b.data.follow_up || ''));

    return {
      totalPatients: patients.length,
      activePatients: patients.filter((p) => (p.data.status ?? 'active') === 'active').length,
      apptTotal: appts.length,
      by,
      visitRate,
      visitsTotal: rangedVisits.length,
      days: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      topDiag: [...diag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      followUps,
    };
  }, [patients, appointments, visits, from, to]);

  const maxDay = Math.max(1, ...stats.days.map((d) => d[1].total));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        <Kpi label="Patients" value={stats.totalPatients} sub={`${stats.activePatients} active`} />
        <Kpi label="Appointments" value={stats.apptTotal} accent="#4f46e5" />
        <Kpi label="Visited" value={stats.by.visited} accent="#16a34a" />
        <Kpi label="No-shows" value={stats.by.not_visited} accent="#ea580c" />
        <Kpi label="Visit rate" value={stats.visitRate == null ? '—' : `${stats.visitRate}%`} accent="#0891b2" />
        <Kpi label="Visits logged" value={stats.visitsTotal} accent="#7c3aed" />
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <div style={cardTitle}>Appointment status</div>
        {(['visited', 'not_visited', 'scheduled', 'cancelled'] as ApptStatus[]).map((s) => {
          const n = stats.by[s];
          const pct = stats.apptTotal ? Math.round((n / stats.apptTotal) * 100) : 0;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
              <span style={{ width: 90, fontSize: 13, color: '#475569' }}>{STATUS[s].label}</span>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: STATUS[s].color }} />
              </div>
              <span style={{ width: 64, textAlign: 'right', fontSize: 13, color: '#475569' }}>{n} ({pct}%)</span>
            </div>
          );
        })}
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <div style={cardTitle}>Appointments per day</div>
        {stats.days.length === 0 ? (
          <p style={{ ...muted, margin: 0 }}>No data in range.</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, overflowX: 'auto', paddingTop: 8 }}>
            {stats.days.map(([day, d]) => (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>{d.total}</div>
                <div title={`${d.total} total, ${d.visited} visited`} style={{ width: 22, height: `${(d.total / maxDay) * 96}px`, background: '#c7d2fe', borderRadius: '4px 4px 0 0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div style={{ height: `${(d.visited / d.total) * 100}%`, background: '#4f46e5', borderRadius: d.visited === d.total ? '4px 4px 0 0' : 0 }} />
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>{day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16, marginTop: 16 }}>
        <div style={card}>
          <div style={cardTitle}>Top diagnoses</div>
          {stats.topDiag.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>No visits logged.</p>
          ) : (
            stats.topDiag.map(([d, n]) => (
              <div key={d} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid #f8fafc' }}>
                <span style={{ color: '#334155', textTransform: 'capitalize' }}>{d}</span>
                <span style={muted}>{n}</span>
              </div>
            ))
          )}
        </div>
        <div style={card}>
          <div style={cardTitle}>Follow-ups due ({stats.followUps.length})</div>
          {stats.followUps.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>No upcoming follow-ups.</p>
          ) : (
            stats.followUps.slice(0, 8).map((v) => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid #f8fafc' }}>
                <span style={{ color: '#334155' }}>{v.data.patient_name || v.data.phone}</span>
                <span style={muted}>{fmtDate(v.data.follow_up)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Activity — the org's call history (who, by which method, the outcome)
// ---------------------------------------------------------------------------

function Activity() {
  const [number, setNumber] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [applied, setApplied] = useState<{ number?: string; sessionId?: string }>({});
  const { calls, loading, error, reload } = useCallHistory(applied);

  const search = () =>
    setApplied({
      ...(number.trim() ? { number: number.trim() } : {}),
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    });
  const clear = () => {
    setNumber('');
    setSessionId('');
    setApplied({});
  };
  const active = !!applied.number || !!applied.sessionId;

  return (
    <>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Mobile number(s) — comma-separated for bulk"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            style={{ ...inp, flex: '2 1 220px' }}
          />
          <input
            placeholder="Session id(s) — comma-separated for bulk"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            style={{ ...inp, flex: '2 1 220px' }}
          />
          <button onClick={search} style={btnSm}>Search</button>
          {active && <button onClick={clear} style={ghost}>Clear</button>}
        </div>
        <div style={{ ...muted, marginTop: 6 }}>
          Search call history by mobile number or session id — single or bulk (comma-separated).
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <span style={muted}>
          {active ? `${calls.length} match` : 'Calls placed or received by your agents — who, by which method, and the outcome.'}
        </span>
        <button onClick={reload} style={ghost}>Refresh</button>
      </div>
      {error && <div style={banner}>{error.message}</div>}
      {loading ? (
        <p style={muted}>Loading…</p>
      ) : calls.length === 0 ? (
        <p style={muted}>No calls yet.</p>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Method</th>
                <th style={th}>Direction</th>
                <th style={th}>From → To</th>
                <th style={th}>Agent</th>
                <th style={th}>Status</th>
                <th style={th}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 50).map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(c.start_time)}</td>
                  <td style={td}><span style={pill('#3730a3', '#e0e7ff')}>{c.channel || '—'}</span></td>
                  <td style={td}>{c.direction || '—'}</td>
                  <td style={{ ...td, color: '#475569', whiteSpace: 'nowrap' }}>
                    {c.from_number || '—'} → {c.to_number || '—'}
                  </td>
                  <td style={td}>{c.agent_name || '—'}</td>
                  <td style={td}>{c.status || '—'}</td>
                  <td style={td}>{c.duration_sec != null ? `${c.duration_sec}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function Badge({ status }: { status: ApptStatus }) {
  const s = STATUS[status] ?? STATUS.scheduled;
  return <span style={pill(s.color, s.bg)}>{s.label}</span>;
}

function Kpi({ label, value, sub, accent = '#0f172a' }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

function MiniList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{title}</div>
      {items.filter(Boolean).length === 0 ? (
        <p style={{ ...muted, margin: 0, fontSize: 13 }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const wrap: CSSProperties = { maxWidth: 940, margin: '0 auto', padding: 20, fontFamily: 'system-ui,-apple-system,sans-serif', color: '#0f172a' };
const head: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 };
const card: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 0 };
const cardTitle: CSSProperties = { fontWeight: 600, marginBottom: 10, fontSize: 14 };
const inp: CSSProperties = { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, outline: 'none' };
const btn: CSSProperties = { padding: '8px 16px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const btnSm: CSSProperties = { ...btn, padding: '6px 12px', fontSize: 13 };
const ghost: CSSProperties = { padding: '5px 10px', background: 'transparent', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, color: '#475569', cursor: 'pointer' };
const banner: CSSProperties = { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#64748b', fontWeight: 600, background: '#f8fafc' };
const td: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const muted: CSSProperties = { color: '#94a3b8', fontSize: 13 };
const miniRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13, borderBottom: '1px solid #eef2f7' };
const action = (color: string): CSSProperties => ({ marginLeft: 6, padding: '4px 10px', background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' });
const pill = (color: string, bg: string): CSSProperties => ({ background: bg, color, borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 });
