import "fake-indexeddb/auto";
import Dexie from "dexie";
import crypto from "crypto";

(async () => {
  const db = new Dexie("LawnRouteDB");
  db.version(2).stores({
    customers: '++id, name, address'
  });

  const newCustomer = {
    name: "Test Field Add",
    address: 'Added from field', 
    phone: '',
    email: '',
    propertyNotes: '',
    geofence: [
      { lat: 30.0001, lng: -90.0001 },
      { lat: 30.0001, lng: -89.9999 },
      { lat: 29.9999, lng: -89.9999 },
      { lat: 29.9999, lng: -90.0001 }
    ],
    services: [
      { id: crypto.randomUUID(), name: 'Mowing', price: 40, active: true },
    ],
    createdAt: Date.now()
  };

  const id = await db.customers.add(newCustomer);
  
  const dataToSave = {
    name: "Test Field Add Updated",
    address: 'Added from field', 
    phone: '',
    email: '',
    propertyNotes: '',
    geofence: newCustomer.geofence,
    services: newCustomer.services,
    lawnSize: '',
    obstacleCount: '',
    terrain: 'flat',
    fencedBackyard: false,
    serviceInterval: 7,
    mowingInterval: 7,
    fertilizerInterval: 30,
    fertilizerRounds: 6,
    specialApplications: ''
  };

  try {
    const res = await db.customers.update(Number(id), dataToSave);
    console.log("Update returned:", res);
    const updated = await db.customers.get(id);
    console.log("Updated name:", updated.name);
  } catch (e) {
    console.error("Update failed:", e.message);
  }
})();
