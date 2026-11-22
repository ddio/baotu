import { afterEach, describe, expect, it, vi } from 'vitest'
import { RULES_VERSION } from '../src/sim/rules'
import { trackEnd, trackPlay, trackReplay, trackShare } from '../src/ui/track'

describe('使用統計', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GoatCounter 沒載到（或根本沒有 window）就什麼都不做', () => {
    expect(() => trackPlay({ difficulty: 'normal', players: 4 })).not.toThrow()
    vi.stubGlobal('window', {})
    expect(() => trackReplay(RULES_VERSION)).not.toThrow()
    vi.stubGlobal('window', { goatcounter: { count: () => { throw new Error('壞了') } } })
    expect(() => trackEnd({ difficulty: 'hard', players: 3 }, 'lose')).not.toThrow()
  })

  it('分類都放在 path 裡：難度、對手數（不含自己）、規則版本、結果', () => {
    const count = vi.fn()
    vi.stubGlobal('window', { goatcounter: { count } })
    trackPlay({ difficulty: 'normal', players: 4 })
    trackEnd({ difficulty: 'hard', players: 3 }, 'win')
    trackEnd({ difficulty: 'easy', players: 4 }, 'quit')
    trackReplay(RULES_VERSION)
    trackReplay(6)
    trackShare('send')
    trackShare('play')
    expect(count.mock.calls.map(([v]) => v.path)).toEqual([
      `play/normal/3/v${RULES_VERSION}`,
      `end/win/hard/2/v${RULES_VERSION}`,
      `end/quit/easy/3/v${RULES_VERSION}`,
      `replay/v${RULES_VERSION}`,
      'replay/v6',
      'share/send',
      'share/play',
    ])
    for (const [v] of count.mock.calls) {
      expect(v.event).toBe(true)
      expect(v.title).toBeTruthy()
    }
  })
})
