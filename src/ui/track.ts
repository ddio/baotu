// 使用統計：用 GoatCounter 記開了幾局、勝負、重播了哪一版的記錄、分享了幾次開局。
// 只送出「難度／對手數／規則版本／結果」這幾個分類，沒有 cookie、不知道是誰，對戰內容與記錄不會送出去。
// 腳本沒載到（擋廣告、離線、本機開發）就什麼都不做，不影響遊戲。
import type { Difficulty } from '../sim/ai'
import { RULES_VERSION } from '../sim/rules'

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; title?: string; event?: boolean }) => void }
  }
}

const LEVEL: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' }
const RESULT = { win: '勝', lose: '敗', quit: '放棄' } as const

// GoatCounter 依 path 分開計數，所以分類都放進 path；title 只是後台好讀
function count(path: string, title: string): void {
  try {
    window.goatcounter?.count?.({ path, title, event: true })
  } catch { /* 統計失敗不該影響遊戲 */ }
}

interface Game { difficulty: Difficulty; players: number }
const kind = (g: Game) => `${g.difficulty}/${g.players - 1}/v${RULES_VERSION}`
const label = (g: Game) => `難度${LEVEL[g.difficulty]}　對 ${g.players - 1} 家　規則 v${RULES_VERSION}`

/** 開了一局 */
export const trackPlay = (g: Game) => count(`play/${kind(g)}`, `開局　${label(g)}`)

/** 一局結束：打贏、打輸，或中途放棄（重來、回主畫面）。直接關掉分頁的不會有這一筆。 */
export const trackEnd = (g: Game, result: keyof typeof RESULT) => count(`end/${result}/${kind(g)}`, `${RESULT[result]}　${label(g)}`)

/** 看了一筆重播；version 是那筆記錄的規則版本 */
export const trackReplay = (version: number) => count(`replay/v${version}`, `重播　規則 v${version}${version === RULES_VERSION ? '' : '（舊版）'}`)

/** 分享開局：send 是按了「分享開局」，play 是照分享的開局（網址帶著代碼）開了一局。代碼本身不送出去。 */
export const trackShare = (what: 'send' | 'play') => count(`share/${what}`, what === 'send' ? '分享開局' : '照分享的開局開了一局')
