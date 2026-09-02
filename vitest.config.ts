import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/types') }
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // UI のテストだけ jsdom で動かす。engine 系は実ブラウザを使うので node のまま
    environmentMatchGlobs: [['tests/**/*.test.tsx', 'jsdom']],
    environment: 'node'
  }
})
