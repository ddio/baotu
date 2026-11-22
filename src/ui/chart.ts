// 結束畫面的兵力走勢圖：每一方一條線，線尾用該方的形狀標記。
import { SAMPLE_TICKS } from '../sim/match'
import { TICKS_PER_SECOND } from '../sim/rules'
import { clock, h, s } from './dom'
import { PAPER, shapePath, sideIcon, sideName, SIDES } from './theme'

export function forceChart(history: number[][], players: number): HTMLElement {
  const W = 340, H = 168, L = 32, RIGHT = 14, T = 10, B = 20
  const n = history.length
  const stepSec = SAMPLE_TICKS / TICKS_PER_SECOND
  let peak = 1
  for (const row of history) for (let p = 1; p <= players; p++) peak = Math.max(peak, row[p])
  const unit = peak > 400 ? 200 : peak > 160 ? 100 : 50
  const top = Math.ceil(peak / unit) * unit
  const x = (i: number) => L + ((W - L - RIGHT) * i) / Math.max(1, n - 1)
  const y = (v: number) => T + (H - T - B) * (1 - v / top)

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '各方兵力隨時間的變化' })
  for (const v of [0, top / 2, top]) {
    svg.append(s('line', { x1: L, x2: W - RIGHT, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: L - 5, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, String(v)))
  }
  svg.append(s('text', { x: L, y: H - 5, class: 'axis' }, '0:00'),
    s('text', { x: W - RIGHT, y: H - 5, 'text-anchor': 'end', class: 'axis' }, clock((n - 1) * stepSec)))

  const stride = Math.max(1, Math.ceil(n / 300))
  for (let p = players; p >= 1; p--) {
    // 畫到出局為止
    let end = n - 1
    for (let i = 1; i < n; i++) if (history[i][p] === 0) { end = i; break }
    let d = ''
    for (let i = 0; i <= end; i += stride) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(history[i][p]).toFixed(1)}`
    if (end % stride !== 0) d += `L${x(end).toFixed(1)},${y(history[end][p]).toFixed(1)}`
    const line = s('path', { d, class: 'line' })
    line.style.stroke = SIDES[p].color
    const dot = s('path', { d: shapePath(p, 4.5), transform: `translate(${x(end).toFixed(1)},${y(history[end][p]).toFixed(1)})`, 'stroke-width': 2 })
    dot.style.fill = SIDES[p].color
    dot.style.stroke = PAPER
    svg.append(line, dot)
  }

  const cross = s('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' })
  svg.append(cross)
  const legend = h('div', { class: 'legend' })
  for (let p = 1; p <= players; p++) legend.append(h('span', {}, sideIcon(p), sideName(p)))
  const idle = '在圖上移動可以看每個時間點的兵力'
  const tip = h('div', { class: 'tip', 'aria-live': 'off' }, idle)

  const show = (e: PointerEvent) => {
    const box = svg.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - RIGHT)) * (n - 1))))
    cross.setAttribute('x1', String(x(i)))
    cross.setAttribute('x2', String(x(i)))
    cross.setAttribute('visibility', 'visible')
    tip.replaceChildren(h('b', {}, clock(i * stepSec)), '　')
    for (let p = 1; p <= players; p++) tip.append(`${sideName(p)} `, h('b', {}, String(history[i][p])), '　')
  }
  svg.addEventListener('pointermove', show)
  svg.addEventListener('pointerdown', show)
  svg.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden')
    tip.textContent = idle
  })
  return h('div', { class: 'chart' }, legend, svg, tip)
}
