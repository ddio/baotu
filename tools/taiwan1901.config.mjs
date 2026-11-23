// 1901 年二十廳＋1909 年花蓮港廳，再把紅頭嶼（蘭嶼）從臺東分出來：以現代鄉鎮歸併的對照表。
// 依據與推定的地方見 README「地圖與出處」。
const W = (s) => s.split(/\s+/).filter(Boolean)

export const MAP_ID = 'taiwan1901'
export const MAP_NAME = '臺灣二十廳（1901）'
// 改這個檔之前先 npm run freeze:map 把現在這一版留下來，改完版本加一
export const MAP_VERSION = 3

// 每區：id、名稱、今天大致是哪裡、特色、據點經緯度（約在廳治，太擠的地方挪開）
// towns：{ 縣市: [鄉鎮…] }，'*' 表示該縣市沒有被別區點名的其餘鄉鎮
// 新的區只能加在最後面：記錄裡存的是區的編號
export const REGIONS = [
  { id: 'taipei', name: '臺北', today: '臺北市、板橋、新莊、淡水一帶', trait: 'city', node: [121.47, 25.1],
    towns: { 台北市: W('大安區 信義區 萬華區 中正區 南港區 松山區 大同區 中山區 內湖區 士林區 北投區'),
      新北市: W('永和區 中和區 板橋區 土城區 新莊區 泰山區 五股區 蘆洲區 三重區 林口區 八里區 淡水區 三芝區 石門區') } },
  { id: 'keelung', name: '基隆', today: '基隆市、汐止、瑞芳、金山、貢寮一帶', trait: 'fort', node: [121.8, 25.11],
    towns: { 基隆市: ['*'], 新北市: W('汐止區 金山區 萬里區 瑞芳區 平溪區 雙溪區 貢寮區') } },
  { id: 'shenkeng', name: '深坑', today: '文山、新店、深坑、石碇、坪林一帶', trait: 'none', node: [121.64, 24.9],
    towns: { 台北市: ['文山區'], 新北市: W('新店區 深坑區 石碇區 坪林區 烏來區') } },
  { id: 'yilan', name: '宜蘭', today: '宜蘭縣', trait: 'none', node: [121.7, 24.62], towns: { 宜蘭縣: ['*'] } },
  { id: 'taoyuan', name: '桃仔園', today: '桃園市，加三峽、鶯歌、樹林、關西', trait: 'none', node: [121.27, 24.93],
    towns: { 桃園市: ['*'], 新竹縣: ['關西鎮'], 新北市: W('三峽區 鶯歌區 樹林區') } },
  { id: 'hsinchu', name: '新竹', today: '新竹縣市，加竹南、頭份、南庄', trait: 'post', node: [121.03, 24.74],
    towns: { 新竹市: ['*'], 新竹縣: ['*'], 苗栗縣: W('竹南鎮 頭份市 三灣鄉 南庄鄉') } },
  { id: 'miaoli', name: '苗栗', today: '苗栗縣南半，加大甲、后里', trait: 'none', node: [120.83, 24.48],
    towns: { 苗栗縣: ['*'], 台中市: W('大甲區 大安區 外埔區 后里區') } },
  { id: 'taichung', name: '臺中', today: '臺中市（大甲溪以南）', trait: 'city', node: [120.72, 24.17], towns: { 台中市: ['*'] } },
  { id: 'changhua', name: '彰化', today: '彰化縣', trait: 'granary', node: [120.52, 23.96], towns: { 彰化縣: ['*'] } },
  { id: 'nantou', name: '南投', today: '南投縣（不含竹山、鹿谷）', trait: 'none', node: [120.9, 23.88], towns: { 南投縣: ['*'] } },
  { id: 'douliu', name: '斗六', today: '雲林縣，加竹山、鹿谷', trait: 'none', node: [120.5, 23.7],
    towns: { 雲林縣: ['*'], 南投縣: W('竹山鎮 鹿谷鄉') } },
  { id: 'chiayi', name: '嘉義', today: '嘉義縣市（不含布袋、義竹）', trait: 'post', node: [120.52, 23.45],
    towns: { 嘉義市: ['*'], 嘉義縣: ['*'] } },
  { id: 'yanshui', name: '鹽水港', today: '布袋、新營、白河、麻豆、佳里一帶', trait: 'granary', node: [120.27, 23.27],
    towns: { 嘉義縣: W('布袋鎮 義竹鄉 鹿草鄉'),
      台南市: W('鹽水區 新營區 柳營區 後壁區 白河區 東山區 麻豆區 下營區 六甲區 官田區 佳里區 學甲區 將軍區 北門區 七股區 西港區') } },
  { id: 'tainan', name: '臺南', today: '臺南市區、善化、新化、玉井一帶', trait: 'city', node: [120.27, 23.02], towns: { 台南市: ['*'] } },
  { id: 'fanshuliao', name: '蕃薯藔', today: '旗山、美濃、甲仙、六龜一帶', trait: 'none', node: [120.55, 22.93],
    towns: { 高雄市: W('旗山區 美濃區 內門區 杉林區 甲仙區 六龜區 田寮區 茂林區 桃源區 那瑪夏區') } },
  { id: 'fengshan', name: '鳳山', today: '高雄市區、鳳山、岡山一帶', trait: 'fort', node: [120.33, 22.67], towns: { 高雄市: ['*'] } },
  { id: 'ahou', name: '阿猴', today: '屏東平原（不含恆春半島）', trait: 'granary', node: [120.59, 22.57], towns: { 屏東縣: ['*'] } },
  { id: 'hengchun', name: '恆春', today: '恆春半島', trait: 'none', node: [120.77, 22.07],
    towns: { 屏東縣: W('恆春鎮 車城鄉 滿州鄉 枋山鄉 牡丹鄉 獅子鄉') } },
  { id: 'taitung', name: '臺東', today: '臺東縣', trait: 'post', node: [121.1, 22.8], towns: { 台東縣: ['*'] } },
  { id: 'hualien', name: '花蓮港', today: '花蓮縣', trait: 'none', node: [121.5, 23.83], towns: { 花蓮縣: ['*'] } },
  { id: 'penghu', name: '澎湖', today: '澎湖縣', trait: 'fort', node: [119.6, 23.58], towns: { 澎湖縣: ['*'] } },
  // 日治時期屬臺東廳，獨立成一區是遊戲的改編。島照實際大小畫，比據點的圖記還小；綠島（火燒島）留在臺東
  { id: 'hongtou', name: '紅頭嶼', today: '蘭嶼', trait: 'none', node: [121.55, 22.045], towns: { 台東縣: ['蘭嶼鄉'] } },
]

// 翻越中央山脈的連線一律是山路
export const MOUNTAIN = [
  ['taichung', 'hsinchu'], ['nantou', 'fanshuliao'], ['hualien', 'taichung'], ['hualien', 'fanshuliao'],
  ['yilan', 'hsinchu'], ['yilan', 'taichung'], ['yilan', 'taoyuan'],
  ['hualien', 'nantou'], ['taitung', 'fanshuliao'], ['taitung', 'ahou'],
]
// 航線：兩個據點之間的直線
export const SEA = [
  ['penghu', 'yanshui'], ['penghu', 'tainan'], ['penghu', 'fengshan'],
  ['hongtou', 'taitung'], ['hongtou', 'hengchun'],
]
// 險航線：走得比一般航線慢（倍數在 src/sim/rules.ts 的 roughFactor）。
// via 是從 ends[0] 到 ends[1] 中間依序經過的經緯度，產生地圖時會接成一條平滑的線。
// 澎湖—臺北：沿著西海岸外海往北，從淡水河口進臺北。這條是遊戲加的，不是照哪一條實際的定期航線。
export const ROUGH = [
  { ends: ['penghu', 'taipei'], via: [[120.2, 24.0], [120.47, 24.45], [120.78, 24.85], [121.05, 25.12], [121.36, 25.2]] },
]
// 轉彎的路：兩個據點的直線會從第三個據點旁邊擦過去的，改成繞開。
// 軍隊在圖上靠近就會打起來（RULES.clashRange），直線擦過別人的城門口，路過的會跟在那裡圍城、進城的打起來。
// via 的寫法跟險航線一樣。行軍時間仍然照兩個據點的直線距離算，繞路只改走在圖上的哪裡。
export const BEND = [
  // 新竹—臺中的山路：直線從苗栗城外 14 單位穿過去。改走內山（今天的五峰、泰安一帶），從苗栗東邊繞
  { ends: ['hsinchu', 'taichung'], via: [[121.13, 24.46]] },
  // 基隆—宜蘭：直線擦過深坑。改沿東北角海岸（貢寮、頭城）走
  { ends: ['keelung', 'yilan'], via: [[121.86, 25.0], [121.8, 24.76]] },
  // 嘉義—臺南：直線擦過鹽水港。改走東邊的山腳（大埔、玉井一帶）
  { ends: ['chiayi', 'tainan'], via: [[120.51, 23.2]] },
  // 鳳山—澎湖的航線：直線擦過臺南。改從外海繞
  { ends: ['fengshan', 'penghu'], via: [[120.0, 22.95]] },
  // 下面四條離別的據點本身夠遠，但會擦到在那個據點城外紮營的軍隊（城外是離據點 28 單位的地方），所以只彎一點點
  { ends: ['tainan', 'penghu'], via: [[119.95, 23.2]] },
  { ends: ['nantou', 'chiayi'], via: [[120.78, 23.64]] },
  { ends: ['shenkeng', 'taoyuan'], via: [[121.45, 24.87]] },
  { ends: ['yilan', 'taoyuan'], via: [[121.47, 24.74]] },
]
// 產生地圖時檢查：連線離別的據點比這個數近就列出來（遭遇的距離是 36）
export const CLEAR = 45

// 畫面：澎湖往本島靠近（經度），好讓直式手機放得下
export const SHIFT = { penghu: [0.25, 0] }
export const BBOX = { lon0: 119.5, lon1: 122.06, lat0: 21.86, lat1: 25.34 }
export const HEIGHT = 1000
// 簡化：保留多少比例的邊界點；小於這個面積（平方公里）的小島不畫
export const KEEP_POINTS = 0.2
export const MIN_ISLAND_KM2 = 0.5
