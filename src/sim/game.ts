// 遊戲規則本體：純函式、固定節拍、只用整數。不碰 DOM、不用 Math.random。
import { type Graph, legTicks, pathTo, reach } from './graph'
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
    owner: 0, units: RULES.neutral[r.trait], acc: 0, readyAt: 0, bonusTaken: 0,
  }))
  setup.starts.forEach((r, i) => {
    regions[r].owner = i + 1
    regions[r].units = RULES.startUnits
  })
  const alive = [false]
  for (let p = 1; p <= setup.players; p++) alive.push(true)
  return { tick: 0, players: setup.players, regions, armies: [], nextArmyId: 1, alive, winner: 0 }
}

export const isCity = (map: MapData, r: number) => map.regions[r].trait === 'city'
export const capOf = (map: MapData, r: number) => (isCity(map, r) ? RULES.cap.city : RULES.cap.normal)
export const prodOf = (map: MapData, r: number) => (isCity(map, r) ? RULES.prodPerTick.city : RULES.prodPerTick.normal)
/** 這次派兵會派出幾個 */
export const sendAmount = (units: number) => Math.floor(units / 2)
/** 進攻 r 區時，n 個兵實際算幾個 */
export const attackStrength = (map: MapData, r: number, n: number) =>
  map.regions[r].trait === 'fort' ? Math.floor((n * RULES.fortNum) / RULES.fortDen) : n

export function canSend(state: GameState, from: number): boolean {
  const r = state.regions[from]
  return r.owner !== 0 && state.tick >= r.readyAt && r.units >= RULES.minUnitsToSend
}

/**
 * 下指令：從 from 派一半的兵到 to。成功回傳 true。
 * 派兵的人就是 from 現在的主人，所以指令本身不用記是誰下的。
 */
export function issue(state: GameState, map: MapData, g: Graph, from: number, to: number): boolean {
  if (state.winner || from === to || from < 0 || to < 0 || from >= g.n || to >= g.n) return false
  if (!canSend(state, from)) return false
  const src = state.regions[from]
  const fast = map.regions[from].trait === 'post'
  const path = pathTo(reach(g, state, from, src.owner, fast), to)
  if (!path) return false
  const n = sendAmount(src.units)
  src.units -= n
  src.readyAt = state.tick + RULES.cooldownTicks
  state.armies.push({
    id: state.nextArmyId++, owner: src.owner, units: n, path, leg: 0, t: 0,
    legTicks: legTicks(g, path[0], path[1], fast), fast,
  })
  return true
}

function arrive(state: GameState, map: MapData, army: Army, at: number): void {
  const r = state.regions[at]
  if (r.owner === army.owner) { r.units += army.units; return }
  const power = attackStrength(map, at, army.units)
  if (power <= r.units) { r.units -= power; return }
  // 佔領
  r.units = power - r.units
  r.owner = army.owner
  r.acc = 0
  r.readyAt = state.tick
  const bit = 1 << army.owner
  if (map.regions[at].trait === 'granary' && !(r.bonusTaken & bit)) {
    r.bonusTaken |= bit
    r.units += RULES.granaryBonus
  }
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
  // 行軍（依編號順序處理，結果才固定）
  const still: Army[] = []
  for (const a of state.armies) {
    a.t += 1
    if (a.t < a.legTicks) { still.push(a); continue }
    const at = a.path[a.leg + 1]
    const last = a.leg + 1 === a.path.length - 1
    // 中途的區已經不是自己的，就在這裡開打
    if (last || state.regions[at].owner !== a.owner) { arrive(state, map, a, at); continue }
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
  for (const r of state.regions) { mix(r.owner); mix(r.units); mix(r.acc); mix(r.readyAt); mix(r.bonusTaken) }
  for (const a of state.armies) { mix(a.id); mix(a.owner); mix(a.units); mix(a.leg); mix(a.t); for (const p of a.path) mix(p) }
  mix(state.winner)
  return h
}
