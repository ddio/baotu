type Kid = Node | string | null | false | undefined
type Props = Record<string, unknown>

function apply(el: Element, props: Props, kids: Kid[]): void {
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids) if (kid !== null && kid !== false && kid !== undefined) el.append(kid)
}

/** 建 HTML 元素：h('button', { class: 'x', onclick: fn }, '文字') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  apply(el, props, kids)
  return el
}

/** 建 SVG 元素 */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props: Props = {}, ...kids: Kid[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  apply(el, props, kids)
  return el
}

/** 3:05 這種時間 */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
