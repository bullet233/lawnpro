export function parseLawnSizeToSqFt(inputStr) {
  if (!inputStr) return null;
  const str = inputStr.toLowerCase().trim().replace(/,/g, '');
  
  // Extract the first number found (handling decimals)
  const match = str.match(/[\d.]+/);
  if (!match) return null;
  
  let val = parseFloat(match[0]);
  if (isNaN(val)) return null;

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
