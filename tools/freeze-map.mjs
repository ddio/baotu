// 把某個 commit 裡的地圖留一份到 src/maps/old/，之後改地圖，那一版的記錄還是能重播。
//
//   npm run freeze:map            留下 HEAD 裡的那一版
//   npm run freeze:map -- <ref>   留下指定 commit 裡的那一版
//
// 跟 npm run freeze（規則引擎）是一對：改規則前凍結引擎，改地圖前凍結地圖。
// 讀的是 git 裡的檔案，不是工作目錄，所以已經重新產生地圖了也拿得到改之前的樣子。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const MAP = 'taiwan1901'
const MARK = '  // freeze-map:insert'

const ref = process.argv[2] ?? 'HEAD'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const fail = (msg) => { console.error(msg); process.exit(1) }

const sha = git('rev-parse', '--short', ref).trim()
const source = git('show', `${ref}:src/maps/${MAP}.json`)
const { id, version } = JSON.parse(source)
if (id !== MAP || !Number.isInteger(version)) fail(`${ref} 的 src/maps/${MAP}.json 看起來不對（id ${id}、version ${version}）`)

const file = `src/maps/old/${MAP}.v${version}.json`
if (existsSync(file)) fail(`${file} 已經有了：地圖 v${version} 留過了`)

const registry = 'src/maps/index.ts'
const index = readFileSync(registry, 'utf8')
if (!index.includes(MARK)) fail(`${registry} 裡找不到「${MARK.trim()}」那一行`)

mkdirSync('src/maps/old', { recursive: true })
writeFileSync(file, source)
writeFileSync(registry, index.replace(MARK, `  '${MAP}@${version}': () => import('./old/${MAP}.v${version}.json'),\n${MARK}`))

console.log(`地圖 v${version}（${sha}）留在 ${file}，已經登記到 ${registry}。之後不要再改它。`)
console.log('接著：改 tools/taiwan1901.config.mjs、MAP_VERSION 加一，npm run build:map，再 npm test。')
