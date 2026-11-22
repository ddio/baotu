// 各個畫面：開局、對戰、結束、記錄、重播。地圖只有一張，畫面之間換的是上下兩列與蓋在上面的紙片。
import { DEFAULT_MAP, MAPS } from '../maps'
import type { Difficulty } from '../sim/ai'
import type { ViewState } from '../sim/engine'
import type { MapData, PlayerId } from '../sim/types'
import { CURRENT } from '../sim/engines'
import { canSend, createGame, forecast, sendAmount } from '../sim/game'
import { legTicks, reach, route, stopIndex } from '../sim/graph'
import { Match, type MatchConfig } from '../sim/match'
import { decodeOpening, encodeOpening, openingConfig, openingOf } from '../sim/opening'
import { addRecord, type GameRecord, makeRecord, MAX_RECORDS, openReplay, parseRecord, playable, type Replay, type Result } from '../sim/record'
import { RULES, RULES_VERSION, TICKS_PER_SECOND } from '../sim/rules'
import { pickStarts } from '../sim/setup'
import { forceChart } from './chart'
import { clock, h } from './dom'
import { type Marks, MapView } from './mapview'
import { loadPrefs, loadRecords, savePrefs, saveRecords } from './store'
import { DIFFICULTY, sideIcon, sideName, SIDES, SPECIALS, traitIcon, TRAITS } from './theme'
import { trackEnd, trackPlay, trackReplay, trackShare } from './track'

const ME = 1
const TICK_MS = 1000 / TICKS_PER_SECOND
/**
 * 重播的戰報裡，沒換主人的仗（攻城失利、守住、遭遇）兩邊合計折損到這個數才提。
 * 兵是一個換一個，60 大約是各折 30：一個普通據點的上限是 40，等於幾乎一整城的兵拚光。
 * 拿 48 局電腦對打量過：60 平均一局多 6 則（40 是 10 則，太吵；80 是 4 則，四分之一的局一則都沒有）。
 */
const BATTLE_MIN = 60
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard']
const RESULT: Record<Result, string> = { win: '勝', lose: '敗', quit: '放棄' }

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1
/** 網址 # 後面的開局代碼（#g=2-13-3n-zik0zj）；沒有就是 null */
const linkCode = () => /^#g=(.+)$/.exec(location.hash)?.[1] ?? null
const noMarks = (me = 0): Marks => ({ me, selected: -1, targets: null, hover: -1, picked: -1, stop: -1 })

export function startApp(root: HTMLElement): void {
  const map = MAPS[DEFAULT_MAP]
  let view = new MapView(map, CURRENT.view)
  const bar = h('header', { class: 'bar' })
  const stage = h('main', { class: 'stage' }, view.svg)
  const panel = h('footer', { class: 'panel' })
  root.append(bar, stage, panel)

  /** 換一張地圖來畫：重播改版前的記錄時換成當時的地圖，離開時換回來 */
  const useMap = (m: MapData) => {
    if (view.map === m) return
    const next = new MapView(m, CURRENT.view)
    view.svg.replaceWith(next.svg)
    view = next
  }

  /** 離開目前畫面時要做的收尾（停掉動畫、拿掉事件） */
  let leave: (() => void) | null = null
  let atStart = false
  const enter = (cleanup: () => void, start = false) => { leave?.(); leave = cleanup; atStart = start }

  // ---- 蓋在上面的紙片 ----
  let veil: HTMLElement | null = null
  /** 紙片每換一次就加一：等舊版規則下載的重播，回來時發現紙片換過了就不播 */
  let slips = 0
  const closeSlip = () => { veil?.remove(); veil = null; slips += 1 }
  const openSlip = (...kids: (Node | string)[]) => {
    closeSlip()
    const slip = h('div', { class: 'slip', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, ...kids)
    veil = h('div', { class: 'veil' }, slip)
    root.append(veil)
    slip.focus()
  }

  const regionText = (i: number, state: ViewState): [string, string] => {
    const r = map.regions[i], st = state.regions[i], t = TRAITS[r.trait]
    const owner = st.owner === 0 ? '中立' : sideName(st.owner)
    const trait = !t ? '' : st.spent ? `【${t.name}】存糧已經被拿走，再打下來不會加兵。` : `【${t.name}】${t.text}。`
    return [`${r.name}廳　${owner}　${st.units} 兵`, `${trait}今${r.today}。`]
  }

  /** 上方的各方兵力條 */
  const forcesBar = (players: number) => {
    const segs = Array.from({ length: players }, (_, i) => {
      const p = i + 1, num = h('span', {})
      const el = h('div', { class: 'seg', title: sideName(p) }, sideIcon(p, SIDES[p].ink, SIDES[p].ink), num)
      el.style.background = SIDES[p].color
      el.style.color = SIDES[p].ink
      return { el, num }
    })
    const el = h('div', { class: 'forces', role: 'img', 'aria-label': '各方兵力' }, ...segs.map((x) => x.el))
    const update = (state: ViewState) => {
      const t = new Array<number>(players + 1).fill(0)
      for (const r of state.regions) t[r.owner] += r.units
      for (const a of state.armies) t[a.owner] += a.units
      segs.forEach((x, i) => {
        x.num.textContent = String(t[i + 1])
        x.el.style.flexGrow = String(Math.max(t[i + 1], 1))
        x.el.classList.toggle('out', !state.alive[i + 1])
      })
    }
    return { el, update }
  }

  // ---- 開局的網址 ----
  /** 現在網址列上的開局代碼 */
  let linked = ''
  /** 網址列跟著目前這一局走：重新整理、或把網址貼給別人，開出來都是同一個開局。不留瀏覽記錄。 */
  const setLink = (config: MatchConfig | null) => {
    linked = config ? encodeOpening(openingOf(map, config)) : ''
    try {
      history.replaceState(null, '', linked ? `#g=${linked}` : location.pathname + location.search)
    } catch { /* 網址改不了（例如直接開檔案）不影響遊戲 */ }
  }
  // 在同一個分頁貼上別的開局網址：頁面不會重新載入，自己來
  window.addEventListener('hashchange', () => {
    const code = linkCode()
    if (code !== null && code !== linked) location.reload()
  })
  /** 「分享開局」的按鈕和它底下的一行回應。say 是跟網址一起送出去的話。 */
  const shareOpening = (config: MatchConfig, say: string): [HTMLButtonElement, HTMLElement] => {
    const url = `${location.origin}${location.pathname}#g=${encodeOpening(openingOf(map, config))}`
    const status = h('p', { class: 'lead shared', role: 'status' })
    const button = h('button', { onclick: async () => {
      trackShare('send')
      // 手機：交給系統的分享選單
      if (navigator.share) {
        try { await navigator.share({ title: '堡圖', text: say, url }); return } catch (e) {
          if ((e as Error).name === 'AbortError') return
        }
      }
      try {
        await navigator.clipboard.writeText(url)
        status.replaceChildren('網址複製好了。貼給別人，打開就是同一個開局。')
      } catch {
        // 連剪貼簿都不能用：把網址擺出來讓人自己複製
        const field = h('input', { class: 'link', readonly: true, value: url, 'aria-label': '這個開局的網址', onfocus: () => field.select() })
        status.replaceChildren('複製這個網址給別人：', field)
        field.focus()
      }
    } }, '分享開局')
    return [button, status]
  }

  // ================= 開局 =================
  /** shared：照網址上的開局打（起點、對手數、難度都定好了）；message：開局畫面上先講的一句話 */
  function showStart(picked = -1, shared: MatchConfig | null = null, message = ''): void {
    closeSlip()
    const ac = new AbortController()
    enter(() => ac.abort(), true)
    setLink(shared)
    const prefs = loadPrefs()
    const state = createGame(map, shared ? { players: shared.players, starts: shared.starts } : { players: 0, starts: [] })
    const head = h('div', { class: 'head' }), body = h('div', { class: 'body' })
    const go = h('button', { class: 'primary go', onclick: () => shared ? begin(shared, true) : startGame(picked, prefs.opponents, prefs.difficulty) }, '開始')

    const choice = <T,>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
      const buttons = options.map(([v, text]) => h('button', { type: 'button', onclick: () => { set(v); savePrefs(prefs); sync() } }, text))
      const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === get())))
      sync()
      return h('span', { class: 'field' }, label, h('span', { class: 'choice', role: 'group', 'aria-label': label }, ...buttons))
    }
    const draw = () => {
      view.render(state, 0, { ...noMarks(), picked })
      if (shared) {
        head.textContent = `分享的開局：從${map.regions[picked].name}廳起家`
        body.textContent = `對 ${shared.players - 1} 家，難度${DIFFICULTY[shared.difficulty]}。各家的起點標在圖上了；起點和電腦用的亂數，都跟分享出來的那一局一樣。`
      } else if (picked < 0) {
        head.textContent = '選一個廳起家'
        body.textContent = `${message}點地圖上的任何一區。把其他勢力都趕出去，全島歸你就贏了。`
      } else {
        const [, detail] = regionText(picked, state)
        head.textContent = `從${map.regions[picked].name}廳起家`
        body.textContent = detail
      }
      go.disabled = picked < 0
    }
    if (!shared) view.svg.addEventListener('pointerdown', (e) => {
      const r = view.regionAt(e.clientX, e.clientY)
      if (r >= 0) { picked = r; draw() }
    }, { signal: ac.signal })

    bar.replaceChildren(h('h1', {}, '堡圖'), h('span', { class: 'grow' }),
      h('button', { class: 'small', onclick: showHelp }, '玩法'),
      h('button', { class: 'small', onclick: () => showRecords() }, '記錄'))
    panel.replaceChildren(head, body, shared ? h('div', { class: 'row' },
      go, h('button', { onclick: () => showStart(picked) }, '自己選起點')) : h('div', { class: 'row' },
      choice('對手', [[2, '2 家'], [3, '3 家']], () => prefs.opponents, (v) => { prefs.opponents = v }),
      choice('難度', LEVELS.map((l) => [l, DIFFICULTY[l]] as [Difficulty, string]), () => prefs.difficulty, (v) => { prefs.difficulty = v }),
      go))
    draw()
  }

  function startGame(start: number, opponents: number, difficulty: Difficulty): void {
    const seed = newSeed(), players = opponents + 1
    begin({ players, starts: pickStarts(map, start, players, seed), human: ME, difficulty, seed })
  }

  /** shared：這一局是照分享的開局打的 */
  function begin(config: MatchConfig, shared = false): void {
    trackPlay(config)
    if (shared) trackShare('play')
    play(new Match(map, config))
  }

  // ================= 對戰 =================
  function play(match: Match): void {
    closeSlip()
    const ac = new AbortController()
    const { state, graph, config } = match
    const marks = noMarks(ME)
    let raf = 0, last = performance.now(), acc = 0
    let speed = 1, paused = false, ended = false
    let dragging = false, moved = false, downX = 0, downY = 0
    /** 拖曳中手指在地圖上的位置 */
    let aimX = 0, aimY = 0
    let inspected = -1

    enter(() => { ac.abort(); cancelAnimationFrame(raf); view.clearAim() })
    setLink(config)
    const setup = `從${map.regions[config.starts[0]].name}廳起家，對 ${config.players - 1} 家，難度${DIFFICULTY[config.difficulty]}`

    const forces = forcesBar(config.players)
    const time = h('span', { class: 'digits note' }, '0:00')
    const speedBtn = h('button', { class: 'small digits', 'aria-label': '切換速度', onclick: () => { speed = speed === 1 ? 2 : 1; speedBtn.textContent = speed + '×' } }, '1×')
    bar.replaceChildren(forces.el, time, speedBtn, h('button', { class: 'small', onclick: () => pause() }, '暫停'))
    const head = h('div', { class: 'head' }), body = h('div', { class: 'body' })
    panel.replaceChildren(head, body)
    let shown = ''
    const say = (a: string, b: string) => {
      if (a + '\n' + b === shown) return
      shown = a + '\n' + b
      head.textContent = a
      body.textContent = b
    }

    const select = (r: number) => {
      marks.selected = r
      marks.hover = -1
      if (r < 0) { marks.targets = null; return }
      // 圈起來的是只經過自己的區就到得了的；其他的區也能指，軍隊會在路上先打
      const direct = reach(graph, state, r, ME, map.regions[r].trait === 'post').dist
      marks.targets = direct.map((d, i) => i !== r && d < Infinity)
    }
    const mine = (r: number) => r >= 0 && state.regions[r].owner === ME
    const order = (from: number, to: number) => { match.order(from, to); select(-1) }

    /** 現在從 from 派到 to：走哪條路、會停在第幾站、到那裡要多久 */
    const plan = (from: number, to: number) => {
      const fast = map.regions[from].trait === 'post'
      const path = route(graph, state, from, ME, fast, to)!
      const stop = stopIndex(state, path, ME)
      let ticks = 0, ridge = false, rough = false
      for (let i = 0; i < stop; i++) {
        ticks += legTicks(graph, path[i], path[i + 1], fast)
        const kind = graph.links[path[i]].find((l) => l.to === path[i + 1])?.kind
        if (kind === 'mountain') ridge = true
        if (kind === 'rough') rough = true
      }
      const slow = [ridge ? '要翻山' : '', rough ? '走險航線' : ''].filter(Boolean).join('、')
      return { path, stop, at: path[stop], ticks, slow }
    }

    const orderText = (from: number, to: number): [string, string] => {
      const p = plan(from, to)
      const a = map.regions[from], b = map.regions[to], target = state.regions[p.at]
      const n = sendAmount(state.regions[from].units)
      const secs = Math.max(1, Math.round(p.ticks / TICKS_PER_SECOND))
      const trip = `約 ${secs} 秒到${p.slow && `（${p.slow}）`}`
      // 照規則先跑一遍：砲台一路上（連在城外打的時候）打掉幾個、守軍邊打邊長，都算在內
      const f = forecast(state, map, graph, from, to)
      const fort = f?.shelled ? `，砲台會打掉你約 ${f.shelled} 兵` : ''
      if (target.owner === ME) return [`${a.name} → ${b.name}　增援 ${n} 兵`, `${trip}${fort}。`]
      const odds = !f ? '' : f.mine ? `拿得下，會剩約 ${f.units} 兵` : `拿不下，守軍會剩約 ${f.units}`
      const head = `${a.name} → ${b.name}　派 ${n} 兵`
      if (p.at !== to) return [head, `路上的${map.regions[p.at].name}不是你的，會先在那裡開打：守軍 ${target.units}${fort}，${trip}${odds && '，' + odds}。`]
      return [head, `守軍 ${target.units}${fort}。${trip}${odds && '，' + odds}。`]
    }
    /** 把準備派兵的路線畫在地圖上 */
    const drawAim = () => {
      marks.stop = -1
      if (marks.selected >= 0 && marks.hover >= 0) {
        const p = plan(marks.selected, marks.hover)
        if (p.at !== marks.hover) marks.stop = p.at
        view.setRoute(p.path, p.stop)
      } else if (dragging && moved) view.setAim(marks.selected, aimX, aimY)
      else view.clearAim()
    }
    const updatePanel = () => {
      if (marks.selected >= 0 && marks.hover >= 0) say(...orderText(marks.selected, marks.hover))
      else if (marks.selected >= 0) {
        const r = map.regions[marks.selected]
        say(`${r.name}廳　派出 ${sendAmount(state.regions[marks.selected].units)} 兵`, '拖到目標放開，或直接點目標；再點一次取消。圈起來的區可以直達，其他的會在路上先開打。')
      } else if (inspected >= 0) say(...regionText(inspected, state))
      else say('從你的區拖到目標，整區的兵都派出去', '藍色圓形是你。兵會自己長，派兵後那一區要等幾秒才能再派。')
    }

    // ---- 操作 ----
    const svg = view.svg, opt = { signal: ac.signal }
    svg.addEventListener('pointerdown', (e) => {
      if (paused || ended || !e.isPrimary) return
      const r = view.regionAt(e.clientX, e.clientY)
      if (marks.selected >= 0) {
        const from = marks.selected
        if (r >= 0 && r !== from) { order(from, r); return }
        select(-1)
        if (r === from) return
      }
      inspected = r
      if (mine(r) && canSend(state, r)) {
        select(r)
        dragging = true
        moved = false
        downX = e.clientX
        downY = e.clientY
        svg.setPointerCapture(e.pointerId)
      }
    }, opt)
    svg.addEventListener('pointermove', (e) => {
      if (marks.selected < 0 || paused || ended) return
      if (!dragging && e.pointerType !== 'mouse') return
      const r = view.regionAt(e.clientX, e.clientY)
      marks.hover = r >= 0 && r !== marks.selected ? r : -1
      if (!dragging) return
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true
      const p = view.point(e.clientX, e.clientY)
      aimX = p.x
      aimY = p.y
    }, opt)
    const release = (cancelled: boolean) => {
      if (!dragging) return
      dragging = false
      if (cancelled) select(-1)
      else if (marks.hover >= 0) order(marks.selected, marks.hover)
      else if (moved) select(-1)
      // 沒有拖動就放開＝點選，保持選中，等下一次點目標
    }
    svg.addEventListener('pointerup', () => release(false), opt)
    svg.addEventListener('pointercancel', () => release(true), opt)

    // ---- 暫停 ----
    const resume = () => { paused = false; last = performance.now(); closeSlip() }
    const pause = () => {
      if (ended || paused) return
      paused = true
      release(true)
      const [share, shared] = shareOpening(config, `「堡圖」的一個開局：${setup}。`)
      openSlip(h('h2', {}, '暫停'),
        h('p', { class: 'lead' }, `已經打了 ${clock(state.tick / TICKS_PER_SECOND)}。`),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: resume }, '繼續'),
          h('button', { onclick: () => { finish('quit'); startGame(config.starts[0], config.players - 1, config.difficulty) } }, '重來'),
          h('button', { onclick: () => { finish('quit'); showStart(config.starts[0]) } }, '回主畫面'),
          share),
        shared)
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause() }, opt)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') { if (paused) resume(); else pause() }
    }, opt)

    // ---- 結束 ----
    let saved = true
    const finish = (result: Result): GameRecord | null => {
      ended = true
      trackEnd(config, result)
      // 剛開局就放棄的不留
      if (result === 'quit' && state.tick < 15 * TICKS_PER_SECOND) return null
      const rec = makeRecord(match, result, new Date())
      saved = saveRecords(addRecord(loadRecords(), rec))
      return rec
    }
    const end = () => {
      const result: Result = state.winner === ME ? 'win' : 'lose'
      const rec = finish(result)!
      select(-1)
      view.clearAim()
      const took = clock(state.tick / TICKS_PER_SECOND)
      const [share, shared] = shareOpening(config,
        `我在「堡圖」${setup}，${result === 'win' ? `${took} 拿下全島` : `撐了 ${took}`}。同一個開局，換你試試。`)
      openSlip(
        h('h2', {}, result === 'win' ? '全島底定' : '領地盡失'),
        h('p', { class: 'lead' }, `${setup}，打了 ${took}。`),
        forceChart(match.history, config.players),
        saved ? '' : h('p', { class: 'notice' }, '這一局沒能存進瀏覽器（空間不足或儲存被停用），關掉分頁就看不到了。'),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: () => startGame(config.starts[0], config.players - 1, config.difficulty) }, '再來一局'),
          h('button', { onclick: () => showStart() }, '換個起點'),
          h('button', { onclick: () => showReplay(rec) }, '看重播'),
          share),
        shared)
    }

    // ---- 主迴圈 ----
    const afterTick = () => {
      if (marks.selected >= 0) {
        if (!mine(marks.selected)) { dragging = false; select(-1) }
        else { const hover = marks.hover; select(marks.selected); marks.hover = hover }
      }
      if (state.tick % 5 === 0) {
        forces.update(state)
        time.textContent = clock(state.tick / TICKS_PER_SECOND)
      }
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(250, now - last)
      last = now
      if (!paused && !ended) {
        acc += dt * speed
        while (acc >= TICK_MS && !ended) {
          acc -= TICK_MS
          match.tick()
          afterTick()
          if (match.over) { forces.update(state); end() }
        }
      }
      drawAim()
      view.render(state, ended ? 0 : Math.min(1, acc / TICK_MS), marks)
      updatePanel()
    }
    forces.update(state)
    raf = requestAnimationFrame(frame)
  }

  // ================= 重播 =================
  /** 先拿到記錄那一版的規則和地圖（舊版要下載），拿到了才換畫面 */
  function showReplay(rec: GameRecord): void {
    const asked = slips
    openReplay(rec).then(
      (replay) => {
        if (slips !== asked) return
        if (replay) playReplay(replay)
        else showRecords('這筆記錄的規則或地圖已經沒有留著，不能重播。')
      },
      () => { if (slips === asked) showRecords('這筆記錄用的舊版規則或地圖沒能下載，連上網路後再試一次。') })
  }

  function playReplay(replay: Replay): void {
    closeSlip()
    const rec = replay.rec
    const old = rec.rulesVersion !== RULES_VERSION, oldMap = replay.map !== map
    trackReplay(rec.rulesVersion)
    const ac = new AbortController()
    let raf = 0, last = performance.now(), acc = 0, playing = true, speed = 2
    // 戰報：你攻下、失守的據點，和沒換主人的大仗，在地圖角落留幾秒。照時間軸上的位置算，拉時間軸也對得上
    const me = rec.config.human
    const place = (i: number) => replay.map.regions[i].name
    const feed: { tick: number; make: () => HTMLElement }[] = []
    /** 一則戰報。toll 是［你折損的，對方折損的］ */
    const post = (tick: number, cls: 'won' | 'lost', icon: PlayerId, text: string, title: string, toll?: [number, number]) => feed.push({ tick, make: () =>
      h('div', { class: cls, title: toll ? `${title}：你折損 ${toll[0]}，對方折損 ${toll[1]}` : title },
        h('span', { class: 'digits' }, clock(tick / TICKS_PER_SECOND)), sideIcon(icon), h('span', {}, text),
        toll ? h('span', { class: 'toll digits' }, `折 ${toll[0]}　殲 ${toll[1]}`) : '') })
    if (me !== 0) {
      for (const e of replay.takes) {
        if (e.to === me) post(e.tick, 'won', e.to, `攻下${place(e.region)}`, `你攻下${place(e.region)}`)
        else if (e.from === me) post(e.tick, 'lost', e.to, `${place(e.region)}陷落`, `${place(e.region)}被${sideName(e.to)}攻下`)
      }
      // 易手的上面已經有一則；這裡補上你沒攻下來的、你守住的，和城外的遭遇
      for (const b of replay.battles) {
        const all = b.lost.reduce((x, y) => x + y, 0), ours = b.lost[me], theirs = all - ours
        if (b.kind === 'fell' || all < BATTLE_MIN) continue
        const name = place(b.region)
        if (b.kind === 'field') {
          if (ours === 0 || theirs === 0) continue
          // 圖示用折損最多的那個對手
          let foe = 0
          b.lost.forEach((n, p) => { if (p !== me && n > b.lost[foe]) foe = p })
          const where = b.other >= 0 ? `${name}、${place(b.other)}間` : `${name}附近`
          post(b.tick, 'won', foe as PlayerId, `${where}遭遇`, `你在${where}遇上${sideName(foe as PlayerId)}`, [ours, theirs])
        } else if (b.attacker === me) {
          post(b.tick, 'lost', b.defender, `攻${name}失利`, `你攻${name}沒打下來`, [ours, theirs])
        } else if (b.defender === me) {
          post(b.tick, 'won', b.attacker, `守住${name}`, `你守住${name}，打退${sideName(b.attacker)}`, [ours, theirs])
        }
      }
      feed.sort((a, b) => a.tick - b.tick)
    }
    const news = h('div', { class: 'news' })
    const shown = new Map<number, HTMLElement>()
    const NEWS_TICKS = 80, NEWS_FADE = 20
    const report = () => {
      const now = replay.state.tick
      const recent: number[] = []
      feed.forEach((e, i) => { if (e.tick <= now && e.tick > now - NEWS_TICKS) recent.push(i) })
      recent.splice(0, recent.length - 3)
      for (const [i, el] of shown) if (!recent.includes(i)) { el.remove(); shown.delete(i) }
      for (const i of recent) {
        let el = shown.get(i)
        if (!el) {
          el = feed[i].make()
          shown.set(i, el)
          news.append(el)
        }
        el.style.opacity = String(Math.min(1, (NEWS_TICKS - (now - feed[i].tick)) / NEWS_FADE))
      }
    }
    stage.append(news)
    enter(() => { ac.abort(); cancelAnimationFrame(raf); news.remove(); view.useRules(CURRENT.view); useMap(map) })
    useMap(replay.map)
    view.useRules(replay.engine.view)

    const forces = forcesBar(rec.config.players)
    const total = rec.ticks
    const startName = replay.map.regions[rec.config.starts[0]].name
    // 分享這一局的開局。網址帶的是現在這張地圖的版本，改版前的地圖開不出同一局，就不給分享
    const took = clock(total / TICKS_PER_SECOND)
    const setup = `從${startName}廳起家，對 ${rec.config.players - 1} 家，難度${DIFFICULTY[rec.config.difficulty]}`
    const [share, shared] = oldMap ? [] : shareOpening(rec.config, rec.config.human
      ? `我在「堡圖」${setup}，${rec.result === 'win' ? `${took} 拿下全島` : rec.result === 'lose' ? `撐了 ${took}` : `打了 ${took}`}。同一個開局，換你試試。`
      : `「堡圖」的一個開局：${setup}。`)
    if (share) share.className = 'small'
    bar.replaceChildren(forces.el, share ?? '', h('button', { class: 'small', onclick: () => showRecords() }, '離開重播'))
    const toggle = h('button', { class: 'small', onclick: () => {
      if (replay.done) replay.seek(0)
      playing = !playing
      sync()
    } })
    const speedBtn = h('button', { class: 'small digits', 'aria-label': '切換速度', onclick: () => { speed = speed >= 8 ? 1 : speed * 2; speedBtn.textContent = speed + '×' } }, speed + '×')
    const slider = h('input', { type: 'range', min: '0', max: String(total), step: '1', 'aria-label': '時間軸' })
    const time = h('span', { class: 'digits' })
    slider.addEventListener('input', () => { playing = false; replay.seek(Number(slider.value)); acc = 0; sync() })
    const then = [old ? `規則 v${rec.rulesVersion}` : '', oldMap ? '改版前的地圖' : ''].filter(Boolean).join('、')
    panel.replaceChildren(
      h('div', { class: 'body' }, `${when(rec)}　從${startName}廳起家，${RESULT[rec.result]}。${then ? `當時是${then}，跟現在的玩法說明不完全一樣。` : ''}${replay.faithful ? '' : '這筆記錄重跑出來的結果和當時不一樣。'}`, shared ?? ''),
      h('div', { class: 'row' }, toggle, speedBtn, slider, time))
    const sync = () => {
      toggle.textContent = playing && !replay.done ? '暫停' : replay.done ? '從頭播' : '播放'
      slider.value = String(replay.state.tick)
      time.textContent = `${clock(replay.state.tick / TICKS_PER_SECOND)} / ${clock(total / TICKS_PER_SECOND)}`
      forces.update(replay.state)
    }
    const marks = noMarks()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(250, now - last)
      last = now
      if (playing && !replay.done) {
        acc += dt * speed
        let stepped = false
        while (acc >= TICK_MS && !replay.done) { acc -= TICK_MS; replay.step(); stepped = true }
        if (replay.done) { playing = false; acc = 0 }
        if (stepped && (replay.state.tick % 5 === 0 || replay.done)) sync()
      }
      view.render(replay.state, playing ? Math.min(1, acc / TICK_MS) : 0, marks)
      report()
    }
    sync()
    raf = requestAnimationFrame(frame)
  }

  // ================= 記錄 =================
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = (rec: GameRecord) => {
    const d = new Date(rec.date)
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const download = (name: string, data: unknown) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    const a = h('a', { href: url, download: name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const fileName = (rec: GameRecord) => {
    const d = new Date(rec.date)
    return `baotu-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  }

  function showRecords(message = ''): void {
    // 從重播回來時，底下換回開局畫面
    if (!atStart) showStart()
    let list = loadRecords()
    const notice = h('p', { class: 'notice', role: 'status' }, message)
    const count = h('p', { class: 'lead' })
    const ul = h('ul', { class: 'plain records' })
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' })
    const exportAll = h('button', { onclick: () => download('baotu-records.json', list) }, '全部匯出')

    const draw = () => {
      count.textContent = list.length
        ? `存在這個瀏覽器裡，共 ${list.length} 筆，最多留 ${MAX_RECORDS} 筆，滿了會丟掉最舊的。`
        : `還沒有記錄。打完一局就會存在這個瀏覽器裡，最多留 ${MAX_RECORDS} 筆。`
      exportAll.disabled = !list.length
      ul.replaceChildren(...list.map((rec) => {
        const ok = playable(rec)
        const start = MAPS[rec.map]?.regions[rec.config.starts[0]]?.name ?? '？'
        const del = h('button', { class: 'small', onclick: () => {
          if (del.dataset.armed) { list = list.filter((r) => r.id !== rec.id); saveRecords(list); draw(); return }
          del.dataset.armed = '1'
          del.textContent = '確定刪除'
          del.classList.add('danger')
        } }, '刪除')
        return h('li', {},
          h('div', { class: 'what' }, `${RESULT[rec.result]}　${start}廳起家，對 ${rec.config.players - 1} 家，難度${DIFFICULTY[rec.config.difficulty]}`),
          h('div', { class: 'when digits' }, `${when(rec)}　打了 ${clock(rec.ticks / TICKS_PER_SECOND)}${ok ? (rec.rulesVersion === RULES_VERSION ? '' : `　規則 v${rec.rulesVersion}`) : '　規則或地圖已改版，不能重播'}`),
          h('div', { class: 'acts' },
            h('button', { class: 'small', disabled: !ok, onclick: () => showReplay(rec) }, '重播'),
            h('button', { class: 'small', onclick: () => download(fileName(rec), rec) }, '匯出'), del))
      }))
    }

    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      file.value = ''
      if (!f) return
      if (f.size > 8_000_000) { notice.textContent = '檔案太大，不像是堡圖的記錄。'; return }
      let added = 0
      try {
        const raw: unknown = JSON.parse(await f.text())
        for (const x of Array.isArray(raw) ? raw : [raw]) {
          const rec = parseRecord(x)
          if (!rec) continue
          list = addRecord(list, rec)
          added += 1
        }
      } catch { /* 不是 JSON */ }
      if (!added) { notice.textContent = '這個檔案裡沒有堡圖的記錄。'; return }
      notice.textContent = saveRecords(list) ? `讀進 ${added} 筆。` : '讀進來了，但瀏覽器存不下，關掉分頁就會不見。'
      draw()
    })

    draw()
    openSlip(h('h2', {}, '記錄'), count,
      h('div', { class: 'actions' },
        h('label', { class: 'button' }, file, '匯入'), exportAll,
        h('button', { class: 'primary', onclick: closeSlip }, '關閉')),
      notice, ul)
  }

  // ================= 玩法 =================
  function showHelp(): void {
    openSlip(h('h2', {}, '玩法'),
      h('p', {}, `地圖是 1901 年的臺灣二十廳，加上後來的花蓮港廳，再把紅頭嶼（蘭嶼）分出來，共 ${map.regions.length} 區。選一區起家，把其他勢力都趕出去就贏了。`),
      h('ul', {},
        h('li', {}, `每一區上的數字是兵力。你的區會自己長兵，長到 ${RULES.cap.normal}（大城 ${RULES.cap.city}、砲台 ${RULES.cap.fort}）為止；中立的區不會長。`),
        h('li', {}, '從你的區拖到另一區，那一區的兵就全部派出去。也可以先點自己的區，再點目標。'),
        h('li', {}, '兵沿著相鄰的區走，會自己找路，拉線時看得到路線。路上第一個不是你的區，就是開打的地方。'),
        h('li', {}, `到了別人的區，兵會停在城外開打：雙方一個換一個，每秒各少 ${RULES.siegePerTick * TICKS_PER_SECOND} 個。守軍先打光，剩下的兵就進城佔領。`),
        h('li', {}, `進城也要排隊：增援自己的區、或剛打下來要進城，每秒進 ${RULES.enterPerTick * TICKS_PER_SECOND} 個，還在城外的兵會被敵軍打到。`),
        h('li', {}, `兩支不同陣營的軍隊在地圖上靠近了就會停下來打，不一定要走同一條路。一兵換一兵，每秒各少 ${RULES.clashPerTick * TICKS_PER_SECOND} 個；打完了，兵多的帶著剩下的繼續走。打的時候不能攻城，也進不了城。`),
        h('li', {}, `派兵後，那一區要等 ${RULES.cooldownTicks / TICKS_PER_SECOND} 秒才能再派。`),
        h('li', {}, '翻越中央山脈（棕色的山線）要花三倍時間。'),
        h('li', {}, '澎湖和紅頭嶼只能走虛線標出的航線。澎湖往臺北那一條長短相間的是險航線，跟翻山一樣要花三倍時間。')),
      h('h3', {}, '有特色的區'),
      h('p', { class: 'lead' }, '這些區的據點右上角有圖記，地圖左下角也有圖例。'),
      h('ul', { class: 'plain' }, ...SPECIALS.map((k) => h('li', {}, traitIcon(k), `${TRAITS[k]!.name}：${TRAITS[k]!.text}。`))),
      h('h3', {}, '誰是誰'),
      h('p', {}, ...[1, 2, 3, 4].flatMap((p) => [h('span', { class: 'who' }, sideIcon(p), sideName(p)), '　'])),
      h('p', { class: 'lead' }, '分區是用現在的鄉鎮界拼出來的，和當年的界線不完全一樣。'),
      h('p', { class: 'lead' }, '這個網站用 GoatCounter 統計造訪人數，以及開局、勝負、重播、分享開局的次數（連同難度、對手數、規則版本）。不用 cookie，不知道你是誰；對戰的內容和記錄只留在你的瀏覽器裡。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: closeSlip }, '知道了')))
  }

  // 網址帶著開局代碼就照它開；代碼看不懂的當作沒有
  const opening = decodeOpening(linkCode() ?? '')
  const shared = opening && openingConfig(map, opening)
  if (shared) showStart(shared.starts[0], shared)
  else showStart(-1, null, opening && opening.mapVersion !== map.version ? '這個網址是舊版地圖的開局，現在開不出一樣的局了。' : '')
}
