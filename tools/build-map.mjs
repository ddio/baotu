// 由 taiwan-atlas 的鄉鎮界，依 taiwan1901.config.mjs 歸併成遊戲用的地圖資料。
// 用法：npm run build:map
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { merge, mesh } from 'topojson-client'
import { presimplify, simplify, quantile } from 'topojson-simplify'
import * as C from './taiwan1901.config.mjs'

const require = createRequire(import.meta.url)
const raw = JSON.parse(readFileSync(require.resolve('taiwan-atlas/towns-10t.json'), 'utf8'))
// 在拓樸層簡化，相鄰兩區共用的邊界才會維持同一條線
const pre = presimplify(raw)
const topo = simplify(pre, quantile(pre, C.KEEP_POINTS))
const geoms = topo.objects.towns.geometries

// ---- 鄉鎮 → 區 ----
const explicit = new Map(), rest = new Map()
C.REGIONS.forEach((r, i) => {
  for (const [county, towns] of Object.entries(r.towns)) for (const t of towns) {
    if (t === '*') rest.set(county, i)
    else {
      const k = county + t
      if (explicit.has(k)) throw new Error('重複指定：' + k)
      explicit.set(k, i)
    }
  }
})
const known = new Set(geoms.map((g) => g.properties.COUNTYNAME + g.properties.TOWNNAME))
for (const k of explicit.keys()) if (!known.has(k)) throw new Error('找不到鄉鎮：' + k)
const regionOf = (g) => {
  const p = g.properties
  return explicit.get(p.COUNTYNAME + p.TOWNNAME) ?? rest.get(p.COUNTYNAME) ?? -1
}
const members = C.REGIONS.map(() => [])
for (const g of geoms) { const i = regionOf(g); if (i >= 0) members[i].push(g) }

// ---- 投影 ----
const K = Math.cos((23.7 * Math.PI) / 180)
const { lon0, lon1, lat0, lat1 } = C.BBOX
const S = C.HEIGHT / ((lat1 - lat0) * (110.57 / 111.32))
const WIDTH = Math.round((lon1 - lon0) * K * S)
const r1 = (v) => Math.round(v * 10) / 10
const project = ([lon, lat], shift = [0, 0]) =>
  [r1((lon + shift[0] - lon0) * K * S), r1((lat1 - lat - shift[1]) * S * (110.57 / 111.32))]
const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.32 * K, (a[1] - b[1]) * 110.57)
const inBox = (ring) => ring.some(([x, y]) => x >= lon0 - 0.3 && x <= lon1 && y >= lat0 && y <= lat1)
const ringArea = (ring) => {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return (Math.abs(s) / 2) * 111.32 * K * 110.57
}
const toPath = (line, shift, close) => {
  const pts = []
  for (const p of line) {
    const q = project(p, shift)
    const last = pts[pts.length - 1]
    if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q)
  }
  return 'M' + pts.map((p) => p.join(',')).join('L') + (close ? 'Z' : '')
}
const pointInRing = ([x, y], ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ---- 各區外框 ----
const regions = C.REGIONS.map((r, i) => {
  const shift = C.SHIFT[r.id]
  const mp = merge(topo, members[i])
  const outer = mp.coordinates.map((poly) => poly[0]).filter((ring) => inBox(ring) && ringArea(ring) >= C.MIN_ISLAND_KM2)
  if (!outer.some((ring) => pointInRing(r.node, ring))) throw new Error('據點不在區內：' + r.name)
  const [x, y] = project(r.node, shift)
  return {
    id: r.id, name: r.name, today: r.today, trait: r.trait, x, y,
    area: Math.round(outer.reduce((s, ring) => s + ringArea(ring), 0)),
    d: outer.map((ring) => toPath(ring, shift, true)).join(''),
  }
})

// ---- 連線與邊界 ----
const idx = Object.fromEntries(C.REGIONS.map((r, i) => [r.id, i]))
const pairKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a)
const kindOf = new Map()
for (const [a, b] of C.MOUNTAIN) kindOf.set(pairKey(idx[a], idx[b]), 'mountain')
const edges = [], borders = []
for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
  const m = mesh(topo, topo.objects.towns, (g, h) => {
    const p = regionOf(g), q = regionOf(h)
    return (p === a && q === b) || (p === b && q === a)
  })
  if (!m.coordinates.length) continue
  const kind = kindOf.get(pairKey(a, b)) ?? 'land'
  kindOf.delete(pairKey(a, b))
  edges.push({ a, b, kind, km: r1(km(C.REGIONS[a].node, C.REGIONS[b].node)) })
  borders.push({ a, b, kind, d: m.coordinates.map((line) => toPath(line, undefined, false)).join('') })
}
if (kindOf.size) throw new Error('設定為山路的兩區並不相鄰：' + [...kindOf.keys()])
for (const [p, q] of C.SEA) {
  const a = Math.min(idx[p], idx[q]), b = Math.max(idx[p], idx[q])
  edges.push({ a, b, kind: 'sea', km: r1(km(C.REGIONS[a].node, C.REGIONS[b].node)) })
}

const out = { id: C.MAP_ID, name: C.MAP_NAME, version: C.MAP_VERSION, width: WIDTH, height: C.HEIGHT, regions, edges, borders }
const file = new URL('../src/maps/taiwan1901.json', import.meta.url)
writeFileSync(file, JSON.stringify(out) + '\n')

// ---- 報告 ----
const count = (k) => edges.filter((e) => e.kind === k).length
console.log(`${regions.length} 區，連線 ${edges.length}（一般 ${count('land')}、山路 ${count('mountain')}、航線 ${count('sea')}），畫布 ${WIDTH}×${C.HEIGHT}`)
let min = Infinity, minPair = ''
for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
  const d = Math.hypot(regions[a].x - regions[b].x, regions[a].y - regions[b].y)
  if (d < min) { min = d; minPair = regions[a].name + '—' + regions[b].name }
}
console.log(`據點最近的兩區：${minPair}，相距 ${min.toFixed(0)} 單位`)
console.log(`檔案大小 ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
