export function getVisitRevenueBreakdown(visit, customer, defaultServices) {
  if (visit.revenueBreakdown) return visit.revenueBreakdown;
  
  const breakdown = {};
  
  if (!visit.priceEarned) return breakdown;
  
  if (!visit.appliedServices || visit.appliedServices.length === 0) {
    breakdown['s1'] = visit.priceEarned; // Fallback to mowing if missing
    return breakdown;
  }
  
  if (visit.appliedServices.length === 1) {
    breakdown[visit.appliedServices[0]] = visit.priceEarned;
    return breakdown;
  }
  
  // Try to reconstruct based on current prices
  let sum = 0;
  const temp = {};
  visit.appliedServices.forEach(sId => {
     const s = customer?.services?.find(x => x.id === sId) || defaultServices?.find(x => x.id === sId);
     const price = s?.price || 0;
     temp[sId] = price;
     sum += price;
  });
  
  // If the historical sum matches the priceEarned exactly, we successfully reverse-engineered it
  if (sum === visit.priceEarned && sum > 0) {
     return temp;
  }
  
  // If there's a mismatch (because they changed prices but didn't update past visits),
  // dump all revenue into the primary service to guarantee the total math is correct.
  breakdown[visit.appliedServices[0]] = visit.priceEarned;
  return breakdown;
}

export function calculateServiceTotals(visits, customers, defaultServices) {
  const totals = {};
  
  visits.forEach(v => {
    if (v.status === 'skipped') return;
    const cust = customers.find(c => c.id === v.customerId);
    const breakdown = getVisitRevenueBreakdown(v, cust, defaultServices);
    
    Object.entries(breakdown).forEach(([sId, amount]) => {
      if (!totals[sId]) totals[sId] = 0;
      totals[sId] += amount;
    });
  });
  
  return totals;
}
