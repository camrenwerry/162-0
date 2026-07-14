import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BetaErrorBoundary } from './components/BetaRecovery.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BetaErrorBoundary><App /></BetaErrorBoundary>
  </StrictMode>,
)
