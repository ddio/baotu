// 存在瀏覽器裡的東西：對戰記錄（最多 32 筆）與上次的開局設定。
// localStorage 可能被關掉或滿了，所以讀寫都要能失敗而不影響遊戲。
import type { Difficulty } from '../sim/ai'
import { addRecord, type GameRecord, parseRecord } from '../sim/record'

const RECORDS = 'baotu.records.v1'
const PREFS = 'baotu.prefs.v1'

export function loadRecords(): GameRecord[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECORDS) ?? '[]')
    if (!Array.isArray(raw)) return []
    let list: GameRecord[] = []
    for (const x of raw) {
      const rec = parseRecord(x)
      if (rec) list = addRecord(list, rec)
    }
    return list
  } catch {
    return []
  }
}

/** 存不進去（空間滿了、無痕模式）就回 false */
export function saveRecords(list: GameRecord[]): boolean {
  try {
    localStorage.setItem(RECORDS, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

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
