import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle, Info, Trash2, SkipForward } from 'lucide-react';

/**
 * AppDialog — replaces window.alert and window.confirm throughout the app.
 *
 * Usage:
 *   // Alert (info only):
 *   setDialog({ type: 'info', title: 'Saved!', message: 'Route has been saved.' })
 *
 *   // Confirm (with cancel):
 *   setDialog({ type: 'danger', title: 'Delete Client', message: '...', onConfirm: () => doDelete() })
 *
 * Props:
 *   dialog: { type: 'info'|'success'|'warning'|'danger', title, message, confirmLabel?, onConfirm? }
 *   onClose: () => void
 */
export default function AppDialog({ dialog, onClose }) {
  if (!dialog) return null;

  const { type = 'info', title, message, confirmLabel, cancelLabel, onConfirm, onCancel } = dialog;

  const icons = {
    info:    <Info size={22} color="#3b82f6" />,
    success: <CheckCircle size={22} color="var(--color-primary)" />,
    warning: <AlertTriangle size={22} color="#f59e0b" />,
    danger:  <Trash2 size={22} color="#ef4444" />,
    skip:    <SkipForward size={22} color="#f59e0b" />,
  };

  const confirmColors = {
    info:    'var(--color-primary)',
    success: 'var(--color-primary)',
    warning: '#f59e0b',
    danger:  '#ef4444',
    skip:    '#f59e0b',
  };

  const handleConfirm = async () => {
    if (onConfirm) {
      await onConfirm();
    }
    onClose();
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ zIndex: 9999 }}
    >
      <div className="modal-content" style={{ maxWidth: '380px', textAlign: 'center' }}>
        <div style={{ marginBottom: '1rem' }}>{icons[type] ?? icons.info}</div>

        {title && (
          <h3 style={{ margin: '0 0 0.6rem 0', fontSize: '1.1rem', color: 'var(--color-text-main)' }}>
            {title}
          </h3>
        )}

        {message && (
          <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {message}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
          {(onConfirm || onCancel) && (
            <button
              onClick={async () => {
                if (onCancel) await onCancel();
                onClose();
              }}
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              {cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className="btn"
            style={{ flex: 1, background: confirmColors[type], color: 'white', border: 'none' }}
          >
            {confirmLabel ?? (onConfirm ? 'Confirm' : 'OK')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
