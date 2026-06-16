import re

def patch():
    with open('src/pages/LiveMap.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update logVisit signature
    content = content.replace(
        "const logVisit = async (customer, durationSecs, entryTime, status, note = '', overrideDriveTimeSecs = null) => {",
        "const logVisit = async (customer, durationSecs, entryTime, status, note = '', overrideDriveTimeSecs = null, overrideDriveSource = null) => {"
    )

    # 2. Update logVisit internal calculation
    old_calc = """    // Calculate Drive Time - use the accumulated drive timer (respects pause for lunch etc.)
    // If the drive timer was running, capture the final value; otherwise use accumulated
    let driveTimeSecs = overrideDriveTimeSecs !== null ? overrideDriveTimeSecs : Math.floor(
      isDrivingPausedRef.current
        ? accumulatedDriveTimeRef.current
        : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
    );"""
    
    new_calc = """    // Calculate Drive Time
    let driveTimeSecs = 0;
    let driveTimeSource = 'unknown';

    if (overrideDriveTimeSecs !== null) {
      driveTimeSecs = overrideDriveTimeSecs;
      driveTimeSource = overrideDriveSource || 'override';
    } else {
      driveTimeSecs = Math.floor(
        isDrivingPausedRef.current
          ? accumulatedDriveTimeRef.current
          : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
      );
      driveTimeSource = isDrivingPausedRef.current ? 'live_timer_paused' : 'live_timer_running';
    }"""
    
    content = content.replace(old_calc, new_calc)

    # 3. Update db.visits.add call
    content = content.replace(
        "driveTimeSecs: driveTimeSecs || 0,",
        "driveTimeSecs: driveTimeSecs || 0,\n        driveTimeSource: driveTimeSource,"
    )

    # 4. Update logVisit usages
    content = content.replace(
        "logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, 'skipped', '', drivebyPrompt.driveTime);",
        "logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, 'skipped', '', drivebyPrompt.driveTime, 'geofence_entry_snapshot');"
    )
    content = content.replace(
        "logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNoteRef.current, capturedDriveTimeSecsRef.current);",
        "logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNoteRef.current, capturedDriveTimeSecsRef.current, 'geofence_entry_snapshot');"
    )
    content = content.replace(
        "logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNote);",
        "logVisit(completedCust, finalDuration, jobStartRef.current, 'completed', liveNote, null, 'manual_finish');"
    )
    content = content.replace(
        "logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, status, '', drivebyPrompt.driveTime);",
        "logVisit(drivebyPrompt.customer, drivebyPrompt.duration, drivebyPrompt.entry, status, '', drivebyPrompt.driveTime, 'geofence_entry_snapshot');"
    )
    content = content.replace(
        "await logVisit(cust, 0, Date.now(), 'skipped');",
        "await logVisit(cust, 0, Date.now(), 'skipped', '', null, 'manual_skip');"
    )

    # 5. Update TimeSplitModal companion DB add
    content = content.replace(
        "driveTimeSecs: 0,\n        entryTime: companionEntryTime,",
        "driveTimeSecs: 0,\n        driveTimeSource: 'companion_split',\n        entryTime: companionEntryTime,"
    )

    with open('src/pages/LiveMap.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

patch()
