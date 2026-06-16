import re

def refactor_livemap():
    with open('src/pages/LiveMap.jsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add imports
    new_imports = """
import { useGeolocation } from '../hooks/useGeolocation';
import { useWeatherTracker } from '../hooks/useWeatherTracker';
import { useWakeLock } from '../hooks/useWakeLock';
import { useDriveTimer } from '../hooks/useDriveTimer';
import { useJobTimer } from '../hooks/useJobTimer';
import JobCompletionModal from '../components/livemap/JobCompletionModal';
import DrivebyPromptModal from '../components/livemap/DrivebyPromptModal';
import RouteListPanel from '../components/livemap/RouteListPanel';
import LiveTimerPanel from '../components/livemap/LiveTimerPanel';
import PendingArrivalAlert from '../components/livemap/PendingArrivalAlert';
"""
    # Just inject them after the react import
    content = re.sub(r"import \{ useState, useEffect, useRef, useMemo \} from 'react';\n", "import { useState, useEffect, useRef, useMemo } from 'react';\n" + new_imports, content)

    # 2. Inject hooks into the component
    hook_injections = """
  const { position, positionRef, speed, heading, poorGps, accuracy } = useGeolocation();
  const { weather, weatherRef } = useWeatherTracker(positionRef);
  
  const { 
    isDrivingPaused, drivingDuration, togglePause: toggleDrivePause, 
    resetTimer: resetDriveTimer, getFinalDriveTimeSecs,
    isDrivingPausedRef, accumulatedDriveTimeRef, lastDriveResumeTimeRef 
  } = useDriveTimer();

  const {
    timerState, liveDuration, startTimer, pauseTimer, resumeTimer, toggleTimer, resetTimer: resetJobTimer,
    getFinalDurationSecs, jobStartRef, accumulatedTimeRef, lastResumeTimeRef, timerStateRef
  } = useJobTimer();

  useWakeLock(activeRoute?.status === 'active');

  const currentPosition = position; // backwards compatibility alias
  const latestLocRef = positionRef; // backwards compatibility alias
"""
    content = re.sub(r"(export default function LiveMap\(\) \{[\s\S]*?const navigate = useNavigate\(\);\n)", r"\1" + hook_injections, content)

    # 3. Strip state variables
    state_removals = [
        r"const \[timerState, setTimerState\] = useState\('idle'\);.*?// 'idle', 'running', 'paused'\n",
        r"const \[liveDuration, setLiveDuration\] = useState\(0\);\n",
        r"const \[speed, setSpeed\] = useState\(0\);\n",
        r"const \[heading, setHeading\] = useState\(0\);\n",
        r"const \[isDrivingPaused, setIsDrivingPaused\] = useState\(true\);\n",
        r"const \[drivingDuration, setDrivingDuration\] = useState\(0\);\n",
        r"const \[poorGps, setPoorGps\] = useState\(false\);\n",
        r"const \[weather, setWeather\] = useState\(null\);\n",
        r"const jobStartRef = useRef\(null\);\n",
        r"const accumulatedTimeRef = useRef\(0\);\n",
        r"const lastResumeTimeRef = useRef\(null\);\n",
        r"const timerStateRef = useRef\('idle'\);\n",
        r"const isDrivingPausedRef = useRef\(true\);\n",
        r"const accumulatedDriveTimeRef = useRef\(0\);\n",
        r"const lastDriveResumeTimeRef = useRef\(Date\.now\(\)\);\n",
        r"const latestLocRef = useRef\(null\);\n",
        r"const poorGpsRef = useRef\(false\);\n",
        r"const weatherRef\s*=\s*useRef\(null\);\n",
        r"const weatherTimerRef\s*=\s*useRef\(null\);\n",
        r"const \[currentPosition, setCurrentPosition\] = useState\(null\);\n"
    ]
    for pattern in state_removals:
        content = re.sub(pattern, "", content)

    # 4. Strip the giant `useEffect` block and `fetchWeather`
    content = re.sub(r"// 2\. Real-Time Weather Logging[\s\S]*?// 4\. Job Timers & Driveby Detection", "// 4. Job Timers & Driveby Detection", content)

    # 5. Strip saveDriveTimerState
    content = re.sub(r"const saveDriveTimerState = \([\s\S]*?\}, \[\]\);\n", "", content)

    # 6. Strip Wake Lock effect
    content = re.sub(r"// \?\? Wake Lock[\s\S]*?useWakeLock\(!!activeRoute\);\n", "", content)

    # 7. JSX replacements from refactor_livemap_jsx.py
    # PendingArrivalAlert
    content = re.sub(
        r"\{pendingArrival && \([\s\S]*?secondsLeft\}s\n\s*<\/div>\n\s*<\/div>\n\s*<\/div>\n\s*\)\}",
        r"<PendingArrivalAlert pendingArrival={pendingArrival} />",
        content
    )

    # JobCompletionModal
    content = re.sub(
        r"\{completionPanel && \([\s\S]*?\{/\* Top Panel: Current or Next Job Info \*/\}",
        r"""
      <JobCompletionModal 
        completionPanel={completionPanel}
        panelNote={panelNote}
        setPanelNote={setPanelNote}
        panelNoteActiveRef={panelNoteActiveRef}
        completionTimerRef={completionTimerRef}
        setCompletionPanel={setCompletionPanel}
        setTimeSplit={setTimeSplit}
        setIsEditJobOpen={setIsEditJobOpen}
        setActiveEpaJob={setActiveEpaJob}
        handleSaveNote={handleSaveNote}
      />

      {isEditJobOpen && completionPanel && (
        <EditJobModal 
          completionPanel={completionPanel}
          onSave={handleSaveEditedJob}
          onClose={() => setIsEditJobOpen(false)}
        />
      )}

      {/* Top Panel: Current or Next Job Info */}""",
        content
    )

    # LiveTimerPanel
    content = re.sub(
        r"\{activeGeofence \? \([\s\S]*?<SlideToFinish onComplete=\{handleManualDone\} \/>\n\s*<\/div>\n\s*\) : \(",
        r"""{activeGeofence ? (
          <LiveTimerPanel 
            activeGeofence={activeGeofence}
            timerState={timerState}
            liveDuration={liveDuration}
            weather={weather}
            liveNote={liveNote}
            setShowLiveNoteModal={setShowLiveNoteModal}
            setDialog={setDialog}
            togglePause={togglePause}
            handleManualDone={handleManualDone}
            onCancelJob={() => {
              activeGeofenceIdRef.current = null;
              setActiveGeofence(null);
              anchorGeofenceRef.current = null;
              setTimerState('idle');
              setLiveNote('');
            }}
          />
        ) : (""",
        content
    )

    # DrivebyPromptModal
    content = re.sub(
        r"\{drivebyPrompt && \([\s\S]*?Ignore \(GPS Bounce\)\n\s*<\/button>\n\s*<\/div>\n\s*<\/div>\n\s*<\/div>\n\s*\)\}",
        r"""<DrivebyPromptModal drivebyPrompt={drivebyPrompt} handleDrivebyResolution={handleDrivebyResolution} />""",
        content
    )

    # RouteListPanel
    content = re.sub(
        r"\{/\* Bottom Panel \(Native-style Bottom Sheet\) \*/\}[\s\S]*?\{/\* Recenter Button if autoCenter is disabled \*/\}",
        r"""<RouteListPanel 
        activeRoute={activeRoute}
        allVisits={allVisits}
        getStopStatus={getStopStatus}
        handleSkipStop={handleSkipStop}
        isRouteListOpen={isRouteListOpen}
        setIsRouteListOpen={setIsRouteListOpen}
        progressInfo={progressInfo}
        onStartJob={(stop) => {
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          activeGeofenceIdRef.current = stop.id;
          anchorGeofenceRef.current = position ? { lat: position.lat, lng: position.lng } : 'no-gps';
          setActiveGeofence(stop);
          setIsRouteListOpen(false);
          startTimer();
          
          // Inform Engine
          if (engineRef.current) {
            engineRef.current.manualStartJob(stop);
          }
        }}
        onForceEndRoute={() => {
          setDialog({
            type: 'warning',
            title: 'End Active Route?',
            message: 'Are you sure you want to forcibly end this route? Incomplete jobs will be skipped.',
            onConfirm: () => {
              finishActiveRoute();
              setDialog(null);
            },
            onCancel: () => setDialog(null)
          });
        }}
      />

      {/* Recenter Button if autoCenter is disabled */}""",
        content
    )

    # 8. Clean duplicates
    # Remove SlideToFinish function
    content = re.sub(
        r"function SlideToFinish\(\{ onComplete \}\) \{[\s\S]*?\}\n",
        "",
        content
    )

    with open('src/pages/LiveMap.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

refactor_livemap()
