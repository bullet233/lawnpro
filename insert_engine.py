import re

def insert_engine():
    with open('src/pages/LiveMapRefactored.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    engine_init = """
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new GeofenceEngine({
      onEnter: (customer) => {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        
        // Capture drive time right when entering the geofence
        capturedDriveTimeSecsRef.current = getFinalDriveTimeSecs();
        resetDriveTimer(true); // reset and start new job timer implicitly? No, reset and stop.
        // Wait, drive timer gets stopped later by startTimer, let's just reset it.
        resetDriveTimer(false);

        startTimer(Date.now());
        activeGeofenceIdRef.current = customer.id;
        setActiveGeofence(customer);
        setPendingArrival(null);
        dismissedOpportunitiesRef.current.clear();
      },
      onPendingEnter: (customer, secondsLeft) => {
        if (customer) {
          setPendingArrival({ name: customer.name, secondsLeft });
        } else {
          setPendingArrival(null);
        }
      },
      onExit: (customer, durationSecs) => {
        handleExitGeofence();
      },
      onDriveBy: (customer, durationSecs) => {
        setDrivebyPrompt({
          customer,
          duration: durationSecs,
          entry: jobStartRef.current,
          driveTime: capturedDriveTimeSecsRef.current
        });
      },
      onOpportunityFound: (customer) => {
        setNearbyOpportunity(customer);
      }
    });
  }

  // Push context to GeofenceEngine whenever route or location updates
  useEffect(() => {
    if (engineRef.current && position) {
      engineRef.current.setContext({
        routeStops: activeRouteRef.current?.expandedStops || [],
        allCustomers: allCustomersRef.current,
        routeVisits: routeVisitsRef.current,
        dismissedOpportunities: dismissedOpportunitiesRef.current,
        anchorGeofence: anchorGeofenceRef.current,
        isJobPaused: timerStateRef.current === 'paused'
      });
      engineRef.current.updateLocation({
        lat: position.lat,
        lng: position.lng,
        accuracy: accuracy
      });
    }
  }, [position, accuracy]);
"""
    content = content.replace("useEffect(() => { panelNoteRef.current = panelNote; }, [panelNote]);", "useEffect(() => { panelNoteRef.current = panelNote; }, [panelNote]);\n" + engine_init)

    with open('src/pages/LiveMapRefactored.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

insert_engine()
