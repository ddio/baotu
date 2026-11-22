// 凍結：規則 v6（取自 4d1df56）。只用來重播舊記錄，不要改。
import { RULES } from './rules'
import type { GameState, MapData, PlayerId } from './types'

export interface Link {
  to: number
  ticks: number
  kind: 'land' | 'mountain' | 'sea'
  /** 兩個據點在圖上的直線距離 ×10（整數） */
  len: number
}

/** 由地圖資料算出的鄰接表，行軍時間已經換算成拍數。 */
export interface Graph {
  n: number
  links: Link[][]
  /** 有砲台的區 */
  forts: number[]
  /** 各區據點的座標 ×10（整數），算砲台射程用 */
  x: number[]
  y: number[]
}

export function buildGraph(map: MapData): Graph {
  const links: Link[][] = map.regions.map(() => [])
  const x = map.regions.map((r) => Math.round(r.x * 10))
  const y = map.regions.map((r) => Math.round(r.y * 10))
  for (const e of map.edges) {
    const factor = e.kind === 'mountain' ? RULES.mountainFactor : 1
    // km 只到小數一位，先乘 10 變整數，整段都是整數運算
    const kmX10 = Math.round(e.km * 10)
    const ticks = Math.max(RULES.minLegTicks, Math.round((kmX10 * factor) / RULES.speedKmPerTickX10))
    // 整數開根號再捨去，各家瀏覽器算出來都一樣
    const dx = x[e.b] - x[e.a], dy = y[e.b] - y[e.a]
    const len = Math.floor(Math.sqrt(dx * dx + dy * dy))
    links[e.a].push({ to: e.b, ticks, kind: e.kind, len })
    links[e.b].push({ to: e.a, ticks, kind: e.kind, len })
  }
  for (const l of links) l.sort((p, q) => p.to - q.to)
  const forts: number[] = []
  map.regions.forEach((r, i) => { if (r.trait === 'fort') forts.push(i) })
  return {
    n: map.regions.length, links, forts, x, y,
  }
}

/**
 * 在 from → to 這段路上走了 t / legTicks 的軍隊，是不是在 fort 砲台的射程內。
 * 兩邊同乘 legTicks 再比平方，不出現小數。
 */
export function inRange(g: Graph, fort: number, from: number, to: number, t: number, legTicks: number): boolean {
  const dx = (g.x[from] - g.x[fort]) * legTicks + (g.x[to] - g.x[from]) * t
  const dy = (g.y[from] - g.y[fort]) * legTicks + (g.y[to] - g.y[from]) * t
  const reach = RULES.fort.range * 10 * legTicks
  return dx * dx + dy * dy <= reach * reach
}

export function legTicks(g: Graph, from: number, to: number, fast: boolean): number {
  const link = g.links[from].find((l) => l.to === to)
  if (!link) throw new Error(`${from} 與 ${to} 不相鄰`)
  return fast ? Math.max(1, Math.ceil((link.ticks * RULES.postNum) / RULES.postDen)) : link.ticks
}

/**
 * 要在 to 停下來的軍隊，走到第幾拍就到城外（離據點 RULES.gate）。
 * 攻城和進駐都停在這裡，不走到據點中心。
 */
export function gateTick(g: Graph, from: number, to: number, legTicks: number): number {
  const link = g.links[from].find((l) => l.to === to)
  if (!link) throw new Error(`${from} 與 ${to} 不相鄰`)
  return Math.max(1, legTicks - Math.floor((RULES.gate * 10 * legTicks) / link.len))
}

/** 在 from → to 這段路上走了 t / legTicks 的軍隊，在圖上的位置 ×10（整數）。 */
export function posOf(g: Graph, from: number, to: number, t: number, legTicks: number): [number, number] {
  return [
    g.x[from] + Math.trunc(((g.x[to] - g.x[from]) * t) / legTicks),
    g.y[from] + Math.trunc(((g.y[to] - g.y[from]) * t) / legTicks),
  ]
}

export interface Reach {
  /** 到各區要幾拍；到不了是 Infinity */
  dist: number[]
  prev: number[]
}

/**
 * 從 from 出發、以 owner 的身分能到哪些區。
 * 中途只能經過自己的區；終點可以是任何區。
 * anywhere 為 true 時不管是誰的區都當成能通過（用來替打不到的遠處找路）。
 */
export function reach(g: Graph, state: GameState, from: number, owner: PlayerId, fast: boolean, anywhere = false): Reach {
  const dist = new Array<number>(g.n).fill(Infinity)
  const prev = new Array<number>(g.n).fill(-1)
  const done = new Array<boolean>(g.n).fill(false)
  dist[from] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < g.n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0) break
    done[u] = true
    // 不是自己的區只能當終點，不能再往下走
    if (!anywhere && u !== from && state.regions[u].owner !== owner) continue
    for (const l of g.links[u]) {
      const t = fast ? Math.max(1, Math.ceil((l.ticks * RULES.postNum) / RULES.postDen)) : l.ticks
      const d = dist[u] + t
      if (d < dist[l.to]) { dist[l.to] = d; prev[l.to] = u }
    }
  }
  return { dist, prev }
}

export function pathTo(r: Reach, to: number): number[] | null {
  if (r.dist[to] === Infinity) return null
  const path = [to]
  for (let u = r.prev[to]; u >= 0; u = r.prev[u]) path.push(u)
  return path.reverse()
}

/**
 * 從 from 派兵到 to 會走哪條路（含起點與終點）。
 * 能只經過自己的區就走其中最快的；不行就走全圖最快的路，
 * 這時軍隊會在路上第一個不是自己的區停下來開打，打贏也留在那裡。
 */
export function route(g: Graph, state: GameState, from: number, owner: PlayerId, fast: boolean, to: number): number[] | null {
  if (from === to) return null
  return pathTo(reach(g, state, from, owner, fast), to) ?? pathTo(reach(g, state, from, owner, fast, true), to)
}

/** 照這條路走，會在第幾站停下來：路上第一個不是自己的區，都是自己的就是終點。 */
export function stopIndex(state: GameState, path: number[], owner: PlayerId): number {
  for (let i = 1; i < path.length; i++) if (state.regions[path[i]].owner !== owner) return i
  return path.length - 1
}
