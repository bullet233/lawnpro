import { useState, useRef } from 'react';
import { FastForward } from 'lucide-react';

export default function SlideToFinish({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const trackRef = useRef(null);
  
  const handleMove = (clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const p = x / rect.width;
    setProgress(p);
    if (p > 0.95) {
      onComplete();
      setProgress(0);
    }
  };

  const handleTouchMove = (e) => handleMove(e.touches[0].clientX);
  const handleMouseMove = (e) => { if (e.buttons === 1) handleMove(e.clientX); };
  const handleEnd = () => { if (progress < 0.95) setProgress(0); };

  return (
    <div 
      ref={trackRef}
      style={{ position: 'relative', height: '52px', background: '#ffffff', borderRadius: '26px', overflow: 'hidden', touchAction: 'none', border: 'none', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      onMouseMove={handleMouseMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(16,185,129,0.1)', transition: progress === 0 ? 'width 0.3s' : 'none' }} />
      <div style={{ position: 'absolute', width: '100%', textAlign: 'center', fontWeight: 800, color: '#10b981', fontSize: '0.95rem', letterSpacing: '1px', userSelect: 'none', pointerEvents: 'none' }}>
        SLIDE TO FINISH JOB
      </div>
      <div 
        style={{ position: 'absolute', left: `calc(4px + ${progress} * (100% - 52px))`, top: '4px', width: '44px', height: '44px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', transition: progress === 0 ? 'left 0.3s' : 'none', cursor: 'grab', zIndex: 2, boxShadow: '0 2px 8px rgba(16,185,129,0.4)' }}
      >
        <FastForward size={22} fill="currentColor" />
      </div>
    </div>
  );
}
