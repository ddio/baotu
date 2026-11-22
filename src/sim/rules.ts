// 數值都集中在這裡。改了會影響戰局的東西，就要把 RULES_VERSION 加一，
// 舊記錄才不會被用新規則硬播。
export const RULES_VERSION = 3

/** 每秒幾拍 */
export const TICKS_PER_SECOND = 10

export const RULES = {
  /** 每拍累積的產兵量（1000 = 一個兵） */
  prodPerTick: { normal: 100, city: 160 },
  /** 兵長到這裡就停（援軍進來可以超過） */
  cap: { normal: 40, city: 70, fort: 100 },
  /** 中立守軍 */
  neutral: { none: 10, post: 10, granary: 12, fort: 14, city: 30 },
  /** 起點兵力 */
  startUnits: 20,
  /** 派兵後的冷卻（拍） */
  cooldownTicks: 40,
  /** 至少要有這麼多兵才能派 */
  minUnitsToSend: 1,
  /** 一般行軍：每拍走幾公里（×10，避免小數） */
  speedKmPerTickX10: 12,
  /** 山路要走幾倍的時間 */
  mountainFactor: 3,
  /** 每一段最少幾拍 */
  minLegTicks: 8,
  /** 驛站出發：時間乘以 num/den */
  postNum: 2,
  postDen: 3,
  /** 進攻砲台：兵力乘以 num/den */
  fortNum: 2,
  fortDen: 3,
  /** 糧倉：每次換人佔領時加的兵 */
  granaryBonus: 15,
} as const
