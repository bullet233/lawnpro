import { useState, useEffect, useRef, useCallback } from 'react';

export function useDriveTimer() {
  const [isDrivingPaused, setIsDrivingPaused] = useState(true);
  const [drivingDuration, setDrivingDuration] = useState(0);

  const isDrivingPausedRef = useRef(true);
  const accumulatedDriveTimeRef = useRef(0);
  const lastDriveResumeTimeRef = useRef(Date.now());

  const saveState = useCallback((isPaused, accumulated) => {
    localStorage.setItem('drive_timer_state', JSON.stringify({
      accumulated,
      lastResume: lastDriveResumeTimeRef.current,
      isPaused,
      savedAt: Date.now()
    }));
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('drive_timer_state');
      if (stored) {
        const { accumulated, lastResume, isPaused, savedAt } = JSON.parse(stored);
        const isStale = savedAt && (Date.now() - savedAt) > 12 * 60 * 60 * 1000;

        if (!isPaused && !isStale && lastResume && savedAt) {
          accumulatedDriveTimeRef.current = (accumulated || 0) + (Date.now() - savedAt) / 1000;
          lastDriveResumeTimeRef.current = Date.now();
          isDrivingPausedRef.current = false;
          setIsDrivingPaused(false);
        } else {
          accumulatedDriveTimeRef.current = accumulated || 0;
          isDrivingPausedRef.current = true;
          setIsDrivingPaused(true);
          if (!isPaused && isStale) {
            saveState(true, accumulated || 0);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load drive timer state', e);
    }
  }, [saveState]);

  // Live UI Updates (every second)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDrivingPaused) {
        const total = accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000;
        setDrivingDuration(Math.floor(total));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isDrivingPaused]);

  const pauseTimer = () => {
    if (!isDrivingPausedRef.current) {
      isDrivingPausedRef.current = true;
      setIsDrivingPaused(true);
      accumulatedDriveTimeRef.current += (Date.now() - lastDriveResumeTimeRef.current) / 1000;
      saveState(true, accumulatedDriveTimeRef.current);
    }
  };

  const resumeTimer = () => {
    if (isDrivingPausedRef.current) {
      isDrivingPausedRef.current = false;
      setIsDrivingPaused(false);
      lastDriveResumeTimeRef.current = Date.now();
      saveState(false, accumulatedDriveTimeRef.current);
    }
  };

  const togglePause = () => {
    if (isDrivingPausedRef.current) {
      resumeTimer();
    } else {
      pauseTimer();
    }
  };

  const getFinalDriveTimeSecs = () => {
    return Math.floor(
      isDrivingPausedRef.current
        ? accumulatedDriveTimeRef.current
        : accumulatedDriveTimeRef.current + (Date.now() - lastDriveResumeTimeRef.current) / 1000
    );
  };

  const resetTimer = (autoStart = false) => {
    accumulatedDriveTimeRef.current = 0;
    lastDriveResumeTimeRef.current = Date.now();
    setDrivingDuration(0);
    
    if (autoStart) {
      isDrivingPausedRef.current = false;
      setIsDrivingPaused(false);
      saveState(false, 0);
    } else {
      isDrivingPausedRef.current = true;
      setIsDrivingPaused(true);
      saveState(true, 0);
    }
  };

  return {
    isDrivingPaused,
    drivingDuration,
    togglePause,
    pauseTimer,
    resumeTimer,
    resetTimer,
    getFinalDriveTimeSecs,
    // Refs exposed for synchronous access without stale closures
    isDrivingPausedRef,
    accumulatedDriveTimeRef,
    lastDriveResumeTimeRef
  };
}
