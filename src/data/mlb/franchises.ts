export interface FranchiseDefinition {
  id: string
  abbreviation: string
  displayName: string
  sourceTeamIds: readonly string[]
}

/** Canonical franchise identities used by generated pool IDs and the game engine. */
export const FRANCHISES: readonly FranchiseDefinition[] = [
  { id: 'nyy', abbreviation: 'NYY', displayName: 'New York Yankees', sourceTeamIds: ['NYA'] },
  { id: 'bos', abbreviation: 'BOS', displayName: 'Boston Red Sox', sourceTeamIds: ['BOS'] },
  { id: 'lad', abbreviation: 'LAD', displayName: 'Los Angeles Dodgers', sourceTeamIds: ['LAN'] },
  { id: 'sfg', abbreviation: 'SFG', displayName: 'San Francisco Giants', sourceTeamIds: ['SFN'] },
  { id: 'stl', abbreviation: 'STL', displayName: 'St. Louis Cardinals', sourceTeamIds: ['SLN'] },
  { id: 'chc', abbreviation: 'CHC', displayName: 'Chicago Cubs', sourceTeamIds: ['CHN'] },
  { id: 'atl', abbreviation: 'ATL', displayName: 'Atlanta Braves', sourceTeamIds: ['ATL'] },
  { id: 'sea', abbreviation: 'SEA', displayName: 'Seattle Mariners', sourceTeamIds: ['SEA'] },
  { id: 'bal', abbreviation: 'BAL', displayName: 'Baltimore Orioles', sourceTeamIds: ['BAL'] },
  { id: 'oak', abbreviation: 'OAK', displayName: 'Oakland Athletics', sourceTeamIds: ['OAK'] },
  { id: 'laa', abbreviation: 'LAA', displayName: 'Los Angeles Angels', sourceTeamIds: ['CAL', 'ANA', 'LAA'] },
  { id: 'phi', abbreviation: 'PHI', displayName: 'Philadelphia Phillies', sourceTeamIds: ['PHI'] },
] as const
