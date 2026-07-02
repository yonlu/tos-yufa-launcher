import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// @yufa/shared is TypeScript source and must be bundled, not externalized;
// zod/semver ride along so the packaged app has no hoisting surprises.
const bundled = { exclude: ['@yufa/shared', 'zod', 'semver'] }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(bundled)],
  },
  preload: {
    plugins: [externalizeDepsPlugin(bundled)],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
