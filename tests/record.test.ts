import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { Match, type MatchConfig } from '../src/sim/match'
import { OLDEST_KEPT } from '../src/sim/engines'
import { addRecord, type GameRecord, makeRecord, MAX_RECORDS, openReplay, parseRecord, playable, Replay } from '../src/sim/record'
import { RULES_VERSION } from '../src/sim/rules'
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

describe('記錄與重播', () => {
  const m = play(config(7))
  const rec = makeRecord(m, 'win', new Date('2026-11-22T10:00:00Z'))

  it('重播會回到一樣的結局', () => {
    const r = new Replay(rec, map)
    expect(r.faithful).toBe(true)
    expect(r.history).toEqual(m.history)
    r.seek(rec.ticks)
    expect(r.hash()).toBe(rec.hash)
    expect(r.state.winner).toBe(m.state.winner)
  })

  it('直接跳到某一拍，跟一拍一拍走到那裡一樣；也可以往回跳', () => {
    const a = new Replay(rec, map), b = new Replay(rec, map)
    const mid = Math.floor(rec.ticks / 2)
    a.seek(mid)
    for (let i = 0; i < mid; i++) b.step()
    expect(a.hash()).toBe(b.hash())
    a.seek(rec.ticks)
    a.seek(mid)
    expect(a.hash()).toBe(b.hash())
  })

  it('重播先把整局的易手記下來：哪一拍、哪一區、從誰換到誰', () => {
    const r = new Replay(rec, map)
    expect(r.takes.length).toBeGreaterThan(10)
    expect(r.takes.map((e) => e.tick)).toEqual(r.takes.map((e) => e.tick).sort((x, y) => x - y))
    for (const e of r.takes.filter((_, i) => i % 5 === 0)) {
      expect(e.from).not.toBe(e.to)
      r.seek(e.tick - 1)
      expect(r.state.regions[e.region].owner).toBe(e.from)
      r.seek(e.tick)
      expect(r.state.regions[e.region].owner).toBe(e.to)
    }
    // 最後贏的那一方，手上的區都是打下來的或起點
    r.seek(rec.ticks)
    const last = new Map(r.takes.map((e) => [e.region, e.to]))
    r.state.regions.forEach((x, i) => { if (last.has(i)) expect(x.owner).toBe(last.get(i)) })
  })

  it('中途放棄的局也能重播', () => {
    const half = new Match(map, config(8, { human: 1 }))
    for (let i = 0; i < 300; i++) {
      if (i === 5) half.order(half.config.starts[0], half.graph.links[half.config.starts[0]][0].to)
      half.tick()
    }
    const r = new Replay(makeRecord(half, 'quit', new Date()), map)
    expect(r.faithful).toBe(true)
    r.seek(300)
    expect(r.done).toBe(true)
  })

  it('指令被改過就對不上雜湊', () => {
    const bad = { ...rec, commands: rec.commands.slice(0, rec.commands.length - 300) }
    expect(new Replay(bad, map).faithful).toBe(false)
  })

  it('匯出再匯入是同一筆；不像樣的東西會被擋下', () => {
    expect(parseRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec)
    expect(parseRecord(null)).toBeNull()
    expect(parseRecord('x')).toBeNull()
    expect(parseRecord({})).toBeNull()
    expect(parseRecord({ ...rec, commands: [1, 2] })).toBeNull()
    expect(parseRecord({ ...rec, commands: [0, 1, -2] })).toBeNull()
    expect(parseRecord({ ...rec, result: 'draw' })).toBeNull()
    expect(parseRecord({ ...rec, config: { ...rec.config, starts: [0, 0, 1, 2] } })).toBeNull()
    expect(parseRecord({ ...rec, config: { ...rec.config, difficulty: 'god' } })).toBeNull()
    expect(parseRecord({ ...rec, date: 'yesterday' })).toBeNull()
  })

  it('指到不存在的區：起點會被拒絕，指令則被略過', () => {
    expect(() => new Replay({ ...rec, config: { ...rec.config, starts: [0, 1, 2, 99] } }, map)).toThrow()
    const odd = { ...rec, commands: [0, 99, 1, ...rec.commands] }
    expect(new Replay(odd, map).faithful).toBe(true)
  })

  it('沒有留著那一版規則、或地圖版本不同的記錄不能重播', async () => {
    expect(playable(rec, MAPS)).toBe(true)
    expect((await openReplay(rec, MAPS))?.faithful).toBe(true)
    expect(playable({ ...rec, rulesVersion: RULES_VERSION + 1 }, MAPS)).toBe(false)
    expect(await openReplay({ ...rec, rulesVersion: RULES_VERSION + 1 }, MAPS)).toBeNull()
    expect(playable({ ...rec, rulesVersion: OLDEST_KEPT - 1 }, MAPS)).toBe(false)
    expect(playable({ ...rec, mapVersion: map.version + 1 }, MAPS)).toBe(false)
    expect(playable({ ...rec, map: 'nowhere' }, MAPS)).toBe(false)
  })

  it('最多留 32 筆，新的在前，同一筆不重複', () => {
    let list: GameRecord[] = []
    for (let i = 0; i < 40; i++) {
      list = addRecord(list, { ...rec, id: 'r' + i, date: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })
    }
    expect(list).toHaveLength(MAX_RECORDS)
    expect(list[0].id).toBe('r39')
    expect(list[MAX_RECORDS - 1].id).toBe('r8')
    expect(addRecord(list, list[3])).toHaveLength(MAX_RECORDS)
    // 匯入一筆很舊的：排在最後，擠不進去就不留
    expect(addRecord(list, { ...rec, id: 'old', date: '2020-01-01T00:00:00.000Z' }).some((r) => r.id === 'old')).toBe(false)
  })
})
