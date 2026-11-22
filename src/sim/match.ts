// 一局遊戲：把規則、電腦對手、指令記錄串起來。畫面只跟這一層打交道。
import { AI_PROFILE, aiThink, type Difficulty } from './ai'
import { createGame, issue, step, totals } from './game'
import { buildGraph, type Graph } from './graph'
import { Rng } from './rng'
import type { GameState, MapData, PlayerId } from './types'

export interface MatchConfig {
  /** 勢力數（含玩家） */
  players: number
  /** starts[p - 1] 是玩家 p 的起點 */
  starts: number[]
  /** 真人是幾號；0 表示全部交給電腦 */
  human: PlayerId
  difficulty: Difficulty
  seed: number
}

/** 每隔幾拍記一次各方兵力（結束畫面的走勢圖用） */
export const SAMPLE_TICKS = 10

export class Match {
  readonly graph: Graph
  readonly state: GameState
  /** 所有成功的指令，三個一組：拍、從、到 */
  readonly commands: number[] = []
  /** 每 SAMPLE_TICKS 拍一筆各方總兵力 */
  readonly history: number[][] = []
  private readonly rngs: Rng[] = []

  constructor(readonly map: MapData, readonly config: MatchConfig) {
    this.graph = buildGraph(map)
    this.state = createGame(map, { players: config.players, starts: config.starts })
    for (let p = 0; p <= config.players; p++) this.rngs.push(new Rng(config.seed * 31 + p * 7919 + 1))
    this.history.push(totals(this.state))
  }

  /** 下指令（真人與電腦都走這裡）。成功才會記下來。 */
  order(from: number, to: number): boolean {
    const tick = this.state.tick
    if (!issue(this.state, this.map, this.graph, from, to)) return false
    this.commands.push(tick, from, to)
    return true
  }

  /** 推進一拍：電腦先想，再跑規則。 */
  tick(): void {
    const s = this.state
    if (s.winner) return
    const think = AI_PROFILE[this.config.difficulty].think
    for (let p = 1; p <= s.players; p++) {
      if (p === this.config.human || !s.alive[p]) continue
      // 各家錯開，不要同一拍一起動
      if ((s.tick + p * 7) % think !== 0) continue
      for (const o of aiThink(s, this.map, this.graph, p, this.rngs[p], this.config.difficulty)) this.order(o.from, o.to)
    }
    step(s, this.map, this.graph)
    if (s.tick % SAMPLE_TICKS === 0) this.history.push(totals(s))
  }

  /** 真人已經出局 */
  get humanOut(): boolean {
    return this.config.human !== 0 && !this.state.alive[this.config.human]
  }
  get over(): boolean {
    return this.state.winner !== 0 || this.humanOut
  }
}
