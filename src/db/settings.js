const SETTINGS_KEY = 'lawn_route_tracker_settings';

const DEFAULT_SETTINGS = {
  targetHourlyRate: 60,
  rateUnderpaidThreshold: 45,
  minStopFee: 30,
  drivebyThresholdSecs: 45,
  leafHourlyRate: 0,   // $/hr billed for leaf time on a leaf job (0 = not priced)
  leafButtons: 'auto', // 'auto' (Oct 1 – Dec 1) | 'show' | 'hide' — see utils/leaves
  costOfGas: 3.50,
  truckMpg: 7,
  mowerGph: 1.0,
  businessName: '',
  businessAddress: '',
  businessPhone: '',
  businessEmail: '',
  businessLogo: '',
  applicatorName: '',
  licenseNumber: '',
  chemicalInventory: []
};

export function getSettings() {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to load settings', err);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(newSettings) {
  try {
    const current = getSettings();
    const updated = { ...current, ...newSettings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to save settings', err);
    return getSettings();
  }
}
