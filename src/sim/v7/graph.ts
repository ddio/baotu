// 凍結：規則 v7（取自 acf686b）。只用來重播舊記錄，不要改。
import { RULES } from './rules'
import type { EdgeKind, GameState, MapData, PlayerId } from './types'

export interface Link {
  to: number
  ticks: number
  kind: EdgeKind
  /** 這條路在圖上的長度 ×10（整數）。直的就是兩個據點的距離，轉彎的航線是每一小段加起來 */
  len: number
  /** 這條路從這一頭走到 to 經過的點，座標 ×10（整數）：x0, y0, x1, y1, … 直的只有兩頭 */
  pts: number[]
  /** 走到第 i 個點時已經走了多長（×10）：cum[0] 是 0，最後一個是 len */
  cum: number[]
}

/** 走海路的連線：一般航線和險航線 */
export const bySea = (kind: EdgeKind): boolean => kind === 'sea' || kind === 'rough'

/** 由地圖資料算出的鄰接表，行軍時間已經換算成拍數。 */
export interface Graph {
  n: number
  links: Link[][]
  /** 有砲台的區 */
  forts: number[]
  /** 各區據點的座標 ×10（整數），算砲台射程用 */
  x: number[]
  y: number[]
  /** 各區砲台的射程 ×10（整數）；不是砲台的區是 0 */
  range: number[]
}

export function buildGraph(map: MapData): Graph {
  const links: Link[][] = map.regions.map(() => [])
  const x = map.regions.map((r) => Math.round(r.x * 10))
  const y = map.regions.map((r) => Math.round(r.y * 10))
  for (const e of map.edges) {
    const factor = e.kind === 'mountain' ? RULES.mountainFactor : e.kind === 'rough' ? RULES.roughFactor : 1
    // km 只到小數一位，先乘 10 變整數，整段都是整數運算
    const kmX10 = Math.round(e.km * 10)
    const ticks = Math.max(RULES.minLegTicks, Math.round((kmX10 * factor) / RULES.speedKmPerTickX10))
    const pts = [x[e.a], y[e.a]]
    for (const [vx, vy] of e.via ?? []) pts.push(Math.round(vx * 10), Math.round(vy * 10))
    pts.push(x[e.b], y[e.b])
    // 整數開根號再捨去，各家瀏覽器算出來都一樣
    const cum = [0]
    for (let i = 2; i < pts.length; i += 2) {
      const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1]
      cum.push(cum[cum.length - 1] + Math.floor(Math.sqrt(dx * dx + dy * dy)))
    }
    const len = cum[cum.length - 1]
    // 回程是同一條線倒過來走，每一小段的長度一樣
    const back: number[] = []
    for (let i = pts.length - 2; i >= 0; i -= 2) back.push(pts[i], pts[i + 1])
    links[e.a].push({ to: e.b, ticks, kind: e.kind, len, pts, cum })
    links[e.b].push({ to: e.a, ticks, kind: e.kind, len, pts: back, cum: cum.map((c) => len - c).reverse() })
  }
  for (const l of links) l.sort((p, q) => p.to - q.to)
  const forts: number[] = []
  map.regions.forEach((r, i) => { if (r.trait === 'fort') forts.push(i) })
  const range = map.regions.map((r) => (r.trait === 'fort' ? (RULES.fort.far[r.id] ?? RULES.fort.range) * 10 : 0))
  return {
    n: map.regions.length, links, forts, x, y, range,
  }
}

const linkOf = (g: Graph, from: number, to: number): Link => {
  const link = g.links[from].find((l) => l.to === to)
  if (!link) throw new Error(`${from} 與 ${to} 不相鄰`)
  return link
}

/** 圖上的這個位置（座標 ×10）是不是在 fort 砲台的射程內。據點的位置是 g.x[i]、g.y[i]，路上的用 posOf。 */
export function inRange(g: Graph, fort: number, x: number, y: number): boolean {
  const dx = x - g.x[fort], dy = y - g.y[fort]
  return dx * dx + dy * dy <= g.range[fort] * g.range[fort]
}

export function legTicks(g: Graph, from: number, to: number, fast: boolean): number {
  const link = linkOf(g, from, to)
  return fast ? Math.max(1, Math.ceil((link.ticks * RULES.postNum) / RULES.postDen)) : link.ticks
}

/**
 * 要在 to 停下來的軍隊，走到第幾拍就到城外（離據點 RULES.gate）。
 * 攻城和進駐都停在這裡，不走到據點中心。
 */
export function gateTick(g: Graph, from: number, to: number, legTicks: number): number {
  return Math.max(1, legTicks - Math.floor((RULES.gate * 10 * legTicks) / linkOf(g, from, to).len))
}

/**
 * 在 from → to 這段路上走了 t / legTicks 的軍隊，在圖上的位置 ×10（整數）。
 * 沿著這條路的線等速走：已經走的長度是 len × t / legTicks，落在哪一小段就在那一段上內插。
 * 比的時候兩邊同乘 legTicks，除法只在最後做一次，不累積誤差。
 */
export function posOf(g: Graph, from: number, to: number, t: number, legTicks: number): [number, number] {
  const { len, pts, cum } = linkOf(g, from, to)
  const gone = len * t
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] * legTicks <= gone) i++
  const den = (cum[i + 1] - cum[i]) * legTicks
  if (den === 0) return [pts[2 * i], pts[2 * i + 1]]
  const part = gone - cum[i] * legTicks
  return [
    pts[2 * i] + Math.trunc(((pts[2 * i + 2] - pts[2 * i]) * part) / den),
    pts[2 * i + 1] + Math.trunc(((pts[2 * i + 3] - pts[2 * i + 1]) * part) / den),
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
