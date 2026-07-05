import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

// App-level safety net. A throw during render (e.g. a Maps component mounting
// before the API script has loaded, or bad data) must never white-screen the
// whole app in the field — show a recoverable message instead.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App error boundary caught:', error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem', gap: '1rem' }}>
          <AlertTriangle size={40} color="#ef4444" />
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-main)' }}>Something went wrong on this screen</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', maxWidth: '320px' }}>
            Your saved data is safe. Try again, or head back to the dashboard.
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={this.handleReset}>Try again</button>
            <button className="btn btn-primary" onClick={() => { window.location.href = import.meta.env.BASE_URL; }}>Go to Dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
