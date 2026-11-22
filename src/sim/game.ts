// 遊戲規則本體：純函式、固定節拍、只用整數。不碰 DOM、不用 Math.random。
import { gateTick, type Graph, inRange, legTicks, posOf, route } from './graph'
import { RULES } from './rules'
import type { Army, GameState, MapData, PlayerId, Region } from './types'

export interface Setup {
  /** 勢力數（含玩家） */
  players: number
  /** starts[p - 1] 是玩家 p 的起點區 */
  starts: number[]
}

export function createGame(map: MapData, setup: Setup): GameState {
  const regions: Region[] = map.regions.map((r) => ({
    owner: 0, units: RULES.neutral[r.trait], acc: 0, readyAt: 0,
  }))
  setup.starts.forEach((r, i) => {
    regions[r].owner = i + 1
    regions[r].units = RULES.startUnits
  })
  const alive = [false]
  for (let p = 1; p <= setup.players; p++) alive.push(true)
  return { tick: 0, players: setup.players, regions, armies: [], nextArmyId: 1, alive, winner: 0, clashes: [], gains: [], shots: [], takes: [] }
}

export const isCity = (map: MapData, r: number) => map.regions[r].trait === 'city'
export const capOf = (map: MapData, r: number) => {
  const trait = map.regions[r].trait
  return trait === 'fort' ? RULES.cap.fort : trait === 'city' ? RULES.cap.city : RULES.cap.normal
}
export const prodOf = (map: MapData, r: number) => (isCity(map, r) ? RULES.prodPerTick.city : RULES.prodPerTick.normal)
/** 這次派兵會派出幾個：整區的兵都走 */
export const sendAmount = (units: number) => units

export function canSend(state: GameState, from: number): boolean {
  const r = state.regions[from]
  return r.owner !== 0 && state.tick >= r.readyAt && r.units >= RULES.minUnitsToSend
}

/**
 * 下指令：把 from 的兵全部派到 to。成功回傳 true。
 * 派兵的人就是 from 現在的主人，所以指令本身不用記是誰下的。
 * to 可以是任何一區：到不了的遠處，軍隊會沿路走到第一個不是自己的區開打。
 */
export function issue(state: GameState, map: MapData, g: Graph, from: number, to: number): boolean {
  if (state.winner || from === to || from < 0 || to < 0 || from >= g.n || to >= g.n) return false
  if (!canSend(state, from)) return false
  const src = state.regions[from]
  const fast = map.regions[from].trait === 'post'
  const path = route(g, state, from, src.owner, fast, to)
  if (!path) return false
  const n = sendAmount(src.units)
  src.units -= n
  src.readyAt = state.tick + RULES.cooldownTicks
  state.armies.push({
    id: state.nextArmyId++, owner: src.owner, units: n, path, leg: 0, t: 0,
    legTicks: legTicks(g, path[0], path[1], fast), fast, siege: false,
  })
  return true
}

/**
 * 軍隊停在城外之後的每一拍。回傳 true 表示還沒完，軍隊繼續留在城外。
 * - 別人的區：跟守軍一個換一個。守軍先打光就佔領；同時打光算守住（守軍剩 0）。
 * - 自己的區（本來就是、剛打下來、或別路的友軍先打下來了）：排隊進城，每拍進去幾個，比圍城快。
 */
function besiege(state: GameState, map: MapData, army: Army, at: number): boolean {
  const r = state.regions[at]
  army.siege = true
  if (r.owner !== army.owner) {
    const n = Math.min(RULES.siegePerTick, army.units, r.units)
    army.units -= n
    r.units -= n
    if (army.units === 0) return false
    if (r.units > 0) return true
    // 佔領：守軍打光了，這一拍就開始進城
    state.takes.push({ region: at, from: r.owner, to: army.owner })
    r.owner = army.owner
    r.acc = 0
    r.readyAt = state.tick
    if (map.regions[at].trait === 'granary') {
      r.units += RULES.granaryBonus
      state.gains.push({ region: at, units: RULES.granaryBonus })
    }
  }
  const n = Math.min(RULES.enterPerTick, army.units)
  army.units -= n
  r.units += n
  return army.units > 0
}

/**
 * 遭遇：兩支敵對的軍隊在圖上靠得夠近（RULES.clashRange）就打起來，一兵換一兵當場抵銷。
 * 看的是圖上的直線距離，所以不只同一條路迎面或追上：兩條路在據點附近會合、
 * 從被圍的城出來撞上城外的敵軍，都算。依編號順序一對一對算，結果才固定。
 */
function clash(state: GameState, g: Graph): void {
  state.clashes = []
  const all = state.armies
  const pos = all.map((a) => posOf(g, a.path[a.leg], a.path[a.leg + 1], a.t, a.legTicks))
  const reach = (RULES.clashRange * 10) ** 2
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    for (let j = i + 1; j < all.length && a.units > 0; j++) {
      const b = all[j]
      if (b.units === 0 || b.owner === a.owner) continue
      const dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1]
      if (dx * dx + dy * dy > reach) continue
      const n = Math.min(a.units, b.units)
      a.units -= n
      b.units -= n
      state.clashes.push({ x: (pos[i][0] + pos[j][0]) >> 1, y: (pos[i][1] + pos[j][1]) >> 1, units: n })
    }
  }
}

/**
 * 砲台開火：每隔幾拍，射程內每一支不是砲台主人的軍隊都少一個兵。
 * 中立的砲台誰都打。在射程裡待越久（走得慢、路繞著砲台），損失越多。
 */
function shell(state: GameState, g: Graph): void {
  state.shots = []
  if (state.tick % RULES.fort.every !== 0) return
  for (const f of g.forts) {
    const owner = state.regions[f].owner
    for (const a of state.armies) {
      if (a.units === 0 || a.owner === owner) continue
      const from = a.path[a.leg], to = a.path[a.leg + 1]
      if (!inRange(g, f, from, to, a.t, a.legTicks)) continue
      a.units -= 1
      const [x, y] = posOf(g, from, to, a.t, a.legTicks)
      state.shots.push({ fort: f, x, y })
    }
  }
}

/**
 * 現在派 units 個兵沿 path 走到第 stop 站，路上會被砲台打掉幾個（照現在各砲台的主人算）。
 * 跟 step 裡的算法一拍一拍對齊，砲台中途沒換人的話就是準的。
 */
export function shellLoss(state: GameState, g: Graph, path: number[], stop: number, fast: boolean, owner: PlayerId, units: number): number {
  const forts = g.forts.filter((f) => state.regions[f].owner !== owner)
  if (!forts.length) return 0
  let tick = state.tick, lost = 0
  for (let i = 0; i < stop; i++) {
    const len = legTicks(g, path[i], path[i + 1], fast)
    // 最後一段只走到城外
    const end = i === stop - 1 ? gateTick(g, path[i], path[i + 1], len) : len
    for (let t = 1; t <= end; t++, tick++) {
      if (tick % RULES.fort.every !== 0) continue
      for (const f of forts) if (inRange(g, f, path[i], path[i + 1], t, len)) lost += 1
    }
  }
  return Math.min(lost, units)
}

export interface Forecast {
  /** 軍隊會停在哪一區 */
  at: number
  /** 打完之後那一區是不是自己的 */
  mine: boolean
  /** 打完之後那一區有幾個兵 */
  units: number
  /** 一路上（含圍城時）被砲台打掉幾個 */
  shelled: number
}

/**
 * 現在從 from 派兵到 to 會怎麼樣。拿一份只有這支軍隊的副本照規則跑到打完為止，
 * 所以砲台、圍城時守軍繼續長兵都算在內；沒算的是路上其他的軍隊。派不出去回傳 null。
 */
export function forecast(state: GameState, map: MapData, g: Graph, from: number, to: number): Forecast | null {
  const sim: GameState = {
    ...state, regions: state.regions.map((r) => ({ ...r })), armies: [], alive: [...state.alive],
    winner: 0, clashes: [], gains: [], shots: [], takes: [],
  }
  const owner = sim.regions[from].owner
  sim.regions[from].readyAt = 0
  if (!issue(sim, map, g, from, to)) return null
  const army = sim.armies[0]
  let shelled = 0
  for (let i = 0; i < 6000 && sim.armies.length; i++) {
    step(sim, map, g)
    shelled += sim.shots.length
    // 副本裡沒有別人的軍隊，可能有人看起來出局了；不讓它提早分出勝負
    sim.winner = 0
  }
  const at = army.path[army.leg + 1]
  return { at, mine: sim.regions[at].owner === owner, units: sim.regions[at].units, shelled }
}

/** 推進一拍。 */
export function step(state: GameState, map: MapData, g: Graph): void {
  if (state.winner) return
  // 生產
  for (let i = 0; i < state.regions.length; i++) {
    const r = state.regions[i]
    if (r.owner === 0 || r.units >= capOf(map, i)) continue
    r.acc += prodOf(map, i)
    if (r.acc >= 1000) { r.acc -= 1000; r.units += 1 }
  }
  // 行軍（依編號順序處理，結果才固定）：先全部往前一拍（停在城外的不動），靠得夠近的敵軍先抵銷，
  // 再挨砲台的砲，剩下的才往下走：到城外就停下來攻城或進城
  for (const a of state.armies) if (!a.siege) a.t += 1
  state.gains = []
  state.takes = []
  clash(state, g)
  shell(state, g)
  const still: Army[] = []
  for (const a of state.armies) {
    if (a.units === 0) continue
    const from = a.path[a.leg], at = a.path[a.leg + 1]
    const last = a.leg + 1 === a.path.length - 1
    // 這一區是終點，或中途的區已經不是自己的：走到城外就停，不進據點
    if (last || a.siege || state.regions[at].owner !== a.owner) {
      if (!a.siege && a.t < gateTick(g, from, at, a.legTicks)) still.push(a)
      else if (besiege(state, map, a, at)) still.push(a)
      continue
    }
    if (a.t < a.legTicks) { still.push(a); continue }
    a.leg += 1
    a.t = 0
    a.legTicks = legTicks(g, a.path[a.leg], a.path[a.leg + 1], a.fast)
    still.push(a)
  }
  state.armies = still
  state.tick += 1
  // 出局與勝負：沒有領地也沒有在路上的兵，就出局
  const has = new Array<boolean>(state.players + 1).fill(false)
  for (const r of state.regions) has[r.owner] = true
  for (const a of state.armies) has[a.owner] = true
  let left = 0, lastAlive = 0
  for (let p = 1; p <= state.players; p++) {
    state.alive[p] = has[p]
    if (has[p]) { left += 1; lastAlive = p }
  }
  if (left === 1) state.winner = lastAlive
}

/** 各方的總兵力（領地＋路上），索引 0 是中立。 */
export function totals(state: GameState): number[] {
  const t = new Array<number>(state.players + 1).fill(0)
  for (const r of state.regions) t[r.owner] += r.units
  for (const a of state.armies) t[a.owner] += a.units
  return t
}

export function regionCount(state: GameState, p: PlayerId): number {
  let n = 0
  for (const r of state.regions) if (r.owner === p) n += 1
  return n
}

/** 狀態的雜湊，用來確認重播與原局一致。 */
export function hashState(state: GameState): number {
  let h = 2166136261 >>> 0
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0 }
  mix(state.tick)
  for (const r of state.regions) { mix(r.owner); mix(r.units); mix(r.acc); mix(r.readyAt) }
  for (const a of state.armies) { mix(a.id); mix(a.owner); mix(a.units); mix(a.leg); mix(a.t); mix(a.siege ? 1 : 0); for (const p of a.path) mix(p) }
  mix(state.winner)
  return h
}
