import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 1. THIS IS THE MOST COMMON FIX FOR BLANK SCREENS
  base: './', 
  build: {
    outDir: 'dist',
    rollupOptions: {
      // 2. Ensure node-pty is external so Vite doesn't try to bundle it
      external: ['node-pty', 'fs', 'path', 'os'], 
    },
  },
})