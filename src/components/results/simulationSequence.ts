import type { DraftResult } from '../../types/draft'

export interface SimulationPhase {
  label: string
  message: string
}

export const SIMULATION_PHASES: readonly SimulationPhase[] = [
  { label: 'Simulating Season', message: 'Your roster is taking the field.' },
  { label: 'Postseason', message: 'The championship run begins.' },
  { label: 'Finalizing Results', message: 'Calculating your projected record.' },
] as const

export const getSimulationDuration = (reducedMotion: boolean) => reducedMotion ? 800 : 3_000

export function getSimulationPhase(progress: number) {
  if (progress < .75) return 0
  if (progress < .92) return 1
  return 2
}

export const getSimulationReveal = (result: DraftResult) => ({
  wins: result.wins,
  losses: result.losses,
  tierLabel: result.tierLabel,
  overallGrade: result.overallGrade,
})
