// 數值都集中在這裡。改了會影響戰局的東西，就要把 RULES_VERSION 加一，
// 舊記錄才不會被用新規則硬播。
export const RULES_VERSION = 5

/** 每秒幾拍 */
export const TICKS_PER_SECOND = 10

export const RULES = {
  /** 每拍累積的產兵量（1000 = 一個兵） */
  prodPerTick: { normal: 100, city: 160 },
  /** 兵長到這裡就停（援軍進來可以超過） */
  cap: { normal: 40, city: 70, fort: 100 },
  /** 中立守軍 */
  neutral: { none: 10, post: 10, granary: 12, fort: 10, city: 30 },
  /** 起點兵力 */
  startUnits: 20,
  /** 城外：要停下來的軍隊（攻城或進駐）停在離據點多遠的地方，地圖座標的單位 */
  gate: 28,
  /** 圍城：到了別人的區，每拍雙方各少幾個兵 */
  siegePerTick: 1,
  /** 進城：到了自己的區，每拍進去幾個兵（比圍城快） */
  enterPerTick: 3,
  /** 遭遇：兩支敵對的軍隊在圖上的直線距離在這以內就打起來，不管是不是同一條路 */
  clashRange: 36,
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
  /**
   * 砲台：射程（地圖座標的單位，量的是軍隊在路上的位置到砲台據點的直線距離）內的敵軍，
   * 每隔 every 拍每支少一個兵。中立的砲台誰都打。
   */
  fort: { range: 80, every: 3 },
  /** 糧倉：每次換人佔領時加的兵 */
  granaryBonus: 15,
} as const
