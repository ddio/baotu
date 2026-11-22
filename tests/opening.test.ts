import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { Match, type MatchConfig } from '../src/sim/match'
import { decodeOpening, encodeOpening, MAX_SEED, type Opening, openingConfig, openingOf } from '../src/sim/opening'
import { hashState } from '../src/sim/game'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const id = (name: string) => map.regions.findIndex((r) => r.name === name)

describe('開局的代碼', () => {
  it('編出來再讀回去是同一個開局', () => {
    const o: Opening = { mapVersion: 2, start: 13, opponents: 3, difficulty: 'normal', seed: MAX_SEED }
    expect(encodeOpening(o)).toBe('2-13-3n-zik0zj')
    expect(decodeOpening('2-13-3n-zik0zj')).toEqual(o)
    for (const difficulty of ['easy', 'normal', 'hard'] as const) for (const opponents of [1, 2, 3]) for (const seed of [0, 1, 35, 36, 123456789, MAX_SEED]) {
      const x: Opening = { mapVersion: map.version, start: seed % map.regions.length, opponents, difficulty, seed }
      expect(decodeOpening(encodeOpening(x))).toEqual(x)
    }
  })

  it('看不懂的代碼一律不收', () => {
    for (const bad of ['', '2', '2-13-3n', '2-13-3n-', '2-13-4n-1', '2-13-0n-1', '2-13-3x-1', '2-13-3n-ZIK', '2-13-3n-zik0zk', '2-13-3n-1000000',
      '02-13-3n-1', '2-013-3n-1', '2-13-3n-01', '0-13-3n-1', '-2-13-3n-1', '2-13-3n-1 ', '2-13-3n-1-1', '2.13.3n.1', '2-13-3n-1#', '<script>']) {
      expect(decodeOpening(bad), bad).toBeNull()
    }
  })

  it('同一個代碼開出來的局，起點、對手、種子都跟原本那一局一樣', () => {
    for (const seed of [1, 7, 20260101, MAX_SEED]) for (const players of [3, 4]) {
      const config: MatchConfig = { players, starts: pickStarts(map, id('臺南'), players, seed), human: 1, difficulty: 'hard', seed }
      const again = openingConfig(map, decodeOpening(encodeOpening(openingOf(map, config)))!)
      expect(again).toEqual(config)
      // 沒有人下指令的話，兩邊的電腦打出來一模一樣
      const a = new Match(map, config), b = new Match(map, again!)
      for (let i = 0; i < 600; i++) { a.tick(); b.tick() }
      expect(hashState(b.state)).toBe(hashState(a.state))
      expect(b.commands).toEqual(a.commands)
    }
  })

  it('地圖版本不對、起點不在圖上的開不出來', () => {
    const o: Opening = { mapVersion: map.version, start: 0, opponents: 2, difficulty: 'easy', seed: 5 }
    expect(openingConfig(map, o)).not.toBeNull()
    expect(openingConfig(map, { ...o, mapVersion: map.version - 1 })).toBeNull()
    expect(openingConfig(map, { ...o, mapVersion: map.version + 1 })).toBeNull()
    expect(openingConfig(map, { ...o, start: map.regions.length })).toBeNull()
    expect(openingConfig(map, { ...o, start: map.regions.length - 1 })).not.toBeNull()
  })
})
