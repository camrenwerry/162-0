import betaData from './betaPlayers.json'
import type { Player, TeamDecadeCombination } from '../../types/draft'

interface BetaDataset {
  combinations: TeamDecadeCombination[]
  players: Player[]
}

// The JSON is generated and checked by `npm run validate:data` before builds.
const dataset = betaData as unknown as BetaDataset

export const TEAM_DECADES = dataset.combinations
export const BETA_PLAYERS = dataset.players
