export interface GameUpdate {
  version: string
  label?: string
  heading: string
  intro?: string
  highlights: readonly string[]
  note?: string
}

// Keep releases newest-first so future updates can be added without changing the screen.
export const GAME_UPDATES: readonly GameUpdate[] = [
  {
    version: '1.0.0',
    label: 'Pennant Pursuit 1.0.0',
    heading: 'A New Era Begins',
    intro: 'Pennant Pursuit has officially arrived.',
    highlights: [
      'New permanent name and brand identity.',
      'Completely rebuilt logos, icons, and visual branding.',
      'Updated app icon, loading artwork, browser icon, and in-app logos.',
      'The same historical drafting experience.',
      'The same pursuit of building the greatest roster in baseball history.',
    ],
    note: 'Thank you for helping shape the future of Pennant Pursuit.',
  },
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
