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

export const TRAITS: Record<Trait, { mark: string; name: string; text: string } | null> = {
  none: null,
  city: { mark: '城', name: '大城', text: '產兵比較快，能屯的兵也多' },
  fort: { mark: '砲', name: '砲台', text: '來攻的兵只算三分之二' },
  granary: { mark: '糧', name: '糧倉', text: '第一次拿下時多得 15 兵' },
  post: { mark: '驛', name: '驛站', text: '從這裡出發的兵走得快' },
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
