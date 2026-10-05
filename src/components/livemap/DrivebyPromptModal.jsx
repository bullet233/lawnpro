import { CheckCircle, FastForward, Navigation } from 'lucide-react';

export default function DrivebyPromptModal({ drivebyPrompt, handleDrivebyResolution }) {
  if (!drivebyPrompt) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3 style={{ marginTop: 0 }}>Short Visit Detected</h3>
        <p>You were at <strong>{drivebyPrompt.customer.name}</strong> for only {drivebyPrompt.duration} seconds.</p>
        {/* Pass-by is the default: nothing gets logged and the stop stays on
            the route. The other two record something, so they are explicit. */}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleDrivebyResolution('ignore')}>
          <Navigation size={18} /> Just passing by
        </button>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.8rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('skipped')}>
            <FastForward size={18} /> Skip this stop
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('completed')}>
            <CheckCircle size={18} /> Normal Service
          </button>
        </div>
        <p style={{ margin: '0.9rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Closes on its own in a minute — nothing is logged unless you choose.
        </p>
      </div>
    </div>
  );
}
