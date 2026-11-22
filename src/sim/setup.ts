import { buildGraph, bySea, type Graph } from './graph'
import { Rng } from './rng'
import type { MapData } from './types'

/** 任兩區之間的行軍時間（不管領地，純看地圖）。 */
function allPairs(g: Graph): number[][] {
  return Array.from({ length: g.n }, (_, s) => {
    const dist = new Array<number>(g.n).fill(Infinity)
    const done = new Array<boolean>(g.n).fill(false)
    dist[s] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < g.n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
      if (u < 0) break
      done[u] = true
      for (const l of g.links[u]) if (dist[u] + l.ticks < dist[l.to]) dist[l.to] = dist[u] + l.ticks
    }
    return dist
  })
}

/**
 * 玩家選好起點後，替對手挑起點：一個一個放，每次挑離已有起點最遠的區。
 * 對手不從只靠航線連接的區（澎湖、紅頭嶼）開局。差不多遠的幾個候選用亂數決定，每局才不會都一樣。
 */
export function pickStarts(map: MapData, humanStart: number, players: number, seed: number): number[] {
  const g = buildGraph(map)
  const d = allPairs(g)
  const rng = new Rng(seed)
  const starts = [humanStart]
  const seaOnly = (i: number) => g.links[i].every((l) => bySea(l.kind))
  while (starts.length < players) {
    const scored: { i: number; s: number }[] = []
    for (let i = 0; i < g.n; i++) {
      if (starts.includes(i) || seaOnly(i)) continue
      scored.push({ i, s: Math.min(...starts.map((s) => d[s][i])) })
    }
    scored.sort((a, b) => b.s - a.s || a.i - b.i)
    // 與最佳差距在 15% 以內的都算候選
    const pool = scored.filter((c) => c.s * 100 >= scored[0].s * 85)
    starts.push(pool[rng.int(pool.length)].i)
  }
  return starts
}
