import { Component, type ErrorInfo, type ReactNode } from 'react'
import { VERSION_LABEL } from '../config/app'
import { isObsoleteLazyChunkError } from '../utils/lazyRoute'
import PennantPursuitLogo from './PennantPursuitLogo'
import './AppRecovery.css'

interface RecoveryProps {
  title?: string
  message?: string
  onHome?: () => void
  onRetry?: () => void
  retryLabel?: string
  homeLabel?: string
}

export function AppRecovery({
  title = 'Something went off the rails',
  message = 'Your game could not continue. Try again, or return home and start a fresh draft.',
  onHome = () => window.location.assign('/'),
  onRetry = () => window.location.reload(),
  retryLabel = 'Try Again',
  homeLabel = 'Return Home',
}: RecoveryProps) {
  return (
    <main className="app-recovery">
      <section role="alert">
        <PennantPursuitLogo compact />
        <span>{VERSION_LABEL}</span>
        <h1>{title}</h1>
        <p>{message}</p>
        <div><button type="button" onClick={onRetry}>{retryLabel}</button><button type="button" onClick={onHome}>{homeLabel}</button></div>
      </section>
    </main>
  )
}

interface BoundaryProps { children: ReactNode; onHome?: () => void }
interface BoundaryState { failed: boolean; error: unknown }

export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, error: null }
  static getDerivedStateFromError(error: unknown): BoundaryState { return { failed: true, error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Pennant Pursuit recovery boundary', error, info)
  }
  render() {
    if (!this.state.failed) return this.props.children
    if (isObsoleteLazyChunkError(this.state.error)) {
      return (
        <AppRecovery
          title="The app update could not finish"
          message="This screen still has an obsolete app file after one automatic recovery attempt. Refresh once more, or return home."
          retryLabel="Refresh App"
          homeLabel="Return Home"
          onRetry={() => window.location.reload()}
          onHome={this.props.onHome}
        />
      )
    }
    return <AppRecovery title="Something went wrong" message="Your draft could not continue." retryLabel="Restart Game" homeLabel="Return Home" onRetry={() => window.location.assign('/draft')} onHome={this.props.onHome} />
  }
}
