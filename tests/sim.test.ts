import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { canSend, capOf, createGame, hashState, issue, sendAmount, shellLoss, step, totals } from '../src/sim/game'
import { buildGraph, pathTo, reach, route, stopIndex } from '../src/sim/graph'
import { RULES } from '../src/sim/rules'
import { pickStarts } from '../src/sim/setup'

const map = MAPS.taiwan1901
const g = buildGraph(map)
const id = (name: string) => map.regions.findIndex((r) => r.name === name)
const run = (s: ReturnType<typeof createGame>, ticks: number) => { for (let i = 0; i < ticks; i++) step(s, map, g) }
const link = (a: string, b: string) => g.links[id(a)].find((l) => l.to === id(b))!

describe('開局', () => {
  it('起點有起始兵力，其餘是中立守軍', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    expect(s.regions[id('苗栗')]).toMatchObject({ owner: 1, units: RULES.startUnits })
    expect(s.regions[id('阿猴')]).toMatchObject({ owner: 2, units: RULES.startUnits })
    expect(s.regions[id('臺北')]).toMatchObject({ owner: 0, units: RULES.neutral.city })
    expect(s.regions[id('宜蘭')]).toMatchObject({ owner: 0, units: RULES.neutral.none })
  })
})

describe('生產', () => {
  it('一般的區每秒 1 兵，大城比較快；中立不長', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('臺南')] })
    run(s, 100)
    expect(s.regions[id('苗栗')].units).toBe(RULES.startUnits + 10)
    expect(s.regions[id('臺南')].units).toBe(RULES.startUnits + 16)
    expect(s.regions[id('宜蘭')].units).toBe(RULES.neutral.none)
  })

  it('長到上限就停；援軍可以超過上限', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    run(s, 1000)
    expect(s.regions[id('苗栗')].units).toBe(capOf(map, id('苗栗')))
    s.regions[id('新竹')].owner = 1
    s.regions[id('新竹')].units = 30
    expect(issue(s, map, g, id('新竹'), id('苗栗'))).toBe(true)
    run(s, 100)
    expect(s.regions[id('苗栗')].units).toBe(capOf(map, id('苗栗')) + 30)
  })

  it('砲台屯得最多，大城其次', () => {
    const s = createGame(map, { players: 3, starts: [id('基隆'), id('臺南'), id('苗栗')] })
    run(s, 1000)
    expect(s.regions[id('基隆')].units).toBe(RULES.cap.fort)
    expect(s.regions[id('臺南')].units).toBe(RULES.cap.city)
    expect(s.regions[id('苗栗')].units).toBe(RULES.cap.normal)
    expect(RULES.cap.fort).toBeGreaterThan(RULES.cap.city)
    expect(RULES.cap.city).toBeGreaterThan(RULES.cap.normal)
  })
})

describe('派兵', () => {
  it('整區的兵都派出去，之後進入冷卻', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    expect(sendAmount(21)).toBe(21)
    expect(issue(s, map, g, id('苗栗'), id('新竹'))).toBe(true)
    expect(s.regions[id('苗栗')].units).toBe(0)
    expect(s.armies).toHaveLength(1)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: RULES.startUnits })
    expect(canSend(s, id('苗栗'))).toBe(false)
    expect(issue(s, map, g, id('苗栗'), id('新竹'))).toBe(false)
    run(s, RULES.cooldownTicks)
    expect(canSend(s, id('苗栗'))).toBe(true)
  })

  it('不能從中立或沒有兵的區派兵，也不能派給自己', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    expect(issue(s, map, g, id('新竹'), id('苗栗'))).toBe(false)
    expect(issue(s, map, g, id('苗栗'), id('苗栗'))).toBe(false)
    s.regions[id('苗栗')].units = 0
    expect(issue(s, map, g, id('苗栗'), id('新竹'))).toBe(false)
  })

  it('經過自己的區到得了的地方，就走自己的區', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('新竹')].owner = 1
    const r = reach(g, s, id('苗栗'), 1, false)
    expect(pathTo(r, id('桃仔園'))).toEqual([id('苗栗'), id('新竹'), id('桃仔園')])
    expect(pathTo(r, id('臺北'))).toBeNull()
    const path = route(g, s, id('苗栗'), 1, false, id('桃仔園'))!
    expect(path).toEqual([id('苗栗'), id('新竹'), id('桃仔園')])
    expect(stopIndex(s, path, 1)).toBe(2)
  })

  it('再遠也派得出去：軍隊自己找路，在路上第一個不是自己的區開打，打贏也留在那裡', () => {
    const s = createGame(map, { players: 2, starts: [id('澎湖'), id('宜蘭')] })
    const path = route(g, s, id('澎湖'), 1, false, id('嘉義'))!
    expect(path).toEqual([id('澎湖'), id('鹽水港'), id('嘉義')])
    expect(stopIndex(s, path, 1)).toBe(1)
    s.regions[id('澎湖')].units = 60
    expect(issue(s, map, g, id('澎湖'), id('嘉義'))).toBe(true)
    run(s, link('澎湖', '鹽水港').ticks)
    expect(s.armies).toHaveLength(0)
    expect(s.regions[id('鹽水港')].owner).toBe(1)
    expect(s.regions[id('嘉義')].owner).toBe(0)
  })

  it('路上那一區在軍隊到之前變成自己的，就繼續往前走', () => {
    const s = createGame(map, { players: 2, starts: [id('澎湖'), id('宜蘭')] })
    s.regions[id('澎湖')].units = 60
    issue(s, map, g, id('澎湖'), id('嘉義'))
    s.regions[id('鹽水港')].owner = 1
    run(s, link('澎湖', '鹽水港').ticks)
    expect(s.armies).toHaveLength(1)
    run(s, link('鹽水港', '嘉義').ticks)
    expect(s.regions[id('嘉義')].owner).toBe(1)
  })
})

describe('行軍與交戰', () => {
  it('山路要三倍時間；驛站出發比較快', () => {
    const plain = link('新竹', '苗栗'), ridge = link('新竹', '宜蘭')
    expect(ridge.kind).toBe('mountain')
    // 新竹—宜蘭的直線距離約是新竹—苗栗的兩倍，再乘三倍
    expect(ridge.ticks).toBeGreaterThan(plain.ticks * 5)
    const s = createGame(map, { players: 2, starts: [id('新竹'), id('阿猴')] })
    issue(s, map, g, id('新竹'), id('苗栗'))
    expect(s.armies[0].fast).toBe(true)
    expect(s.armies[0].legTicks).toBe(Math.ceil((plain.ticks * RULES.postNum) / RULES.postDen))
  })

  it('兵力夠就佔領，剩下的兵留下來', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('苗栗')].units = 30
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, link('苗栗', '新竹').ticks)
    expect(s.armies).toHaveLength(0)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: 30 - RULES.neutral.post })
  })

  it('兵力不夠（或剛好打平）就只是削弱守軍', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('苗栗')].units = RULES.neutral.post
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, link('苗栗', '新竹').ticks)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 0, units: 0 })
  })

  it('砲台：射程內的敵軍一路被打，中立的砲台誰都打', () => {
    const s = createGame(map, { players: 2, starts: [id('臺北'), id('阿猴')] })
    s.regions[id('臺北')].units = 40
    const path = [id('臺北'), id('基隆')]
    const expected = shellLoss(s, g, path, 1, false, 1, 40)
    expect(expected).toBeGreaterThan(4)
    issue(s, map, g, id('臺北'), id('基隆'))
    let shots = 0
    for (let i = 0; i < link('臺北', '基隆').ticks; i++) { step(s, map, g); shots += s.shots.length }
    expect(shots).toBe(expected)
    // 打下來的兵 = 派出去的 − 路上被打掉的 − 守軍
    expect(s.regions[id('基隆')]).toMatchObject({ owner: 1, units: 40 - expected - RULES.neutral.fort })
  })

  it('砲台：不打自己人，路過的敵軍照打；兵被打光就沒了', () => {
    // 臺北 → 深坑 這段路繞過基隆砲台的射程
    for (const [from, to, hit] of [['臺北', '深坑', false], ['深坑', '臺北', true]] as const) {
      const s = createGame(map, { players: 2, starts: [id('臺北'), id('深坑')] })
      s.regions[id('基隆')].owner = 1
      s.regions[id(from)].units = 30
      expect(shellLoss(s, g, [id(from), id(to)], 1, false, s.regions[id(from)].owner, 30) > 0).toBe(hit)
      issue(s, map, g, id(from), id(to))
      let shots = 0
      for (let i = 0; i < link(from, to).ticks - 1; i++) { step(s, map, g); shots += s.shots.length }
      expect(shots > 0).toBe(hit)
      expect(s.armies[0].units).toBe(30 - shots)
    }
    // 只有 2 個兵的小隊走不到
    const t = createGame(map, { players: 2, starts: [id('臺北'), id('阿猴')] })
    t.regions[id('臺北')].units = 2
    issue(t, map, g, id('臺北'), id('基隆'))
    run(t, link('臺北', '基隆').ticks)
    expect(t.armies).toHaveLength(0)
    expect(t.regions[id('基隆')]).toMatchObject({ owner: 0, units: RULES.neutral.fort })
  })

  it('糧倉：每次換人佔領都加兵', () => {
    const s = createGame(map, { players: 2, starts: [id('臺中'), id('斗六')] })
    const take = (from: string, units: number) => {
      s.regions[id(from)].units = units
      s.regions[id(from)].readyAt = 0
      issue(s, map, g, id(from), id('彰化'))
      const gained: number[] = []
      for (let i = 0; i < 60; i++) { step(s, map, g); for (const e of s.gains) if (e.region === id('彰化')) gained.push(e.units) }
      return gained
    }
    expect(take('臺中', 30)).toEqual([RULES.granaryBonus])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 1, units: 30 - RULES.neutral.granary + RULES.granaryBonus + 3 })
    // 被搶走、再搶回來，每次都加
    s.regions[id('彰化')].units = 5
    expect(take('斗六', 30)).toEqual([RULES.granaryBonus])
    expect(s.regions[id('彰化')].owner).toBe(2)
    s.regions[id('彰化')].units = 5
    expect(take('臺中', 30)).toEqual([RULES.granaryBonus])
    expect(s.regions[id('彰化')].owner).toBe(1)
    // 增援自己的糧倉、打不下來，都不加
    s.regions[id('彰化')].units = 30
    expect(take('臺中', 10)).toEqual([])
    expect(take('斗六', 10)).toEqual([])
    expect(s.regions[id('彰化')].owner).toBe(1)
  })

  it('中途的區被搶走，就在那裡開打', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('新竹')].owner = 1
    s.regions[id('新竹')].units = 5
    s.regions[id('苗栗')].units = 40
    issue(s, map, g, id('苗栗'), id('桃仔園'))
    s.regions[id('新竹')].owner = 2
    run(s, link('苗栗', '新竹').ticks)
    expect(s.armies).toHaveLength(0)
    // 守軍 5，行軍期間對手又長了幾個兵
    const grown = Math.floor((link('苗栗', '新竹').ticks * RULES.prodPerTick.normal) / 1000)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: 40 - 5 - grown })
    expect(s.regions[id('桃仔園')].owner).toBe(0)
  })
})

describe('路上相遇', () => {
  const start = () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('臺中')] })
    return { s, ticks: link('苗栗', '臺中').ticks }
  }

  it('迎面碰上的敵軍一兵換一兵，兵多的帶著剩下的繼續走', () => {
    const { s, ticks } = start()
    s.regions[id('苗栗')].units = 30
    s.regions[id('臺中')].units = 18
    issue(s, map, g, id('苗栗'), id('臺中'))
    issue(s, map, g, id('臺中'), id('苗栗'))
    // 兩邊一樣快，走到一半碰頭
    run(s, Math.ceil(ticks / 2) - 1)
    expect(s.armies.map((a) => a.units)).toEqual([30, 18])
    run(s, 1)
    expect(s.armies).toHaveLength(1)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 12 })
    expect(s.clashes).toHaveLength(1)
    expect(s.clashes[0]).toMatchObject({ from: id('苗栗'), to: id('臺中'), units: 18 })
    run(s, 1)
    expect(s.clashes).toHaveLength(0)
    run(s, ticks)
    // 臺中的兵都派出去了，只剩路上這段時間長出來的
    expect(s.regions[id('臺中')].owner).toBe(1)
    expect(s.regions[id('苗栗')].owner).toBe(1)
  })

  it('兵力一樣就同歸於盡', () => {
    const { s, ticks } = start()
    issue(s, map, g, id('苗栗'), id('臺中'))
    issue(s, map, g, id('臺中'), id('苗栗'))
    run(s, ticks)
    expect(s.armies).toHaveLength(0)
    expect(s.regions[id('苗栗')].owner).toBe(1)
    expect(s.regions[id('臺中')].owner).toBe(2)
  })

  it('自己人擦身而過沒事；不同路上的也碰不到', () => {
    const { s, ticks } = start()
    s.regions[id('臺中')].owner = 1
    issue(s, map, g, id('苗栗'), id('臺中'))
    issue(s, map, g, id('臺中'), id('苗栗'))
    run(s, ticks - 1)
    expect(s.armies.map((a) => a.units)).toEqual([20, 20])

    const t = createGame(map, { players: 2, starts: [id('苗栗'), id('臺中')] })
    issue(t, map, g, id('苗栗'), id('新竹'))
    issue(t, map, g, id('臺中'), id('彰化'))
    run(t, 5)
    expect(t.armies.map((a) => a.units)).toEqual([20, 20])
    expect(t.clashes).toHaveLength(0)
  })

  it('同方向：後面比較快的追上前面的敵軍，也會打起來', () => {
    const { s } = start()
    const path = [id('苗栗'), id('臺中')]
    s.armies.push(
      { id: 1, owner: 1, units: 9, path, leg: 0, t: 5, legTicks: 20, fast: false },
      { id: 2, owner: 2, units: 4, path, leg: 0, t: 0, legTicks: 10, fast: true })
    s.nextArmyId = 3
    run(s, 4)
    expect(s.armies).toHaveLength(2)
    run(s, 1)
    expect(s.armies).toHaveLength(1)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 5 })
  })

  it('剛出門就撞上快到的敵軍：在門口先抵銷，剩下的才攻城', () => {
    const { s, ticks } = start()
    s.regions[id('苗栗')].units = 30
    issue(s, map, g, id('苗栗'), id('臺中'))
    run(s, ticks - 1)
    const home = s.regions[id('臺中')].units
    issue(s, map, g, id('臺中'), id('苗栗'))
    run(s, 1)
    expect(s.armies).toHaveLength(0)
    expect(s.clashes).toHaveLength(1)
    // 30 個兵先被出門的守軍抵銷掉一部分，剩下的打進空城
    expect(s.regions[id('臺中')]).toMatchObject({ owner: 1, units: 30 - home })
  })
})

describe('勝負', () => {
  it('對手沒有領地也沒有兵在路上，就分出勝負', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('新竹')] })
    s.regions[id('苗栗')].units = 100
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, 60)
    expect(s.alive[2]).toBe(false)
    expect(s.winner).toBe(1)
    const tick = s.tick
    run(s, 10)
    expect(s.tick).toBe(tick)
  })

  it('還有兵在路上的不算出局', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('新竹')] })
    s.regions[id('新竹')].units = 30
    issue(s, map, g, id('新竹'), id('桃仔園'))
    s.regions[id('新竹')].owner = 1
    run(s, 1)
    expect(s.alive[2]).toBe(true)
    expect(s.winner).toBe(0)
  })
})

describe('可重現', () => {
  it('同樣的指令得到同樣的結果', () => {
    const play = () => {
      const s = createGame(map, { players: 3, starts: [id('苗栗'), id('阿猴'), id('宜蘭')] })
      for (let t = 0; t < 600; t++) {
        if (t % 50 === 0) {
          issue(s, map, g, id('苗栗'), id('新竹'))
          issue(s, map, g, id('阿猴'), id('鳳山'))
          issue(s, map, g, id('宜蘭'), id('深坑'))
        }
        step(s, map, g)
      }
      return s
    }
    const a = play(), b = play()
    expect(hashState(a)).toBe(hashState(b))
    expect(totals(a)).toEqual(totals(b))
  })
})

describe('替對手挑起點', () => {
  it('不重複、不放澎湖、不貼著玩家（隔著山不算），同樣的種子結果一樣', () => {
    for (const human of [id('臺北'), id('臺中'), id('恆春'), id('澎湖')]) {
      const starts = pickStarts(map, human, 4, 12345)
      expect(starts[0]).toBe(human)
      expect(new Set(starts).size).toBe(4)
      expect(starts.slice(1)).not.toContain(id('澎湖'))
      for (const s of starts.slice(1)) expect(g.links[human].some((l) => l.to === s && l.kind === 'land')).toBe(false)
      expect(pickStarts(map, human, 4, 12345)).toEqual(starts)
    }
  })
})
