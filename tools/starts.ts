// 調數值用：每個起點各打一批，看從哪裡開局比較吃香。
// 每一方都是同一種難度的電腦，1 號從指定的區開局，其他人照正式的規則分配（離得最遠的區）。
// 用法：npm run starts（幾分鐘）。GAMES 是每個起點打幾局，LEVEL 是難度，PLAYERS 是幾方（不給就 3 方、4 方都跑）。
import { it } from 'vitest'
import { MAPS } from '../src/maps'
import { AI_PROFILE, aiThink, type Difficulty } from '../src/sim/ai'
import { createGame, issue, step } from '../src/sim/game'
import { buildGraph, bySea } from '../src/sim/graph'
import { Rng } from '../src/sim/rng'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const g = buildGraph(map)
const LIMIT = 9000 // 15 分鐘
const GAMES = Number(process.env.GAMES ?? 150)
const LEVEL = (process.env.LEVEL ?? 'hard') as Difficulty
const PLAYERS = process.env.PLAYERS ? [Number(process.env.PLAYERS)] : [3, 4]

it('starts', () => {
  const prof = AI_PROFILE[LEVEL]
  for (const players of PLAYERS) {
    /** 1 號從這裡開局贏了幾局 */
    const first = new Array<number>(g.n).fill(0)
    /** 不管幾號，從這裡開局的有幾局、贏了幾局 */
    const any = new Array<number>(g.n).fill(0), anyWin = new Array<number>(g.n).fill(0)
    for (let start = 0; start < g.n; start++) {
      // 只靠航線連接的島不拿來當起點
      if (g.links[start].every((l) => bySea(l.kind))) continue
      for (let k = 1; k <= GAMES; k++) {
        const seed = start * 1000 + k
        const starts = pickStarts(map, start, players, seed)
        const s = createGame(map, { players, starts })
        const rngs = Array.from({ length: players + 1 }, (_, p) => new Rng(seed * 31 + p * 7919 + 1))
        while (!s.winner && s.tick < LIMIT) {
          for (let p = 1; p <= players; p++) {
            if (!s.alive[p] || (s.tick + p * 7) % prof.think !== 0) continue
            for (const o of aiThink(s, map, g, p, rngs[p], prof)) issue(s, map, g, o.from, o.to)
          }
          step(s, map, g)
        }
        for (let p = 1; p <= players; p++) any[starts[p - 1]]++
        if (s.winner) anyWin[starts[s.winner - 1]]++
        if (s.winner === 1) first[start]++
      }
    }
    console.log(`\n${players} 方、難度 ${LEVEL}、每個起點 ${GAMES} 局。人人一樣強的話應該贏 ${Math.round(100 / players)}%`)
    console.log('起點        自己選這裡   不管誰從這裡開局（局數）')
    const rows = map.regions.map((r, i) => ({ r, i })).filter(({ i }) => any[i])
      .sort((a, b) => first[b.i] - first[a.i])
    for (const { r, i } of rows) {
      const mine = g.links[i].every((l) => bySea(l.kind)) ? '   —' : `${Math.round((first[i] * 100) / GAMES)}%`.padStart(4)
      console.log(`${r.name.padEnd(6, '　')}${mine}        ${`${Math.round((anyWin[i] * 100) / any[i])}%`.padStart(4)}（${any[i]}）`)
    }
  }
}, 3_600_000)
