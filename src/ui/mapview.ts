// 地圖畫面：一張 SVG。只負責把狀態畫出來、回答「這個位置是哪一區」，不管規則。
import { RULES } from '../sim/rules'
import type { Clash, GameState, MapData, PlayerId, Shot } from '../sim/types'
import { s } from './dom'
import { BADGE, shapePath, SIDES, SPECIALS, textShift, traitBadge, TRAITS } from './theme'

/** 據點的半徑（地圖單位） */
export const R = 21
const LABEL = 17
/** 點在據點附近多遠以內算點到它 */
const NEAR = 36

export interface Marks {
  /** 玩家是幾號；0 表示旁觀（重播） */
  me: PlayerId
  /** 選中的出發區，沒有是 -1 */
  selected: number
  /** 選中出發區之後，哪些區到得了 */
  targets: boolean[] | null
  /** 游標或手指指著的目標，沒有是 -1 */
  hover: number
  /** 開局畫面挑中的起點，沒有是 -1 */
  picked: number
  /** 這次派兵會先在哪一區停下來開打（不是目標本身的時候才標），沒有是 -1 */
  stop: number
}

interface NodeEls {
  g: SVGGElement
  shape: SVGPathElement
  /** 墊在據點底下的紙色底：冷卻時據點變淡，也不會透出底下經過的兵 */
  back: SVGPathElement
  units: SVGTextElement
  ring: SVGCircleElement
  halo: SVGCircleElement
  owner: number
  shown: number
  ringOn: boolean
  cls: string
}
/** 路上的軍隊：小點的半徑、同一排的間距、前後排的間距 */
const DOT = 4.2
const DOT_GAP = 10
const ROW_GAP = 10
/** 幾個兵畫幾個點：大約三個兵一個點，最多 24 個 */
export const dotsFor = (units: number) => Math.max(1, Math.min(24, Math.ceil(units / 3)))

interface RowEls { g: SVGGElement; dots: SVGPathElement[]; key: number; shown: boolean }
interface ArmyEls {
  g: SVGGElement
  text: SVGTextElement
  rows: RowEls[]
  owner: number
  units: number
  dots: number
  /** 正在走的那一段路（from → to）與上一段的起點（沒有是 -1），長度是地圖單位 */
  from: number
  to: number
  prev: number
  len: number
  prevLen: number
  /** 最後一次畫的時候：最前面一排離 from 多遠 */
  s: number
  /** 從第幾拍開始排隊進城（規則裡停在城外，畫面上隊伍接著往據點裡走）；不是在進城是 -1 */
  enter: number
}

export class MapView {
  readonly svg: SVGSVGElement
  private readonly land: SVGPathElement[] = []
  private readonly landCls: string[] = []
  private readonly nodes: NodeEls[] = []
  /** 砲台的射程圈，照區的編號放 */
  private readonly ranges = new Map<number, SVGCircleElement>()
  private readonly armyLayer: SVGGElement
  /** 蓋在據點上面的短暫效果 */
  private readonly fxLayer: SVGGElement
  private readonly armies = new Map<number, ArmyEls>()
  private sparkTick = -1
  private readonly aim: SVGPolylineElement
  private readonly aimRest: SVGPolylineElement

  constructor(readonly map: MapData) {
    const { width: W, height: H } = map
    this.svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map', role: 'img', 'aria-label': map.name })

    // 海：橫向的水紋線
    const defs = s('defs', {},
      s('pattern', { id: 'sea', width: 7, height: 7, patternUnits: 'userSpaceOnUse' },
        s('line', { x1: 0, y1: 3.5, x2: 7, y2: 3.5, class: 'sea-line' })))
    // 海比圖幅大得多：畫面比地圖寬或高的時候，多出來的地方也是海
    const far = { x: -3 * W, y: -3 * H, width: 7 * W, height: 7 * H }
    this.svg.append(defs, s('rect', { ...far, class: 'sea-base' }), s('rect', { ...far, fill: 'url(#sea)' }))

    // 海岸：在陸地底下疊兩圈淡淡的岸線
    const all = map.regions.map((r) => r.d).join('')
    this.svg.append(s('path', { d: all, class: 'shore shore-2' }), s('path', { d: all, class: 'shore shore-1' }))

    const landLayer = s('g', {})
    for (const r of map.regions) {
      const p = s('path', { d: r.d, class: 'land' })
      this.land.push(p)
      this.landCls.push('')
      landLayer.append(p)
    }
    this.svg.append(landLayer)

    // 山脈：粗線配上短虛線，看起來像舊地圖上的暈滃線
    const ridges = s('g', {})
    for (const b of map.borders) if (b.kind === 'mountain') ridges.append(s('path', { d: b.d, class: 'ridge' }), s('path', { d: b.d, class: 'ridge-spine' }))
    this.svg.append(ridges)

    const lanes = s('g', {})
    for (const e of map.edges) if (e.kind === 'sea') {
      const a = map.regions[e.a], b = map.regions[e.b]
      lanes.append(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'lane' }))
    }
    this.svg.append(lanes)

    // 砲台的射程：一圈虛線，圈內的敵軍會挨砲
    const ranges = s('g', {})
    map.regions.forEach((r, i) => {
      if (r.trait !== 'fort') return
      const ring = s('circle', { cx: r.x, cy: r.y, r: RULES.fort.range, class: 'range' })
      this.ranges.set(i, ring)
      ranges.append(ring)
    })
    this.svg.append(ranges)

    // 圖名
    const title = s('g', { class: 'cartouche' })
    ;[...'臺灣堡圖'].forEach((ch, i) => title.append(s('text', { x: 62, y: 96 + i * 54, class: 'title' }, ch)))
    ;[...'明治三十四年二十廳'].forEach((ch, i) => title.append(s('text', { x: 108, y: 70 + i * 21, class: 'subtitle' }, ch)))
    this.svg.append(title, this.legend(H))

    this.aim = s('polyline', { class: 'aim', visibility: 'hidden' })
    this.aimRest = s('polyline', { class: 'aim-rest', visibility: 'hidden' })
    this.armyLayer = s('g', {})
    const nodeLayer = s('g', {})
    for (const r of map.regions) {
      const g = s('g', { transform: `translate(${r.x},${r.y})`, class: 'node' })
      const halo = s('circle', { r: R + 9, class: 'halo' })
      const ring = s('circle', { r: R + 4.5, class: 'cooldown', pathLength: 100, transform: 'rotate(-90)', visibility: 'hidden' })
      const shape = s('path', { class: 'stamp' })
      const back = s('path', { class: 'stamp-back' })
      const units = s('text', { class: 'units' })
      g.append(halo, ring, back, shape, units, this.label(r.name, r.y + R + LABEL + 12 > H - 12))
      // 有特色的區：圖記掛在據點的右上角
      if (r.trait !== 'none') {
        const badge = traitBadge(r.trait)
        badge.setAttribute('transform', `translate(${R * 0.86},${-R * 0.86})`)
        g.append(badge)
      }
      this.nodes.push({ g, shape, back, units, ring, halo, owner: -1, shown: -1, ringOn: false, cls: '' })
      nodeLayer.append(g)
    }
    this.fxLayer = s('g', { class: 'fx' })
    this.svg.append(this.aimRest, this.aim, this.armyLayer, nodeLayer, this.fxLayer)
  }

  /** 據點下面的地名。貼著圖框下緣的區，地名改放右邊。 */
  private label(name: string, side: boolean): SVGGElement {
    const nameW = name.length * LABEL
    const g = s('g', { class: 'label', transform: `translate(0,${side ? 6 : R + LABEL + 3})` })
    g.append(s('text', { x: side ? R + 7 + nameW / 2 : 0, y: 0, class: 'name' }, name))
    return g
  }

  /** 圖例：左下角的海上，四種圖記各一行 */
  private legend(H: number): SVGGElement {
    const ROW = 26, W = 196, x = 34, y = H - 18 - ROW * SPECIALS.length - 8
    const g = s('g', { class: 'legend', transform: `translate(${x},${y})` },
      s('rect', { width: W, height: ROW * SPECIALS.length + 8, class: 'legend-box' }))
    SPECIALS.forEach((k, i) => {
      const cy = 4 + ROW * i + ROW / 2
      const badge = traitBadge(k)
      badge.setAttribute('transform', `translate(${8 + BADGE},${cy})`)
      g.append(badge,
        s('text', { x: 16 + BADGE * 2, y: cy + 5.5, class: 'legend-text' },
          s('tspan', { class: 'legend-name' }, TRAITS[k]!.name), s('tspan', { dx: 7 }, TRAITS[k]!.short)))
    })
    return g
  }

  /** 螢幕座標 → 地圖座標 */
  point(clientX: number, clientY: number): { x: number; y: number } {
    const m = this.svg.getScreenCTM()
    if (!m) return { x: -1, y: -1 }
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  /** 這個螢幕位置是哪一區：先看有沒有點在據點附近，再看落在哪一塊地上。沒有就回 -1。 */
  regionAt(clientX: number, clientY: number): number {
    const p = this.point(clientX, clientY)
    let best = -1, bestD = NEAR
    this.map.regions.forEach((r, i) => {
      const d = Math.hypot(r.x - p.x, r.y - p.y)
      if (d < bestD) { bestD = d; best = i }
    })
    if (best >= 0) return best
    const pt = new DOMPoint(p.x, p.y)
    for (let i = 0; i < this.land.length; i++) if (this.land[i].isPointInFill(pt)) return i
    return -1
  }

  /** 拖曳時還沒指到任何一區：從出發區拉一條線到手指的位置 */
  setAim(from: number, x: number, y: number): void {
    const r = this.map.regions[from]
    this.aim.setAttribute('points', `${r.x},${r.y} ${x.toFixed(1)},${y.toFixed(1)}`)
    this.aim.setAttribute('class', 'aim')
    this.aim.setAttribute('visibility', 'visible')
    this.aimRest.setAttribute('visibility', 'hidden')
  }
  /** 指到某一區：畫出軍隊會走的路。走得到的那一段（到第 stop 站）是實線，後面到目標的是淡淡的虛線。 */
  setRoute(path: number[], stop: number): void {
    const pts = (ids: number[]) => ids.map((i) => `${this.map.regions[i].x},${this.map.regions[i].y}`).join(' ')
    this.aim.setAttribute('points', pts(path.slice(0, stop + 1)))
    this.aim.setAttribute('class', 'aim ok')
    this.aim.setAttribute('visibility', 'visible')
    const rest = stop < path.length - 1
    if (rest) this.aimRest.setAttribute('points', pts(path.slice(stop)))
    this.aimRest.setAttribute('visibility', rest ? 'visible' : 'hidden')
  }
  clearAim(): void {
    this.aim.setAttribute('visibility', 'hidden')
    this.aimRest.setAttribute('visibility', 'hidden')
  }

  /** 把目前的狀態畫出來。alpha 是這一拍走了多少（0–1），讓行軍看起來連續。 */
  render(state: GameState, alpha: number, marks: Marks): void {
    const regs = this.map.regions
    for (let i = 0; i < regs.length; i++) {
      const r = state.regions[i], n = this.nodes[i]
      if (n.owner !== r.owner) {
        const first = n.owner < 0
        n.owner = r.owner
        n.shape.setAttribute('d', shapePath(r.owner, R))
        n.back.setAttribute('d', shapePath(r.owner, R))
        n.shape.style.fill = SIDES[r.owner].color
        n.units.style.fill = SIDES[r.owner].ink
        n.units.setAttribute('y', String(7.5 + textShift(r.owner, R)))
        n.ring.style.stroke = SIDES[r.owner].color
        this.land[i].style.fill = SIDES[r.owner].tint
        // 射程圈跟著砲台主人的顏色；中立的用墨色
        const range = this.ranges.get(i)
        if (range) range.style.stroke = r.owner ? SIDES[r.owner].color : ''
        if (!first) {
          // 易主時據點跳一下
          n.shape.classList.remove('taken')
          void n.shape.getBoundingClientRect()
          n.shape.classList.add('taken')
        }
      }
      if (n.shown !== r.units) { n.shown = r.units; n.units.textContent = String(r.units) }

      const cooling = marks.me !== 0 && r.owner === marks.me && state.tick < r.readyAt
      if (cooling) {
        const left = (r.readyAt - state.tick - alpha) / RULES.cooldownTicks
        n.ring.setAttribute('stroke-dasharray', `${Math.max(0, Math.min(1, left)) * 100} 100`)
      }
      if (cooling !== n.ringOn) { n.ringOn = cooling; n.ring.setAttribute('visibility', cooling ? 'visible' : 'hidden') }

      let cls = 'node'
      if (i === marks.selected) cls += ' selected'
      else if (i === marks.hover) cls += ' hover'
      else if (marks.targets?.[i]) cls += ' target'
      if (i === marks.picked) cls += ' picked'
      if (i === marks.stop) cls += ' stop'
      if (cooling) cls += ' cooling'
      if (cls !== n.cls) { n.cls = cls; n.g.setAttribute('class', cls) }

      const dim = marks.targets && !marks.targets[i] && i !== marks.selected ? 'land dim' : i === marks.picked ? 'land lit' : 'land'
      if (dim !== this.landCls[i]) { this.landCls[i] = dim; this.land[i].setAttribute('class', dim) }
    }

    this.renderArmies(state, state.tick + alpha, alpha)
    if (state.tick !== this.sparkTick) {
      this.sparkTick = state.tick
      for (const c of state.clashes) this.spark(c)
      for (const e of state.gains) this.gain(e.region, e.units, state.regions[e.region].owner)
      for (const e of state.shots) this.shot(e)
      // 圍城：城門口每隔幾拍閃一下
      if (state.tick % 3 === 0) for (const a of state.armies) if (a.siege && state.regions[a.path[a.leg + 1]].owner !== a.owner) {
        const from = regs[a.path[a.leg]], to = regs[a.path[a.leg + 1]]
        const len = Math.hypot(to.x - from.x, to.y - from.y), f = (len - R - 1) / len
        this.sparkAt(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, 8)
      }
    }
  }

  /** 砲台開砲：砲口閃一下，一顆砲彈沿著一道淡線飛到軍隊身上，落點冒一小團煙。 */
  private shot(e: Shot): void {
    const fort = this.map.regions[e.fort], tx = e.x / 10, ty = e.y / 10
    const far = Math.hypot(tx - fort.x, ty - fort.y)
    // 砲彈從據點邊上出發；軍隊已經貼到據點上的時候就原地炸
    const start = Math.min(R + 3, far)
    const ux = far ? (tx - fort.x) / far : 0, uy = far ? (ty - fort.y) / far : 0
    const sx = fort.x + ux * start, sy = fort.y + uy * start
    const shell = s('circle', { r: 5, class: 'shell' })
    shell.style.setProperty('--dx', `${(tx - sx).toFixed(1)}px`)
    shell.style.setProperty('--dy', `${(ty - sy).toFixed(1)}px`)
    const g = s('g', { class: 'shot' },
      s('line', { x1: sx.toFixed(1), y1: sy.toFixed(1), x2: tx.toFixed(1), y2: ty.toFixed(1), class: 'shell-trail' }),
      s('g', { transform: `translate(${sx.toFixed(1)},${sy.toFixed(1)})` }, s('circle', { r: 9, class: 'muzzle' }), shell),
      s('g', { transform: `translate(${tx.toFixed(1)},${ty.toFixed(1)})` }, s('circle', { r: 10, class: 'puff' })))
    this.fxLayer.append(g)
    setTimeout(() => g.remove(), 620)
  }

  /**
   * 糧倉換人、兵變多了：一圈小點從四周湧進據點，據點鼓一下，外面盪開兩圈，上面飄一個「+15」。
   */
  private gain(region: number, units: number, owner: number): void {
    const r = this.map.regions[region], n = this.nodes[region]
    const at = `translate(${r.x},${r.y})`
    // 湧進來的小點畫在據點底下，走到中間就被據點蓋住
    const crowd = s('g', { transform: at, class: 'gain' })
    const COUNT = 12
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + 0.26, far = R + 30 + (i % 3) * 7
      const dot = s('path', { d: shapePath(owner, DOT), class: 'army-dot gain-dot' })
      dot.style.fill = SIDES[owner].color
      dot.style.setProperty('--dx', `${(Math.cos(angle) * far).toFixed(1)}px`)
      dot.style.setProperty('--dy', `${(Math.sin(angle) * far).toFixed(1)}px`)
      dot.style.animationDelay = `${i * 30}ms`
      crowd.append(dot)
    }
    this.armyLayer.append(crowd)
    const over = s('g', { transform: at, class: 'gain' })
    // 兩圈跟著據點鼓起來的那一下盪開
    for (const delay of [330, 520]) {
      const ring = s('circle', { r: R + 3, class: 'gain-ring' })
      ring.style.stroke = SIDES[owner].color
      ring.style.animationDelay = `${delay}ms`
      over.append(ring)
    }
    over.append(s('text', { y: -R - 12, class: 'gain-text' }, `+${units}`))
    this.fxLayer.append(over)
    for (const el of [n.shape, n.units]) {
      el.classList.remove('taken', 'swell')
      void el.getBoundingClientRect()
      el.classList.add('swell')
    }
    setTimeout(() => { crowd.remove(); over.remove() }, 1400)
  }

  /**
   * 路上的軍隊：一排一排的小點，兵越多點越多。最前面那一排就是軍隊在規則裡的位置，
   * 後面幾排沿著走過的路跟著；還沒出城的、已經進城的那幾排不畫（藏在據點底下）。
   */
  private renderArmies(state: GameState, time: number, alpha: number): void {
    const regs = this.map.regions
    const dist = (a: number, b: number) => Math.hypot(regs[b].x - regs[a].x, regs[b].y - regs[a].y)
    const seen = new Set<number>()
    for (const a of state.armies) {
      seen.add(a.id)
      let el = this.armies.get(a.id)
      if (!el) {
        const g = s('g', { class: 'army' })
        const text = s('text', { class: 'army-units' })
        g.append(text)
        el = { g, text, rows: [], owner: a.owner, units: -1, dots: 0, from: 0, to: 0, prev: -1, len: 1, prevLen: 1, s: 0, enter: -1 }
        this.armies.set(a.id, el)
        this.armyLayer.append(g)
      }
      if (el.units !== a.units) {
        el.units = a.units
        el.text.textContent = String(a.units)
        const dots = dotsFor(a.units)
        if (dots !== el.dots) this.formUp(el, dots)
      }
      el.from = a.path[a.leg]
      el.to = a.path[a.leg + 1]
      el.prev = a.leg > 0 ? a.path[a.leg - 1] : -1
      el.len = dist(el.from, el.to)
      el.prevLen = el.prev >= 0 ? dist(el.prev, el.from) : 1
      el.s = Math.min(1, (a.t + (a.siege ? 0 : alpha)) / a.legTicks) * el.len
      // 進城：規則裡這支停在城外、每拍進去幾個；畫面上隊伍照原來的步伐接著走進據點（被據點蓋住），
      // 排數跟著還沒進去的兵變少
      if (!(a.siege && state.regions[el.to].owner === a.owner)) el.enter = -1
      else if (el.enter < 0 || time < el.enter) el.enter = time
      const head = el.enter < 0 ? el.s : Math.min(el.len, el.s + (time - el.enter) * Math.max(2.5, el.len / a.legTicks))
      this.place(el, head)
      // 兵數標在城外，不跟著進去
      const from = regs[el.from], to = regs[el.to], f = el.s / el.len
      el.text.setAttribute('transform', `translate(${(from.x + (to.x - from.x) * f).toFixed(1)},${(from.y + (to.y - from.y) * f - 13).toFixed(1)})`)
    }
    // 不在了的就收掉：進城進完了，或在路上、城外被打光了
    for (const [id, el] of this.armies) {
      if (seen.has(id)) continue
      el.g.remove()
      this.armies.delete(id)
    }
  }

  private formUp(el: ArmyEls, dots: number): void {
    for (const row of el.rows) row.g.remove()
    el.rows = []
    el.dots = dots
    const wide = dots <= 2 ? dots : dots <= 6 ? 2 : dots <= 12 ? 3 : 4
    for (let left = dots; left > 0; left -= wide) {
      const g = s('g', { visibility: 'hidden' })
      const marks: SVGPathElement[] = []
      for (let k = 0; k < Math.min(wide, left); k++) {
        const dot = s('path', { d: shapePath(el.owner, DOT), class: 'army-dot' })
        dot.style.fill = SIDES[el.owner].color
        marks.push(dot)
        g.append(dot)
      }
      el.rows.push({ g, dots: marks, key: -1, shown: false })
      el.g.insertBefore(g, el.text)
    }
  }

  /** 把一支軍隊的每一排放到路上：最前面一排在離這段路起點 head 的地方，後面每排往回退一格。 */
  private place(el: ArmyEls, head: number): void {
    const regs = this.map.regions
    for (let r = 0; r < el.rows.length; r++) {
      const row = el.rows[r]
      let d = head - r * ROW_GAP, from = el.from, to = el.to, len = el.len
      let show = d <= len
      if (d < 0) {
        // 這一排還在上一段路上；沒有上一段，就是還沒出城
        if (el.prev < 0) show = false
        else { from = el.prev; to = el.from; len = el.prevLen; d += len; if (d < 0) show = false }
      }
      if (show !== row.shown) { row.shown = show; row.g.setAttribute('visibility', show ? 'visible' : 'hidden') }
      if (!show) continue
      const a = regs[from], b = regs[to]
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
      const key = from * 1024 + to
      if (row.key !== key) {
        // 每排排成微微後掠的弧線，像一道浪。點本身不轉，形狀才認得出是哪一方
        row.key = key
        row.dots.forEach((dot, k) => {
          const side = k - (row.dots.length - 1) / 2
          const back = -1.6 * side * side, across = side * DOT_GAP
          dot.setAttribute('transform', `translate(${(ux * back - uy * across).toFixed(1)},${(uy * back + ux * across).toFixed(1)})`)
        })
      }
      row.g.setAttribute('transform', `translate(${(a.x + ux * d).toFixed(1)},${(a.y + uy * d).toFixed(1)})`)
    }
  }

  /** 兩軍打起來的地方（兩軍中間）閃一下 */
  private spark(c: Clash): void {
    this.sparkAt(c.x / 10, c.y / 10, 7 + Math.min(8, Math.sqrt(c.units) * 1.5))
  }

  private sparkAt(x: number, y: number, size: number): void {
    const burst = s('g', { class: 'spark' })
    for (let i = 0; i < 8; i++) {
      const x = Math.cos((i * Math.PI) / 4), y = Math.sin((i * Math.PI) / 4)
      burst.append(s('line', { x1: (x * size * 0.45).toFixed(1), y1: (y * size * 0.45).toFixed(1), x2: (x * size).toFixed(1), y2: (y * size).toFixed(1) }))
    }
    const g = s('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` }, burst)
    this.armyLayer.append(g)
    setTimeout(() => g.remove(), 450)
  }
}
