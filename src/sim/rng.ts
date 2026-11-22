/** 可重現的亂數（mulberry32）。模擬與 AI 一律用它，不用 Math.random。 */
export class Rng {
  private s: number
  constructor(seed: number) { this.s = seed >>> 0 }
  /** 0 ≤ x < 2^32 的整數 */
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  /** 0 ≤ x < n 的整數 */
  int(n: number): number { return this.nextU32() % n }
}
