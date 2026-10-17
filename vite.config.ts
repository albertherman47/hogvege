import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import invoiceOcrPlugin from './server/invoice-ocr.mjs'

export default defineConfig(({ mode }) => ({
  plugins: [react(), invoiceOcrPlugin(loadEnv(mode, process.cwd(), ''))],
}))
