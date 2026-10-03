import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RootErrorBoundary] Uncaught application error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = window.location.pathname + '?mode=desktop';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#070b14',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, sans-serif',
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            background: 'rgba(17, 24, 39, 0.85)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            textAlign: 'center',
          }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: '#f43f5e',
              fontSize: '24px',
              fontWeight: 'bold',
            }}>
              ⚠️
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px', color: '#f8fafc' }}>
              Application Render Notice
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.5 }}>
              The application encountered a runtime issue while loading. Click below to reload or reset session state.
            </p>

            {this.state.error && (
              <pre style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '0.76rem',
                color: '#fda4af',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '24px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleReload}
                style={{
                  background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 20px',
                  color: '#051020',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Reload SideBro
              </button>
              <button
                onClick={this.handleReset}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '10px',
                  padding: '10px 20px',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Reset & Launch Desktop
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

