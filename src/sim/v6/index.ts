// 規則 v6 的引擎，重播那一版的記錄時才會下載。
// 同一個資料夾裡其他檔案是凍結的；現在的畫面需要舊版沒有的東西時，在這裡轉接，不要去改它們。
import { makeEngine } from '../engine'
import { createGame, hashState, issue, step, totals } from './game'
import { buildGraph } from './graph'
import { RULES } from './rules'

export const engine = makeEngine(6, { RULES, buildGraph, createGame, issue, step, hashState, totals })
