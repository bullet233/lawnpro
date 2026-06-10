import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, X } from 'lucide-react'

function ReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r)
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  })

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="animate-fade-in" style={{
      position: 'fixed',
      bottom: '85px', 
      left: '50%',
      transform: 'translateX(-50%)',
      width: '90%',
      maxWidth: '400px',
      backgroundColor: 'var(--color-bg-card)',
      border: '2px solid var(--color-primary)',
      boxShadow: 'var(--shadow-lg)',
      borderRadius: 'var(--radius-md)',
      padding: '1.2rem',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.8rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--color-primary)' }}>
          <Download size={22} />
          <strong style={{ fontSize: '1.1rem' }}>{needRefresh ? 'Update Available!' : 'App Ready Offline'}</strong>
        </div>
        <button onClick={close} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          <X size={20} color="var(--color-text-muted)" />
        </button>
      </div>
      
      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-main)', lineHeight: 1.5 }}>
        {needRefresh 
          ? 'A new version of Lawn Route Tracker is available. Update now to get the latest features and bug fixes.' 
          : 'The app has been cached and will now work completely offline!'}
      </p>

      {needRefresh && (
        <button 
          className="btn btn-primary" 
          onClick={() => updateServiceWorker(true)}
          style={{ width: '100%', marginTop: '0.5rem', padding: '0.8rem', fontSize: '1rem' }}
        >
          Update App Now
        </button>
      )}
    </div>
  )
}

export default ReloadPrompt
