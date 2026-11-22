// 電腦對手。跟玩家走同一條路：看得到的資訊一樣，也只能下「從哪裡派到哪裡」的指令。
// 難度主要差在反應速度（多久想一次、一次發動幾波），其次是出手多謹慎、會不會把後方的兵往前線送。
import { canSend, capOf, prodOf, sendAmount, shellLoss } from './game'
import { type Graph, inRange, pathTo, reach } from './graph'
import { RULES } from './rules'
import type { Rng } from './rng'
import type { GameState, MapData, PlayerId } from './types'

export type Difficulty = 'easy' | 'normal' | 'hard'

export const AI_PROFILE: Record<Difficulty, {
  /** 每隔幾拍想一次 */
  think: number
  /** 這次乾脆不動的機率（百分比） */
  skip: number
  /** 一次最多發動幾波進攻 */
  attacks: number
  /** 進攻時要比守軍多幾個兵才出手 */
  margin: number
  /** 後方的區兵力到上限的幾成（百分比）就往前線送；0 表示不送，也不補防 */
  reinforceAt: number
}> = {
  easy: { think: 60, skip: 30, attacks: 1, margin: 5, reinforceAt: 0 },
  normal: { think: 40, skip: 20, attacks: 1, margin: 3, reinforceAt: 100 },
  hard: { think: 12, skip: 0, attacks: 3, margin: 1, reinforceAt: 50 },
}

export interface Order { from: number; to: number }

const VALUE = { none: 10, post: 13, fort: 13, granary: 12, city: 22 } as const

export function aiThink(
  state: GameState, map: MapData, g: Graph, me: PlayerId, rng: Rng, difficulty: Difficulty,
): Order[] {
  const prof = AI_PROFILE[difficulty]
  if (rng.int(100) < prof.skip) return []
  const n = g.n
  const orders: Order[] = []

  // 已經在路上的兵：我方要去打的、敵方要來打我的
  const mine = new Array<number>(n).fill(0)
  const hostile = new Array<number>(n).fill(0)
  for (const a of state.armies) {
    // 軍隊會停在路上第一個不是自己的區，不一定走得到終點
    let dest = a.path[a.path.length - 1]
    for (let i = a.leg + 1; i < a.path.length; i++) if (state.regions[a.path[i]].owner !== a.owner) { dest = a.path[i]; break }
    if (a.owner === me) mine[dest] += a.units
    else if (state.regions[dest].owner === me) hostile[dest] += a.units
  }

  let sources: number[] = []
  for (let i = 0; i < n; i++) if (state.regions[i].owner === me && canSend(state, i)) sources.push(i)
  // 派兵是整區派光，所以有敵軍正朝這裡來的區一律留下來守，不管守不守得住。
  // 不然來攻的人到的時候常常撲空，看起來像守軍沒被算進去。
  sources = sources.filter((s) => hostile[s] === 0)
  if (!sources.length) return orders
  const reaches = new Map(sources.map((s) => [s, reach(g, state, s, me, map.regions[s].trait === 'post')]))

  // ---- 進攻：每次挑最划算的目標，湊得出兵力就出手 ----
  for (let round = 0; round < prof.attacks && sources.length; round++) {
    let best: { score: number; to: number; from: number[] } | null = null
    for (let t = 0; t < n; t++) {
      const target = state.regions[t]
      if (target.owner === me) continue
      const near = sources
        .map((s) => ({ s, eta: reaches.get(s)!.dist[t] }))
        .filter((c) => c.eta < Infinity)
        .sort((a, b) => a.eta - b.eta || a.s - b.s)
      if (!near.length) continue
      // 圍城時還在幾座別人砲台的射程裡（打砲台本身，或緊鄰砲台的區）
      const guns = g.forts.filter((f) => state.regions[f].owner !== me && inRange(g, f, g.x[t], g.y[t])).length
      const from: number[] = []
      let sent = 0, lost = 0, eta = 0, ok = false
      for (const c of near) {
        from.push(c.s)
        // 路上會被砲台打掉的先扣掉
        const units = sendAmount(state.regions[c.s].units)
        const path = pathTo(reaches.get(c.s)!, t)!
        sent += units
        lost += shellLoss(state, g, path, path.length - 1, map.regions[c.s].trait === 'post', me, units)
        eta = c.eta
        // 對方在我走到之前、還有圍城的那段時間都會長兵；圍城大約是守軍有幾個就打幾拍
        let defence = target.units
        if (target.owner !== 0 && defence < capOf(map, t)) {
          const siege = Math.floor(defence / RULES.siegePerTick)
          defence = Math.min(capOf(map, t), defence + Math.floor((prodOf(map, t) * (eta + siege)) / 1000))
        }
        // 圍城時每支軍隊繼續挨砲
        const shelled = guns * from.length * Math.ceil(defence / (RULES.siegePerTick * RULES.fort.every))
        if (sent - lost - shelled + mine[t] >= defence + prof.margin) { ok = true; break }
      }
      if (!ok) continue
      let value: number = target.spent ? VALUE.none : VALUE[map.regions[t].trait]
      if (target.owner !== 0) value += 4
      // 花的兵越少、越快到的越好；加一點亂數，幾個對手才不會想得一模一樣
      const score = Math.floor((value * 1000) / (sent + 8 + Math.floor(eta / 6))) + rng.int(40)
      if (!best || score > best.score) best = { score, to: t, from }
    }
    if (!best) break
    for (const f of best.from) orders.push({ from: f, to: best.to })
    mine[best.to] += best.from.reduce((s, f) => s + sendAmount(state.regions[f].units), 0)
    sources = sources.filter((s) => !best!.from.includes(s))
  }

  // ---- 補防與往前線送兵 ----
  if (prof.reinforceAt > 0 && sources.length) {
    const frontier: { r: number; need: number }[] = []
    for (let i = 0; i < n; i++) {
      if (state.regions[i].owner !== me) continue
      let threat = 0, exposed = false
      for (const l of g.links[i]) {
        const o = state.regions[l.to]
        if (o.owner === me) continue
        exposed = true
        if (o.owner !== 0) threat = Math.max(threat, o.units)
      }
      if (!exposed) continue
      frontier.push({ r: i, need: hostile[i] * 2 + threat - state.regions[i].units - mine[i] })
    }
    for (const s of sources) {
      const src = state.regions[s]
      const interior = g.links[s].every((l) => state.regions[l.to].owner === me)
      // 前線的區只在別人快被打下來時才分兵；後方的區兵多了就往前送
      if (interior && src.units * 100 < capOf(map, s) * prof.reinforceAt) continue
      let pick = -1, pickScore = -Infinity
      for (const f of frontier) {
        if (f.r === s) continue
        const eta = reaches.get(s)!.dist[f.r]
        if (eta === Infinity) continue
        if (!interior && hostile[f.r] <= state.regions[f.r].units) continue
        const score = f.need * 10 - Math.floor(eta / 4)
        if (score > pickScore) { pickScore = score; pick = f.r }
      }
      if (pick >= 0) {
        orders.push({ from: s, to: pick })
        const f = frontier.find((x) => x.r === pick)!
        f.need -= sendAmount(src.units)
      }
    }
  }
  return orders
}
