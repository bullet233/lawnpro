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
