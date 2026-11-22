import { RULES } from './rules'
import type { GameState, MapData, PlayerId } from './types'

export interface Link { to: number; ticks: number; kind: 'land' | 'mountain' | 'sea' }

/** 由地圖資料算出的鄰接表，行軍時間已經換算成拍數。 */
export interface Graph { n: number; links: Link[][] }

export function buildGraph(map: MapData): Graph {
  const links: Link[][] = map.regions.map(() => [])
  for (const e of map.edges) {
    const factor = e.kind === 'mountain' ? RULES.mountainFactor : 1
    // km 只到小數一位，先乘 10 變整數，整段都是整數運算
    const kmX10 = Math.round(e.km * 10)
    const ticks = Math.max(RULES.minLegTicks, Math.round((kmX10 * factor) / RULES.speedKmPerTickX10))
    links[e.a].push({ to: e.b, ticks, kind: e.kind })
    links[e.b].push({ to: e.a, ticks, kind: e.kind })
  }
  for (const l of links) l.sort((p, q) => p.to - q.to)
  return { n: map.regions.length, links }
}

export function legTicks(g: Graph, from: number, to: number, fast: boolean): number {
  const link = g.links[from].find((l) => l.to === to)
  if (!link) throw new Error(`${from} 與 ${to} 不相鄰`)
  return fast ? Math.max(1, Math.ceil((link.ticks * RULES.postNum) / RULES.postDen)) : link.ticks
}

export interface Reach {
  /** 到各區要幾拍；到不了是 Infinity */
  dist: number[]
  prev: number[]
}

/**
 * 從 from 出發、以 owner 的身分能到哪些區。
 * 中途只能經過自己的區；終點可以是任何區。
 */
export function reach(g: Graph, state: GameState, from: number, owner: PlayerId, fast: boolean): Reach {
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
    if (u !== from && state.regions[u].owner !== owner) continue
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
