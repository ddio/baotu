// 每一版規則各留一筆真實的記錄（tests/fixtures/records/v<N>.json）。
// 重播出來的結尾雜湊要跟記錄上的一樣，才算那一版的引擎（和當時的地圖）還在、而且沒被動過。
/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasMap, loadMap, MAPS } from '../src/maps'
import { CURRENT, hasEngine, loadEngine, OLDEST_KEPT } from '../src/sim/engines'
import { Match } from '../src/sim/match'
import { makeRecord, openReplay, parseRecord, playable, Replay } from '../src/sim/record'
import { RULES_VERSION } from '../src/sim/rules'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const file = (v: number) => new URL(`./fixtures/records/v${v}.json`, import.meta.url)

// npm run fixture：現行版本還沒有記錄就打一局電腦對電腦的存起來。已經有的不會蓋掉。
if (process.env.FIXTURE && !existsSync(file(RULES_VERSION))) {
  const seed = 7
  const m = new Match(map, { players: 4, starts: pickStarts(map, seed % 20, 4, seed), human: 0, difficulty: 'normal', seed })
  while (!m.over && m.state.tick < 12000) m.tick()
  writeFileSync(file(RULES_VERSION), JSON.stringify(makeRecord(m, 'win', new Date('2026-01-01T00:00:00Z'))) + '\n')
}

describe('每一版規則都還能重播', () => {
  it('現行的引擎就是 RULES_VERSION 那一版', async () => {
    expect(CURRENT.version).toBe(RULES_VERSION)
    expect(await loadEngine(RULES_VERSION)).toBe(CURRENT)
    expect(await loadEngine(OLDEST_KEPT - 1)).toBeNull()
  })

  for (let v = OLDEST_KEPT; v <= RULES_VERSION; v++) {
    it(`規則 v${v}：留著的記錄重播出來跟當時一樣`, async () => {
      expect(existsSync(file(v)), `少了 tests/fixtures/records/v${v}.json。現行版本用 npm run fixture 產生`).toBe(true)
      const rec = parseRecord(JSON.parse(readFileSync(file(v), 'utf8')))!
      expect(rec.rulesVersion).toBe(v)
      expect(hasEngine(v), `少了規則 v${v} 的引擎：改規則之前要先 npm run freeze`).toBe(true)
      expect(hasMap(rec.map, rec.mapVersion), `少了地圖 v${rec.mapVersion}：改地圖之前要先 npm run freeze:map`).toBe(true)
      expect(playable(rec)).toBe(true)
      const engine = (await loadEngine(v))!
      expect(engine.version).toBe(v)
      const old = (await loadMap(rec.map, rec.mapVersion))!
      expect(old.version).toBe(rec.mapVersion)
      const replay = new Replay(rec, old, engine)
      expect(
        replay.faithful,
        v === RULES_VERSION
          ? '規則的行為變了：先 npm run freeze 把舊的凍結起來，RULES_VERSION 加一，再 npm run fixture'
          : `src/sim/v${v}/ 和 src/maps/old/ 是凍結的，不能改`,
      ).toBe(true)
      expect(replay.takes.length).toBeGreaterThan(10)
      // 畫面走的那條路（先下載引擎再重播）也一樣
      const opened = (await openReplay(rec))!
      expect(opened.engine).toBe(engine)
      expect(opened.map).toBe(old)
    })
  }

  it('地圖從第 1 版到現行版都留著', async () => {
    for (let v = 1; v <= map.version; v++) {
      expect(hasMap(map.id, v), `少了地圖 v${v}`).toBe(true)
      expect((await loadMap(map.id, v))?.version).toBe(v)
    }
    expect(await loadMap(map.id, map.version)).toBe(map)
    expect(await loadMap(map.id, map.version + 1)).toBeNull()
    expect(await loadMap('nowhere', 1)).toBeNull()
  })
})
