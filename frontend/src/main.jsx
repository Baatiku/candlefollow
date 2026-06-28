import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('Dashboard error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0f172a',
          color: '#f1f5f9', fontFamily: 'monospace', gap: '16px', padding: '32px'
        }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Dashboard crashed</div>
          <div style={{
            background: '#1e293b', padding: '12px 20px', borderRadius: '8px',
            color: '#f87171', fontSize: '0.85rem', maxWidth: '600px', wordBreak: 'break-word'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none',
              padding: '10px 24px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem'
            }}
          >
            Reload dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
