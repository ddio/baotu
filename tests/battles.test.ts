// 重播整理出來的戰役（src/sim/battles.ts）：圍城守住、圍城易手、路上遭遇，折損各算在誰頭上。
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { OLDEST_KEPT } from '../src/sim/engines'
import { type GameRecord, openReplay, parseRecord, RECORD_FORMAT, Replay } from '../src/sim/record'
import { RULES, RULES_VERSION } from '../src/sim/rules'

const map = MAPS.taiwan1901
const at = (name: string) => map.regions.findIndex((r) => r.name === name)
const MIAOLI = at('苗栗'), TAICHU = at('臺中'), SHINCHIKU = at('新竹'), SHOKA = at('彰化')

/** 手寫一局：兩家，1 號在苗栗、2 號在臺中（隔一段平路），指令照給的下 */
const game = (commands: number[], ticks: number): Replay => {
  const rec: GameRecord = {
    format: RECORD_FORMAT, id: 'battle', date: '2026-11-23T00:00:00.000Z', map: map.id, mapVersion: map.version,
    rulesVersion: RULES_VERSION,
    config: { players: 2, starts: [MIAOLI, TAICHU], human: 1, difficulty: 'normal', seed: 1 },
    commands, ticks, result: 'quit', hash: 0,
  }
  return new Replay(rec, map)
}

describe('重播整理出來的戰役', () => {
  it('攻城沒打下來：攻方打光，守方少掉一樣多，記成一場守住的圍城', () => {
    const r = game([0, MIAOLI, TAICHU], 200)
    expect(r.takes).toEqual([])
    expect(r.battles).toHaveLength(1)
    const [b] = r.battles
    expect(b).toMatchObject({ kind: 'held', region: TAICHU, attacker: 1, defender: 2, other: -1 })
    expect(b.lost).toEqual([0, RULES.startUnits, RULES.startUnits])
    // 一拍換一個，打了 20 拍；記的是最後一個兵倒下之後的那一拍
    expect(b.tick - b.start).toBe(RULES.startUnits - 1)
    r.seek(b.tick - 1)
    expect(r.state.armies).toHaveLength(1)
    r.seek(b.tick)
    expect(r.state.armies).toHaveLength(0)
  })

  it('兩軍在路上撞見：各折一樣多，記成一場遭遇，地點是那一段路的兩頭', () => {
    const r = game([0, MIAOLI, TAICHU, 0, TAICHU, MIAOLI], 200)
    expect(r.takes).toEqual([])
    expect(r.battles).toHaveLength(1)
    const [b] = r.battles
    expect(b).toMatchObject({ kind: 'field', attacker: 0, defender: 0 })
    expect(b.lost).toEqual([0, RULES.startUnits, RULES.startUnits])
    expect([b.region, b.other].sort()).toEqual([MIAOLI, TAICHU].sort())
  })

  it('打下來的：圍城記成易手，跟 takes 同一拍；進城的兵不算折損', () => {
    // 2 號把兵調去彰化，臺中只剩剛長出來的幾個
    const r = game([0, TAICHU, SHOKA, 0, MIAOLI, TAICHU], 300)
    const take = r.takes.find((e) => e.region === TAICHU)!
    expect(take).toMatchObject({ from: 2, to: 1 })
    const b = r.battles.find((x) => x.region === TAICHU)!
    expect(b).toMatchObject({ kind: 'fell', attacker: 1, defender: 2, tick: take.tick })
    expect(b.lost[1]).toBe(b.lost[2])
    expect(b.lost[1]).toBeGreaterThan(0)
    expect(b.lost[1]).toBeLessThan(8)
    // 整局 1 號只折了這幾個：進臺中、之後在城裡的都不算
    expect(r.battles.reduce((n, x) => n + x.lost[1], 0)).toBe(b.lost[1])
  })

  it('打中立：守軍記在 0 號；打完調回自己的城不算一場仗', () => {
    const r = game([0, MIAOLI, SHINCHIKU, 120, SHINCHIKU, MIAOLI], 300)
    expect(r.battles).toHaveLength(1)
    expect(r.battles[0]).toMatchObject({ kind: 'fell', region: SHINCHIKU, attacker: 1, defender: 0 })
    expect(r.battles[0].lost).toEqual([RULES.neutral.post, RULES.neutral.post, 0])
  })

  it('整局電腦對打：照時間排，易手的每一場都對得上一次易手，守住的那幾場城沒換人', () => {
    const rec = parseRecord(JSON.parse(readFileSync(new URL(`./fixtures/records/v${RULES_VERSION}.json`, import.meta.url), 'utf8')))!
    const r = new Replay(rec, map)
    expect(r.faithful).toBe(true)
    expect(r.battles.length).toBeGreaterThan(20)
    expect(r.battles.map((b) => b.tick)).toEqual(r.battles.map((b) => b.tick).sort((x, y) => x - y))
    for (const kind of ['held', 'fell', 'field'] as const) expect(r.battles.some((b) => b.kind === kind)).toBe(true)
    for (const b of r.battles) {
      expect(b.start).toBeLessThanOrEqual(b.tick)
      expect(b.tick).toBeLessThanOrEqual(rec.ticks)
      expect(b.lost.every((n) => n >= 0)).toBe(true)
      expect(b.lost.reduce((x, y) => x + y, 0)).toBeGreaterThan(0)
      if (b.kind === 'field') { expect(b.lost.filter((n) => n > 0).length).toBeGreaterThanOrEqual(1); continue }
      expect(b.attacker).not.toBe(b.defender)
      const changed = r.takes.filter((e) => e.region === b.region && e.tick >= b.start && e.tick <= b.tick)
      if (b.kind === 'fell') expect(changed.some((e) => e.tick === b.tick)).toBe(true)
      else expect(changed).toEqual([])
    }
  })

  for (let v = OLDEST_KEPT; v < RULES_VERSION; v++) {
    it(`規則 v${v} 的舊記錄也整理得出來`, async () => {
      const rec = parseRecord(JSON.parse(readFileSync(new URL(`./fixtures/records/v${v}.json`, import.meta.url), 'utf8')))!
      const r = (await openReplay(rec))!
      expect(r.faithful).toBe(true)
      expect(r.battles.length).toBeGreaterThan(10)
      for (const kind of ['held', 'fell', 'field'] as const) expect(r.battles.some((b) => b.kind === kind)).toBe(true)
    })
  }
})
