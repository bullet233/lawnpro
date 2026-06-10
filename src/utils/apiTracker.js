import { db } from '../db/db';

export const API_PRICES = {
  mapLoad: 0.007,
  geocode: 0.005,
  autocomplete: 0.017,
  distanceMatrix: 0.005
};

export const trackApiCall = async (type) => {
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  try {
    const stats = await db.apiStats.get(date) || { 
      date, 
      mapLoads: 0, 
      geocodes: 0, 
      autocomplete: 0,
      distanceMatrix: 0
    };
    
    if (type === 'mapLoad') stats.mapLoads++;
    else if (type === 'geocode') stats.geocodes++;
    else if (type === 'autocomplete') stats.autocomplete++;
    else if (type === 'distanceMatrix') stats.distanceMatrix = (stats.distanceMatrix || 0) + 1;
    
    await db.apiStats.put(stats);
  } catch (e) {
    console.error('API Tracking failed', e);
  }
};
