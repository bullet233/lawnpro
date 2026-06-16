import re

def fix_drive_timer():
    with open('src/pages/LiveMap.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix logVisit drive timer reset
    content = re.sub(
        r"      // Reset drive timer\s+accumulatedDriveTimeRef\.current = 0;\s+lastDriveResumeTimeRef\.current = Date\.now\(\);\s+setDrivingDuration\(0\);\s+if \(hasMoreStops\) \{\s+// AUTO-START for the next job\s+isDrivingPausedRef\.current = false;\s+setIsDrivingPaused\(false\);\s+saveDriveTimerState\(false, 0\);\s+\} else \{\s+// Route complete or manual job: PAUSE the drive timer\s+isDrivingPausedRef\.current = true;\s+setIsDrivingPaused\(true\);\s+saveDriveTimerState\(true, 0\);\s+\}",
        r"      // Reset drive timer\n      resetDriveTimer(hasMoreStops);",
        content
    )

    # Fix start route button
    content = re.sub(
        r"                      // Tie the driving timer explicitly to this Start Route action!\s+accumulatedDriveTimeRef\.current = 0;\s+lastDriveResumeTimeRef\.current = Date\.now\(\);\s+isDrivingPausedRef\.current = false;\s+setIsDrivingPaused\(false\);\s+saveDriveTimerState\(false, 0\);",
        r"                      // Tie the driving timer explicitly to this Start Route action!\n                      resetDriveTimer(true);",
        content
    )

    # Fix first pause/resume button (Start Driving)
    content = re.sub(
        r"                               e\.stopPropagation\(\);\s+lastDriveResumeTimeRef\.current = Date\.now\(\);\s+isDrivingPausedRef\.current = false;\s+setIsDrivingPaused\(false\);\s+saveDriveTimerState\(false, accumulatedDriveTimeRef\.current\);",
        r"                               e.stopPropagation();\n                               toggleDrivePause();",
        content
    )

    # Fix second pause/resume button (Toggle)
    content = re.sub(
        r"                               e\.stopPropagation\(\);\s+if \(isDrivingPausedRef\.current\) \{\s+// Resume\s+lastDriveResumeTimeRef\.current = Date\.now\(\);\s+isDrivingPausedRef\.current = false;\s+setIsDrivingPaused\(false\);\s+saveDriveTimerState\(false, accumulatedDriveTimeRef\.current\);\s+\} else \{\s+// Pause\s+accumulatedDriveTimeRef\.current \+= \(Date\.now\(\) - lastDriveResumeTimeRef\.current\) / 1000;\s+isDrivingPausedRef\.current = true;\s+setIsDrivingPaused\(true\);\s+saveDriveTimerState\(true, accumulatedDriveTimeRef\.current\);\s+\}",
        r"                               e.stopPropagation();\n                               toggleDrivePause();",
        content
    )
    
    # Catch any leftover setIsDrivingPaused in the file (just in case)
    content = re.sub(r"setIsDrivingPaused\(false\);", "/* setIsDrivingPaused removed */", content)

    with open('src/pages/LiveMap.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

fix_drive_timer()
