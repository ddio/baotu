// 凍結：規則 v6（取自 4d1df56）。只用來重播舊記錄，不要改。
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
  /** 已經停在城外：別人的區就一個換一個地打，自己的區就排隊進城 */
  siege: boolean
  /** 這一拍打完，附近還有活著的敵軍：被纏住了，下一拍不前進，也不攻城、不進城 */
  fight: boolean
}

/** 兩支敵對的軍隊打起來的地方（兩軍中間，地圖座標 ×10）和這一拍各自少掉的兵。 */
export interface Clash { x: number; y: number; units: number }

/** 砲台打中一支軍隊：軍隊當時的位置（地圖座標 ×10）。 */
export interface Shot { fort: number; x: number; y: number }

/** 一區換了主人：from 是原本的（0 是中立），to 是打下來的 */
export interface Take { region: number; from: PlayerId; to: PlayerId }

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
  /** 剛跑完的這一拍裡，哪些區換了主人。也只給畫面用。 */
  takes: Take[]
}

/** 一筆指令：在第 tick 拍，從 from 區派兵到 to 區。派兵的人就是當下 from 的主人。 */
export interface Command { tick: number; from: number; to: number }
