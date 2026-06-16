import { useState, useEffect, useRef } from 'react';

export function useJobTimer() {
  const [timerState, setTimerState] = useState('idle'); // 'idle' | 'running' | 'paused'
  const [liveDuration, setLiveDuration] = useState(0);

  const jobStartRef = useRef(null);
  const accumulatedTimeRef = useRef(0);
  const lastResumeTimeRef = useRef(null);
  const timerStateRef = useRef('idle');

  // Keep state and ref in sync
  useEffect(() => {
    timerStateRef.current = timerState;
  }, [timerState]);

  // Live UI Updates
  useEffect(() => {
    let interval;
    if (timerState === 'running') {
      interval = setInterval(() => {
        const totalSecs = (accumulatedTimeRef.current + (Date.now() - lastResumeTimeRef.current)) / 1000;
        setLiveDuration(Math.floor(totalSecs));
      }, 1000);
    } else if (timerState === 'paused') {
      const totalSecs = accumulatedTimeRef.current / 1000;
      setLiveDuration(Math.floor(totalSecs));
    } else {
      setLiveDuration(0);
    }
    return () => clearInterval(interval);
  }, [timerState]);

  const startTimer = (startTime = Date.now()) => {
    jobStartRef.current = startTime;
    accumulatedTimeRef.current = 0;
    lastResumeTimeRef.current = startTime;
    setTimerState('running');
  };

  const pauseTimer = () => {
    if (timerStateRef.current === 'running') {
      accumulatedTimeRef.current += (Date.now() - lastResumeTimeRef.current);
      setTimerState('paused');
    }
  };

  const resumeTimer = () => {
    if (timerStateRef.current === 'paused') {
      lastResumeTimeRef.current = Date.now();
      setTimerState('running');
    }
  };

  const toggleTimer = () => {
    if (timerState === 'running') {
      pauseTimer();
    } else if (timerState === 'paused') {
      resumeTimer();
    }
  };

  const resetTimer = () => {
    jobStartRef.current = null;
    accumulatedTimeRef.current = 0;
    lastResumeTimeRef.current = null;
    setTimerState('idle');
  };

  const getFinalDurationSecs = () => {
    return Math.floor(
      timerStateRef.current === 'paused'
        ? accumulatedTimeRef.current / 1000
        : (accumulatedTimeRef.current + (Date.now() - lastResumeTimeRef.current)) / 1000
    );
  };

  return {
    timerState,
    liveDuration,
    startTimer,
    pauseTimer,
    resumeTimer,
    toggleTimer,
    resetTimer,
    getFinalDurationSecs,
    // Refs
    jobStartRef,
    accumulatedTimeRef,
    lastResumeTimeRef,
    timerStateRef
  };
}
