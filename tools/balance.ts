// 調數值用：讓電腦自己打，看一局多長、各難度之間誰強。
// 用法：npm run balance（跑完大約半分鐘）
import { it } from 'vitest'
import { MAPS } from '../src/maps'
import { AI_PROFILE, aiThink, type Difficulty } from '../src/sim/ai'
import { createGame, issue, step } from '../src/sim/game'
import { buildGraph } from '../src/sim/graph'
import { Rng } from '../src/sim/rng'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const g = buildGraph(map)
const LIMIT = 9000 // 15 分鐘
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard']

/** 1 號用 me 的打法，其他人用 them。回傳 1 號的勝率與每局秒數。 */
function series(me: Difficulty, them: Difficulty, players: number, games = 120) {
  let win = 0, n = 0
  const secs: number[] = []
  for (let seed = 1; n < games; seed++) {
    const start = seed % map.regions.length
    // 只靠航線連接的島不拿來當起點
    if (map.regions[start].id === 'penghu' || map.regions[start].id === 'hongtou') continue
    n++
    const s = createGame(map, { players, starts: pickStarts(map, start, players, seed) })
    const rngs = Array.from({ length: players + 1 }, (_, p) => new Rng(seed * 31 + p * 7919 + 1))
    while (!s.winner && s.alive[1] && s.tick < LIMIT) {
      for (let p = 1; p <= players; p++) {
        const d = p === 1 ? me : them
        if (!s.alive[p] || (s.tick + p * 7) % AI_PROFILE[d].think !== 0) continue
        for (const o of aiThink(s, map, g, p, rngs[p], d)) issue(s, map, g, o.from, o.to)
      }
      step(s, map, g)
    }
    if (s.winner === 1) win++
    secs.push(s.tick / 10)
  }
  secs.sort((a, b) => a - b)
  return { win: Math.round((win * 100) / n), median: Math.round(secs[secs.length >> 1]) }
}

it('balance', () => {
  for (const players of [3, 4]) {
    console.log(`\n${players} 方：1 號的勝率 %（15 分鐘內成為最後一方），括號內是每局秒數的中位數`)
    console.log('1 號＼對手   ' + LEVELS.map((l) => l.padEnd(12)).join(''))
    for (const me of LEVELS) {
      const row = LEVELS.map((them) => {
        const r = series(me, them, players)
        return `${r.win}% (${r.median}s)`.padEnd(12)
      })
      console.log(me.padEnd(12) + row.join(''))
    }
  }
}, 600_000)
