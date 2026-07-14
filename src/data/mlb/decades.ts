import type { Decade } from '../../types/draft'

export interface DecadeDefinition {
  id: Decade
  startYear: number
  endYear: number
}

export const DECADE_DEFINITIONS: readonly DecadeDefinition[] = [
  { id: '1980s', startYear: 1980, endYear: 1989 },
  { id: '1990s', startYear: 1990, endYear: 1999 },
  { id: '2000s', startYear: 2000, endYear: 2009 },
  { id: '2010s', startYear: 2010, endYear: 2019 },
] as const
