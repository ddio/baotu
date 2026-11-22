import { defineConfig } from 'vite'

// 純靜態網站：build 出來的 dist/ 直接放到 GitHub Pages（baotu.ddio.io）
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
})
