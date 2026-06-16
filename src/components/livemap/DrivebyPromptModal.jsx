import { CheckCircle, FastForward } from 'lucide-react';

export default function DrivebyPromptModal({ drivebyPrompt, handleDrivebyResolution }) {
  if (!drivebyPrompt) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3 style={{ marginTop: 0 }}>Short Visit Detected</h3>
        <p>You were at <strong>{drivebyPrompt.customer.name}</strong> for only {drivebyPrompt.duration} seconds.</p>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('skipped')}>
            <FastForward size={18} /> Skipped
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleDrivebyResolution('completed')}>
            <CheckCircle size={18} /> Normal Service
          </button>
        </div>
      </div>
    </div>
  );
}
