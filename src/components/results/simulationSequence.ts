import type { DraftResult } from '../../types/draft'

export interface SimulationStage {
  label: string
  message: string
}

export const SIMULATION_STAGES: readonly SimulationStage[] = [
  { label: 'Building your season', message: 'The roster is taking the field' },
  { label: 'Opening Day', message: 'The lineup is finding its rhythm' },
  { label: 'April', message: 'The rotation is settling in' },
  { label: 'All-Star Break', message: 'The season is taking shape' },
  { label: 'Trade Deadline', message: 'The bullpen is being tested' },
  { label: 'September', message: 'The pennant race is heating up' },
  { label: 'Postseason', message: 'October baseball begins' },
  { label: 'Finalizing Results', message: 'Projecting the final standings' },
] as const

export const getSimulationTiming = (reducedMotion: boolean) => ({
  stageDuration: reducedMotion ? 170 : 540,
  revealDelay: reducedMotion ? 120 : 360,
})

export const getSimulationReveal = (result: DraftResult) => ({
  wins: result.wins,
  losses: result.losses,
  tierLabel: result.tierLabel,
  overallGrade: result.overallGrade,
})
