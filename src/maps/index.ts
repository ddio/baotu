import type { MapData } from '../sim/types'
import taiwan1901 from './taiwan1901.json'

/** 目前所有的地圖。之後加分區地圖（鄉鎮市）就是在這裡多一筆。 */
export const MAPS: Record<string, MapData> = {
  taiwan1901: taiwan1901 as unknown as MapData,
}
export const DEFAULT_MAP = 'taiwan1901'

/**
 * 改版前的地圖（src/maps/old/），只用來重播當時的記錄，要重播時才下載。
 * 改地圖之前先跑 npm run freeze:map，把現在這一版留下來。
 */
const OLD: Record<string, () => Promise<{ default: unknown }>> = {
  'taiwan1901@1': () => import('./old/taiwan1901.v1.json'),
  // freeze-map:insert（npm run freeze:map 會在這一行上面加一筆，不要改這行）
}
const key = (id: string, version: number) => `${id}@${version}`

/** 這張地圖的這一版還在不在：現行的，或留著的舊版 */
export const hasMap = (id: string, version: number): boolean =>
  MAPS[id]?.version === version || Object.hasOwn(OLD, key(id, version))

/** 拿某一版的地圖。沒有這一版回傳 null；舊版要下載，下載失敗會丟出例外。 */
export async function loadMap(id: string, version: number): Promise<MapData | null> {
  if (MAPS[id]?.version === version) return MAPS[id]
  if (!Object.hasOwn(OLD, key(id, version))) return null
  return (await OLD[key(id, version)]()).default as MapData
}
