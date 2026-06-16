import re

with open('src/pages/LiveMap.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import
if 'import { GeofenceEngine }' not in content:
    content = content.replace("import { db } from '../db/db';", "import { db } from '../db/db';\nimport { GeofenceEngine } from '../engine/GeofenceEngine';")

# 2. Add Engine Instantiation
engine_code = """
  // --- GEOFENCE TRACKING ENGINE ---
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new GeofenceEngine({
      enterDebounceMs: 8000,
      exitDebounceMs: 15000,
      drivebyThresholdSecs: getSettings().drivebyThresholdSecs || 45,
      onEnter: (customer) => {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        startTimer();
        activeGeofenceIdRef.current = customer.id;
        setActiveGeofence(customer);
        setPendingArrival(null);
      },
      onPendingEnter: (customer, remainingSecs) => {
        if (!customer) {
          setPendingArrival(null);
        } else {
          setPendingArrival({ name: customer.name, secondsLeft: remainingSecs });
        }
      },
      onExit: (customer, durationSecs) => {
        // The engine calls this, but we can just use our existing handleExitGeofence
        handleExitGeofence();
      },
      onDriveBy: (customer, durationSecs) => {
        // In our current setup, handleExitGeofence handles driveby detection internally.
        // We just call it.
        handleExitGeofence();
      },
      onOpportunityFound: (customer) => {
        if (customer) {
          setNearbyOpportunity(customer);
        } else {
          setNearbyOpportunity(null);
        }
      }
    });
  }

  // Update engine context
  useEffect(() => {
    if (engineRef.current && activeRoute) {
      engineRef.current.setContext({
        routeStops: activeRoute.expandedStops || [],
        allCustomers: allCustomers || [],
        routeVisits: routeVisits || [],
        dismissedOpportunities: dismissedOpportunitiesRef.current,
        anchorGeofence: anchorGeofenceRef.current,
        isJobPaused: timerState === 'paused'
      });
    }
  }, [activeRoute, allCustomers, routeVisits, timerState]);

  // Feed position to engine
  useEffect(() => {
    if (!activeRoute || !position) return;
    engineRef.current.updateLocation({
      lat: position.lat,
      lng: position.lng,
      accuracy: accuracy,
      timestamp: Date.now()
    });
  }, [position, activeRoute, accuracy]);
"""

if 'const engineRef = useRef(null);' not in content:
    # insert before handleExitGeofence
    content = content.replace("const handleExitGeofence = () => {", engine_code + "\n  const handleExitGeofence = () => {")

with open('src/pages/LiveMap.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
