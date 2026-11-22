// 顏色、形狀與用語。顏色用 dataviz 的檢查工具驗過（含色覺辨認），
// 而且每一方另有自己的形狀，不單靠顏色分辨。
import type { Difficulty } from '../sim/ai'
import type { Trait } from '../sim/types'
import { s } from './dom'

export const PAPER = '#ece5cf'
export const INK = '#22282b'

export interface Side { name: string; color: string; ink: string; tint: string }

const mix = (a: string, b: string, t: number): string => {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) * t + p(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')
}
const side = (name: string, color: string, ink: string): Side => ({ name, color, ink, tint: mix(color, PAPER, 0.4) })

/** 索引 0 是中立，1 是玩家 */
export const SIDES: Side[] = [
  { name: '中立', color: '#f3eedd', ink: INK, tint: '#e3dbc1' },
  side('藍', '#1f5fa8', '#ffffff'),
  side('朱', '#c8402a', '#ffffff'),
  side('綠', '#1f8a70', '#ffffff'),
  side('黃', '#b98500', '#1d2226'),
]

/** 各方據點的形狀（以原點為中心、半徑約 r） */
export function shapePath(owner: number, r: number): string {
  const f = (v: number) => Math.round(v * 10) / 10
  switch (owner) {
    case 0: { const q = f(r * 0.82); return `M${-q},0a${q},${q} 0 1,0 ${2 * q},0a${q},${q} 0 1,0 ${-2 * q},0Z` }
    case 1: return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`
    case 2: { const q = f(r * 0.9); return `M${-q},${-q}H${q}V${q}H${-q}Z` }
    case 3: { const q = f(r * 1.2); return `M0,${-q}L${q},0L0,${q}L${-q},0Z` }
    default: { const q = f(r * 1.3); return `M0,${f(-q * 0.95)}L${f(q * 0.98)},${f(q * 0.72)}H${f(-q * 0.98)}Z` }
  }
}
/** 數字在形狀裡要往下挪多少（三角形的重心比較低） */
export const textShift = (owner: number, r: number) => (owner >= 4 ? r * 0.18 : 0)

export type Special = Exclude<Trait, 'none'>
export const SPECIALS: Special[] = ['city', 'fort', 'granary', 'post']

/** name 是名稱，text 是完整說明，short 是地圖圖例上的一句話 */
export const TRAITS: Record<Trait, { name: string; text: string; short: string } | null> = {
  none: null,
  city: { name: '大城', text: '產兵比較快，能屯的兵也多', short: '產兵快' },
  fort: { name: '砲台', text: '虛線圈是射程，圈內的敵軍每秒被打掉約 3 兵；沒人佔的時候誰都打。能屯的兵也最多', short: '砲轟路過敵軍' },
  granary: { name: '糧倉', text: '每次換人佔領，都多得 15 兵', short: '拿下就加兵' },
  post: { name: '驛站', text: '從這裡出發的兵走得快', short: '出兵走得快' },
}

/** 圖記的半徑（地圖單位） */
export const BADGE = 12.5

/**
 * 特色的圖記：墨色圓底配紙色圖樣，以原點為中心。
 * 不用字，遠看也認得；不用各方的顏色，才不會被當成是誰的。
 * 城是城牆與城門，砲是一門砲，糧是稻穗，驛是驛旗。
 */
export function traitBadge(trait: Special): SVGGElement {
  const g = s('g', { class: 'badge' }, s('circle', { r: BADGE, class: 'badge-disc' }))
  const line = (d: string, width: number) => s('path', { d, class: 'badge-line', 'stroke-width': width })
  switch (trait) {
    case 'city':
      g.append(s('path', { class: 'badge-fill', d: 'M-7.5,6.5V-6.5H-4.5V-3H-1.5V-6.5H1.5V-3H4.5V-6.5H7.5V6.5H2.2V2.6a2.2,2.2 0 0 0 -4.4,0V6.5Z' }))
      break
    case 'fort':
      g.append(line('M-6,1.2L6.8,-5.2', 4.4),
        s('circle', { cx: -2.4, cy: 3.6, r: 4, class: 'badge-wheel' }),
        s('circle', { cx: -2.4, cy: 3.6, r: 1.1, class: 'badge-hub' }))
      break
    case 'granary':
      g.append(line('M0,8V-7.5', 1.6), line('M0,5L-4.6,0.6M0,5L4.6,0.6M0,0.8L-4.6,-3.6M0,0.8L4.6,-3.6M0,-3.4L-3.8,-7M0,-3.4L3.8,-7', 2.6))
      break
    case 'post':
      g.append(line('M-4.6,8V-7.6', 2), s('path', { class: 'badge-fill', d: 'M-4.6,-7.8L7.6,-3.4L-4.6,1Z' }))
      break
  }
  return g
}

/** 放在文字旁邊用的圖記 */
export function traitIcon(trait: Special): SVGSVGElement {
  return s('svg', { viewBox: '-14 -14 28 28', class: 'trait-icon', 'aria-hidden': 'true' }, traitBadge(trait))
}

export const DIFFICULTY: Record<Difficulty, string> = { easy: '易', normal: '中', hard: '難' }

/** 在文字裡怎麼稱呼某一方 */
export const sideName = (p: number) => (p === 1 ? '你' : SIDES[p].name + '軍')

/** 某一方的小圖示（顏色加形狀） */
export function sideIcon(p: number, fill = SIDES[p].color, stroke = 'var(--ink)'): SVGSVGElement {
  const path = s('path', { d: shapePath(p, 9), 'stroke-width': 1.5 })
  path.style.fill = fill
  path.style.stroke = stroke
  return s('svg', { viewBox: '-13 -13 26 26', 'aria-hidden': 'true' }, path)
}
