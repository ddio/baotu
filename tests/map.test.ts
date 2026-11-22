import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'

const map = MAPS.taiwan1901
const id = (name: string) => map.regions.findIndex((r) => r.name === name)
const edge = (a: string, b: string) =>
  map.edges.find((e) => (e.a === id(a) && e.b === id(b)) || (e.a === id(b) && e.b === id(a)))

describe('臺灣二十廳地圖', () => {
  it('有 21 區、43 條連線（一般 30、山路 10、航線 3）', () => {
    expect(map.regions).toHaveLength(21)
    expect(map.edges).toHaveLength(43)
    const count = (k: string) => map.edges.filter((e) => e.kind === k).length
    expect([count('land'), count('mountain'), count('sea')]).toEqual([30, 10, 3])
  })

  it('區的代號與名稱都不重複', () => {
    expect(new Set(map.regions.map((r) => r.id)).size).toBe(21)
    expect(new Set(map.regions.map((r) => r.name)).size).toBe(21)
  })

  it('連線沒有重複，也沒有自己連自己', () => {
    const keys = map.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of map.edges) {
      expect(e.a).not.toBe(e.b)
      expect(e.km).toBeGreaterThan(0)
    }
  })

  it('全圖連通', () => {
    const seen = new Set([0])
    const queue = [0]
    while (queue.length) {
      const u = queue.pop()!
      for (const e of map.edges) {
        const v = e.a === u ? e.b : e.b === u ? e.a : -1
        if (v >= 0 && !seen.has(v)) { seen.add(v); queue.push(v) }
      }
    }
    expect(seen.size).toBe(21)
  })

  it('澎湖只靠三條航線：鹽水港、臺南、鳳山', () => {
    const lanes = map.edges.filter((e) => e.a === id('澎湖') || e.b === id('澎湖'))
    expect(lanes.every((e) => e.kind === 'sea')).toBe(true)
    const others = lanes.map((e) => map.regions[e.a === id('澎湖') ? e.b : e.a].name).sort()
    expect(others).toEqual(['臺南', '鳳山', '鹽水港'].sort())
  })

  it('翻越中央山脈的都是山路，西部平原的不是', () => {
    expect(edge('花蓮港', '南投')?.kind).toBe('mountain')
    expect(edge('臺東', '阿猴')?.kind).toBe('mountain')
    expect(edge('宜蘭', '桃仔園')?.kind).toBe('mountain')
    expect(edge('臺北', '基隆')?.kind).toBe('land')
    expect(edge('花蓮港', '臺東')?.kind).toBe('land')
    expect(edge('臺北', '宜蘭')).toBeUndefined()
  })

  it('據點都在畫布內，彼此不會擠在一起', () => {
    for (const r of map.regions) {
      expect(r.x).toBeGreaterThan(0)
      expect(r.x).toBeLessThan(map.width)
      expect(r.y).toBeGreaterThan(0)
      expect(r.y).toBeLessThan(map.height)
    }
    for (let a = 0; a < 21; a++) for (let b = a + 1; b < 21; b++) {
      const d = Math.hypot(map.regions[a].x - map.regions[b].x, map.regions[a].y - map.regions[b].y)
      expect(d).toBeGreaterThan(60)
    }
  })

  it('每一區都有外框，每條陸上連線都有對應的邊界', () => {
    for (const r of map.regions) expect(r.d.startsWith('M')).toBe(true)
    expect(map.borders).toHaveLength(40)
  })
})
