import { useState, useRef } from 'react';
import { ChevronsRight } from 'lucide-react';

// accent: the knob colour; tint: the track colour; ink: the label colour.
export default function SlideToFinish({ onComplete, accent = '#047857', tint = '#E1F5EE', ink = '#065f46' }) {
  const [progress, setProgress] = useState(0);
  const trackRef = useRef(null);
  // One slide finishes the job once. Touch moves keep arriving past 95%
  // before the reset renders, and each one used to call onComplete again —
  // logging the job a second time as a 0-second visit.
  const firedRef = useRef(false);

  const handleMove = (clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const p = x / rect.width;
    setProgress(p);
    if (p > 0.95 && !firedRef.current) {
      firedRef.current = true;
      onComplete();
      setProgress(0);
    }
  };

  const handleTouchMove = (e) => handleMove(e.touches[0].clientX);
  const handleMouseMove = (e) => { if (e.buttons === 1) handleMove(e.clientX); };
  // Lifting the finger re-arms the slider for the next job.
  const handleEnd = () => { firedRef.current = false; if (progress < 0.95) setProgress(0); };

  return (
    <div
      ref={trackRef}
      role="slider" aria-label="Slide to finish job" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      style={{ position: 'relative', height: '56px', background: tint, borderRadius: '28px', overflow: 'hidden', touchAction: 'none', border: 'none', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      onMouseMove={handleMouseMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(0,0,0,0.06)', transition: progress === 0 ? 'width 0.3s' : 'none' }} />
      <div style={{ position: 'absolute', width: '100%', textAlign: 'center', fontWeight: 700, color: ink, fontSize: '1.05rem', paddingLeft: '48px', boxSizing: 'border-box', userSelect: 'none', pointerEvents: 'none' }}>
        Slide to finish job
      </div>
      <div
        style={{ position: 'absolute', left: `calc(4px + ${progress} * (100% - 74px))`, top: '4px', width: '66px', height: '48px', borderRadius: '24px', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', transition: progress === 0 ? 'left 0.3s' : 'none', cursor: 'grab', zIndex: 2 }}
      >
        <ChevronsRight size={26} />
      </div>
    </div>
  );
}
