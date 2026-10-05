import { db } from '../db/db';
import { getSettings } from '../db/settings';
import { LEAF_CONDITION, isLeafVisit, isMowVisit, isCleanupVisit, mowingServiceIds, computeLeafBilling, computeCleanupSuggestion } from './leaves';

// The DB side of leaf billing (the math lives in utils/leaves).
//
// The hourly leaf rate only ever produces a SUGGESTION. Each leaf job stores:
//   leafSecs       — leaf time: minutes over the lawn's usual mow
//   leafSuggested  — leafSecs × the hourly leaf rate
//   leafCharge     — what was actually charged for leaves (in priceEarned)
//   leafDecided    — true once the driver picked: use it, another amount, or
//                    no charge. Until then the job sits on the "to decide" list.
// Nothing is added to a visit's price until the driver decides.

const round2 = (n) => Math.round(n * 100) / 100;

export const leafHourlyRate = () => Number(getSettings().leafHourlyRate) || 0;

// This lawn's usual plain-mow time (leaf visits and the visit itself left out).
export async function usualMowSecs(customerId, excludeVisitId = null) {
  const visits = await db.visits.where('customerId').equals(customerId).toArray();
  const ids = mowingServiceIds();
  const plain = visits.filter((v) =>
    v.id !== excludeVisitId && v.status === 'completed' && v.durationSecs > 0 &&
    (!v.division || v.division === 'mowing') && !isLeafVisit(v) && isMowVisit(v, ids));
  if (plain.length === 0) return null;
  return Math.round(plain.reduce((s, v) => s + v.durationSecs, 0) / plain.length);
}

// Bring a visit's leaf time and suggestion in line with its tag and its time.
// Safe to call after anything that may have changed either: tagging /
// untagging, a time edit, a split, a resumed job. Never changes what was
// charged — except to take the charge back off a visit that is no longer a
// leaf job.
//
// Tagging or untagging one visit moves the lawn's "usual mow" (a long visit
// stops, or starts, counting as a plain mow), so the lawn's other leaf jobs
// get their leaf time and suggestion refreshed too.
export async function syncLeafBilling(visitId) {
  const visit = await db.visits.get(visitId);
  if (!visit) return null;

  let result = visit;
  if (isCleanupVisit(visit)) {
    // Clean-up: the whole visit is leaf work. Keep its time and the hourly
    // suggestion current; its price is only changed by the driver's choice.
    const { leafSecs, leafCharge } = computeCleanupSuggestion(visit.durationSecs, leafHourlyRate());
    const next = { leafSecs, leafSuggested: leafCharge };
    // A leaf-job charge left over from before the services were changed.
    if (visit.leafCharge) {
      next.leafCharge = 0;
      next.priceEarned = round2(Math.max(0, (visit.priceEarned || 0) - visit.leafCharge));
    }
    await db.visits.update(visitId, next);
    result = { ...visit, ...next };
  } else if (!isLeafVisit(visit)) {
    if (visit.leafCharge || visit.leafSecs || visit.leafSuggested || visit.leafDecided) {
      const cleared = {
        leafSecs: 0, leafSuggested: 0, leafCharge: 0, leafDecided: false,
        priceEarned: round2(Math.max(0, (visit.priceEarned || 0) - (visit.leafCharge || 0))),
      };
      await db.visits.update(visitId, cleared);
      result = { ...visit, ...cleared };
    }
  }

  // Every leaf job at this lawn shares one baseline: its plain mows.
  const usual = await usualMowSecs(visit.customerId);
  const rate = leafHourlyRate();
  const siblings = await db.visits.where('customerId').equals(visit.customerId).toArray();
  for (const v of siblings) {
    if (v.status !== 'completed' || !isLeafVisit(v) || isCleanupVisit(v)) continue;
    if (v.leafSecsManual) continue; // leaf time typed by hand in Edit Visit
    const { leafSecs, leafCharge } = computeLeafBilling(v.durationSecs, usual, rate);
    if (v.leafSecs === leafSecs && v.leafSuggested === leafCharge) continue;
    await db.visits.update(v.id, { leafSecs, leafSuggested: leafCharge });
    if (v.id === visitId) result = { ...result, leafSecs, leafSuggested: leafCharge };
  }
  return result;
}

// Change which services a saved visit was for (e.g. Mowing → Fall Clean-up
// from the Logs page). The visit is re-priced from the customer's service
// prices — add-ons and a decided leaf charge stay on top — and its leaf /
// clean-up numbers are settled for what it is now.
export async function changeVisitServices(visitId, serviceIds) {
  const visit = await db.visits.get(visitId);
  if (!visit) return null;
  const customer = await db.customers.get(visit.customerId);
  const services = (customer?.services || []).filter((s) => serviceIds.includes(s.id));
  const addOns = Array.isArray(visit.addOns) ? visit.addOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0;
  const stillMow = isMowVisit({ appliedServices: serviceIds });
  const update = {
    appliedServices: serviceIds,
    priceEarned: round2(services.reduce((sum, s) => sum + (s.price || 0), 0) + addOns + (stillMow ? (visit.leafCharge || 0) : 0)),
    revenueBreakdown: undefined,
    cleanupFlatPrice: undefined,
  };
  if (!stillMow) {
    // A clean-up can't also be a leaf job; its price starts at the flat rate.
    update.conditions = (visit.conditions || []).filter((c) => c !== LEAF_CONDITION);
    update.leafCharge = 0;
    update.leafDecided = false;
  } else if (isCleanupVisit(visit)) {
    update.leafDecided = false; // was a clean-up, is a mow again
  }
  await db.visits.update(visitId, update);
  return syncLeafBilling(visitId);
}

// Tag or untag a saved visit as a leaf job.
export async function setLeafTag(visitId, on, extra = {}) {
  const visit = await db.visits.get(visitId);
  if (!visit) return null;
  const others = (visit.conditions || []).filter((c) => c !== LEAF_CONDITION);
  await db.visits.update(visitId, { conditions: on ? [...others, LEAF_CONDITION] : others, ...extra });
  return syncLeafBilling(visitId);
}

// The driver's decision on a leaf job: charge `amount` for leaves (0 = no
// charge). Passing null puts it back on the "to decide" list.
export async function setLeafCharge(visitId, amount) {
  const visit = await db.visits.get(visitId);
  if (!visit) return null;
  const decided = amount != null;
  const charge = decided ? round2(Math.max(0, Number(amount) || 0)) : 0;
  if (isCleanupVisit(visit)) {
    // The chosen amount IS the clean-up's price (it replaces the flat service
    // price). The flat price is remembered so Undo can put it back.
    const flat = visit.cleanupFlatPrice ?? (visit.priceEarned || 0);
    const next = decided
      ? { priceEarned: charge, leafDecided: true, cleanupFlatPrice: flat, revenueBreakdown: undefined }
      : { priceEarned: flat, leafDecided: false, revenueBreakdown: undefined };
    await db.visits.update(visitId, next);
    return { ...visit, ...next };
  }
  const next = {
    leafCharge: charge,
    leafDecided: decided,
    priceEarned: round2(Math.max(0, (visit.priceEarned || 0) - (visit.leafCharge || 0)) + charge),
  };
  await db.visits.update(visitId, next);
  return { ...visit, ...next };
}
