export function parseLawnSizeToSqFt(inputStr) {
  if (inputStr === null || inputStr === undefined || inputStr === '') return null;
  if (typeof inputStr === 'number') return Math.round(inputStr);

  const str = inputStr.toString().toLowerCase().trim().replace(/,/g, '');
  
  // Extract the first number or fraction found (e.g. 1/4, 0.5, 1)
  const match = str.match(/[\d.]+(?:\/[\d.]+)?/);
  if (!match) return null;
  
  let val = 0;
  if (match[0].includes('/')) {
    const parts = match[0].split('/');
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (den === 0 || isNaN(num) || isNaN(den)) return null;
    val = num / den;
  } else {
    val = parseFloat(match[0]);
    if (isNaN(val)) return null;
  }

  // Check for 'k' suffix for thousands
  if (str.includes('k')) {
    val = val * 1000;
  }

  // Check for acres
  if (str.includes('acre') || str.includes('ac')) {
    return Math.round(val * 43560);
  }
  
  // Assume sq ft otherwise
  return Math.round(val);
}
