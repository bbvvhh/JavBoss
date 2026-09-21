import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 代理目标可用 JAVBOSS_PROXY_TARGET 覆盖，方便对着 mock 服务调 UI。
const backendProxy = () => ({
  target: process.env.JAVBOSS_PROXY_TARGET || 'http://localhost:17654',
  changeOrigin: false,
})

// 生产环境由 Go 后端挂在 /m/ 下，dev server 保持同样的 base，避免路径行为不一致。
// https://vitejs.dev/config/
export default defineConfig({
  base: '/m/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/healthz': backendProxy(),
      '/auth': backendProxy(),
      '/videos': backendProxy(),
      '/subtitles': backendProxy(),
      '/tags': backendProxy(),
      '/sync': backendProxy(),
      '/directories': backendProxy(),
      '/storage': backendProxy(),
      '/downloader': backendProxy(),
      '/downloads': backendProxy(),
      '/extension': backendProxy(),
      '/jav': backendProxy(),
      '/config': backendProxy(),
      '/tools': backendProxy(),
    },
  },
})
