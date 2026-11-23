// 假扮真人的對手，量電腦會不會被騙用的（tools/duel.ts 的 TRICK）。
// 打法跟「強」一樣，只多一招真人常用的：拿剛派過兵、只剩幾個兵的區，往隔壁別人屯最多兵的區派過去。
// 兵不多，但那一區只要看到有人來打就整區留下來守，等於用幾個兵釘住一大堆。
import { type AiProfile, type Order, aiThink } from '../src/sim/ai'
import { canSend } from '../src/sim/game'
import type { Graph } from '../src/sim/graph'
import type { Rng } from '../src/sim/rng'
import type { GameState, MapData, PlayerId } from '../src/sim/types'

export function trickThink(
  state: GameState, map: MapData, g: Graph, me: PlayerId, rng: Rng, base: AiProfile, feintMax: number, minStack: number,
): Order[] {
  const orders: Order[] = []
  const busy = new Set<number>()
  for (const a of state.armies) {
    if (a.owner !== me) continue
    let dest = a.path[a.path.length - 1]
    for (let i = a.leg + 1; i < a.path.length; i++) if (state.regions[a.path[i]].owner !== me) { dest = a.path[i]; break }
    busy.add(dest)
  }
  const used = new Set<number>()
  for (let r = 0; r < g.n; r++) {
    const R = state.regions[r]
    if (R.owner !== me || R.units < 1 || R.units > feintMax || !canSend(state, r)) continue
    let pick = -1, big = minStack - 1
    for (const l of g.links[r]) {
      const o = state.regions[l.to]
      if (o.owner === me || o.owner === 0 || busy.has(l.to)) continue
      if (o.units > big) { big = o.units; pick = l.to }
    }
    if (pick < 0) continue
    orders.push({ from: r, to: pick })
    busy.add(pick)
    used.add(r)
  }
  for (const o of aiThink(state, map, g, me, rng, base)) if (!used.has(o.from)) orders.push(o)
  return orders
}
