import pool0 from './pools/nyy-1980s.json'
import pool1 from './pools/nyy-1990s.json'
import pool2 from './pools/nyy-2000s.json'
import pool3 from './pools/nyy-2010s.json'
import pool4 from './pools/bos-1980s.json'
import pool5 from './pools/bos-1990s.json'
import pool6 from './pools/bos-2000s.json'
import pool7 from './pools/bos-2010s.json'
import pool8 from './pools/lad-1980s.json'
import pool9 from './pools/lad-1990s.json'
import pool10 from './pools/lad-2000s.json'
import pool11 from './pools/lad-2010s.json'
import pool12 from './pools/sfg-1980s.json'
import pool13 from './pools/sfg-1990s.json'
import pool14 from './pools/sfg-2000s.json'
import pool15 from './pools/sfg-2010s.json'
import pool16 from './pools/stl-1980s.json'
import pool17 from './pools/stl-1990s.json'
import pool18 from './pools/stl-2000s.json'
import pool19 from './pools/stl-2010s.json'
import pool20 from './pools/chc-1980s.json'
import pool21 from './pools/chc-1990s.json'
import pool22 from './pools/chc-2000s.json'
import pool23 from './pools/chc-2010s.json'
import pool24 from './pools/atl-1980s.json'
import pool25 from './pools/atl-1990s.json'
import pool26 from './pools/atl-2000s.json'
import pool27 from './pools/atl-2010s.json'
import pool28 from './pools/sea-1980s.json'
import pool29 from './pools/sea-1990s.json'
import pool30 from './pools/sea-2000s.json'
import pool31 from './pools/sea-2010s.json'
import pool32 from './pools/bal-1980s.json'
import pool33 from './pools/bal-1990s.json'
import pool34 from './pools/bal-2000s.json'
import pool35 from './pools/bal-2010s.json'
import pool36 from './pools/oak-1980s.json'
import pool37 from './pools/oak-1990s.json'
import pool38 from './pools/oak-2000s.json'
import pool39 from './pools/oak-2010s.json'
import pool40 from './pools/laa-1980s.json'
import pool41 from './pools/laa-1990s.json'
import pool42 from './pools/laa-2000s.json'
import pool43 from './pools/laa-2010s.json'
import pool44 from './pools/phi-1980s.json'
import pool45 from './pools/phi-1990s.json'
import pool46 from './pools/phi-2000s.json'
import pool47 from './pools/phi-2010s.json'
import combinations from './pool-index.json'
import type { PlayerCard, TeamDecade } from '../../types/draft'

export const PLAYER_POOLS: Readonly<Record<string, readonly PlayerCard[]>> = {
  'nyy-1980s': pool0 as unknown as PlayerCard[],
  'nyy-1990s': pool1 as unknown as PlayerCard[],
  'nyy-2000s': pool2 as unknown as PlayerCard[],
  'nyy-2010s': pool3 as unknown as PlayerCard[],
  'bos-1980s': pool4 as unknown as PlayerCard[],
  'bos-1990s': pool5 as unknown as PlayerCard[],
  'bos-2000s': pool6 as unknown as PlayerCard[],
  'bos-2010s': pool7 as unknown as PlayerCard[],
  'lad-1980s': pool8 as unknown as PlayerCard[],
  'lad-1990s': pool9 as unknown as PlayerCard[],
  'lad-2000s': pool10 as unknown as PlayerCard[],
  'lad-2010s': pool11 as unknown as PlayerCard[],
  'sfg-1980s': pool12 as unknown as PlayerCard[],
  'sfg-1990s': pool13 as unknown as PlayerCard[],
  'sfg-2000s': pool14 as unknown as PlayerCard[],
  'sfg-2010s': pool15 as unknown as PlayerCard[],
  'stl-1980s': pool16 as unknown as PlayerCard[],
  'stl-1990s': pool17 as unknown as PlayerCard[],
  'stl-2000s': pool18 as unknown as PlayerCard[],
  'stl-2010s': pool19 as unknown as PlayerCard[],
  'chc-1980s': pool20 as unknown as PlayerCard[],
  'chc-1990s': pool21 as unknown as PlayerCard[],
  'chc-2000s': pool22 as unknown as PlayerCard[],
  'chc-2010s': pool23 as unknown as PlayerCard[],
  'atl-1980s': pool24 as unknown as PlayerCard[],
  'atl-1990s': pool25 as unknown as PlayerCard[],
  'atl-2000s': pool26 as unknown as PlayerCard[],
  'atl-2010s': pool27 as unknown as PlayerCard[],
  'sea-1980s': pool28 as unknown as PlayerCard[],
  'sea-1990s': pool29 as unknown as PlayerCard[],
  'sea-2000s': pool30 as unknown as PlayerCard[],
  'sea-2010s': pool31 as unknown as PlayerCard[],
  'bal-1980s': pool32 as unknown as PlayerCard[],
  'bal-1990s': pool33 as unknown as PlayerCard[],
  'bal-2000s': pool34 as unknown as PlayerCard[],
  'bal-2010s': pool35 as unknown as PlayerCard[],
  'oak-1980s': pool36 as unknown as PlayerCard[],
  'oak-1990s': pool37 as unknown as PlayerCard[],
  'oak-2000s': pool38 as unknown as PlayerCard[],
  'oak-2010s': pool39 as unknown as PlayerCard[],
  'laa-1980s': pool40 as unknown as PlayerCard[],
  'laa-1990s': pool41 as unknown as PlayerCard[],
  'laa-2000s': pool42 as unknown as PlayerCard[],
  'laa-2010s': pool43 as unknown as PlayerCard[],
  'phi-1980s': pool44 as unknown as PlayerCard[],
  'phi-1990s': pool45 as unknown as PlayerCard[],
  'phi-2000s': pool46 as unknown as PlayerCard[],
  'phi-2010s': pool47 as unknown as PlayerCard[],
}

export const TEAM_DECADES = combinations as TeamDecade[]
export const PLAYER_CARDS = Object.values(PLAYER_POOLS).flat()
