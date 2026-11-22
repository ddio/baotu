import { describe, expect, it } from 'vitest'
import { MAPS } from '../src/maps'
import { canSend, capOf, createGame, forecast, hashState, issue, sendAmount, shellLoss, step, totals } from '../src/sim/game'
import { buildGraph, gateTick, pathTo, posOf, reach, route, stopIndex } from '../src/sim/graph'
import { RULES } from '../src/sim/rules'
import { pickStarts } from '../src/sim/setup'
import type { MapData } from '../src/sim/types'

const map = MAPS.taiwan1901
const g = buildGraph(map)
const id = (name: string) => map.regions.findIndex((r) => r.name === name)
const run = (s: ReturnType<typeof createGame>, ticks: number) => { for (let i = 0; i < ticks; i++) step(s, map, g) }
/** 跑到路上沒有軍隊為止，回傳跑了幾拍 */
const settle = (s: ReturnType<typeof createGame>) => { let n = 0; while (s.armies.length && n < 5000) { step(s, map, g); n++ } return n }
const link = (a: string, b: string) => g.links[id(a)].find((l) => l.to === id(b))!
/** 從 a 走到 b 的城外要幾拍（要停在 b 的軍隊，第幾拍開始攻城或進城） */
const gate = (a: string, b: string) => gateTick(g, id(a), id(b), link(a, b).ticks)

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
    settle(s)
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
    settle(s)
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
    // 走到城外就停下來（不用走到據點中心），一拍換一個，不是一到就全部扣掉
    expect(gate('苗栗', '新竹')).toBeLessThan(link('苗栗', '新竹').ticks)
    run(s, gate('苗栗', '新竹') - 1)
    expect(s.armies[0]).toMatchObject({ siege: false, units: 30 })
    run(s, 1)
    expect(s.armies[0]).toMatchObject({ siege: true, units: 29 })
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 0, units: RULES.neutral.post - 1 })
    run(s, 3)
    expect(s.armies[0]).toMatchObject({ siege: true, units: 26 })
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 0, units: RULES.neutral.post - 4 })
    // 守軍打光的那一拍佔領，剩下的兵開始進城：也不是一次全進去，每拍進幾個，比圍城快
    run(s, RULES.neutral.post - 4)
    const left = 30 - RULES.neutral.post
    expect(s.takes).toEqual([{ region: id('新竹'), from: 0, to: 1 }])
    expect(s.armies[0]).toMatchObject({ siege: true, units: left - RULES.enterPerTick })
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: RULES.enterPerTick })
    run(s, 1)
    expect(s.takes).toEqual([])
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: 2 * RULES.enterPerTick })
    expect(settle(s)).toBe(Math.ceil(left / RULES.enterPerTick) - 2)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 1, units: left })
  })

  it('增援自己的區：停在城外排隊進城，每拍進幾個', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    // 屯滿的區不再長兵，數字才好算
    const full = capOf(map, id('新竹'))
    s.regions[id('新竹')].owner = 1
    s.regions[id('新竹')].units = full
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, gate('苗栗', '新竹') - 1)
    expect(s.armies[0]).toMatchObject({ siege: false, units: 20 })
    expect(s.regions[id('新竹')].units).toBe(full)
    run(s, 1)
    expect(s.armies[0]).toMatchObject({ siege: true, units: 20 - RULES.enterPerTick })
    expect(s.regions[id('新竹')].units).toBe(full + RULES.enterPerTick)
    expect(RULES.enterPerTick).toBeGreaterThan(RULES.siegePerTick)
    expect(settle(s)).toBe(Math.ceil(20 / RULES.enterPerTick) - 1)
    expect(s.regions[id('新竹')].units).toBe(full + 20)
  })

  it('圍城的時候守軍照樣長兵；別路的友軍先打下來，城外的就直接進城', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('新竹')] })
    s.regions[id('新竹')].units = 30
    s.regions[id('苗栗')].units = 25
    issue(s, map, g, id('苗栗'), id('新竹'))
    const ticks = settle(s)
    expect(ticks).toBe(gate('苗栗', '新竹') + 24)
    // 25 個兵打掉 25 個守軍，但守軍在行軍和圍城期間又長了幾個
    const grown = Math.floor((ticks * RULES.prodPerTick.normal) / 1000)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 2, units: 30 - 25 + grown })

    const t = createGame(map, { players: 2, starts: [id('苗栗'), id('臺北')] })
    t.regions[id('桃仔園')].owner = 1
    t.regions[id('苗栗')].units = 15
    t.regions[id('桃仔園')].units = 40
    issue(t, map, g, id('苗栗'), id('新竹'))
    run(t, gate('苗栗', '新竹') + 2)
    expect(t.armies[0]).toMatchObject({ siege: true, units: 12 })
    t.regions[id('新竹')].owner = 1
    run(t, 1)
    expect(t.armies[0].units).toBe(12 - RULES.enterPerTick)
    settle(t)
    expect(t.regions[id('新竹')]).toMatchObject({ owner: 1, units: RULES.neutral.post - 3 + 12 })
  })

  it('圍城中守軍派兵出城：在門口跟城外的軍隊打，打的時候城外那支攻不了城；打完城空了才進去', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('新竹')] })
    // 對手另外還有一區，才不會兵一打光就分出勝負
    s.regions[id('臺南')].owner = 2
    s.regions[id('新竹')].units = 30
    s.regions[id('苗栗')].units = 50
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, gate('苗栗', '新竹') + 4)
    const outside = s.armies[0].units, inside = s.regions[id('新竹')].units
    expect(s.armies[0].siege).toBe(true)
    // 往哪個方向出城都一樣：城外的敵軍就在遭遇的範圍裡
    expect(issue(s, map, g, id('新竹'), id('桃仔園'))).toBe(true)
    run(s, 1)
    expect(s.clashes).toHaveLength(1)
    expect(s.armies.map((a) => [a.units, a.fight])).toEqual([[outside - RULES.clashPerTick, true], [inside - RULES.clashPerTick, true]])
    // 城已經空了，但城外那支被纏住，這時候拿不下來
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 2, units: 0 })
    run(s, 3)
    expect(s.regions[id('新竹')].owner).toBe(2)
    settle(s)
    // 出城的全部換掉了；打的這段時間城裡又長了一兩個兵，也要打掉
    expect(s.regions[id('新竹')].owner).toBe(1)
    expect(s.regions[id('新竹')].units).toBeLessThanOrEqual(outside - inside)
    expect(s.regions[id('新竹')].units).toBeGreaterThanOrEqual(outside - inside - 4)
  })

  it('兵力不夠（或剛好打平）就只是削弱守軍', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('苗栗')].units = RULES.neutral.post
    issue(s, map, g, id('苗栗'), id('新竹'))
    settle(s)
    expect(s.regions[id('新竹')]).toMatchObject({ owner: 0, units: 0 })
  })

  it('砲台：射程內的敵軍一路被打，圍城時也照打；中立的砲台誰都打', () => {
    const s = createGame(map, { players: 2, starts: [id('臺北'), id('阿猴')] })
    s.regions[id('臺北')].units = 40
    const onTheWay = shellLoss(s, g, [id('臺北'), id('基隆')], 1, false, 1, 40)
    expect(onTheWay).toBeGreaterThan(4)
    const f = forecast(s, map, g, id('臺北'), id('基隆'))!
    issue(s, map, g, id('臺北'), id('基隆'))
    let shots = 0
    while (s.armies.length) { step(s, map, g); shots += s.shots.length }
    // 在城外打的那幾拍還在射程裡
    expect(shots).toBeGreaterThan(onTheWay)
    // 打下來的兵 = 派出去的 − 被砲打掉的 − 守軍；事先的估計跟實際一樣
    expect(s.regions[id('基隆')]).toMatchObject({ owner: 1, units: 40 - shots - RULES.neutral.fort })
    expect(f).toEqual({ at: id('基隆'), mine: true, units: 40 - shots - RULES.neutral.fort, shelled: shots })
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
      for (let i = 0; i < gate(from, to) - 1; i++) { step(s, map, g); shots += s.shots.length }
      expect(shots > 0).toBe(hit)
      expect(s.armies[0].units).toBe(30 - shots)
    }
    // 只有 2 個兵的小隊走不到
    const t = createGame(map, { players: 2, starts: [id('臺北'), id('阿猴')] })
    t.regions[id('臺北')].units = 2
    issue(t, map, g, id('臺北'), id('基隆'))
    settle(t)
    expect(t.armies).toHaveLength(0)
    expect(t.regions[id('基隆')]).toMatchObject({ owner: 0, units: RULES.neutral.fort })
  })

  it('糧倉：第一次被打下來才加兵，一局只給一次', () => {
    const s = createGame(map, { players: 2, starts: [id('臺中'), id('斗六')] })
    const take = (from: string, units: number, to = '彰化') => {
      s.regions[id(from)].units = units
      s.regions[id(from)].readyAt = 0
      issue(s, map, g, id(from), id(to))
      const gained: number[] = []
      while (s.armies.length) { step(s, map, g); for (const e of s.gains) if (e.region === id(to)) gained.push(e.units) }
      return gained
    }
    // 打不下來不算，存糧還在
    expect(take('臺中', 5)).toEqual([])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 0, spent: false })
    s.regions[id('彰化')].units = RULES.neutral.granary
    expect(take('臺中', 30)).toEqual([RULES.granaryBonus])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 1, units: 30 - RULES.neutral.granary + RULES.granaryBonus, spent: true })
    // 被搶走、再搶回來，都不再加（守軍只會比派去的少，沒有多出 15）
    s.regions[id('彰化')].units = 5
    expect(take('斗六', 30)).toEqual([])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 2, spent: true })
    expect(s.regions[id('彰化')].units).toBeLessThan(30)
    s.regions[id('彰化')].units = 5
    expect(take('臺中', 30)).toEqual([])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 1, spent: true })
    // 每個糧倉各算各的：鹽水港的還在
    expect(s.regions[id('鹽水港')].spent).toBe(false)
    // 不是糧倉的區不會被標成發過
    expect(s.regions.filter((r) => r.spent)).toHaveLength(1)
  })

  it('糧倉：從糧倉起家的，存糧留給第一個打下來的人', () => {
    const s = createGame(map, { players: 2, starts: [id('彰化'), id('臺中')] })
    expect(s.regions[id('彰化')].spent).toBe(false)
    s.regions[id('彰化')].units = 5
    s.regions[id('臺中')].units = 30
    issue(s, map, g, id('臺中'), id('彰化'))
    const gained: number[] = []
    while (s.armies.length && !s.winner) { step(s, map, g); for (const e of s.gains) gained.push(e.units) }
    expect(gained).toEqual([RULES.granaryBonus])
    expect(s.regions[id('彰化')]).toMatchObject({ owner: 2, spent: true })
  })

  it('中途的區被搶走，就在那裡開打', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('阿猴')] })
    s.regions[id('新竹')].owner = 1
    s.regions[id('新竹')].units = 5
    s.regions[id('苗栗')].units = 40
    issue(s, map, g, id('苗栗'), id('桃仔園'))
    s.regions[id('新竹')].owner = 2
    settle(s)
    // 守軍 5，行軍和圍城期間對手又長了幾個兵
    expect(s.regions[id('新竹')].owner).toBe(1)
    expect(s.regions[id('新竹')].units).toBeGreaterThanOrEqual(40 - 5 - 4)
    expect(s.regions[id('新竹')].units).toBeLessThanOrEqual(40 - 5)
    expect(s.regions[id('桃仔園')].owner).toBe(0)
  })
})

describe('路上相遇', () => {
  const start = () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('臺中')] })
    return { s, ticks: link('苗栗', '臺中').ticks }
  }

  it('迎面來的敵軍靠得夠近就打起來：兩邊停下來，每拍各少幾個，不是整隊一次抵銷', () => {
    const { s, ticks } = start()
    s.regions[id('苗栗')].units = 30
    s.regions[id('臺中')].units = 18
    issue(s, map, g, id('苗栗'), id('臺中'))
    issue(s, map, g, id('臺中'), id('苗栗'))
    let n = 0
    while (!s.clashes.length) {
      expect(s.armies.map((a) => a.units)).toEqual([30, 18])
      step(s, map, g)
      n++
    }
    // 兩邊一樣快；不用等到走到一半、位置交會才打
    expect(n).toBeLessThan(Math.ceil(ticks / 2))
    expect(n).toBeGreaterThan(ticks / 4)
    const rate = RULES.clashPerTick
    expect(s.armies.map((a) => [a.units, a.fight])).toEqual([[30 - rate, true], [18 - rate, true]])
    expect(s.clashes).toEqual([{ x: expect.any(Number), y: expect.any(Number), units: rate }])
    // 打起來的地方記在兩軍中間，大約是這段路的中點
    const mid = posOf(g, id('苗栗'), id('臺中'), 1, 2)
    expect(Math.hypot(s.clashes[0].x - mid[0], s.clashes[0].y - mid[1])).toBeLessThan(60)
    // 打的時候都停在原地
    const where = s.armies.map((a) => a.t)
    run(s, 3)
    expect(s.armies.map((a) => a.t)).toEqual(where)
    expect(s.armies.map((a) => a.units)).toEqual([30 - 4 * rate, 18 - 4 * rate])
    // 18 個兵換完要 18 / rate 拍；兵少的打光，兵多的那一拍就不算被纏住，下一拍繼續走
    run(s, 18 / rate - 4)
    expect(s.armies).toHaveLength(1)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 12, fight: false, t: where[0] })
    run(s, 1)
    expect(s.clashes).toHaveLength(0)
    expect(s.armies[0].t).toBe(where[0] + 1)
    settle(s)
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

  it('自己人擦身而過沒事；離得遠的也碰不到', () => {
    const { s } = start()
    s.regions[id('臺中')].owner = 1
    issue(s, map, g, id('苗栗'), id('臺中'))
    issue(s, map, g, id('臺中'), id('苗栗'))
    run(s, gate('苗栗', '臺中') - 1)
    expect(s.armies.map((a) => a.units)).toEqual([20, 20])

    const t = createGame(map, { players: 2, starts: [id('苗栗'), id('臺中')] })
    issue(t, map, g, id('苗栗'), id('新竹'))
    issue(t, map, g, id('臺中'), id('彰化'))
    run(t, 5)
    expect(t.armies.map((a) => a.units)).toEqual([20, 20])
    expect(t.clashes).toHaveLength(0)
  })

  it('同方向：後面比較快的敵軍追到夠近，就打起來', () => {
    const { s } = start()
    const path = [id('苗栗'), id('臺中')]
    s.armies.push(
      { id: 1, owner: 1, units: 9, path, leg: 0, t: 36, legTicks: 60, fast: false, siege: false, fight: false },
      { id: 2, owner: 2, units: 4, path, leg: 0, t: 0, legTicks: 10, fast: true, siege: false, fight: false })
    s.nextArmyId = 3
    run(s, 1)
    expect(s.armies).toHaveLength(2)
    while (!s.clashes.length) step(s, map, g)
    // 打起來的時候後面那支還沒追上；前面那支也被纏住，停下來打
    expect(s.armies.map((a) => a.fight)).toEqual([true, true])
    expect(s.armies[1].t * 6).toBeLessThan(s.armies[0].t)
    while (s.armies.length > 1) step(s, map, g)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 5 })
  })

  it('不同路上的敵軍，在圖上靠得夠近也打', () => {
    // 一支剛從苗栗往南出發（走得很慢），另一支從北邊的新竹往苗栗來：不同的兩段路，但都在苗栗旁邊
    const { s } = start()
    s.armies.push(
      { id: 1, owner: 1, units: 9, path: [id('苗栗'), id('臺中')], leg: 0, t: 0, legTicks: 400, fast: false, siege: false, fight: false },
      { id: 2, owner: 2, units: 4, path: [id('新竹'), id('苗栗')], leg: 0, t: 10, legTicks: 40, fast: false, siege: false, fight: false })
    s.nextArmyId = 3
    const far = () => {
      const [p, q] = s.armies.map((x) => posOf(g, x.path[0], x.path[1], x.t, x.legTicks))
      return Math.hypot(p[0] - q[0], p[1] - q[1]) / 10
    }
    expect(far()).toBeGreaterThan(RULES.clashRange)
    let last = far()
    while (!s.clashes.length) { last = far(); step(s, map, g) }
    expect(last).toBeGreaterThan(RULES.clashRange)
    expect(s.clashes[0].units).toBe(RULES.clashPerTick)
    while (s.armies.length > 1) step(s, map, g)
    expect(s.armies[0]).toMatchObject({ owner: 1, units: 5 })
  })

  it('在城外排隊進城的援軍被敵軍纏住：先打完才繼續進城', () => {
    const { s } = start()
    const full = capOf(map, id('新竹'))
    s.regions[id('新竹')].owner = 1
    s.regions[id('新竹')].units = full
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, gate('苗栗', '新竹') + 1)
    const queue = s.armies[0].units, inside = s.regions[id('新竹')].units
    expect(inside).toBe(full + 2 * RULES.enterPerTick)
    // 敵軍出現在同一個城門口
    const me = s.armies[0]
    s.armies.push({ id: 9, owner: 2, units: 3, path: [...me.path], leg: 0, t: me.t, legTicks: me.legTicks, fast: me.fast, siege: false, fight: false })
    run(s, 1)
    expect(s.armies.map((x) => [x.units, x.fight])).toEqual([[queue - 2, true], [1, true]])
    expect(s.regions[id('新竹')].units).toBe(inside)
    // 下一拍敵軍打光，這一拍就接著進城
    run(s, 1)
    expect(s.armies).toHaveLength(1)
    expect(s.regions[id('新竹')].units).toBe(inside + RULES.enterPerTick)
    settle(s)
    expect(s.regions[id('新竹')].units).toBe(full + 20 - 3)
  })

  it('剛出門就撞上快到城外的敵軍：先打完，剩下的才攻城', () => {
    const { s } = start()
    s.regions[id('臺南')].owner = 2
    s.regions[id('苗栗')].units = 30
    issue(s, map, g, id('苗栗'), id('臺中'))
    run(s, gate('苗栗', '臺中') - 1)
    const home = s.regions[id('臺中')].units
    issue(s, map, g, id('臺中'), id('苗栗'))
    run(s, 1)
    expect(s.clashes).toHaveLength(1)
    expect(s.armies).toHaveLength(2)
    // 城是空的，但還在跟出門的守軍打，這時候進不去
    expect(s.regions[id('臺中')].owner).toBe(2)
    // 30 個兵先被出門的守軍換掉一部分，剩下的打進（這段時間又長了一點兵的）城
    settle(s)
    expect(s.regions[id('臺中')].owner).toBe(1)
    expect(s.regions[id('臺中')].units).toBeLessThanOrEqual(30 - home)
    expect(s.regions[id('臺中')].units).toBeGreaterThanOrEqual(30 - home - 4)
  })
})

describe('勝負', () => {
  it('對手沒有領地也沒有兵在路上，就分出勝負', () => {
    const s = createGame(map, { players: 2, starts: [id('苗栗'), id('新竹')] })
    s.regions[id('苗栗')].units = 100
    issue(s, map, g, id('苗栗'), id('新竹'))
    run(s, 80)
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

describe('轉彎的航線與險航線', () => {
  // 甲 ─(險航線，往下繞一個ㄇ字)─ 乙；丙是砲台，在ㄇ字底下。甲乙的直線離丙很遠，繞下去的線才會經過丙的射程。
  const region = (name: string, x: number, y: number, trait: MapData['regions'][number]['trait'] = 'none') =>
    ({ id: name, name, today: '', trait, x, y, area: 1, d: 'M0,0' })
  const bent: MapData = {
    id: 'bent', name: '測試', version: 1, width: 600, height: 500,
    regions: [region('甲', 100, 100), region('乙', 500, 100), region('丙', 300, 340, 'fort'), region('丁', 100, 20)],
    edges: [
      { a: 0, b: 1, kind: 'rough', km: 96, via: [[100, 300], [500, 300]] },
      { a: 0, b: 2, kind: 'sea', km: 96 },
      { a: 0, b: 3, kind: 'land', km: 30 },
    ],
    borders: [],
  }
  const bg = buildGraph(bent)
  const there = bg.links[0].find((l) => l.to === 1)!, back = bg.links[1].find((l) => l.to === 0)!

  it('險航線比一樣遠的航線慢 RULES.roughFactor 倍', () => {
    expect(there.kind).toBe('rough')
    expect(there.ticks).toBe(bg.links[0].find((l) => l.to === 2)!.ticks * RULES.roughFactor)
    expect(back.ticks).toBe(there.ticks)
  })

  it('路長是沿著線量的，來回一樣長', () => {
    expect(there.len).toBe(2000 + 4000 + 2000)
    expect(back.len).toBe(there.len)
    expect(there.cum).toEqual([0, 2000, 6000, 8000])
    expect(back.cum).toEqual([0, 2000, 6000, 8000])
  })

  it('軍隊沿著線走：先往下、再橫過去、再往上，回程倒過來', () => {
    const T = there.ticks
    expect(posOf(bg, 0, 1, 0, T)).toEqual([1000, 1000])
    expect(posOf(bg, 0, 1, T, T)).toEqual([5000, 1000])
    expect(posOf(bg, 0, 1, T / 8, T)).toEqual([1000, 2000])
    expect(posOf(bg, 0, 1, T / 4, T)).toEqual([1000, 3000])
    expect(posOf(bg, 0, 1, T / 2, T)).toEqual([3000, 3000])
    expect(posOf(bg, 0, 1, (T * 3) / 4, T)).toEqual([5000, 3000])
    // 回程是同一條線（捨去的方向不同，最多差 1，也就是 0.1 個地圖單位）
    for (let t = 0; t <= T; t++) {
      const [x0, y0] = posOf(bg, 1, 0, t, T), [x1, y1] = posOf(bg, 0, 1, T - t, T)
      expect(Math.abs(x0 - x1) + Math.abs(y0 - y1)).toBeLessThanOrEqual(1)
    }
    // 每一拍走的距離差不多：不會在轉彎的地方跳一大步
    for (let t = 1; t <= T; t++) {
      const [x0, y0] = posOf(bg, 0, 1, t - 1, T), [x1, y1] = posOf(bg, 0, 1, t, T)
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan((there.len / T) * 1.5)
    }
  })

  it('城外也是沿著線量的：最後停在離據點 RULES.gate 的地方', () => {
    const T = there.ticks, at = gateTick(bg, 0, 1, T)
    const [x, y] = posOf(bg, 0, 1, at, T)
    expect(x).toBe(5000)
    // 一拍走 len / T，所以停的地方離 gate 不會超過一拍的路
    expect((y - 1000) / 10).toBeLessThanOrEqual(RULES.gate)
    expect((y - 1000) / 10).toBeGreaterThan(RULES.gate - there.len / T / 10)
  })

  it('砲台看的是軍隊真正走的線：繞進射程就挨砲，直線距離再遠也一樣', () => {
    const s = createGame(bent, { players: 2, starts: [0, 3] })
    s.regions[0].units = 60
    const direct = Math.hypot(300 - 300, 340 - 100)
    expect(direct).toBeGreaterThan(RULES.fort.range)
    const lost = shellLoss(s, bg, [0, 1], 1, false, 1, 60)
    expect(lost).toBeGreaterThan(5)
    expect(issue(s, bent, bg, 0, 1)).toBe(true)
    let shots = 0
    for (let i = 0; i < gateTick(bg, 0, 1, there.ticks) - 1; i++) { step(s, bent, bg); shots += s.shots.length }
    expect(shots).toBe(lost)
    expect(s.armies[0].units).toBe(60 - lost)
  })

  it('只靠航線（含險航線）連接的區，對手不拿來開局', () => {
    const sea: MapData = { ...bent, edges: bent.edges.filter((e) => e.kind !== 'land') }
    for (let seed = 1; seed <= 20; seed++) expect(pickStarts(bent, 3, 2, seed)[1]).not.toBe(1)
    expect(() => pickStarts(sea, 0, 2, 1)).toThrow()
  })
})
