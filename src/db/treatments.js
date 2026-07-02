import { db } from './db';

// ── Treatment domain ─────────────────────────────────────────────────────────
// A first-class model for chemical / fertilizer applications, kept fully separate
// from mow visits. Phase 1 stands up the data + program scheduling API; the
// Treatments section UI (Phase 2) is built on top of these helpers.
//
// Shapes:
//   TreatmentProgram = { id, name, builtIn?, steps: ProgramStep[] }
//   ProgramStep      = { id, order, name, category, startMonth, endMonth,
//                        defaultProductName?, defaultRate? }   (months are 1-12)
//   Treatment        = { id, customerId, programId, stepId, stepName, stepOrder,
//                        category, year, status, dueDate, dueWindowStart,
//                        dueWindowEnd, completedAt, price, durationSecs, weather,
//                        complianceLog, note }
//   status ∈ 'scheduled' | 'due' | 'completed' | 'skipped'

export const PROGRAM_CATEGORIES = [
  'Fertilizer', 'Weed Control', 'Pre-Emergent', 'Fungicide', 'Insecticide', 'Other'
];

// A sensible default cool-season turf program. Built-in so a fresh install has
// something to enroll customers into; fully editable/removable in the UI.
export const STANDARD_5_STEP = {
  name: 'Standard 5-Step Program',
  builtIn: true,
  steps: [
    { id: 'step1', order: 1, name: 'Early Spring — Pre-Emergent + Crabgrass Preventer', category: 'Pre-Emergent', startMonth: 3, endMonth: 4 },
    { id: 'step2', order: 2, name: 'Late Spring — Fertilizer + Broadleaf Weed Control', category: 'Weed Control', startMonth: 5, endMonth: 5 },
    { id: 'step3', order: 3, name: 'Summer — Grub Control + Slow-Release Fertilizer', category: 'Insecticide', startMonth: 6, endMonth: 7 },
    { id: 'step4', order: 4, name: 'Early Fall — Fertilizer + Weed Control', category: 'Fertilizer', startMonth: 9, endMonth: 9 },
    { id: 'step5', order: 5, name: 'Late Fall — Winterizer Fertilizer', category: 'Fertilizer', startMonth: 10, endMonth: 11 }
  ]
};

// ── Pure scheduling helpers (no DB; unit-testable) ───────────────────────────

// Start of the step's due window for a given calendar year (ms epoch).
export function stepDueDate(step, year) {
  return new Date(year, step.startMonth - 1, 1).getTime();
}

// Inclusive [start, end] window for the step in a given year (ms epoch).
// end = last instant of endMonth.
export function stepWindow(step, year) {
  const start = new Date(year, step.startMonth - 1, 1).getTime();
  const end = new Date(year, step.endMonth, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

// Classify a scheduled treatment relative to a reference time.
export function classifyTreatment(t, asOf = Date.now()) {
  if (t.status === 'completed' || t.status === 'skipped') return t.status;
  if (t.dueWindowEnd != null && t.dueWindowEnd < asOf) return 'overdue';
  if (t.dueWindowStart != null && t.dueWindowStart <= asOf) return 'due';
  return 'scheduled';
}

// ── Program CRUD ─────────────────────────────────────────────────────────────

export function getPrograms() {
  return db.treatmentPrograms.toArray();
}

export function getProgram(id) {
  return db.treatmentPrograms.get(id);
}

export function createProgram(program) {
  return db.treatmentPrograms.add({ name: 'New Program', steps: [], ...program });
}

export function updateProgram(id, changes) {
  return db.treatmentPrograms.update(id, changes);
}

export function deleteProgram(id) {
  return db.treatmentPrograms.delete(id);
}

// Seed the built-in program if the user has none. Idempotent — safe to call on
// every app launch (covers both fresh installs and upgraded DBs, since Dexie
// .upgrade() does not run for brand-new databases).
export async function ensureDefaultProgram() {
  const count = await db.treatmentPrograms.count();
  if (count === 0) {
    await db.treatmentPrograms.add({ ...STANDARD_5_STEP });
  }
}

// ── Enrollment + schedule generation ─────────────────────────────────────────

// Enroll a customer in a program for a given year, generating one scheduled
// treatment per step. Idempotent per (customer, program, step, year).
export async function enrollCustomer(customerId, programId, year = new Date().getFullYear()) {
  const program = await db.treatmentPrograms.get(programId);
  if (!program) throw new Error(`Treatment program ${programId} not found`);

  await db.customers.update(customerId, { treatmentProgramId: programId, treatmentProgramYear: year });

  const existing = await db.treatments.where({ customerId }).toArray();
  const toCreate = [];
  for (const step of program.steps || []) {
    const already = existing.some(t => t.programId === programId && t.stepId === step.id && t.year === year);
    if (already) continue;
    const { start, end } = stepWindow(step, year);
    toCreate.push({
      customerId,
      programId,
      stepId: step.id,
      stepName: step.name,
      stepOrder: step.order,
      category: step.category,
      year,
      status: 'scheduled',
      dueDate: start,
      dueWindowStart: start,
      dueWindowEnd: end,
      completedAt: null,
      price: 0,
      durationSecs: 0,
      weather: null,
      complianceLog: null,
      note: ''
    });
  }
  if (toCreate.length) await db.treatments.bulkAdd(toCreate);
  return toCreate.length;
}

// ── Treatment queries ────────────────────────────────────────────────────────

export function getTreatmentsForCustomer(customerId) {
  return db.treatments.where({ customerId }).toArray();
}

// Scheduled/due treatments at or before (asOf + upcomingDays). Each is annotated
// with its computed state and sorted by due date.
export async function getDueTreatments({ asOf = Date.now(), upcomingDays = 14 } = {}) {
  const horizon = asOf + upcomingDays * 86400000;
  const open = await db.treatments.where('status').anyOf('scheduled', 'due').toArray();
  return open
    .filter(t => t.dueWindowStart == null || t.dueWindowStart <= horizon)
    .map(t => ({ ...t, state: classifyTreatment(t, asOf) }))
    .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
}

// ── Treatment lifecycle ──────────────────────────────────────────────────────

// Mark a scheduled treatment completed (e.g. when its compliance log is saved).
export function completeTreatment(treatmentId, data = {}) {
  return db.treatments.update(treatmentId, {
    status: 'completed',
    completedAt: data.completedAt || Date.now(),
    complianceLog: data.complianceLog ?? null,
    price: data.price || 0,
    durationSecs: data.durationSecs || 0,
    weather: data.weather ?? null,
    note: data.note || ''
  });
}

// Create a standalone completed treatment with no prior scheduled record
// (ad-hoc application that wasn't part of a program step).
export function logAdHocTreatment(customerId, data = {}) {
  return db.treatments.add({
    customerId,
    programId: null,
    stepId: null,
    stepName: data.stepName || 'Ad-hoc application',
    category: data.category || null,
    year: new Date(data.completedAt || Date.now()).getFullYear(),
    status: 'completed',
    dueDate: data.completedAt || Date.now(),
    dueWindowStart: null,
    dueWindowEnd: null,
    completedAt: data.completedAt || Date.now(),
    price: data.price || 0,
    durationSecs: data.durationSecs || 0,
    weather: data.weather ?? null,
    complianceLog: data.complianceLog ?? null,
    note: data.note || ''
  });
}

export function skipTreatment(treatmentId, note = '') {
  return db.treatments.update(treatmentId, { status: 'skipped', note });
}

// Re-open a skipped treatment (undo a skip).
export function unskipTreatment(treatmentId) {
  return db.treatments.update(treatmentId, { status: 'scheduled', note: '' });
}

// Remove a customer's enrollment. Deletes only still-open (scheduled/skipped)
// treatments for the given year — completed applications are kept as history.
export async function unenrollCustomer(customerId, year = new Date().getFullYear()) {
  await db.customers.update(customerId, { treatmentProgramId: null, treatmentProgramYear: null });
  const open = await db.treatments
    .where({ customerId })
    .filter(t => t.year === year && (t.status === 'scheduled' || t.status === 'skipped'))
    .toArray();
  if (open.length) await db.treatments.bulkDelete(open.map(t => t.id));
  return open.length;
}
