import { describe, expect, it } from 'vitest'
import { loadMap, MAPS } from '../src/maps'

const map = MAPS.taiwan1901
const id = (name: string) => map.regions.findIndex((r) => r.name === name)
const edge = (a: string, b: string) =>
  map.edges.find((e) => (e.a === id(a) && e.b === id(b)) || (e.a === id(b) && e.b === id(a)))

describe('臺灣二十廳地圖', () => {
  it('有 22 區、46 條連線（一般 30、山路 10、航線 5、險航線 1）', () => {
    expect(map.regions).toHaveLength(22)
    expect(map.edges).toHaveLength(46)
    const count = (k: string) => map.edges.filter((e) => e.kind === k).length
    expect([count('land'), count('mountain'), count('sea'), count('rough')]).toEqual([30, 10, 5, 1])
  })

  it('舊版就有的區，編號和代號都沒變（記錄裡存的是編號）', async () => {
    for (let v = 1; v < map.version; v++) {
      const old = (await loadMap(map.id, v))!
      expect(map.regions.slice(0, old.regions.length).map((r) => r.id)).toEqual(old.regions.map((r) => r.id))
    }
  })

  it('區的代號與名稱都不重複', () => {
    expect(new Set(map.regions.map((r) => r.id)).size).toBe(22)
    expect(new Set(map.regions.map((r) => r.name)).size).toBe(22)
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
    expect(seen.size).toBe(22)
  })

  const lanesOf = (name: string) => map.edges
    .filter((e) => e.a === id(name) || e.b === id(name))
    .map((e) => `${map.regions[e.a === id(name) ? e.b : e.a].name}:${e.kind}`).sort()

  it('澎湖只靠航線：鹽水港、臺南、鳳山三條，加一條往臺北的險航線', () => {
    expect(lanesOf('澎湖')).toEqual(['臺南:sea', '鳳山:sea', '鹽水港:sea', '臺北:rough'].sort())
  })

  it('紅頭嶼只靠兩條航線：臺東、恆春', () => {
    expect(lanesOf('紅頭嶼')).toEqual(['臺東:sea', '恆春:sea'].sort())
    expect(map.regions[id('紅頭嶼')].trait).toBe('none')
  })

  it('險航線是一條繞過西海岸的線：比直線長，離沿途的據點夠遠，不出圖框', () => {
    const e = edge('澎湖', '臺北')!
    const a = map.regions[e.a], b = map.regions[e.b]
    const pts = [[a.x, a.y], ...e.via!, [b.x, b.y]]
    let len = 0
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    expect(len).toBeGreaterThan(Math.hypot(b.x - a.x, b.y - a.y) * 1.05)
    expect(e.km).toBeGreaterThan(250)
    for (const [x, y] of e.via!) {
      expect(x).toBeGreaterThan(10)
      expect(x).toBeLessThan(map.width - 10)
      expect(y).toBeGreaterThan(10)
      expect(y).toBeLessThan(map.height - 10)
      // 比遭遇的距離（36）遠得多：路過的船不會跟岸上的軍隊打起來
      map.regions.forEach((r, i) => { if (i !== e.a && i !== e.b) expect(Math.hypot(r.x - x, r.y - y)).toBeGreaterThan(60) })
    }
    // 其他的連線都是直的
    expect(map.edges.filter((x) => x.via)).toEqual([e])
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
    for (let a = 0; a < map.regions.length; a++) for (let b = a + 1; b < map.regions.length; b++) {
      const d = Math.hypot(map.regions[a].x - map.regions[b].x, map.regions[a].y - map.regions[b].y)
      expect(d).toBeGreaterThan(60)
    }
  })

  it('每一區都有外框，每條陸上連線都有對應的邊界', () => {
    for (const r of map.regions) expect(r.d.startsWith('M')).toBe(true)
    expect(map.borders).toHaveLength(40)
  })
})
