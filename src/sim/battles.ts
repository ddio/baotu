// 重播用的戰役整理：一局跑過去的時候，把每一拍少掉的兵歸到「哪一場仗」裡，
// 一場仗打完才算一筆：圍城（守住了、或換了主人）和城外、路上的遭遇。
//
// 只看 ViewState（規則引擎對外的樣子），不碰哪一版的規則內部，所以舊版規則的記錄也整理得出來。
// 代價是要從前後兩拍的差別去推「這幾個兵是怎麼少的」：
//   - 停在城外、沒被纏住的軍隊，這一拍一定輪到它：城是別人的就跟守軍一個換一個，是自己的就進城
//   - 進城少掉的不算折損
//   - 其餘少掉的是遭遇和砲台打的
// 推不準的只有軍隊消失的那一拍（差一兩個兵），所以這裡的數字拿來寫戰報，不拿來判勝負。
import type { Sim, ViewArmy } from './engine'
import type { MapData, PlayerId } from './types'

export interface Battle {
  /** 開打的那一拍 */
  start: number
  /** 打完的那一拍：最後一次有人折損、或這一區易手之後的那一拍（跟 Replay.takes 的 tick 同一種算法） */
  tick: number
  /** held：攻方打光了，城還在守方手上。fell：圍到一半這一區換了主人（不一定是這個攻方打下來的）。field：城外、路上的遭遇 */
  kind: 'held' | 'fell' | 'field'
  /** 圍城：被圍的區。遭遇：交戰的地方比較靠近的那個據點 */
  region: number
  /** 遭遇打在兩個據點中間的時候，那一段路的另一頭；其他時候是 -1 */
  other: number
  /** 圍城的攻方和守方（守方 0 是中立）；遭遇兩個都是 0，看 lost 就知道誰在場 */
  attacker: PlayerId
  defender: PlayerId
  /** 各方折損的兵，索引是玩家編號。守方的包含趕來解圍、在城外跟攻方打起來的援軍 */
  lost: number[]
}

/**
 * 同一方對同一區，隔這麼多拍以內又打上來，算同一場圍城；超過就是打完了。
 * 取 2 秒：幾路同時到的會連成一場，零星一小隊一小隊送上來的（派兵冷卻 4 秒）各算各的，
 * 不會拖成一場打幾分鐘、到最後才有結果的仗。試過 5 秒，大仗的數量差不多，但九成的仗要多等十秒才收尾。
 */
const SIEGE_GAP = 20
/** 同一個地方的遭遇，隔這麼多拍以內再打起來算同一場 */
const FIELD_GAP = 20
/** 離這場遭遇開打的地方多近算同一個地方（地圖座標 ×10；遭遇的距離是 36） */
const FIELD_REACH = 800

interface Open {
  siege: boolean
  region: number
  attacker: PlayerId
  defender: PlayerId
  /** 遭遇開打的位置，和當時那支軍隊走的那一段路 */
  x: number
  y: number
  from: number
  to: number
  start: number
  last: number
  lost: number[]
  closed: boolean
}

interface Seen {
  owner: PlayerId
  units: number
  siege: boolean
  fight: boolean
  from: number
  target: number
  x: number
  y: number
}

export class BattleLog {
  private prev = new Map<number, Seen>()
  private owners: PlayerId[] = []
  /** 還在打的圍城：區 × 16 + 攻方 */
  private sieges = new Map<number, Open>()
  private fields: Open[] = []
  /** 每支軍隊上一次是在哪一場仗裡跟人打起來的。對手死掉的那一拍找不到對手，就靠這個 */
  private side = new Map<number, Open>()
  private done: Battle[] = []

  constructor(private readonly map: MapData, private readonly players: number, private readonly enterPerTick: number) {}

  /** 這一拍的指令下完、還沒走之前叫：記下每支軍隊和每一區現在的樣子 */
  before(sim: Sim): void {
    const s = sim.state
    this.prev.clear()
    for (const a of s.armies) {
      const [x, y] = sim.where(a)
      this.prev.set(a.id, { owner: a.owner, units: a.units, siege: a.siege, fight: a.fight, from: a.path[a.leg], target: a.path[a.leg + 1], x, y })
    }
    this.owners = s.regions.map((r) => r.owner)
  }

  /** 走完一拍之後叫 */
  after(sim: Sim): void {
    const s = sim.state, tick = s.tick, E = this.enterPerTick
    const now = new Map<number, ViewArmy>(s.armies.map((a) => [a.id, a]))
    /** 這一拍還纏在一起的軍隊和它們的位置，找對手用 */
    const fighting = s.armies.filter((a) => a.fight).map((a) => ({ a, at: sim.where(a) }))
    const loose: { id: number; p: Seen; a: ViewArmy | undefined; n: number }[] = []

    for (const [id, p] of this.prev) {
      const a = now.get(id)
      const d = p.units - (a ? a.units : 0)
      if (d <= 0) continue
      const ownBefore = this.owners[p.target] === p.owner
      const ownAfter = s.regions[p.target].owner === p.owner
      // 這一拍有沒有輪到它攻城或進城：停在城外、沒被纏住。消失的軍隊看上一拍
      const turn = a ? a.siege && !a.fight : p.siege && !p.fight
      let traded = 0, entered = 0
      if (turn) {
        if (!ownAfter) traded = 1
        else if (ownBefore) entered = a ? E : d
        // 這一拍打下來的：先跟守軍換一個再進城，或是同一方別支先打下來、它只進城
        else { traded = a && d !== E ? 1 : 0; entered = d }
      } else if (!a && !p.fight && ownAfter) {
        // 走到自己的城外，兵少到一拍就進完了
        entered = d
      }
      traded = Math.min(traded, d)
      entered = Math.min(entered, d - traded)
      const rest = d - traded - entered
      const fought = p.fight || (a ? a.fight : false)

      if ((p.siege || (a ? a.siege : false)) && !ownBefore) {
        // 在圍別人的城：換掉的兩邊各算一個；圍城時挨的砲、被援軍咬掉的，也算在這場圍城的攻方
        const b = this.siege(p.target, p.owner, tick)
        b.lost[p.owner] += traded + rest
        b.lost[b.defender] += traded
        b.last = tick
        if (fought) this.side.set(id, b)
      } else if (fought && rest > 0) {
        loose.push({ id, p, a, n: rest })
      }
    }

    // 不是在圍城的軍隊跟人打起來：對手正在圍它家的城，就是解圍，算進那場圍城的守方；不然就是遭遇
    for (const { id, p, a, n } of loose) {
      let b: Open | undefined
      if (a && a.fight) {
        const [x, y] = sim.where(a)
        let foe: ViewArmy | undefined, fx = x, fy = y, best = Infinity
        for (const f of fighting) {
          if (f.a.owner === a.owner) continue
          const dist = (f.at[0] - x) ** 2 + (f.at[1] - y) ** 2
          if (dist < best) { best = dist; foe = f.a; [fx, fy] = f.at }
        }
        const t = foe && foe.siege ? foe.path[foe.leg + 1] : -1
        if (foe && t >= 0 && this.owners[t] === a.owner) b = this.sieges.get(t * 16 + foe.owner)
        if (!b) {
          const was = this.side.get(id)
          // 遭遇的地點取兩軍中間
          b = was && !was.closed && !was.siege ? was : this.field((x + fx) >> 1, (y + fy) >> 1, p, tick)
        }
        this.side.set(id, b)
      } else {
        // 對手這一拍打光了（或自己打光了）：算在上一拍的那場仗裡
        b = this.side.get(id)
        if (!b || b.closed) b = this.field(p.x, p.y, p, tick)
      }
      b.lost[p.owner] += n
      b.last = tick
    }
    for (const id of this.side.keys()) if (!now.has(id)) this.side.delete(id)

    // 這一區換了主人：圍它的每一場都到此為止（沒打下來的那幾方，接下來是跟新主人打，另一場）
    for (const e of s.takes) {
      for (const [key, b] of this.sieges) {
        if (b.region !== e.region) continue
        b.last = tick
        this.close(b, 'fell')
        this.sieges.delete(key)
      }
    }
    for (const [key, b] of this.sieges) {
      if (tick - b.last <= SIEGE_GAP) continue
      this.close(b, 'held')
      this.sieges.delete(key)
    }
    this.fields = this.fields.filter((b) => {
      if (tick - b.last <= FIELD_GAP) return true
      this.close(b, 'field')
      return false
    })
  }

  /** 整局跑完：還沒收尾的也算打完了，照時間排好交出去 */
  finish(): Battle[] {
    for (const b of this.sieges.values()) this.close(b, 'held')
    for (const b of this.fields) this.close(b, 'field')
    this.sieges.clear()
    this.fields = []
    return this.done.sort((a, b) => a.tick - b.tick)
  }

  private open(siege: boolean, region: number, attacker: PlayerId, defender: PlayerId, tick: number): Open {
    return {
      siege, region, attacker, defender, x: 0, y: 0, from: -1, to: -1, start: tick, last: tick,
      lost: new Array<number>(this.players + 1).fill(0), closed: false,
    }
  }

  private siege(region: number, attacker: PlayerId, tick: number): Open {
    const key = region * 16 + attacker
    let b = this.sieges.get(key)
    if (!b) this.sieges.set(key, (b = this.open(true, region, attacker, this.owners[region], tick)))
    return b
  }

  private field(x: number, y: number, p: Seen, tick: number): Open {
    for (const b of this.fields) if ((b.x - x) ** 2 + (b.y - y) ** 2 <= FIELD_REACH ** 2) return b
    const b = this.open(false, -1, 0, 0, tick)
    b.x = x
    b.y = y
    b.from = p.from
    b.to = p.target
    this.fields.push(b)
    return b
  }

  private close(b: Open, kind: Battle['kind']): void {
    b.closed = true
    let region = b.region, other = -1
    if (!b.siege) {
      const far = (i: number) => Math.hypot(this.map.regions[i].x * 10 - b.x, this.map.regions[i].y * 10 - b.y)
      const [near, away] = far(b.from) <= far(b.to) ? [b.from, b.to] : [b.to, b.from]
      region = near
      // 離兩頭差不多遠，才說是「兩地之間」
      if (far(away) < far(near) * 2) other = away
    }
    this.done.push({ start: b.start, tick: b.last, kind, region, other, attacker: b.attacker, defender: b.defender, lost: b.lost })
  }
}
