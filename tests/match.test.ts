import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { aiThink } from '../src/sim/ai'
import { canSend, createGame, hashState, issue } from '../src/sim/game'
import { Match, type MatchConfig, SAMPLE_TICKS } from '../src/sim/match'
import { Rng } from '../src/sim/rng'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const config = (seed: number, over: Partial<MatchConfig> = {}): MatchConfig => ({
  players: 4, starts: pickStarts(map, seed % 20, 4, seed), human: 0, difficulty: 'normal', seed, ...over,
})
const play = (c: MatchConfig, limit = 12000) => {
  const m = new Match(map, c)
  while (!m.over && m.state.tick < limit) m.tick()
  return m
}

describe('電腦對手', () => {
  it('下的指令都是當下能執行的', () => {
    const m = new Match(map, config(3))
    const rng = new Rng(1)
    for (let t = 0; t < 600; t++) {
      if (t % 30 === 0) for (let p = 1; p <= 4; p++) {
        const used = new Set<number>()
        for (const o of aiThink(m.state, map, m.graph, p, rng, 'hard')) {
          expect(m.state.regions[o.from].owner).toBe(p)
          expect(canSend(m.state, o.from)).toBe(true)
          expect(used.has(o.from)).toBe(false)
          used.add(o.from)
        }
      }
      m.tick()
    }
  })

  it('有敵軍朝這裡來的區留下來守，不出兵', () => {
    const id = (name: string) => map.regions.findIndex((r) => r.name === name)
    const m = new Match(map, config(3))
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const s = createGame(map, { players: 2, starts: [id('臺中'), id('彰化')] })
      s.regions[id('彰化')].units = 40
      // 沒人來打時，彰化的兵會出去打東西
      let seen = false
      for (let seed = 1; seed <= 20; seed++) seen ||= aiThink(s, map, m.graph, 2, new Rng(seed), difficulty).some((o) => o.from === id('彰化'))
      expect(seen).toBe(true)
      // 臺中的兵出發之後，彰化就不動了
      expect(issue(s, map, m.graph, id('臺中'), id('彰化'))).toBe(true)
      for (let seed = 1; seed <= 20; seed++) expect(aiThink(s, map, m.graph, 2, new Rng(seed), difficulty)).toEqual([])
    }
  })

  it('四方都是電腦時打得出結果', () => {
    for (const seed of [1, 2, 3]) {
      const m = play(config(seed))
      expect(m.state.winner).toBeGreaterThan(0)
      expect(m.state.tick).toBeLessThan(12000)
    }
  })

  it('同樣的設定與種子，整局一模一樣', () => {
    const a = play(config(5)), b = play(config(5))
    expect(a.commands).toEqual(b.commands)
    expect(hashState(a.state)).toBe(hashState(b.state))
    expect(play(config(6)).commands).not.toEqual(a.commands)
  })

  it('真人出局就算結束；每隔固定拍數記一次兵力', () => {
    // 真人什麼都不做
    const m = play(config(2, { human: 1, difficulty: 'hard' }))
    expect(m.humanOut).toBe(true)
    expect(m.over).toBe(true)
    expect(m.history.length).toBe(Math.floor(m.state.tick / SAMPLE_TICKS) + 1)
    expect(m.history[0]).toHaveLength(5)
  })
})
