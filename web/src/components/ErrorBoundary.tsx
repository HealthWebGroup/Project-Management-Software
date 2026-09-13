import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, one bad render anywhere takes the whole page to white and the
 * person has no idea what happened or what to do.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes to the browser console for whoever is debugging; the person sees
    // the friendly panel below.
    console.error('Interface error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="crash">
        <h1>That screen did not load</h1>
        <p>
          Something went wrong drawing this page. Your work is saved — nothing was lost.
        </p>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              window.location.hash = '#/'
              this.setState({ error: null })
            }}
          >
            Go back to the dashboard
          </button>
        </div>
        <details className="crash-detail">
          <summary>Technical detail</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </div>
    )
  }
}
