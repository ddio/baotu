// 把某個 commit 裡的規則引擎凍結成 src/sim/v<N>/，之後改規則，那一版的記錄還是能重播。
//
//   npm run freeze            凍結 HEAD 裡的那一版
//   npm run freeze -- <ref>   凍結指定 commit 裡的那一版（規則已經改完又 commit 了才想起來的時候）
//
// 讀的是 git 裡的檔案，不是工作目錄，所以已經動手改規則了也拿得到改之前的樣子。
// 凍結的檔案一字不改地複製過去，只在最前面加一行說明；之後不要再改它們。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/** 規則引擎的檔案。它們只能互相引用；哪天多引用了別的檔案，要加進這個清單。 */
const FILES = ['game.ts', 'graph.ts', 'rules.ts', 'types.ts']
const MARK = '  // freeze:insert'

const ref = process.argv[2] ?? 'HEAD'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const fail = (msg) => { console.error(msg); process.exit(1) }

const sha = git('rev-parse', '--short', ref).trim()
const source = Object.fromEntries(FILES.map((f) => [f, git('show', `${ref}:src/sim/${f}`)]))
const version = Number(/RULES_VERSION = (\d+)/.exec(source['rules.ts'])?.[1])
if (!Number.isInteger(version)) fail(`在 ${ref} 的 rules.ts 裡找不到 RULES_VERSION`)

const dir = `src/sim/v${version}`
if (existsSync(dir)) fail(`${dir} 已經有了：規則 v${version} 凍結過了`)

const allowed = new Set(FILES.map((f) => './' + f.replace(/\.ts$/, '')))
for (const f of FILES) {
  for (const [, from] of source[f].matchAll(/from '([^']+)'/g)) {
    if (!allowed.has(from)) fail(`${f} 引用了 ${from}，不在凍結清單裡。把它加進 tools/freeze.mjs 的 FILES 再跑一次`)
  }
}

const registry = 'src/sim/engines.ts'
const engines = readFileSync(registry, 'utf8')
if (!engines.includes(MARK)) fail(`${registry} 裡找不到「${MARK.trim()}」那一行`)

mkdirSync(dir)
for (const f of FILES) writeFileSync(`${dir}/${f}`, `// 凍結：規則 v${version}（取自 ${sha}）。只用來重播舊記錄，不要改。\n${source[f]}`)
writeFileSync(`${dir}/index.ts`, `// 規則 v${version} 的引擎，重播那一版的記錄時才會下載。
// 同一個資料夾裡其他檔案是凍結的；現在的畫面需要舊版沒有的東西時，在這裡轉接，不要去改它們。
import { makeEngine } from '../engine'
import { createGame, hashState, issue, step, totals } from './game'
import { buildGraph } from './graph'
import { RULES } from './rules'

export const engine = makeEngine(${version}, { RULES, buildGraph, createGame, issue, step, hashState, totals })
`)
writeFileSync(registry, engines.replace(MARK, `  ${version}: () => import('./v${version}'),\n${MARK}`))

console.log(`規則 v${version}（${sha}）凍結在 ${dir}/，已經登記到 ${registry}。`)
if (!existsSync(`tests/fixtures/records/v${version}.json`)) console.log(`注意：tests/fixtures/records/v${version}.json 不在，這一版沒有測試用的記錄。`)
console.log('接著：改規則、RULES_VERSION 加一，然後 npm run fixture 替新版存一筆記錄，再 npm test。')
