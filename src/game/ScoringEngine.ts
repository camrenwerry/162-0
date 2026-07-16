import type { DraftResult, Roster } from '../types/draft'
import { SCORING_VERSION } from '../config/versions'
import { calculateDraftResult, type ScoringDiagnostics } from './scoring/index'

export interface Scoring {
  calculate(roster: Roster): DraftResult
}

const diagnosticsEnabled = import.meta.env.DEV && import.meta.env.VITE_SCORING_DIAGNOSTICS === 'true'

export class PennantPursuitScoring implements Scoring {
  private lastDiagnostics: ScoringDiagnostics | null = null

  calculate(roster: Roster) {
    const calculation = calculateDraftResult(roster)
    this.lastDiagnostics = calculation.diagnostics
    if (diagnosticsEnabled) console.debug(`[Pennant Pursuit scoring v${SCORING_VERSION}]`, calculation.diagnostics)
    return calculation.result
  }

  getLastDiagnostics() {
    return this.lastDiagnostics
  }
}
