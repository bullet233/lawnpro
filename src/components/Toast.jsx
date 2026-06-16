import { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';

export default function Toast() {
  const [toasts, setToasts] = useState([]);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const handleToast = (e) => {
      const { message, type } = e.detail;
      // Monotonic counter (not Date.now()) so toasts fired in the same millisecond
      // get unique keys and don't collide / get removed together.
      const id = nextIdRef.current++;
      setToasts(prev => [...prev, { id, message, type }]);

      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    };

    window.addEventListener('app-toast', handleToast);
    return () => window.removeEventListener('app-toast', handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '5.5rem', // Above bottom nav
      left: '0',
      right: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.5rem',
      zIndex: 9999,
      pointerEvents: 'none',
      padding: '0 1rem'
    }}>
      {toasts.map(t => {
        const isSuccess = t.type === 'success';
        const isError = t.type === 'error';
        const Icon = isSuccess ? CheckCircle : isError ? AlertCircle : Info;
        const color = isSuccess ? '#10b981' : isError ? '#ef4444' : '#3b82f6';
        const bg = isSuccess ? 'rgba(16,185,129,0.95)' : isError ? 'rgba(239,68,68,0.95)' : 'rgba(59,130,246,0.95)';

        return (
          <div key={t.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: bg,
            color: 'white',
            padding: '0.6rem 1rem',
            borderRadius: '999px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontSize: '0.9rem',
            fontWeight: 600,
            animation: 'slideUpToast 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
          }}>
            <Icon size={16} />
            {t.message}
          </div>
        );
      })}
      <style>{`
        @keyframes slideUpToast {
          from { opacity: 0; transform: translateY(20px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
