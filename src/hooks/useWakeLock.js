import { useEffect, useRef } from 'react';

export function useWakeLock(isActive) {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    const acquireWakeLock = async () => {
      if ('wakeLock' in navigator && isActive) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
            wakeLockRef.current.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          }
        } catch (err) {
          console.error(`${err.name}, ${err.message}`);
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isActive) {
        acquireWakeLock();
      }
    };

    if (isActive) {
      acquireWakeLock();
      document.addEventListener('visibilitychange', handleVisibility);
    } else {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isActive]);
}
