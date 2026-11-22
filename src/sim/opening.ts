// 開局的代碼：放在網址的 #g= 後面，別人打開就是同一個開局（同一版地圖、同樣的起點、對手數、難度、亂數種子）。
// 格式：地圖版本-玩家起點-對手數與難度-種子（36 進位），例如 2-13-3n-zik0zj。
// 對手的起點不放進去：它是 pickStarts 用玩家起點和種子算出來的，同一版地圖算出來一定一樣。
// 規則版本也不放：開出來的局用現行的規則打。改了規則，同一個代碼還是同樣的起點和種子，只是電腦的打法可能不同。
import type { Difficulty } from './ai'
import type { MatchConfig } from './match'
import { pickStarts } from './setup'
import type { MapData } from './types'

export interface Opening {
  mapVersion: number
  /** 玩家（1 號）的起點 */
  start: number
  /** 對手數（不含玩家） */
  opponents: number
  difficulty: Difficulty
  seed: number
}

/** 種子的上限（31 位元），36 進位最多 6 個字 */
export const MAX_SEED = 0x7fffffff
const LEVELS: Record<string, Difficulty> = { e: 'easy', n: 'normal', h: 'hard' }
const CODE = /^(\d{1,4})-(\d{1,3})-([1-3])([enh])-([0-9a-z]{1,6})$/

export const encodeOpening = (o: Opening): string =>
  `${o.mapVersion}-${o.start}-${o.opponents}${o.difficulty[0]}-${o.seed.toString(36)}`

/** 讀代碼。看不懂的、寫法不是 encodeOpening 會產生的（前面補零之類），都回傳 null。 */
export function decodeOpening(code: string): Opening | null {
  const m = CODE.exec(code)
  if (!m) return null
  const o: Opening = { mapVersion: +m[1], start: +m[2], opponents: +m[3], difficulty: LEVELS[m[4]], seed: parseInt(m[5], 36) }
  return o.mapVersion >= 1 && o.seed <= MAX_SEED && encodeOpening(o) === code ? o : null
}

/** 這一局的開局（真人是 1 號的對局） */
export const openingOf = (map: MapData, config: MatchConfig): Opening => ({
  mapVersion: map.version, start: config.starts[0], opponents: config.players - 1, difficulty: config.difficulty, seed: config.seed,
})

/** 照開局排出一局的設定。地圖版本不對（對手的起點會算得不一樣）或起點不在圖上，回傳 null。 */
export function openingConfig(map: MapData, o: Opening): MatchConfig | null {
  if (o.mapVersion !== map.version || o.start >= map.regions.length) return null
  const players = o.opponents + 1
  return { players, starts: pickStarts(map, o.start, players, o.seed), human: 1, difficulty: o.difficulty, seed: o.seed }
}
