// 存在瀏覽器裡的東西：上次的開局設定。
// localStorage 可能被關掉或滿了，所以讀寫都要能失敗而不影響遊戲。
import type { Difficulty } from '../sim/ai'

const PREFS = 'baotu.prefs.v1'

export interface Prefs { opponents: number; difficulty: Difficulty }

export function loadPrefs(): Prefs {
  const prefs: Prefs = { opponents: 3, difficulty: 'normal' }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>
    if (raw.opponents === 2 || raw.opponents === 3) prefs.opponents = raw.opponents
    if (raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard') prefs.difficulty = raw.difficulty
  } catch { /* 用預設值 */ }
  return prefs
}

export function savePrefs(prefs: Prefs): void {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)) } catch { /* 沒存到也沒關係 */ }
}
