// 地圖資料（src/maps/*.json）與模擬狀態的型別。

export type Trait = 'none' | 'city' | 'fort' | 'granary' | 'post'
export type EdgeKind = 'land' | 'mountain' | 'sea'

export interface RegionDef {
  id: string
  name: string
  /** 今天大致是哪裡 */
  today: string
  trait: Trait
  /** 據點在畫布上的位置 */
  x: number
  y: number
  area: number
  /** SVG path */
  d: string
}
export interface EdgeDef { a: number; b: number; kind: EdgeKind; km: number }
export interface BorderDef { a: number; b: number; kind: EdgeKind; d: string }
export interface MapData {
  id: string
  name: string
  version: number
  width: number
  height: number
  regions: RegionDef[]
  edges: EdgeDef[]
  borders: BorderDef[]
}

/** 玩家編號：0 是中立，1 起是各方勢力 */
export type PlayerId = number

export interface Region {
  owner: PlayerId
  units: number
  /** 產兵累積，滿 1000 進一個兵 */
  acc: number
  /** 這一拍（含）之後才能再派兵 */
  readyAt: number
}

export interface Army {
  id: number
  owner: PlayerId
  units: number
  /** 經過的區，含起點與終點 */
  path: number[]
  /** 正在走 path[leg] → path[leg + 1] */
  leg: number
  /** 這一段已經走了幾拍 */
  t: number
  /** 這一段總共幾拍 */
  legTicks: number
  /** 從驛站出發 */
  fast: boolean
}

/** 兩支敵對的軍隊在路上碰頭的地方：from → to 這段路上走了 t / legTicks 的位置。 */
export interface Clash { from: number; to: number; t: number; legTicks: number; units: number }

/** 砲台打中一支軍隊：軍隊當時在 from → to 這段路上走了 t / legTicks 的位置。 */
export interface Shot { fort: number; from: number; to: number; t: number; legTicks: number }

/** 糧倉換人時多出來的兵 */
export interface Gain { region: number; units: number }

export interface GameState {
  tick: number
  players: number
  regions: Region[]
  armies: Army[]
  nextArmyId: number
  /** alive[p]：玩家 p 是否還在場（索引 0 不用） */
  alive: boolean[]
  /** 0 表示還沒分出勝負 */
  winner: PlayerId
  /** 剛跑完的這一拍裡，路上碰頭的地方。只給畫面用，每拍重填，不算進雜湊。 */
  clashes: Clash[]
  /** 剛跑完的這一拍裡，哪些糧倉換了人、加了多少兵。也只給畫面用。 */
  gains: Gain[]
  /** 剛跑完的這一拍裡，砲台打中了誰。也只給畫面用。 */
  shots: Shot[]
}

/** 一筆指令：在第 tick 拍，從 from 區派兵到 to 區。派兵的人就是當下 from 的主人。 */
export interface Command { tick: number; from: number; to: number }
