// 規則引擎對外的樣子。重播依記錄上的規則版本挑引擎：現行的那一份，或 src/sim/v<N>/ 裡凍結的舊版。
// 畫面（MapView、重播畫面）只認這裡的 View* 型別，不直接碰哪一版的 GameState，
// 所以舊版引擎交出來的狀態畫不畫得出來，編譯時就會知道。
import type { Clash, Gain, MapData, PlayerId, Shot, Take } from './types'

export interface ViewRegion {
  owner: PlayerId
  units: number
  /** 這一拍（含）之後才能再派兵 */
  readyAt: number
  /** 糧倉的兵發過了。規則 v7 以前每次換人都發，沒有這一欄 */
  spent?: boolean
}

export interface ViewArmy {
  id: number
  owner: PlayerId
  units: number
  /** 經過的區，含起點與終點 */
  path: number[]
  /** 正在走 path[leg] → path[leg + 1]，這一段走了 t / legTicks */
  leg: number
  t: number
  legTicks: number
  /** 停在城外（攻城或排隊進城） */
  siege: boolean
  /** 被旁邊的敵軍纏住，停在原地 */
  fight: boolean
}

/** 畫面讀得到的狀態。新規則要畫新東西時，在這裡加欄位，舊版的轉接（v<N>/index.ts）負責補上。 */
export interface ViewState {
  tick: number
  players: number
  regions: ViewRegion[]
  armies: ViewArmy[]
  alive: boolean[]
  winner: PlayerId
  clashes: Clash[]
  gains: Gain[]
  shots: Shot[]
  takes: Take[]
}

/** 畫面要用到的規則數字 */
export interface ViewRules {
  /** 砲台射程（地圖座標的單位） */
  fortRange: number
  /** 射程跟別人不一樣的砲台：區的代號 → 射程 */
  fortFar: Readonly<Record<string, number>>
  /** 派兵後的冷卻（拍） */
  cooldownTicks: number
}

export interface Setup {
  /** 勢力數（含玩家） */
  players: number
  /** starts[p - 1] 是玩家 p 的起點區 */
  starts: number[]
}

/** 一局進行中的模擬 */
export interface Sim {
  readonly state: ViewState
  /** 下指令；不合規則的會被略過，回傳 false */
  issue(from: number, to: number): boolean
  step(): void
  hash(): number
  /** 各方的總兵力（領地＋路上），索引 0 是中立 */
  totals(): number[]
}

export interface Engine {
  readonly version: number
  readonly view: ViewRules
  start(map: MapData, setup: Setup): Sim
}

/** 一版規則要交出來的東西：就是 game.ts、graph.ts、rules.ts 本來就有的那幾個。 */
export interface EngineParts<S extends ViewState, G extends object> {
  RULES: { fort: { range: number; far?: Readonly<Record<string, number>> }; cooldownTicks: number }
  buildGraph(map: MapData): G
  createGame(map: MapData, setup: Setup): S
  issue(state: S, map: MapData, g: G, from: number, to: number): boolean
  step(state: S, map: MapData, g: G): void
  hashState(state: S): number
  totals(state: S): number[]
}

export function makeEngine<S extends ViewState, G extends object>(version: number, p: EngineParts<S, G>): Engine {
  const graphs = new WeakMap<MapData, G>()
  return {
    version,
    view: { fortRange: p.RULES.fort.range, fortFar: p.RULES.fort.far ?? {}, cooldownTicks: p.RULES.cooldownTicks },
    start(map, setup) {
      const g = graphs.get(map) ?? p.buildGraph(map)
      graphs.set(map, g)
      const state = p.createGame(map, setup)
      return {
        state,
        issue: (from, to) => p.issue(state, map, g, from, to),
        step: () => p.step(state, map, g),
        hash: () => p.hashState(state),
        totals: () => p.totals(state),
      }
    },
  }
}
