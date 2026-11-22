// 各個畫面：開局、對戰、結束、記錄、重播。地圖只有一張，畫面之間換的是上下兩列與蓋在上面的紙片。
import { DEFAULT_MAP, MAPS } from '../maps'
import type { Difficulty } from '../sim/ai'
import { canSend, createGame, forecast, sendAmount } from '../sim/game'
import { legTicks, reach, route, stopIndex } from '../sim/graph'
import { Match } from '../sim/match'
import { addRecord, type GameRecord, makeRecord, MAX_RECORDS, parseRecord, playable, Replay, type Result } from '../sim/record'
import { RULES, TICKS_PER_SECOND } from '../sim/rules'
import { pickStarts } from '../sim/setup'
import type { GameState } from '../sim/types'
import { forceChart } from './chart'
import { clock, h } from './dom'
import { type Marks, MapView } from './mapview'
import { loadPrefs, loadRecords, savePrefs, saveRecords } from './store'
import { DIFFICULTY, sideIcon, sideName, SIDES, SPECIALS, traitIcon, TRAITS } from './theme'

const ME = 1
const TICK_MS = 1000 / TICKS_PER_SECOND
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard']
const RESULT: Record<Result, string> = { win: '勝', lose: '敗', quit: '放棄' }

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1
const noMarks = (me = 0): Marks => ({ me, selected: -1, targets: null, hover: -1, picked: -1, stop: -1 })

export function startApp(root: HTMLElement): void {
  const map = MAPS[DEFAULT_MAP]
  const view = new MapView(map)
  const bar = h('header', { class: 'bar' })
  const stage = h('main', { class: 'stage' }, view.svg)
  const panel = h('footer', { class: 'panel' })
  root.append(bar, stage, panel)

  /** 離開目前畫面時要做的收尾（停掉動畫、拿掉事件） */
  let leave: (() => void) | null = null
  let atStart = false
  const enter = (cleanup: () => void, start = false) => { leave?.(); leave = cleanup; atStart = start }

  // ---- 蓋在上面的紙片 ----
  let veil: HTMLElement | null = null
  const closeSlip = () => { veil?.remove(); veil = null }
  const openSlip = (...kids: (Node | string)[]) => {
    closeSlip()
    const slip = h('div', { class: 'slip', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, ...kids)
    veil = h('div', { class: 'veil' }, slip)
    root.append(veil)
    slip.focus()
  }

  const regionText = (i: number, state: GameState): [string, string] => {
    const r = map.regions[i], st = state.regions[i], t = TRAITS[r.trait]
    const owner = st.owner === 0 ? '中立' : sideName(st.owner)
    return [`${r.name}廳　${owner}　${st.units} 兵`, `${t ? `【${t.name}】${t.text}。` : ''}今${r.today}。`]
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
    const update = (state: GameState) => {
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

  // ================= 開局 =================
  function showStart(picked = -1): void {
    closeSlip()
    const ac = new AbortController()
    enter(() => ac.abort(), true)
    const prefs = loadPrefs()
    const state = createGame(map, { players: 0, starts: [] })
    const head = h('div', { class: 'head' }), body = h('div', { class: 'body' })
    const go = h('button', { class: 'primary go', onclick: () => startGame(picked, prefs.opponents, prefs.difficulty) }, '開始')

    const choice = <T,>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
      const buttons = options.map(([v, text]) => h('button', { type: 'button', onclick: () => { set(v); savePrefs(prefs); sync() } }, text))
      const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === get())))
      sync()
      return h('span', { class: 'field' }, label, h('span', { class: 'choice', role: 'group', 'aria-label': label }, ...buttons))
    }
    const draw = () => {
      view.render(state, 0, { ...noMarks(), picked })
      if (picked < 0) {
        head.textContent = '選一個廳起家'
        body.textContent = '點地圖上的任何一區。把其他勢力都趕出去，全島歸你就贏了。'
      } else {
        const [, detail] = regionText(picked, state)
        head.textContent = `從${map.regions[picked].name}廳起家`
        body.textContent = detail
      }
      go.disabled = picked < 0
    }
    view.svg.addEventListener('pointerdown', (e) => {
      const r = view.regionAt(e.clientX, e.clientY)
      if (r >= 0) { picked = r; draw() }
    }, { signal: ac.signal })

    bar.replaceChildren(h('h1', {}, '堡圖'), h('span', { class: 'grow' }),
      h('button', { class: 'small', onclick: showHelp }, '玩法'),
      h('button', { class: 'small', onclick: () => showRecords() }, '記錄'))
    panel.replaceChildren(head, body, h('div', { class: 'row' },
      choice('對手', [[2, '2 家'], [3, '3 家']], () => prefs.opponents, (v) => { prefs.opponents = v }),
      choice('難度', LEVELS.map((l) => [l, DIFFICULTY[l]] as [Difficulty, string]), () => prefs.difficulty, (v) => { prefs.difficulty = v }),
      go))
    draw()
  }

  function startGame(start: number, opponents: number, difficulty: Difficulty): void {
    const seed = newSeed(), players = opponents + 1
    play(new Match(map, { players, starts: pickStarts(map, start, players, seed), human: ME, difficulty, seed }))
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
      let ticks = 0, ridge = false
      for (let i = 0; i < stop; i++) {
        ticks += legTicks(graph, path[i], path[i + 1], fast)
        if (graph.links[path[i]].find((l) => l.to === path[i + 1])?.kind === 'mountain') ridge = true
      }
      return { path, stop, at: path[stop], ticks, ridge }
    }

    const orderText = (from: number, to: number): [string, string] => {
      const p = plan(from, to)
      const a = map.regions[from], b = map.regions[to], target = state.regions[p.at]
      const n = sendAmount(state.regions[from].units)
      const secs = Math.max(1, Math.round(p.ticks / TICKS_PER_SECOND))
      const trip = `約 ${secs} 秒到${p.ridge ? '（要翻山）' : ''}`
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
      openSlip(h('h2', {}, '暫停'),
        h('p', { class: 'lead' }, `已經打了 ${clock(state.tick / TICKS_PER_SECOND)}。`),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: resume }, '繼續'),
          h('button', { onclick: () => { finish('quit'); startGame(config.starts[0], config.players - 1, config.difficulty) } }, '重來'),
          h('button', { onclick: () => { finish('quit'); showStart(config.starts[0]) } }, '回主畫面')))
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause() }, opt)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') { if (paused) resume(); else pause() }
    }, opt)

    // ---- 結束 ----
    let saved = true
    const finish = (result: Result): GameRecord | null => {
      ended = true
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
      const startName = map.regions[config.starts[0]].name
      openSlip(
        h('h2', {}, result === 'win' ? '全島底定' : '領地盡失'),
        h('p', { class: 'lead' }, `從${startName}廳起家，對 ${config.players - 1} 家，難度${DIFFICULTY[config.difficulty]}，打了 ${clock(state.tick / TICKS_PER_SECOND)}。`),
        forceChart(match.history, config.players),
        saved ? '' : h('p', { class: 'notice' }, '這一局沒能存進瀏覽器（空間不足或儲存被停用），關掉分頁就看不到了。'),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: () => startGame(config.starts[0], config.players - 1, config.difficulty) }, '再來一局'),
          h('button', { onclick: () => showStart() }, '換個起點'),
          h('button', { onclick: () => showReplay(rec) }, '看重播')))
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
  function showReplay(rec: GameRecord): void {
    closeSlip()
    const replay = new Replay(rec, map)
    const ac = new AbortController()
    let raf = 0, last = performance.now(), acc = 0, playing = true, speed = 2
    enter(() => { ac.abort(); cancelAnimationFrame(raf) })

    const forces = forcesBar(rec.config.players)
    bar.replaceChildren(forces.el, h('button', { class: 'small', onclick: () => showRecords() }, '離開重播'))
    const total = rec.ticks
    const toggle = h('button', { class: 'small', onclick: () => {
      if (replay.done) replay.seek(0)
      playing = !playing
      sync()
    } })
    const speedBtn = h('button', { class: 'small digits', 'aria-label': '切換速度', onclick: () => { speed = speed >= 8 ? 1 : speed * 2; speedBtn.textContent = speed + '×' } }, speed + '×')
    const slider = h('input', { type: 'range', min: '0', max: String(total), step: '1', 'aria-label': '時間軸' })
    const time = h('span', { class: 'digits' })
    slider.addEventListener('input', () => { playing = false; replay.seek(Number(slider.value)); acc = 0; sync() })
    const startName = map.regions[rec.config.starts[0]].name
    panel.replaceChildren(
      h('div', { class: 'body' }, `${when(rec)}　從${startName}廳起家，${RESULT[rec.result]}。${replay.faithful ? '' : '這筆記錄用現在的規則跑出來的結果和當時不一樣。'}`),
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
        const ok = playable(rec, MAPS)
        const start = MAPS[rec.map]?.regions[rec.config.starts[0]]?.name ?? '？'
        const del = h('button', { class: 'small', onclick: () => {
          if (del.dataset.armed) { list = list.filter((r) => r.id !== rec.id); saveRecords(list); draw(); return }
          del.dataset.armed = '1'
          del.textContent = '確定刪除'
          del.classList.add('danger')
        } }, '刪除')
        return h('li', {},
          h('div', { class: 'what' }, `${RESULT[rec.result]}　${start}廳起家，對 ${rec.config.players - 1} 家，難度${DIFFICULTY[rec.config.difficulty]}`),
          h('div', { class: 'when digits' }, `${when(rec)}　打了 ${clock(rec.ticks / TICKS_PER_SECOND)}${ok ? '' : '　規則或地圖已改版，不能重播'}`),
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
      h('p', {}, '地圖是 1901 年的臺灣二十廳，加上後來的花蓮港廳，共 21 區。選一區起家，把其他勢力都趕出去就贏了。'),
      h('ul', {},
        h('li', {}, `每一區上的數字是兵力。你的區會自己長兵，長到 ${RULES.cap.normal}（大城 ${RULES.cap.city}、砲台 ${RULES.cap.fort}）為止；中立的區不會長。`),
        h('li', {}, '從你的區拖到另一區，那一區的兵就全部派出去。也可以先點自己的區，再點目標。'),
        h('li', {}, '兵沿著相鄰的區走，會自己找路，拉線時看得到路線。路上第一個不是你的區，就是開打的地方。'),
        h('li', {}, `到了別人的區，兵會停在城外開打：雙方一個換一個，每秒各少 ${RULES.siegePerTick * TICKS_PER_SECOND} 個。守軍先打光，剩下的兵就進城佔領。`),
        h('li', {}, `進城也要排隊：增援自己的區、或剛打下來要進城，每秒進 ${RULES.enterPerTick * TICKS_PER_SECOND} 個，還在城外的兵會被敵軍打到。`),
        h('li', {}, '兩支不同陣營的軍隊在地圖上靠近了就會打起來，不一定要走同一條路。一兵換一兵，兵多的帶著剩下的繼續走。'),
        h('li', {}, `派兵後，那一區要等 ${RULES.cooldownTicks / TICKS_PER_SECOND} 秒才能再派。`),
        h('li', {}, '翻越中央山脈（棕色的山線）要花三倍時間；澎湖只能走虛線標出的三條航線。')),
      h('h3', {}, '有特色的區'),
      h('p', { class: 'lead' }, '這些區的據點右上角有圖記，地圖左下角也有圖例。'),
      h('ul', { class: 'plain' }, ...SPECIALS.map((k) => h('li', {}, traitIcon(k), `${TRAITS[k]!.name}：${TRAITS[k]!.text}。`))),
      h('h3', {}, '誰是誰'),
      h('p', {}, ...[1, 2, 3, 4].flatMap((p) => [h('span', { class: 'who' }, sideIcon(p), sideName(p)), '　'])),
      h('p', { class: 'lead' }, '分區是用現在的鄉鎮界拼出來的，和當年的界線不完全一樣。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: closeSlip }, '知道了')))
  }

  showStart()
}
