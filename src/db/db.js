import Dexie from 'dexie';

export const db = new Dexie('LawnRouteTrackerDB');

db.version(1).stores({
  customers: '++id, name, address',
  routes: '++id, date, status',
  visits: '++id, routeId, customerId, status'
});

// v2: index isTemplate on routes to support template queries
db.version(2).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate',
  visits: '++id, routeId, customerId, status'
});

// v3: index exitTime on visits so DayReviewModal can query today's jobs by date range
db.version(3).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate',
  visits: '++id, routeId, customerId, status, exitTime'
});

// v4: apiStats to track Google Maps cost
db.version(4).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate',
  visits: '++id, routeId, customerId, status, exitTime',
  apiStats: 'date'
});

// v5: fuelLogs to track daily fuel costs
db.version(5).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate',
  visits: '++id, routeId, customerId, status, exitTime',
  apiStats: 'date',
  fuelLogs: 'date'
});

// v6: pendingSync index for fuelLogs offline mileage sync
db.version(6).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate',
  visits: '++id, routeId, customerId, status, exitTime',
  apiStats: 'date',
  fuelLogs: 'date, pendingSync'
});

// v7: division index to separate mowing and fertilizer modes
db.version(7).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate, division',
  visits: '++id, routeId, customerId, status, exitTime, division',
  apiStats: 'date',
  fuelLogs: 'date, pendingSync'
});

// v8: first-class Treatment domain.
//   - treatmentPrograms: reusable seasonal step programs (template definitions)
//   - treatments: one record per chemical/fertilizer application, decoupled from mow visits.
// Back-fill: every existing visit.complianceLog becomes a completed treatment record so
// legally-required application history is preserved. The original visit.complianceLog is
// left in place (read-only) until the Phase 3 cleanup.
db.version(8).stores({
  customers: '++id, name, address',
  routes: '++id, date, status, isTemplate, division',
  visits: '++id, routeId, customerId, status, exitTime, division',
  apiStats: 'date',
  fuelLogs: 'date, pendingSync',
  treatmentPrograms: '++id, name',
  treatments: '++id, customerId, programId, status, dueDate, completedAt'
}).upgrade(async (tx) => {
  const visits = await tx.table('visits').toArray();
  const toCreate = [];
  for (const v of visits) {
    if (!v.complianceLog) continue;
    toCreate.push({
      customerId: v.customerId,
      sourceVisitId: v.id,
      programId: null,
      stepId: null,
      stepName: 'Migrated application',
      category: null,
      year: v.exitTime ? new Date(v.exitTime).getFullYear() : null,
      status: 'completed',
      dueDate: v.exitTime || null,
      dueWindowStart: null,
      dueWindowEnd: null,
      completedAt: v.exitTime || Date.now(),
      price: 0,
      durationSecs: v.durationSecs || 0,
      weather: v.weather || null,
      complianceLog: v.complianceLog,
      note: v.note || '',
      migratedFrom: 'visit'
    });
  }
  if (toCreate.length) await tx.table('treatments').bulkAdd(toCreate);
});
