import { describe, expect, it } from 'vitest'
import { loadMap, MAPS } from '../src/maps'
import { buildGraph, gateTick, inRange, legTicks, posOf } from '../src/sim/graph'
import { RULES } from '../src/sim/rules'

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

  it('澎湖的砲打得比別的砲台遠，但打不到本島任何一個據點', () => {
    const g = buildGraph(map)
    const far = RULES.fort.far as Record<string, number>
    for (const f of g.forts) expect(g.range[f]).toBe((far[map.regions[f].id] ?? RULES.fort.range) * 10)
    expect(g.range[id('澎湖')]).toBeGreaterThan(g.range[id('基隆')])
    // 射程裡有別人的據點的話，沒人佔的澎湖會從開局就一直打那一區進出的軍隊
    map.regions.forEach((_, i) => { if (i !== id('澎湖')) expect(inRange(g, id('澎湖'), g.x[i], g.y[i])).toBe(false) })
    // 往鹽水港的航線大半在射程裡
    const [x, y] = [(g.x[id('澎湖')] + g.x[id('鹽水港')]) >> 1, (g.y[id('澎湖')] + g.y[id('鹽水港')]) >> 1]
    expect(inRange(g, id('澎湖'), x, y)).toBe(true)
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
  })

  const lineOf = (e: (typeof map.edges)[number]) => [[map.regions[e.a].x, map.regions[e.a].y], ...(e.via ?? []), [map.regions[e.b].x, map.regions[e.b].y]]
  /** 一個點離一條折線多遠 */
  const away = (x: number, y: number, pts: number[][]) => {
    let best = Infinity
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], dx = pts[i][0] - ax, dy = pts[i][1] - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y))
    }
    return best
  }

  it('繞開第三個據點的路有八條，其他的陸路和航線都是直的', () => {
    const bent = map.edges.filter((e) => e.via && e.kind !== 'rough').map((e) => `${map.regions[e.a].name}—${map.regions[e.b].name}`)
    expect(bent.sort()).toEqual(['基隆—宜蘭', '新竹—臺中', '嘉義—臺南', '鳳山—澎湖', '臺南—澎湖', '南投—嘉義', '深坑—桃仔園', '宜蘭—桃仔園'].sort())
  })

  it('每條連線都不從別的據點旁邊擦過去，也碰不到在那裡城外紮營的軍隊', () => {
    const g = buildGraph(map)
    // 每個據點城外會有軍隊停下來的位置：每一條通往它的路上、離它 RULES.gate 的地方（驛站出發的走得快，停的那一拍不一樣）
    const camps: { at: number; x: number; y: number }[] = []
    map.regions.forEach((_, to) => {
      for (const l of g.links[to]) for (const fast of [false, true]) {
        const T = legTicks(g, l.to, to, fast)
        const [x, y] = posOf(g, l.to, to, gateTick(g, l.to, to, T), T)
        camps.push({ at: to, x: x / 10, y: y / 10 })
      }
    })
    for (const e of map.edges) {
      const pts = lineOf(e)
      map.regions.forEach((r, i) => { if (i !== e.a && i !== e.b) expect(away(r.x, r.y, pts)).toBeGreaterThan(45) })
      for (const c of camps) if (c.at !== e.a && c.at !== e.b) expect(away(c.x, c.y, pts)).toBeGreaterThan(RULES.clashRange)
    }
  })

  it('繞路只改走在圖上的哪裡：每條連線的行軍時間跟上一版地圖一樣', async () => {
    const old = buildGraph((await loadMap(map.id, 2))!), now = buildGraph(map)
    expect(now.links.map((ls) => ls.map((l) => [l.to, l.ticks, l.kind]))).toEqual(old.links.map((ls) => ls.map((l) => [l.to, l.ticks, l.kind])))
    // 畫出來的線比直線長，但不會長太多（走起來不會快得不像話）
    for (const e of map.edges) if (e.via && e.kind !== 'rough') {
      const pts = lineOf(e)
      let len = 0
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      const straight = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
      expect(len / straight).toBeGreaterThan(1)
      expect(len / straight).toBeLessThan(1.3)
    }
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
