import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 用相對路徑，放在子目錄或自訂網域都能跑
  base: './',
  build: { target: 'es2022' },
  test: {
    // npm run balance、duel、starts 會改跑 tools/ 底下的（調數值用，不算在測試裡）
    include: process.env.TOOL ? [`tools/${process.env.TOOL}.ts`] : ['tests/**/*.test.ts'],
  },
})
