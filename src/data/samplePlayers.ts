import type { Player, TeamDecadeCombination } from '../types/draft'
import { ADDITIONAL_SAMPLE_PLAYERS } from './additionalSamplePlayers'

export const TEAM_DECADES: TeamDecadeCombination[] = [
  { id: 'sea-1990s', team: 'SEA', teamName: 'Mariners', decade: '1990s' },
  { id: 'nyy-2000s', team: 'NYY', teamName: 'Yankees', decade: '2000s' },
  { id: 'atl-1990s', team: 'ATL', teamName: 'Braves', decade: '1990s' },
  { id: 'stl-2000s', team: 'STL', teamName: 'Cardinals', decade: '2000s' },
  { id: 'laa-2010s', team: 'LAA', teamName: 'Angels', decade: '2010s' },
]

// Curated prototype values for UI development only. These are not the final historical dataset.
const CORE_SAMPLE_PLAYERS: Player[] = [
  { id: 'sea-griffey', name: 'Ken Griffey Jr.', team: 'SEA', decade: '1990s', eligiblePositions: ['CF', 'RF'], type: 'hitter', stats: { war: 56.7, opsPlus: 147, hr: 382, avg: .302 } },
  { id: 'sea-edgar', name: 'Edgar Martinez', team: 'SEA', decade: '1990s', eligiblePositions: ['3B', 'DH'], type: 'hitter', stats: { war: 44.5, opsPlus: 154, hr: 204, avg: .322 } },
  { id: 'sea-arod', name: 'Alex Rodriguez', team: 'SEA', decade: '1990s', eligiblePositions: ['SS', '3B'], type: 'hitter', stats: { war: 38.1, opsPlus: 138, hr: 189, avg: .308 } },
  { id: 'sea-buhner', name: 'Jay Buhner', team: 'SEA', decade: '1990s', eligiblePositions: ['RF', 'LF'], type: 'hitter', stats: { war: 22.8, opsPlus: 126, hr: 263, avg: .257 } },
  { id: 'sea-wilson', name: 'Dan Wilson', team: 'SEA', decade: '1990s', eligiblePositions: ['C'], type: 'hitter', stats: { war: 13.4, opsPlus: 87, hr: 67, avg: .263 } },
  { id: 'sea-tino', name: 'Tino Martinez', team: 'SEA', decade: '1990s', eligiblePositions: ['1B'], type: 'hitter', stats: { war: 7.9, opsPlus: 116, hr: 72, avg: .276 } },
  { id: 'sea-cora', name: 'Joey Cora', team: 'SEA', decade: '1990s', eligiblePositions: ['2B'], type: 'hitter', stats: { war: 10.2, opsPlus: 96, hr: 32, avg: .293 } },
  { id: 'sea-randy', name: 'Randy Johnson', team: 'SEA', decade: '1990s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 39, eraPlus: 138, era: 3.42, so: 2162, sv: 2 } },
  { id: 'sea-moyer', name: 'Jamie Moyer', team: 'SEA', decade: '1990s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 11.8, eraPlus: 116, era: 3.66, so: 525, sv: 0 } },
  { id: 'sea-charlton', name: 'Norm Charlton', team: 'SEA', decade: '1990s', eligiblePositions: ['RP'], type: 'pitcher', stats: { war: 6.1, eraPlus: 131, era: 3.08, so: 417, sv: 48 } },

  { id: 'nyy-jeter', name: 'Derek Jeter', team: 'NYY', decade: '2000s', eligiblePositions: ['SS'], type: 'hitter', stats: { war: 35.7, opsPlus: 117, hr: 161, avg: .317 } },
  { id: 'nyy-posada', name: 'Jorge Posada', team: 'NYY', decade: '2000s', eligiblePositions: ['C'], type: 'hitter', stats: { war: 30.1, opsPlus: 125, hr: 200, avg: .277 } },
  { id: 'nyy-giambi', name: 'Jason Giambi', team: 'NYY', decade: '2000s', eligiblePositions: ['1B', 'DH'], type: 'hitter', stats: { war: 20.6, opsPlus: 143, hr: 209, avg: .260 } },
  { id: 'nyy-cano', name: 'Robinson Canó', team: 'NYY', decade: '2000s', eligiblePositions: ['2B'], type: 'hitter', stats: { war: 17.2, opsPlus: 120, hr: 87, avg: .306 } },
  { id: 'nyy-arod', name: 'Alex Rodriguez', team: 'NYY', decade: '2000s', eligiblePositions: ['3B', 'SS'], type: 'hitter', stats: { war: 40.2, opsPlus: 153, hr: 299, avg: .304 } },
  { id: 'nyy-matsui', name: 'Hideki Matsui', team: 'NYY', decade: '2000s', eligiblePositions: ['LF', 'DH'], type: 'hitter', stats: { war: 12.7, opsPlus: 123, hr: 140, avg: .292 } },
  { id: 'nyy-bernie', name: 'Bernie Williams', team: 'NYY', decade: '2000s', eligiblePositions: ['CF'], type: 'hitter', stats: { war: 15.1, opsPlus: 122, hr: 136, avg: .298 } },
  { id: 'nyy-abreu', name: 'Bobby Abreu', team: 'NYY', decade: '2000s', eligiblePositions: ['RF', 'LF'], type: 'hitter', stats: { war: 9.2, opsPlus: 120, hr: 43, avg: .295 } },
  { id: 'nyy-mussina', name: 'Mike Mussina', team: 'NYY', decade: '2000s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 35.1, eraPlus: 114, era: 3.88, so: 1278, sv: 0 } },
  { id: 'nyy-rivera', name: 'Mariano Rivera', team: 'NYY', decade: '2000s', eligiblePositions: ['RP'], type: 'pitcher', stats: { war: 28.5, eraPlus: 226, era: 1.95, so: 669, sv: 397 } },

  { id: 'atl-lopez', name: 'Javy López', team: 'ATL', decade: '1990s', eligiblePositions: ['C'], type: 'hitter', stats: { war: 15.8, opsPlus: 111, hr: 112, avg: .287 } },
  { id: 'atl-mcgriff', name: 'Fred McGriff', team: 'ATL', decade: '1990s', eligiblePositions: ['1B'], type: 'hitter', stats: { war: 19.8, opsPlus: 130, hr: 130, avg: .293 } },
  { id: 'atl-lemke', name: 'Mark Lemke', team: 'ATL', decade: '1990s', eligiblePositions: ['2B'], type: 'hitter', stats: { war: 8.8, opsPlus: 78, hr: 30, avg: .250 } },
  { id: 'atl-chipper', name: 'Chipper Jones', team: 'ATL', decade: '1990s', eligiblePositions: ['3B', 'SS', 'LF'], type: 'hitter', stats: { war: 26.5, opsPlus: 141, hr: 153, avg: .303 } },
  { id: 'atl-blauser', name: 'Jeff Blauser', team: 'ATL', decade: '1990s', eligiblePositions: ['SS'], type: 'hitter', stats: { war: 19.7, opsPlus: 104, hr: 96, avg: .268 } },
  { id: 'atl-klesko', name: 'Ryan Klesko', team: 'ATL', decade: '1990s', eligiblePositions: ['LF', '1B', 'DH'], type: 'hitter', stats: { war: 15.6, opsPlus: 128, hr: 139, avg: .283 } },
  { id: 'atl-andruw', name: 'Andruw Jones', team: 'ATL', decade: '1990s', eligiblePositions: ['CF'], type: 'hitter', stats: { war: 8.9, opsPlus: 101, hr: 44, avg: .254 } },
  { id: 'atl-justice', name: 'David Justice', team: 'ATL', decade: '1990s', eligiblePositions: ['RF', 'LF'], type: 'hitter', stats: { war: 24.5, opsPlus: 132, hr: 190, avg: .275 } },
  { id: 'atl-maddux', name: 'Greg Maddux', team: 'ATL', decade: '1990s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 47.5, eraPlus: 187, era: 2.15, so: 1298, sv: 0 } },
  { id: 'atl-wohlers', name: 'Mark Wohlers', team: 'ATL', decade: '1990s', eligiblePositions: ['RP'], type: 'pitcher', stats: { war: 4.7, eraPlus: 122, era: 3.13, so: 425, sv: 112 } },

  { id: 'stl-molina', name: 'Yadier Molina', team: 'STL', decade: '2000s', eligiblePositions: ['C'], type: 'hitter', stats: { war: 12.4, opsPlus: 84, hr: 36, avg: .274 } },
  { id: 'stl-pujols', name: 'Albert Pujols', team: 'STL', decade: '2000s', eligiblePositions: ['1B', '3B', 'LF', 'DH'], type: 'hitter', stats: { war: 73.8, opsPlus: 172, hr: 366, avg: .334 } },
  { id: 'stl-vina', name: 'Fernando Viña', team: 'STL', decade: '2000s', eligiblePositions: ['2B'], type: 'hitter', stats: { war: 11.4, opsPlus: 92, hr: 25, avg: .285 } },
  { id: 'stl-rolen', name: 'Scott Rolen', team: 'STL', decade: '2000s', eligiblePositions: ['3B'], type: 'hitter', stats: { war: 27.1, opsPlus: 127, hr: 111, avg: .286 } },
  { id: 'stl-renteria', name: 'Édgar Rentería', team: 'STL', decade: '2000s', eligiblePositions: ['SS'], type: 'hitter', stats: { war: 13.7, opsPlus: 96, hr: 71, avg: .290 } },
  { id: 'stl-edmonds', name: 'Jim Edmonds', team: 'STL', decade: '2000s', eligiblePositions: ['CF'], type: 'hitter', stats: { war: 37.8, opsPlus: 145, hr: 241, avg: .285 } },
  { id: 'stl-holliday', name: 'Matt Holliday', team: 'STL', decade: '2000s', eligiblePositions: ['LF'], type: 'hitter', stats: { war: 2.9, opsPlus: 141, hr: 13, avg: .353 } },
  { id: 'stl-ludwick', name: 'Ryan Ludwick', team: 'STL', decade: '2000s', eligiblePositions: ['RF', 'LF'], type: 'hitter', stats: { war: 8.1, opsPlus: 128, hr: 80, avg: .277 } },
  { id: 'stl-carpenter', name: 'Chris Carpenter', team: 'STL', decade: '2000s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 23.1, eraPlus: 134, era: 3.05, so: 889, sv: 0 } },
  { id: 'stl-isringhausen', name: 'Jason Isringhausen', team: 'STL', decade: '2000s', eligiblePositions: ['RP'], type: 'pitcher', stats: { war: 7.5, eraPlus: 134, era: 2.98, so: 359, sv: 217 } },

  { id: 'laa-iannetta', name: 'Chris Iannetta', team: 'LAA', decade: '2010s', eligiblePositions: ['C'], type: 'hitter', stats: { war: 8.1, opsPlus: 105, hr: 57, avg: .231 } },
  { id: 'laa-pujols', name: 'Albert Pujols', team: 'LAA', decade: '2010s', eligiblePositions: ['1B', 'DH'], type: 'hitter', stats: { war: 13.8, opsPlus: 110, hr: 211, avg: .258 } },
  { id: 'laa-kendrick', name: 'Howie Kendrick', team: 'LAA', decade: '2010s', eligiblePositions: ['2B', 'LF'], type: 'hitter', stats: { war: 19.1, opsPlus: 115, hr: 66, avg: .292 } },
  { id: 'laa-freese', name: 'David Freese', team: 'LAA', decade: '2010s', eligiblePositions: ['3B'], type: 'hitter', stats: { war: 7.8, opsPlus: 119, hr: 40, avg: .258 } },
  { id: 'laa-simmons', name: 'Andrelton Simmons', team: 'LAA', decade: '2010s', eligiblePositions: ['SS'], type: 'hitter', stats: { war: 21.6, opsPlus: 103, hr: 36, avg: .281 } },
  { id: 'laa-trout', name: 'Mike Trout', team: 'LAA', decade: '2010s', eligiblePositions: ['CF', 'LF', 'RF'], type: 'hitter', stats: { war: 73.5, opsPlus: 176, hr: 285, avg: .308 } },
  { id: 'laa-calhoun', name: 'Kole Calhoun', team: 'LAA', decade: '2010s', eligiblePositions: ['RF'], type: 'hitter', stats: { war: 15.2, opsPlus: 108, hr: 140, avg: .249 } },
  { id: 'laa-upton', name: 'Justin Upton', team: 'LAA', decade: '2010s', eligiblePositions: ['LF', 'RF'], type: 'hitter', stats: { war: 6.8, opsPlus: 110, hr: 45, avg: .252 } },
  { id: 'laa-weaver', name: 'Jered Weaver', team: 'LAA', decade: '2010s', eligiblePositions: ['SP'], type: 'pitcher', stats: { war: 24.4, eraPlus: 118, era: 3.40, so: 1147, sv: 0 } },
  { id: 'laa-street', name: 'Huston Street', team: 'LAA', decade: '2010s', eligiblePositions: ['RP'], type: 'pitcher', stats: { war: 3.4, eraPlus: 134, era: 2.72, so: 136, sv: 81 } },
]

export const SAMPLE_PLAYERS: Player[] = [...CORE_SAMPLE_PLAYERS, ...ADDITIONAL_SAMPLE_PLAYERS]
