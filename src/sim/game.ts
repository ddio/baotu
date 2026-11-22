// 遊戲規則本體：純函式、固定節拍、只用整數。不碰 DOM、不用 Math.random。
import { type Graph, legTicks, route } from './graph'
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
  return { tick: 0, players: setup.players, regions, armies: [], nextArmyId: 1, alive, winner: 0, clashes: [], gains: [] }
}

export const isCity = (map: MapData, r: number) => map.regions[r].trait === 'city'
export const capOf = (map: MapData, r: number) => {
  const trait = map.regions[r].trait
  return trait === 'fort' ? RULES.cap.fort : trait === 'city' ? RULES.cap.city : RULES.cap.normal
}
export const prodOf = (map: MapData, r: number) => (isCity(map, r) ? RULES.prodPerTick.city : RULES.prodPerTick.normal)
/** 這次派兵會派出幾個：整區的兵都走 */
export const sendAmount = (units: number) => units
/** 進攻 r 區時，n 個兵實際算幾個 */
export const attackStrength = (map: MapData, r: number, n: number) =>
  map.regions[r].trait === 'fort' ? Math.floor((n * RULES.fortNum) / RULES.fortDen) : n

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
  // 糧倉每次換人都加兵
  if (map.regions[at].trait === 'granary') {
    r.units += RULES.granaryBonus
    state.gains.push({ region: at, units: RULES.granaryBonus })
  }
}

/**
 * 路上相遇：同一段路上不同陣營的兩支軍隊碰頭，就一兵換一兵互相抵銷，兵多的那支帶著剩下的繼續走。
 * 迎面而來的，位置交會就算碰頭；同方向的，後面的追上前面的才算。位置用交叉相乘比，不出現小數。
 */
function clash(state: GameState): void {
  state.clashes = []
  const all = state.armies
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    const au = a.path[a.leg], av = a.path[a.leg + 1]
    for (let j = i + 1; j < all.length && a.units > 0; j++) {
      const b = all[j]
      if (b.units === 0 || b.owner === a.owner) continue
      const bu = b.path[b.leg], bv = b.path[b.leg + 1]
      let met: boolean
      if (au === bv && av === bu) {
        met = a.t * b.legTicks + b.t * a.legTicks >= a.legTicks * b.legTicks
      } else if (au === bu && av === bv) {
        const now = a.t * b.legTicks - b.t * a.legTicks
        const before = (a.t - 1) * b.legTicks - (b.t - 1) * a.legTicks
        met = now === 0 || before === 0 || (now > 0) !== (before > 0)
      } else continue
      if (!met) continue
      const n = Math.min(a.units, b.units)
      a.units -= n
      b.units -= n
      state.clashes.push({ from: au, to: av, t: a.t, legTicks: a.legTicks, units: n })
    }
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
  // 行軍（依編號順序處理，結果才固定）：先全部往前一拍，路上碰頭的先抵銷，剩下的才抵達
  for (const a of state.armies) a.t += 1
  state.gains = []
  clash(state)
  const still: Army[] = []
  for (const a of state.armies) {
    if (a.units === 0) continue
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
  for (const r of state.regions) { mix(r.owner); mix(r.units); mix(r.acc); mix(r.readyAt) }
  for (const a of state.armies) { mix(a.id); mix(a.owner); mix(a.units); mix(a.leg); mix(a.t); for (const p of a.path) mix(p) }
  mix(state.winner)
  return h
}
