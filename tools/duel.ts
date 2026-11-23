// 改電腦的打法時用：讓新的打法跟前一版對打，看有沒有變強、一局有沒有被拖長。
// 用法：npm run duel（幾分鐘）。BASE 是拿來當對手的前一版，比的是現在的「強」。
// 要一次試好幾組數值：GRID="margin=2 margin=3,attacks=2" npm run duel（每一組是在 BASE 上改幾個欄位）。GAMES 是每一輪幾局。
import { it } from 'vitest'
import { MAPS } from '../src/maps'
import { AI_PROFILE, type AiProfile, aiThink } from '../src/sim/ai'
import { createGame, issue, step } from '../src/sim/game'
import { buildGraph } from '../src/sim/graph'
import { Rng } from '../src/sim/rng'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const g = buildGraph(map)
const LIMIT = 9000 // 15 分鐘
const GAMES = Number(process.env.GAMES ?? 400)

/** 前一版的「強」 */
const BASE: AiProfile = { ...AI_PROFILE.hard }
const VARIANTS: Record<string, AiProfile> = process.env.GRID
  ? Object.fromEntries(process.env.GRID.split(' ').map((v) => [
    v, { ...BASE, ...Object.fromEntries(v.split(',').map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])])) },
  ]))
  : { 現在的強: AI_PROFILE.hard }

/** 1 號用 one 的打法，其他人用 rest。每個種子一局，回傳每一局 1 號有沒有贏、打了幾秒、有沒有在時限內分出勝負。 */
function series(one: AiProfile, rest: AiProfile, players: number) {
  const won: boolean[] = [], secs: number[] = []
  let decided = 0
  for (let seed = 1; won.length < GAMES; seed++) {
    const start = seed % map.regions.length
    // 只靠航線連接的島不拿來當起點
    if (map.regions[start].id === 'penghu' || map.regions[start].id === 'hongtou') continue
    const s = createGame(map, { players, starts: pickStarts(map, start, players, seed) })
    const rngs = Array.from({ length: players + 1 }, (_, p) => new Rng(seed * 31 + p * 7919 + 1))
    while (!s.winner && s.tick < LIMIT) {
      for (let p = 1; p <= players; p++) {
        const prof = p === 1 ? one : rest
        if (!s.alive[p] || (s.tick + p * 7) % prof.think !== 0) continue
        for (const o of aiThink(s, map, g, p, rngs[p], prof)) issue(s, map, g, o.from, o.to)
      }
      step(s, map, g)
    }
    won.push(s.winner === 1)
    if (s.winner) decided++
    secs.push(s.tick / 10)
  }
  const sorted = [...secs].sort((a, b) => a - b)
  return { won, wins: won.filter(Boolean).length, median: Math.round(sorted[sorted.length >> 1]), decided }
}

const pct = (n: number) => `${((n * 100) / GAMES).toFixed(1)}%`

it('duel', () => {
  for (const players of [3, 4]) {
    console.log(`\n${players} 方，各 ${GAMES} 局（同一批種子）`)
    // 1 號的位置本來就有好有壞，所以先看前一版自己坐 1 號贏幾成，新的打法坐同一個位置再比
    const base = series(BASE, BASE, players)
    console.log(`前一版自己打自己：1 號贏 ${pct(base.wins)}，一局中位數 ${base.median} 秒，${pct(base.decided)} 在 15 分鐘內分出勝負`)
    for (const [name, prof] of Object.entries(VARIANTS)) {
      const a = series(prof, BASE, players)
      // 同一個種子：新的贏了、前一版沒贏的局數，和反過來的局數
      let up = 0, down = 0
      for (let i = 0; i < GAMES; i++) { if (a.won[i] && !base.won[i]) up++; if (!a.won[i] && base.won[i]) down++ }
      const b = series(BASE, prof, players)
      let line = `${name}：坐 1 號對前一版贏 ${pct(a.wins)}（多贏 ${up} 局、少贏 ${down} 局），一局 ${a.median} 秒｜前一版坐 1 號對它贏 ${pct(b.wins)}`
      // 試一整排數值的時候省掉這一輪
      if (!process.env.GRID) {
        const all = series(prof, prof, players)
        line += `｜全部都用它：一局 ${all.median} 秒，${pct(all.decided)} 分出勝負`
      }
      console.log(line)
    }
  }
}, 3_600_000)
