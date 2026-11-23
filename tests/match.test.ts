import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { AI_PROFILE, aiThink } from '../src/sim/ai'
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

  it('「強」會顧家：隔壁有別家的重兵，就不為了一塊地把家派空', () => {
    const id = (name: string) => map.regions.findIndex((r) => r.name === name)
    const m = new Match(map, config(3))
    const reckless = { ...AI_PROFILE.hard, careful: false }
    const setup = (taichung: number) => {
      const s = createGame(map, { players: 2, starts: [id('臺中'), id('南投')] })
      s.regions[id('臺中')].units = taichung
      s.regions[id('南投')].units = 25
      return s
    }
    // 臺中屯了 30 個兵：不顧家的照樣出門搶地，顧家的不動
    let s = setup(30)
    let seen = false
    for (let seed = 1; seed <= 20; seed++) seen ||= aiThink(s, map, m.graph, 2, new Rng(seed), reckless).length > 0
    expect(seen).toBe(true)
    for (let seed = 1; seed <= 20; seed++) {
      // 只有比自己這一區值錢的地方（驛站、砲台、城）才值得拿家去換
      for (const o of aiThink(s, map, m.graph, 2, new Rng(seed), 'hard')) expect(map.regions[o.to].trait).not.toMatch(/none|granary/)
    }
    // 臺中只剩幾個兵（走過來的時間南投自己就長回來了）：照常出門
    s = setup(3)
    seen = false
    for (let seed = 1; seed <= 20; seed++) seen ||= aiThink(s, map, m.graph, 2, new Rng(seed), 'hard').length > 0
    expect(seen).toBe(true)
  })

  it('「強」補防缺多少補多少：別的區被打，不會整條前線都跑去救', () => {
    const id = (name: string) => map.regions.findIndex((r) => r.name === name)
    const m = new Match(map, config(3))
    const reckless = { ...AI_PROFILE.hard, careful: false }
    const s = createGame(map, { players: 2, starts: [id('臺中'), id('彰化')] })
    // 中立的區都屯重兵，免得電腦跑去打別的
    for (const r of s.regions) if (r.owner === 0) r.units = 90
    const own = (name: string, owner: 1 | 2, units: number) => Object.assign(s.regions[id(name)], { owner, units })
    own('臺中', 1, 60)
    own('苗栗', 1, 40)
    own('彰化', 2, 10)
    own('南投', 2, 25)
    own('斗六', 2, 25)
    // 苗栗的 40 個兵穿過臺中去打彰化（10 個兵，走到的時候也長不到 40）
    expect(issue(s, map, m.graph, id('苗栗'), id('彰化'))).toBe(true)
    const helpers = (difficulty: Parameters<typeof aiThink>[5]) =>
      aiThink(s, map, m.graph, 2, new Rng(1), difficulty).filter((o) => o.to === id('彰化')).map((o) => map.regions[o.from].name).sort()
    // 不顧家的：南投、斗六都整區跑去救，南投隔壁臺中的 60 個兵就能走進空城
    expect(helpers(reckless)).toEqual(['南投', '斗六'].sort())
    // 顧家的：只有斗六去，南投留著看住臺中
    expect(helpers('hard')).toEqual(['斗六'])
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
