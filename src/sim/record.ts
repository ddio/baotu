// 對戰記錄與重播。記錄只存「開局設定＋所有指令」，重播時把指令照拍數餵回規則。
// 電腦對手的指令也記在裡面，所以重播不用再跑一次電腦，改了電腦的打法舊記錄也還能播。
import type { Difficulty } from './ai'
import { createGame, hashState, issue, step, totals } from './game'
import { buildGraph, type Graph } from './graph'
import { type Match, type MatchConfig, SAMPLE_TICKS } from './match'
import { RULES_VERSION } from './rules'
import type { GameState, MapData, Take } from './types'

export const RECORD_FORMAT = 1
export const MAX_RECORDS = 32

export type Result = 'win' | 'lose' | 'quit'

export interface GameRecord {
  format: number
  id: string
  /** ISO 時間 */
  date: string
  map: string
  mapVersion: number
  rulesVersion: number
  config: MatchConfig
  /** 三個一組：拍、從、到 */
  commands: number[]
  /** 總共幾拍 */
  ticks: number
  result: Result
  /** 結束時的狀態雜湊，重播時用來確認沒有走樣 */
  hash: number
}

export function makeRecord(match: Match, result: Result, date: Date): GameRecord {
  return {
    format: RECORD_FORMAT,
    id: `${date.getTime().toString(36)}-${(match.config.seed >>> 0).toString(36)}`,
    date: date.toISOString(),
    map: match.map.id,
    mapVersion: match.map.version,
    rulesVersion: RULES_VERSION,
    config: { ...match.config, starts: [...match.config.starts] },
    commands: [...match.commands],
    ticks: match.state.tick,
    result,
    hash: hashState(match.state),
  }
}

/** 這筆記錄能不能用現在的規則與地圖重播。 */
export function playable(rec: GameRecord, maps: Record<string, MapData>): boolean {
  const map = maps[rec.map]
  return rec.format === RECORD_FORMAT && rec.rulesVersion === RULES_VERSION && !!map && map.version === rec.mapVersion
}

/** 加一筆到最前面；同一筆不重複，超過上限就丟掉最舊的。 */
export function addRecord(list: GameRecord[], rec: GameRecord, max = MAX_RECORDS): GameRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, max)
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']
const RESULTS: Result[] = ['win', 'lose', 'quit']

/** 檢查匯入的東西是不是一筆像樣的記錄；不是就回傳 null。 */
export function parseRecord(x: unknown): GameRecord | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Record<string, unknown>
  const c = r.config as Record<string, unknown> | undefined
  if (!isInt(r.format) || typeof r.id !== 'string' || r.id.length > 64 || typeof r.date !== 'string') return null
  if (Number.isNaN(Date.parse(r.date)) || typeof r.map !== 'string' || !isInt(r.mapVersion) || !isInt(r.rulesVersion)) return null
  if (!isInt(r.ticks) || r.ticks < 0 || r.ticks > 10_000_000 || !isInt(r.hash)) return null
  if (!RESULTS.includes(r.result as Result)) return null
  if (typeof c !== 'object' || c === null) return null
  if (!isInt(c.players) || c.players < 2 || c.players > 8 || !isInt(c.human) || c.human < 0 || c.human > c.players) return null
  if (!isInt(c.seed) || !DIFFICULTIES.includes(c.difficulty as Difficulty)) return null
  if (!Array.isArray(c.starts) || c.starts.length !== c.players || !c.starts.every((v) => isInt(v) && v >= 0)) return null
  if (new Set(c.starts).size !== c.starts.length) return null
  const cmd = r.commands
  if (!Array.isArray(cmd) || cmd.length % 3 !== 0 || cmd.length > 300_000 || !cmd.every((v) => isInt(v) && v >= 0)) return null
  return {
    format: r.format, id: r.id, date: new Date(r.date).toISOString(), map: r.map, mapVersion: r.mapVersion,
    rulesVersion: r.rulesVersion,
    config: { players: c.players, starts: c.starts as number[], human: c.human, difficulty: c.difficulty as Difficulty, seed: c.seed },
    commands: cmd as number[], ticks: r.ticks, result: r.result as Result, hash: r.hash,
  }
}

/** 重播：可以一拍一拍走，也可以直接跳到某一拍。 */
export class Replay {
  readonly graph: Graph
  state: GameState
  /** 整局的兵力走勢（建立時先跑完一遍算出來） */
  readonly history: number[][] = []
  /** 整局裡每一次換主人，照時間排（建立時一起算出來）；tick 是發生之後的那一拍 */
  readonly takes: (Take & { tick: number })[] = []
  /** 跑完整局後的雜湊與記錄上的一不一樣 */
  readonly faithful: boolean
  private next = 0

  constructor(readonly rec: GameRecord, readonly map: MapData) {
    if (rec.config.starts.some((s) => s >= map.regions.length)) throw new Error('記錄與地圖不合')
    this.graph = buildGraph(map)
    this.state = this.fresh()
    this.history.push(totals(this.state))
    while (this.state.tick < rec.ticks && !this.state.winner) {
      this.step()
      for (const e of this.state.takes) this.takes.push({ ...e, tick: this.state.tick })
      if (this.state.tick % SAMPLE_TICKS === 0) this.history.push(totals(this.state))
    }
    this.faithful = hashState(this.state) === rec.hash
    this.seek(0)
  }

  private fresh(): GameState {
    this.next = 0
    return createGame(this.map, { players: this.rec.config.players, starts: this.rec.config.starts })
  }

  get done(): boolean {
    return this.state.tick >= this.rec.ticks || this.state.winner !== 0
  }

  step(): void {
    if (this.done) return
    const c = this.rec.commands
    while (this.next < c.length && c[this.next] <= this.state.tick) {
      if (c[this.next] === this.state.tick) issue(this.state, this.map, this.graph, c[this.next + 1], c[this.next + 2])
      this.next += 3
    }
    step(this.state, this.map, this.graph)
  }

  seek(tick: number): void {
    const target = Math.max(0, Math.min(tick, this.rec.ticks))
    if (target < this.state.tick) this.state = this.fresh()
    while (this.state.tick < target && !this.done) this.step()
  }
}
