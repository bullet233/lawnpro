import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import {
  classifyTreatment, enrollCustomer, completeTreatment, skipTreatment,
  unskipTreatment,
} from '../db/treatments';
import ComplianceLogModal from '../components/ComplianceLogModal';
import AppDialog from '../components/AppDialog';
import { toast } from '../utils/toast';
import {
  Droplets, Calendar, CheckCircle2, SkipForward, UserPlus, ClipboardCheck,
  AlertTriangle, Undo2, Users,
} from 'lucide-react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CATEGORY_COLORS = {
  'Pre-Emergent': '#8b5cf6',
  'Weed Control': '#f59e0b',
  'Fertilizer': '#10b981',
  'Insecticide': '#ef4444',
  'Fungicide': '#0ea5e9',
  'Other': '#64748b',
};

const STATE_META = {
  overdue: { label: 'Overdue', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  due: { label: 'Due Now', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  scheduled: { label: 'Upcoming', color: '#64748b', bg: 'var(--color-bg-main)' },
};

function fmtWindow(t) {
  if (t.dueWindowStart == null) return '';
  const s = new Date(t.dueWindowStart);
  const e = t.dueWindowEnd != null ? new Date(t.dueWindowEnd) : null;
  const sTxt = `${MONTHS[s.getMonth()]} ${s.getDate()}`;
  if (!e) return sTxt;
  const eTxt = e.getMonth() === s.getMonth() ? `${e.getDate()}` : `${MONTHS[e.getMonth()]} ${e.getDate()}`;
  return `${sTxt} – ${eTxt}`;
}

// Is this customer a chemical/fertilizer client? (active fert service or already enrolled)
function fertService(customer) {
  return (customer.services || []).find(
    s => s.active && (s.category === 'Fertilizer' || s.id === 's3')
  ) || null;
}
function fertServicePrice(customer) {
  const svc = fertService(customer);
  return svc ? Number(svc.price) || 0 : 0;
}
function isFertCustomer(customer) {
  if (customer.treatmentProgramId) return true;
  return (customer.services || []).some(
    s => s.active && (s.category === 'Fertilizer' || s.id === 's3')
  );
}

export default function Treatments() {
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  const now = Date.now();

  const programs = useLiveQuery(() => db.treatmentPrograms.toArray(), []) || [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const treatments = useLiveQuery(() => db.treatments.toArray(), []) || [];

  const [logging, setLogging] = useState(null); // { treatment, customer }
  const [dialog, setDialog] = useState(null);
  const [enrolling, setEnrolling] = useState(false);

  const program = programs[0] || null;
  const custById = useMemo(() => {
    const m = new Map();
    customers.forEach(c => m.set(c.id, c));
    return m;
  }, [customers]);

  // Open (schedulable) treatments this year, annotated + joined to customer.
  const openList = useMemo(() => {
    return treatments
      .filter(t => t.year === year && (t.status === 'scheduled' || t.status === 'due'))
      .map(t => ({ ...t, state: classifyTreatment(t, now), customer: custById.get(t.customerId) }))
      .filter(t => t.customer)
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
  }, [treatments, custById, year, now]);

  const attention = openList.filter(t => t.state === 'overdue' || t.state === 'due');
  const upcoming = openList
    .filter(t => t.state === 'scheduled')
    .filter(t => t.dueWindowStart == null || t.dueWindowStart <= now + 45 * 86400000);

  const completedList = useMemo(
    () => treatments
      .filter(t => t.year === year && t.status === 'completed')
      .map(t => ({ ...t, customer: custById.get(t.customerId) }))
      .filter(t => t.customer)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    [treatments, custById, year]
  );
  const completedThisYear = completedList.length;
  const skipped = useMemo(
    () => treatments.filter(t => t.year === year && t.status === 'skipped'),
    [treatments, year]
  );

  // Enrollment buckets
  const fertCustomers = useMemo(() => customers.filter(isFertCustomer), [customers]);
  const unenrolled = fertCustomers.filter(c => !c.treatmentProgramId);
  const enrolled = fertCustomers.filter(c => c.treatmentProgramId);

  const stepsPerYear = program?.steps?.length || 0;
  const progressFor = (customerId) => {
    const mine = treatments.filter(t => t.customerId === customerId && t.year === year);
    return {
      done: mine.filter(t => t.status === 'completed').length,
      total: mine.length || stepsPerYear,
    };
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleEnroll = async (customer) => {
    if (!program) { toast('No treatment program found.'); return; }
    const n = await enrollCustomer(customer.id, program.id, year);
    toast(`${customer.name} enrolled — ${n} step${n === 1 ? '' : 's'} scheduled.`);
  };

  const handleEnrollAll = () => {
    if (!program || unenrolled.length === 0) return;
    setDialog({
      type: 'confirm',
      title: `Enroll ${unenrolled.length} clients?`,
      message: `This will put all ${unenrolled.length} chemical/fertilizer clients on "${program.name}" for ${year}, scheduling each program step.`,
      confirmLabel: 'Enroll All',
      onConfirm: async () => {
        setEnrolling(true);
        let total = 0;
        for (const c of unenrolled) total += await enrollCustomer(c.id, program.id, year);
        setEnrolling(false);
        toast(`Enrolled ${unenrolled.length} clients (${total} treatments scheduled).`);
      },
    });
  };

  const handleSkip = (t) => {
    setDialog({
      type: 'confirm',
      title: `Skip this step?`,
      message: `Skip "${t.stepName}" for ${t.customer.name}? You can un-skip it later.`,
      confirmLabel: 'Skip Step',
      onConfirm: async () => { await skipTreatment(t.id); toast('Step skipped.'); },
    });
  };

  const handleSaveLog = async (logData) => {
    if (!logging) return;
    const { treatment, customer } = logging;

    // Re-opening an already-completed application: update the compliance log
    // only, keeping the original completion facts (and the linked visit in sync).
    if (treatment.status === 'completed') {
      await db.treatments.update(treatment.id, { complianceLog: logData });
      if (treatment.visitId != null) await db.visits.update(treatment.visitId, { complianceLog: logData });
      setLogging(null);
      toast('Compliance log updated.');
      return treatment.visitId ?? null;
    }

    const price = fertServicePrice(customer);
    const now = Date.now();
    // The application really happened — record it as a completed fertilizer
    // visit so it counts in revenue/history like field-logged work, then mark
    // the program step done against that visit.
    const visitId = await db.visits.add({
      routeId: null,
      customerId: customer.id,
      status: 'completed',
      durationSecs: 0,
      driveTimeSecs: 0,
      entryTime: now,
      exitTime: now,
      weather: null,
      priceEarned: price,
      appliedServices: fertService(customer) ? [fertService(customer).id] : [],
      division: 'fertilizer',
      complianceLog: logData,
      note: `Treatment: ${treatment.stepName}`,
    });
    await completeTreatment(treatment.id, {
      complianceLog: logData,
      completedAt: now,
      price,
      visitId,
    });
    setLogging(null);
    toast(`Logged ${treatment.stepName} for ${customer.name}.`);
    return visitId;
  };

  const seasonStep = program?.steps?.find(s => {
    const m = new Date().getMonth() + 1;
    return m >= s.startMonth && m <= s.endMonth;
  });

  return (
    <div className="animate-fade-in" style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '2rem' }}>
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.4rem' }}>
        <Droplets size={28} color="var(--color-primary)" />
        <h1 className="page-title" style={{ margin: 0 }}>Treatment Programs</h1>
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        {program ? program.name : 'No program'} · {year} season
        {seasonStep && <> · <strong style={{ color: 'var(--color-text-main)' }}>Now: {seasonStep.name.split('—')[0].trim()}</strong></>}
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ textAlign: 'center', padding: '1rem 0.5rem' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: attention.length ? '#ef4444' : 'var(--color-text-main)' }}>{attention.length}</div>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-muted)' }}>Needs Attention</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1rem 0.5rem' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-primary)' }}>{completedThisYear}</div>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-muted)' }}>Done in {year}</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1rem 0.5rem' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text-main)' }}>{enrolled.length}</div>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-muted)' }}>Enrolled</div>
        </div>
      </div>

      {/* Needs Attention */}
      <SectionTitle icon={<AlertTriangle size={17} color="#f59e0b" />} title="Needs Attention" count={attention.length} />
      {attention.length === 0 ? (
        <EmptyNote text="Nothing due right now. You're on schedule. 🎉" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.75rem' }}>
          {attention.map(t => (
            <TreatmentRow key={t.id} t={t}
              onLog={() => setLogging({ treatment: t, customer: t.customer })}
              onSkip={() => handleSkip(t)}
              onClient={() => navigate(`/customers/${t.customerId}`)} />
          ))}
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <>
          <SectionTitle icon={<Calendar size={17} color="var(--color-text-muted)" />} title="Upcoming (next 45 days)" count={upcoming.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.75rem' }}>
            {upcoming.map(t => (
              <TreatmentRow key={t.id} t={t} muted
                onLog={() => setLogging({ treatment: t, customer: t.customer })}
                onSkip={() => handleSkip(t)}
                onClient={() => navigate(`/customers/${t.customerId}`)} />
            ))}
          </div>
        </>
      )}

      {/* Enrollment */}
      <SectionTitle icon={<Users size={17} color="var(--color-primary)" />} title="Client Enrollment" count={fertCustomers.length} />
      {unenrolled.length > 0 && (
        <div className="card" style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{unenrolled.length} not enrolled</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Put them on {program?.name || 'the program'} for {year}.</div>
          </div>
          <button className="btn btn-primary" disabled={enrolling} onClick={handleEnrollAll} style={{ whiteSpace: 'nowrap' }}>
            <UserPlus size={16} /> Enroll All
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
        {fertCustomers.length === 0 && (
          <EmptyNote text="No chemical/fertilizer clients yet. Turn on a Fertilizer service for a client to see them here." />
        )}
        {fertCustomers.map(c => {
          const p = progressFor(c.id);
          const isEnrolled = !!c.treatmentProgramId;
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.7rem 0.85rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.id}`)}>
                <div style={{ fontWeight: 600, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {isEnrolled ? `${p.done}/${p.total} applications this year` : 'Not enrolled'}
                </div>
              </div>
              {isEnrolled ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                  <CheckCircle2 size={15} /> Enrolled
                </span>
              ) : (
                <button className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }} onClick={() => handleEnroll(c)}>
                  <UserPlus size={14} /> Enroll
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Completed this year — the compliance archive. Every row reopens its
          saved EPA log for review/reprint (the legal record-keeping half). */}
      {completedList.length > 0 && (
        <>
          <SectionTitle icon={<CheckCircle2 size={17} color="var(--color-primary)" />} title={`Completed in ${year}`} count={completedList.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.75rem' }}>
            {completedList.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.8rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{t.customer.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}> — {t.stepName}</span>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                    {t.completedAt ? new Date(t.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                    {t.price > 0 && ` · $${t.price}`}
                    {!t.complianceLog && ' · no EPA log'}
                  </div>
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => setLogging({ treatment: t, customer: t.customer })}>
                  <ClipboardCheck size={13} /> {t.complianceLog ? 'View Log' : 'Add Log'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Skipped (collapsible-lite) */}
      {skipped.length > 0 && (
        <>
          <SectionTitle icon={<SkipForward size={17} color="var(--color-text-muted)" />} title="Skipped this year" count={skipped.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {skipped.map(t => {
              const c = custById.get(t.customerId);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.8rem', background: 'var(--color-bg-main)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                  <span style={{ flex: 1, color: 'var(--color-text-muted)' }}>{c?.name} — {t.stepName}</span>
                  <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} onClick={() => unskipTreatment(t.id)}>
                    <Undo2 size={13} /> Un-skip
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {logging && (
        <ComplianceLogModal
          visit={{
            id: logging.treatment.visitId ?? undefined,
            exitTime: logging.treatment.completedAt || Date.now(),
            durationSecs: logging.treatment.durationSecs || 0,
            phone: logging.customer.phone,
            address: logging.customer.address,
          }}
          customerName={logging.customer.name}
          customerLawnSize={logging.customer.lawnSize}
          initialLog={logging.treatment.complianceLog || null}
          onSave={handleSaveLog}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  );
}

function SectionTitle({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.7rem 0' }}>
      {icon}
      <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text-main)' }}>{title}</h3>
      {count != null && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>({count})</span>}
    </div>
  );
}

function EmptyNote({ text }) {
  return (
    <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-card)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '1.75rem', fontSize: '0.9rem' }}>
      {text}
    </div>
  );
}

function TreatmentRow({ t, muted, onLog, onSkip, onClient }) {
  const sm = STATE_META[t.state] || STATE_META.scheduled;
  const catColor = CATEGORY_COLORS[t.category] || CATEGORY_COLORS.Other;
  return (
    <div className="card" style={{ padding: '0.85rem 1rem', borderLeft: `4px solid ${muted ? 'var(--color-border)' : sm.color}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span onClick={onClient} style={{ fontWeight: 700, color: 'var(--color-text-main)', cursor: 'pointer' }}>{t.customer.name}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: catColor, background: `${catColor}1a`, padding: '0.1rem 0.45rem', borderRadius: '10px' }}>{t.category}</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: sm.color, background: sm.bg, padding: '0.1rem 0.45rem', borderRadius: '10px' }}>{sm.label}</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-main)', marginTop: '0.25rem', fontWeight: 500 }}>{t.stepName}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Calendar size={12} /> {fmtWindow(t)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: '0.45rem', fontSize: '0.85rem', justifyContent: 'center' }} onClick={onLog}>
          <ClipboardCheck size={15} /> Log Application
        </button>
        <button className="btn btn-secondary" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} onClick={onSkip} title="Skip this step">
          <SkipForward size={15} />
        </button>
      </div>
    </div>
  );
}
