import type { MapData } from '../sim/types'
import taiwan1901 from './taiwan1901.json'

/** 目前所有的地圖。之後加分區地圖（鄉鎮市）就是在這裡多一筆。 */
export const MAPS: Record<string, MapData> = {
  taiwan1901: taiwan1901 as MapData,
}
export const DEFAULT_MAP = 'taiwan1901'
