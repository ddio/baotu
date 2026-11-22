import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { attackStrength, canSend, capOf, createGame, hashState, issue, sendAmount, step, totals } from '../src/sim/game'
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
    expect(s.regions[id('苗栗')].units).toBe(capOf(map, id('苗栗')) + 15)
  })
})

describe('派兵', () => {
  it('派出一半，之後進入冷卻', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    expect(sendAmount(21)).toBe(10)
    expect(issue(s, map, g, id('苗栗'), id('新竹'))).toBe(true)
    expect(s.regions[id('苗栗')].units).toBe(10)
    expect(s.armies).toHaveLength(1)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 10 })
    expect(canSend(s, id('苗栗'))).toBe(false)
    expect(issue(s, map, g, id('苗栗'), id('新竹'))).toBe(false)
    run(s, RULES.cooldownTicks)
    expect(canSend(s, id('苗栗'))).toBe(true)
  })

  it('不能從中立或兵太少的區派兵，也不能派給自己', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    expect(issue(s, map, g, id('新竹'), id('苗栗'))).toBe(false)
    expect(issue(s, map, g, id('苗栗'), id('苗栗'))).toBe(false)
    s.regions[id('苗栗')].units = 1
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
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: 15 - RULES.neutral.post })
  })

  it('兵力不夠（或剛好打平）就只是削弱守軍', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('苗栗')].units = 20
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, link('苗栗', '新竹').ticks)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 0, units: 0 })
  })

  it('砲台：進攻的兵只算三分之二', () => {
    expect(attackStrength(map, id('基隆'), 30)).toBe(20)
    expect(attackStrength(map, id('臺北'), 30)).toBe(30)
  })

  it('糧倉：每一方第一次佔領時加兵，只給一次', () => {
    const s = createGame(map, { players: 2, starts: [id('臺中'), id('斗六')] })
    const take = (from: string, units: number) => {
      s.regions[id(from)].units = units
      s.regions[id(from)].readyAt = 0
      issue(s, map, g, id(from), id('彰化'))
      run(s, 60)
    }
    take('臺中', 40)
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 1, units: 20 - RULES.neutral.granary + RULES.granaryBonus + 3 })
    s.regions[id('彰化')].units = 5
    take('斗六', 40)
    expect(s.regions[id('彰化')].owner).toBe(2)
    const afterSecond = s.regions[id('彰化')].units
    s.regions[id('彰化')].units = 5
    take('臺中', 40)
    expect(s.regions[id('彰化')].owner).toBe(1)
    // 第二次拿回來就沒有加兵了
    expect(s.regions[id('彰化')].units).toBeLessThan(afterSecond)
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
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: 20 - 5 - grown })
    expect(s.regions[id('桃仔園')].owner).toBe(0)
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
