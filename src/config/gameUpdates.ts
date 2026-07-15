export interface GameUpdate {
  version: string
  heading: string
  highlights: readonly string[]
}

// Keep releases newest-first so future updates can be added without changing the screen.
export const GAME_UPDATES: readonly GameUpdate[] = [
  {
    version: '0.12.0',
    heading: "What's New",
    highlights: [
      'Expanded every historical player pool with more stars and depth.',
      'Added proper DH and two-way player support including Shohei Ohtani.',
      'Improved historical position eligibility using featured-season appearances.',
      'Improved projected records for elite teams.',
      '162–0 is now possible, but remains extremely rare.',
      'Improved historical featured-season accuracy.',
    ],
  },
]
