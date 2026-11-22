// 有哪些版本的規則還能跑。現行的直接帶著；凍結的舊版放在 src/sim/v<N>/，要重播時才下載。
//
// 改規則的步驟（docs/DESIGN.md 的「舊版重播」有完整說明）：
//   1. 改之前先跑 npm run freeze，把現在這一版凍結起來（它讀的是 git 裡的檔案，已經動手改了也沒關係）
//   2. 改規則，RULES_VERSION 加一
//   3. npm run fixture，替新版存一筆測試用的記錄
import { type Engine, makeEngine } from './engine'
import { createGame, hashState, issue, step, totals } from './game'
import { buildGraph } from './graph'
import { RULES, RULES_VERSION } from './rules'

/** 現行規則 */
export const CURRENT: Engine = makeEngine(RULES_VERSION, { RULES, buildGraph, createGame, issue, step, hashState, totals })

/** 從這一版起的記錄都要能重播；更早的只看得到結果。 */
export const OLDEST_KEPT = 6

const FROZEN: Record<number, () => Promise<{ engine: Engine }>> = {
  6: () => import('./v6'),
  // freeze:insert（npm run freeze 會在這一行上面加一筆，不要改這行）
}

export const hasEngine = (version: number): boolean => version === RULES_VERSION || Object.hasOwn(FROZEN, version)

/** 拿某一版的引擎。沒有這一版回傳 null；舊版要下載，下載失敗會丟出例外。 */
export async function loadEngine(version: number): Promise<Engine | null> {
  if (version === RULES_VERSION) return CURRENT
  if (!Object.hasOwn(FROZEN, version)) return null
  return (await FROZEN[version]()).engine
}
