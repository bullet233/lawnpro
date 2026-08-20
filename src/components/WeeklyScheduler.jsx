import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getDaysSince } from '../utils/dateUtils';
import { classifyTreatment } from '../db/treatments';
import { useServiceMode } from './ServiceProvider';
import { Search, ChevronDown, Calendar, GripVertical, Plus, X, Moon } from 'lucide-react';
import {
  DAY_NAMES, DAY_LETTERS, LONG_DAY_MINS, todayName, isSnoozed, eligibleForMode,
  estimateJobMins, orderDayStops, dayTotalMins, cheapestInsertIndex, intervalStatus,
  isScheduleAnchor,
} from '../utils/scheduler';

/* Direction 5b — sunlight-legible palette. Accent = pressable, red/amber = status.
   Text is black/near-black for outdoor contrast; the accent follows the active
   division (green for mowing, blue for fertilizer, matching the app theme). */
const SHARED = {
  ink: '#101613', dim: '#101613', faint: '#333B36', line: '#DCE2DF', line2: '#EDF0EE',
  bg: '#FFFFFF', bgOpen: '#FFFFFF', bgToday: '#FFFFFF', railOff: '#F1F4F2',
  late: '#B00E0E', due: '#8A4200', lateChipBg: '#FEF6F6', lateChipText: '#B91C1C',
  removeBg: '#FFF3EC', removeText: '#B4460C', neutralChip: '#F1F4F2',
  toastBg: '#0F1A15', toastUndo: '#5CD39B', overHours: '#B91C1C',
  idx: '#4A554E', handle: '#6B7770', dragBg: '#F1F4F2',
};
function pal(isFert) {
  return {
    ...SHARED,
    head: isFert ? '#3B82F6' : '#10B981',
    headText: isFert ? '#1D4ED8' : '#0B6B45',
    green: isFert ? '#1D4ED8' : '#0B6B45',   // "green" = the accent (blue in fert)
    greenBg: isFert ? '#DBEAFE' : '#E2F4EC',
    greenBg2: isFert ? '#E7F0FF' : '#EAF6F0',
  };
}

const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// Monday-start week: the calendar date sitting under each weekday label.
function weekDates(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const out = {};
  DAY_NAMES.forEach((d, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    out[d] = dt;
  });
  return out;
}
const fmtDate = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtHrs = (mins) => (mins / 60).toFixed(1) + 'h';

export default function WeeklyScheduler({ customers, tieredMatrixData, settings, onLoadDayRoute, allVisits }) {
  const { activeMode } = useServiceMode();
  // Refresh the clock on return-to-tab and every few minutes so TODAY and the
  // late math don't go stale if the app sits open across midnight.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const tiered = tieredMatrixData;
  const C = useMemo(() => pal(activeMode === 'fertilizer'), [activeMode]);

  const [openDay, setOpenDay] = useState(() => todayName(now));
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [moveSheet, setMoveSheet] = useState(null);   // { cust }
  const [addSheet, setAddSheet] = useState(null);      // { day }
  const [batchDay, setBatchDay] = useState(null);      // day name while selecting
  const [selected, setSelected] = useState(() => new Set());
  const [toast, setToast] = useState(null);            // { msg, snapshot }
  const toastTimer = useRef(null);
  const [reorder, setReorder] = useState(null);        // { day, ids:[], draggingId }
  const rowRefs = useRef({});

  const allTreatments = useLiveQuery(
    () => (activeMode === 'fertilizer' ? db.treatments.toArray() : Promise.resolve([])),
    [activeMode]
  ) || [];

  const dates = useMemo(() => weekDates(now), [now]);
  const today = todayName(now);

  // Which customers belong to the active division and can be scheduled at all.
  // Shared with the Route Builder's Load-route so both screens agree.
  const eligible = useMemo(
    () => (customers || []).filter((c) => eligibleForMode(c, activeMode)),
    [customers, activeMode]
  );

  // Last-service + status for one customer (division-filtered, program-aware).
  // Schedule anchors include deliberate "skip this cycle" skips, so a client
  // skipped on purpose shows normally due next cycle instead of LATE.
  const stopInfo = useCallback((cust) => {
    let lastDate = null, lastDays = null, lastWasSkip = false;
    if (allVisits) {
      const visits = allVisits.filter((v) => {
        if (v.customerId !== cust.id || !isScheduleAnchor(v)) return false;
        if (v.division) return v.division === activeMode;
        const svcIds = v.appliedServices || [];
        const defs = settings?.defaultServices || [];
        if (activeMode === 'mowing') {
          const mowIds = defs.filter((s) => s.category === 'Mowing' || s.id === 's1').map((s) => s.id);
          return svcIds.length === 0 || svcIds.some((id) => mowIds.includes(id));
        }
        const fertIds = defs.filter((s) => s.category === 'Fertilizer' || s.id === 's3').map((s) => s.id);
        return svcIds.some((id) => fertIds.includes(id));
      });
      if (visits.length) {
        visits.sort((a, b) => b.exitTime - a.exitTime);
        lastDate = visits[0].exitTime;
        lastDays = getDaysSince(lastDate);
        lastWasSkip = visits[0].status === 'skipped';
      }
    }
    let status;
    if (activeMode === 'fertilizer' && cust.treatmentProgramId) {
      const states = allTreatments
        .filter((t) => t.customerId === cust.id && (t.status === 'scheduled' || t.status === 'due'))
        .map((t) => classifyTreatment(t, now));
      if (states.includes('overdue')) status = { kind: 'late', excess: lastDays != null ? Math.max(1, lastDays - (cust.fertilizerInterval || 30)) : 0 };
      else if (states.includes('due')) status = { kind: 'due', excess: 0 };
      else status = { kind: lastDays == null ? 'new' : 'ok', excess: 0 };
    } else {
      const interval = activeMode === 'fertilizer'
        ? (cust.fertilizerInterval || 30)
        : (cust.mowingInterval || cust.serviceInterval || 7);
      status = intervalStatus(lastDays, interval);
    }
    return { lastDate, lastDays, lastWasSkip, status };
  }, [allVisits, allTreatments, activeMode, settings, now]);

  // day -> ordered stops (Mon..Sun). Unscheduled tracked separately for Add.
  const dayStops = useMemo(() => {
    const map = {}; DAY_NAMES.forEach((d) => { map[d] = []; });
    const unscheduled = [];
    eligible.forEach((c) => {
      if (c.preferredDay && map[c.preferredDay]) map[c.preferredDay].push(c);
      else unscheduled.push(c);
    });
    DAY_NAMES.forEach((d) => {
      const ordered = orderDayStops(map[d]);
      // Snoozed sink to the bottom of the visiting order.
      ordered.sort((a, b) => (isSnoozed(a, now) ? 1 : 0) - (isSnoozed(b, now) ? 1 : 0));
      map[d] = ordered;
    });
    return { map, unscheduled };
  }, [eligible, now]);

  const matches = useCallback((c) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q);
  }, [query]);

  // Project a day's hours if `extra` customers were added to it.
  const projectedMins = useCallback((day, extra = []) => {
    const extraIds = new Set(extra.map((c) => c.id));
    let list = (dayStops.map[day] || []).filter((c) => !extraIds.has(c.id) && !isSnoozed(c, now));
    extra.forEach((c) => {
      if (isSnoozed(c, now)) return;
      const idx = cheapestInsertIndex(list, c);
      list = [...list.slice(0, idx), c, ...list.slice(idx)];
    });
    return dayTotalMins(list, tiered, now);
  }, [dayStops, tiered, now]);

  /* ── undo plumbing ─────────────────────────────────────────────────────── */
  const snapshot = (custs) => custs.map((c) => ({
    id: c.id, preferredDay: c.preferredDay ?? '', snoozedUntil: c.snoozedUntil ?? null, dayOrder: Number.isFinite(c.dayOrder) ? c.dayOrder : null,
  }));
  const showToast = (msg, snap) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, snapshot: snap });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  const undo = async () => {
    if (!toast) return;
    await Promise.all(toast.snapshot.map((s) => db.customers.update(s.id, {
      preferredDay: s.preferredDay, snoozedUntil: s.snoozedUntil, dayOrder: s.dayOrder,
    })));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  /* ── actions ───────────────────────────────────────────────────────────── */
  // Renumber a day's stops so dayOrder reflects the visiting order.
  const persistOrder = async (list) => {
    await Promise.all(list.map((c, i) => db.customers.update(c.id, { dayOrder: i })));
  };

  const moveOne = async (cust, day) => {
    const srcDay = cust.preferredDay || '';
    const affected = [cust];
    (dayStops.map[day] || []).forEach((c) => { if (c.id !== cust.id) affected.push(c); });
    if (srcDay && dayStops.map[srcDay]) dayStops.map[srcDay].forEach((c) => { if (c.id !== cust.id && !affected.find((a) => a.id === c.id)) affected.push(c); });
    const snap = snapshot(affected);

    const target = (dayStops.map[day] || []).filter((c) => c.id !== cust.id);
    const idx = cheapestInsertIndex(target, cust);
    const moved = { ...cust, preferredDay: day };
    const newList = [...target.slice(0, idx), moved, ...target.slice(idx)];
    await db.customers.update(cust.id, { preferredDay: day });
    await persistOrder(newList);

    const activeBefore = newList.filter((c) => !isSnoozed(c, now));
    const pos = activeBefore.findIndex((c) => c.id === cust.id) + 1;
    showToast(`${cust.name} moved to ${day.slice(0, 3)}${pos ? ` · stop ${pos}` : ''}`, snap);
    return { pos, total: activeBefore.length };
  };

  const snoozeOne = async (cust) => {
    const snap = snapshot([cust]);
    await db.customers.update(cust.id, { snoozedUntil: now + SNOOZE_MS });
    showToast(`${cust.name} snoozed 1 week`, snap);
  };
  const removeOne = async (cust) => {
    const snap = snapshot([cust]);
    await db.customers.update(cust.id, { preferredDay: '', dayOrder: null });
    showToast(`${cust.name} removed from ${(cust.preferredDay || 'schedule').slice(0, 3)}`, snap);
  };

  const batchMove = async (day) => {
    const custs = [...selected].map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
    if (!custs.length) return;
    const snap = snapshot([...custs, ...(dayStops.map[day] || [])]);
    let list = (dayStops.map[day] || []).filter((c) => !selected.has(c.id));
    for (const cust of custs) {
      const idx = cheapestInsertIndex(list, cust);
      list = [...list.slice(0, idx), { ...cust, preferredDay: day }, ...list.slice(idx)];
      await db.customers.update(cust.id, { preferredDay: day });
    }
    await persistOrder(list);
    showToast(`${custs.length} stops moved to ${day.slice(0, 3)}`, snap);
    exitBatch();
  };
  const batchSnooze = async () => {
    const custs = [...selected].map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
    if (!custs.length) return;
    const snap = snapshot(custs);
    await Promise.all(custs.map((c) => db.customers.update(c.id, { snoozedUntil: now + SNOOZE_MS })));
    showToast(`${custs.length} stops snoozed 1 week`, snap);
    exitBatch();
  };
  const batchRemove = async () => {
    const custs = [...selected].map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
    if (!custs.length) return;
    const snap = snapshot(custs);
    await Promise.all(custs.map((c) => db.customers.update(c.id, { preferredDay: '', dayOrder: null })));
    showToast(`${custs.length} stops removed`, snap);
    exitBatch();
  };

  const exitBatch = () => { setBatchDay(null); setSelected(new Set()); };
  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  /* ── drag reorder within an open day (pointer-based, touch friendly) ────── */
  useEffect(() => {
    if (!reorder) return;
    const onMove = (e) => {
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const ids = reorder.ids;
      let target = ids.length - 1;
      for (let i = 0; i < ids.length; i++) {
        const el = rowRefs.current[ids[i]];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) { target = i; break; }
      }
      const from = ids.indexOf(reorder.draggingId);
      if (from === -1 || from === target) return;
      const next = ids.slice();
      next.splice(target, 0, next.splice(from, 1)[0]);
      setReorder({ ...reorder, ids: next });
    };
    const onUp = async () => {
      const list = reorder.ids.map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
      setReorder(null);
      await persistOrder(list);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [reorder, eligible]);

  const openDayAndScroll = (day) => {
    setOpenDay((prev) => (prev === day ? null : day));
    if (batchDay && batchDay !== day) exitBatch();
    requestAnimationFrame(() => {
      const el = document.getElementById(`day-sec-${day}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const searching = !!query.trim();

  /* ── render ────────────────────────────────────────────────────────────── */
  return (
    <div style={{ background: C.bg, borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.line}`, position: 'relative' }}>
      {/* Search toggle row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.line}` }}>
        <Search size={18} color={C.dim} strokeWidth={2.4} />
        {showSearch || searching ? (
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stops…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: C.ink, background: 'transparent' }}
          />
        ) : (
          <button onClick={() => setShowSearch(true)} style={{ flex: 1, textAlign: 'left', border: 'none', background: 'transparent', color: C.dim, fontSize: 14, cursor: 'pointer' }}>
            Search stops
          </button>
        )}
        {(showSearch || searching) && (
          <button onClick={() => { setQuery(''); setShowSearch(false); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.faint, display: 'flex' }}>
            <X size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {/* Day rail (sticky) */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, padding: '12px 12px 11px', borderBottom: `1px solid ${C.line}`, background: C.bg }}>
        {DAY_NAMES.map((d) => {
          const count = (dayStops.map[d] || []).filter(matches).length;
          const sel = !searching && openDay === d;
          return (
            <button key={d} onClick={() => openDayAndScroll(d)}
              style={{
                border: 'none', borderRadius: 9, padding: '9px 0', cursor: 'pointer',
                background: sel ? C.green : C.railOff, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: sel ? 'rgba(255,255,255,.72)' : C.dim }}>{DAY_LETTERS[d]}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: sel ? '#fff' : C.ink }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Week list */}
      <div>
        {DAY_NAMES.map((day) => {
          const allStops = dayStops.map[day] || [];
          const stops = allStops.filter(matches);
          const isOpen = searching ? stops.length > 0 : openDay === day;
          const isToday = day === today;
          const active = stops.filter((c) => !isSnoozed(c, now));
          const totalMins = dayTotalMins(orderDayStops(active), tiered, now);
          const lateCount = stops.reduce((n, c) => n + (stopInfo(c).status.kind === 'late' ? 1 : 0), 0);
          const overLong = totalMins > LONG_DAY_MINS;

          // Apply live reorder if this day is being dragged.
          let renderStops = stops;
          if (reorder && reorder.day === day) {
            renderStops = reorder.ids.map((id) => allStops.find((c) => c.id === id)).filter(Boolean).filter(matches);
          }

          return (
            <div key={day} id={`day-sec-${day}`} style={{ borderTop: `1px solid ${C.line}` }}>
              {/* Day header */}
              <button onClick={() => !searching && openDayAndScroll(day)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                  border: 'none', cursor: searching ? 'default' : 'pointer', textAlign: 'left',
                  background: isOpen ? C.bgOpen : (isToday ? C.bgToday : C.bg),
                }}>
                <div style={{ width: 46, flex: '0 0 auto' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '.05em', color: C.ink }}>{day.slice(0, 3).toUpperCase()}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: isToday ? C.green : C.faint }}>{fmtDate(dates[day])}</div>
                </div>
                {stops.length > 0 && (
                  <div style={{ fontSize: 15, fontWeight: 700, color: overLong ? C.overHours : C.ink }}>{fmtHrs(totalMins)}</div>
                )}
                {isToday && (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', color: C.green, background: C.greenBg, borderRadius: 5, padding: '3px 6px' }}>TODAY</span>
                )}
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 13, color: C.dim, textAlign: 'right' }}>
                  {stops.length === 0 ? 'Nothing scheduled' : `${stops.length} stop${stops.length !== 1 ? 's' : ''}${lateCount ? ` · ${lateCount} late` : ''}`}
                </div>
                {!searching && <ChevronDown size={15} color={C.faint} strokeWidth={2.2} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />}
              </button>

              {/* Open body */}
              {isOpen && (
                <div style={{ background: C.bgOpen }}>
                  {/* DRIVE ORDER + Select / Load */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 4px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.09em', color: C.faint }}>DRIVE ORDER</span>
                    <div style={{ flex: 1 }} />
                    {active.length > 0 && onLoadDayRoute && batchDay !== day && (
                      <button onClick={() => onLoadDayRoute(day)}
                        style={{ fontSize: 13, fontWeight: 700, color: C.green, background: C.greenBg, border: 'none', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>
                        Load route
                      </button>
                    )}
                    {stops.length > 0 && (
                      <button onClick={() => { if (batchDay === day) exitBatch(); else { setBatchDay(day); setSelected(new Set()); } }}
                        style={{ fontSize: 13, fontWeight: 700, color: batchDay === day ? '#fff' : C.green, background: batchDay === day ? C.green : C.greenBg, border: 'none', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>
                        {batchDay === day ? 'Cancel' : 'Select'}
                      </button>
                    )}
                  </div>

                  {/* Batch header line */}
                  {batchDay === day && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 16px 8px' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{selected.size} selected on {day}</span>
                      <button onClick={() => setSelected(new Set(stops.filter((c) => stopInfo(c).status.kind === 'late').map((c) => c.id)))}
                        style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        Select all late on {day.slice(0, 3)}
                      </button>
                    </div>
                  )}

                  {/* Stop rows */}
                  {renderStops.map((cust, i) => (
                    <StopRow
                      key={cust.id} cust={cust} index={i + 1} mode={activeMode} C={C}
                      info={stopInfo(cust)} snoozed={isSnoozed(cust, now)}
                      batch={batchDay === day} selected={selected.has(cust.id)}
                      dragging={reorder && reorder.draggingId === cust.id}
                      rowRef={(el) => { if (el) rowRefs.current[cust.id] = el; }}
                      onTap={() => { if (batchDay === day) toggleSelect(cust.id); else setMoveSheet({ cust }); }}
                      onDragStart={() => setReorder({ day, ids: allStops.map((c) => c.id), draggingId: cust.id })}
                    />
                  ))}

                  {/* Add stop */}
                  {batchDay !== day && (
                    <button onClick={() => setAddSheet({ day })}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', border: 'none', borderTop: `1px solid ${C.line2}`, background: 'transparent', color: C.green, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                      <Plus size={17} strokeWidth={2.4} /> Add stop to {day}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Move sheet */}
      {moveSheet && (
        <Portal><MoveSheet
          cust={moveSheet.cust} mode={activeMode} C={C} info={stopInfo(moveSheet.cust)} dates={dates}
          projectedMins={projectedMins} onClose={() => setMoveSheet(null)}
          onMove={async (day) => { await moveOne(moveSheet.cust, day); setMoveSheet(null); }}
          onSnooze={async () => { await snoozeOne(moveSheet.cust); setMoveSheet(null); }}
          onRemove={async () => { await removeOne(moveSheet.cust); setMoveSheet(null); }}
        /></Portal>
      )}

      {/* Add sheet */}
      {addSheet && (
        <Portal><AddSheet
          day={addSheet.day} C={C} candidates={[...dayStops.unscheduled, ...eligible.filter((c) => c.preferredDay && c.preferredDay !== addSheet.day)]}
          onClose={() => setAddSheet(null)}
          onPick={async (cust) => { await moveOne(cust, addSheet.day); setOpenDay(addSheet.day); setAddSheet(null); }}
        /></Portal>
      )}

      {/* Batch tray */}
      {batchDay && selected.size > 0 && (
        <Portal><div style={{ position: 'fixed', left: 0, right: 0, bottom: 74, zIndex: 500, maxWidth: 640, margin: '0 auto', background: C.bg, borderTop: `1px solid ${C.line}`, padding: '10px 12px 12px', boxShadow: '0 -6px 18px rgba(0,0,0,.14)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, marginBottom: 8 }}>MOVE {selected.size} TO</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginBottom: 10 }}>
            {DAY_NAMES.map((d) => {
              const here = d === batchDay;
              const custs = [...selected].map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
              const mins = here ? 0 : projectedMins(d, custs);
              const over = mins > LONG_DAY_MINS;
              const color = here ? C.faint : over ? C.lateChipText : C.green;
              return (
                <button key={d} disabled={here} onClick={() => batchMove(d)}
                  style={{ border: 'none', borderRadius: 8, padding: '8px 0', cursor: here ? 'default' : 'pointer', background: here ? C.neutralChip : over ? C.lateChipBg : C.greenBg, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color }}>{DAY_LETTERS[d]}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{here ? 'here' : fmtHrs(mins)}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={batchSnooze} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '12px', background: C.neutralChip, color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Snooze all 1 week</button>
            <button onClick={batchRemove} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '12px', background: C.removeBg, color: C.removeText, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Remove all</button>
          </div>
        </div></Portal>
      )}

      {/* Undo toast */}
      {toast && (
        <Portal><div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 88, zIndex: 600, background: C.toastBg, borderRadius: 8, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 8px 24px rgba(0,0,0,.3)', maxWidth: '92vw' }}>
          <span style={{ fontSize: 13.5, color: '#fff' }}>{toast.msg}</span>
          <button onClick={undo} style={{ border: 'none', background: 'transparent', color: C.toastUndo, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Undo</button>
        </div></Portal>
      )}
    </div>
  );
}

// Render children into <body> so bottom sheets/toasts escape the page's
// transformed container (which would otherwise trap position:fixed).
function Portal({ children }) {
  return createPortal(children, document.body);
}

/* ── Stop row ──────────────────────────────────────────────────────────────── */
function StopRow({ cust, index, mode, C, info, snoozed, batch, selected, dragging, rowRef, onTap, onDragStart }) {
  const { lastDate, lastDays, lastWasSkip, status } = info;
  // Honest verb: a cycle-skip anchors the clock but wasn't a mow.
  const verb = lastWasSkip ? 'Skipped' : mode === 'fertilizer' ? 'Treated' : 'Mowed';
  const mowColor = status.kind === 'late' ? C.late : status.kind === 'due' ? C.due : C.ink;
  const mowWeight = status.kind === 'late' || status.kind === 'due' ? 700 : 500;
  const mowText = lastDays == null ? 'Never serviced'
    : lastDays === 0 ? `${verb} today`
    : `${verb} ${new Date(lastDate).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${lastDays}d ago`;

  return (
    <div ref={rowRef} onClick={onTap}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px 11px 16px', minHeight: 48,
        cursor: 'pointer', background: dragging ? C.dragBg : C.bg, opacity: snoozed ? 0.6 : 1,
        borderBottom: `1px solid ${C.line}`,
        boxShadow: dragging ? '0 4px 14px rgba(0,0,0,.12)' : 'none',
      }}>
      {batch ? (
        <div style={{ width: 21, height: 21, borderRadius: '50%', flex: '0 0 auto', border: `2px solid ${selected ? C.green : '#C4CEC8'}`, background: selected ? C.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {selected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>}
        </div>
      ) : (
        <div style={{ width: 20, textAlign: 'right', fontSize: 13, fontWeight: 800, color: C.idx, flex: '0 0 auto' }}>{index}</div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust.name}</div>
        <div style={{ fontSize: 13, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust.address || 'No address'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          {snoozed
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13.5, fontWeight: 700, color: C.due }}><Moon size={13} /> Snoozed until {new Date(cust.snoozedUntil).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            : <><Calendar size={13} color={mowColor} strokeWidth={2.2} /><span style={{ fontSize: 13.5, fontWeight: mowWeight, color: mowColor }}>{mowText}</span></>}
        </div>
      </div>

      {!snoozed && (status.kind === 'late' || status.kind === 'due' || status.kind === 'new') && (
        <div style={{ background: status.kind === 'late' ? C.late : C.due, borderRadius: 7, padding: '6px 9px', textAlign: 'center', flex: '0 0 auto' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.05 }}>
            {status.kind === 'late' ? `+${status.excess}d` : status.kind === 'due' ? 'today' : 'new'}
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: '#fff' }}>
            {status.kind === 'late' ? 'LATE' : status.kind === 'due' ? 'DUE' : 'NEW'}
          </div>
        </div>
      )}

      {!batch && (
        <div onPointerDown={(e) => { e.stopPropagation(); onDragStart(); }} onClick={(e) => e.stopPropagation()}
          style={{ flex: '0 0 auto', color: C.handle, display: 'flex', touchAction: 'none', cursor: 'grab', padding: 2 }}>
          <GripVertical size={18} strokeWidth={2} />
        </div>
      )}
    </div>
  );
}

/* ── Move sheet ──────────────────────────────────────────────────────────── */
function StatusPair({ status, C }) {
  if (status.kind !== 'late' && status.kind !== 'due' && status.kind !== 'new') return null;
  return (
    <div style={{ background: status.kind === 'late' ? C.late : C.due, borderRadius: 7, padding: '6px 9px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.05 }}>{status.kind === 'late' ? `+${status.excess}d` : status.kind === 'due' ? 'today' : 'new'}</div>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: '#fff' }}>{status.kind === 'late' ? 'LATE' : status.kind === 'due' ? 'DUE' : 'NEW'}</div>
    </div>
  );
}

function MoveSheet({ cust, C, info, dates, projectedMins, onClose, onMove, onSnooze, onRemove }) {
  const cur = cust.preferredDay || '';
  return (
    <>
      <div onClick={onClose} style={sheetBackdrop} />
      <div style={sheetStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{cust.name}</div>
            <div style={{ fontSize: 13.5, color: C.dim, marginTop: 2 }}>{cust.address || 'No address'}</div>
          </div>
          <StatusPair status={info.status} C={C} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: C.faint }}>MOVE TO</span>
          <span style={{ fontSize: 12, color: C.faint }}>hours after move</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
          {DAY_NAMES.map((d) => {
            const here = d === cur;
            const mins = here ? 0 : projectedMins(d, [cust]);
            const over = mins > LONG_DAY_MINS;
            return (
              <button key={d} disabled={here} onClick={() => onMove(d)}
                style={{
                  border: 'none', borderRadius: 8, padding: '9px 0', cursor: here ? 'default' : 'pointer',
                  background: here ? C.neutralChip : over ? C.lateChipBg : C.greenBg2,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: here ? C.faint : over ? C.lateChipText : C.green }}>{DAY_LETTERS[d]}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: here ? C.faint : over ? C.lateChipText : C.green }}>{here ? 'here' : fmtHrs(mins)}</span>
              </button>
            );
          })}
        </div>

        {/* The exact landing position ("stop N of M") shows in the toast after
            the move — a single static preview here could only describe one day
            and read as if it applied to whichever chip got tapped. */}
        <div style={{ fontSize: 13, color: C.dim, margin: '12px 2px 16px' }}>
          Tap a day — the stop drops in at the nearest point on that day&apos;s route.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onSnooze} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '13px', background: C.neutralChip, color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Snooze 1 week</button>
          <button onClick={onRemove} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '13px', background: C.removeBg, color: C.removeText, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
        </div>
      </div>
    </>
  );
}

/* ── Add sheet ───────────────────────────────────────────────────────────── */
function AddSheet({ day, C, candidates, onClose, onPick }) {
  const [q, setQ] = useState('');
  const list = candidates.filter((c) => !q.trim() || (c.name || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div onClick={onClose} style={sheetBackdrop} />
      <div style={{ ...sheetStyle, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Add a stop to {day}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…"
          style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 12px', fontSize: 15, marginBottom: 10, outline: 'none' }} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {list.length === 0 && <div style={{ color: C.dim, fontSize: 14, padding: '12px 4px' }}>No clients found.</div>}
          {list.map((c) => (
            <button key={c.id} onClick={() => onPick(c)}
              style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${C.line2}`, background: 'transparent', padding: '12px 4px', cursor: 'pointer' }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{c.name}</div>
              <div style={{ fontSize: 12.5, color: C.dim }}>{c.address || 'No address'}{c.preferredDay ? ` · now on ${c.preferredDay.slice(0, 3)}` : ' · unscheduled'}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const sheetBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100 };
const sheetStyle = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 101,
  background: '#fff', borderRadius: '16px 16px 0 0', padding: '18px 18px 24px',
  boxShadow: '0 -10px 30px rgba(0,0,0,.2)', maxWidth: 640, margin: '0 auto',
};
