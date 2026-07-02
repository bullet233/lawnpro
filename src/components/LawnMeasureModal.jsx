import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Full-screen host for the embedded (basic) Lawn Measure tool. The tool lives as
// a static app under public/lawn-measure/ and talks back via postMessage (see
// public/lawn-measure/embed.js). We start it fresh each open so one customer's
// drawing never bleeds into another's, and hand the result to onSave.
const STORAGE_KEY = 'lawn-measure-v2';

export default function LawnMeasureModal({ customer, onClose, onSave }) {
  // Clear the tool's saved session ONCE, synchronously, before the iframe mounts.
  useState(() => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } return true; });

  const base = import.meta.env.BASE_URL || '/';
  const addr = customer?.address ? `?address=${encodeURIComponent(customer.address)}` : '';
  const src = `${base}lawn-measure/index.html${addr}`;

  useEffect(() => {
    const handler = (e) => {
      // Same-origin only (the tool is served from our own dev/build server).
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'lawn-measure-result') {
        onSave({ sqft: d.sqft, perimeterFt: d.perimeterFt, areaCount: d.areaCount });
      } else if (d.type === 'lawn-measure-cancel') {
        onClose();
      }
      // 'lawn-measure-empty' / 'lawn-measure-ready' are ignored here.
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSave, onClose]);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'var(--color-bg-card, #fff)', borderBottom: '1px solid var(--color-border, #e2e8f0)', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--color-text-main, #0f172a)' }}>Measure Lawn</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>
            {customer?.name || 'Client'} · draw the mowable area, then tap “Use this measurement”
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.4rem', color: 'var(--color-text-main, #0f172a)' }}>
          <X size={22} />
        </button>
      </div>
      <iframe
        title="Lawn Measure"
        src={src}
        style={{ flex: 1, width: '100%', border: 'none' }}
        allow="geolocation"
      />
    </div>,
    document.body
  );
}
