import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // 仅 GitHub Pages 部署时注入子路径（工作流设置 PAGES_BASE_PATH）；
    // 本地 dev/preview 与局域网服务器保持根路径，避免静态资源 404
    base: process.env.PAGES_BASE_PATH || '/',
    server: {
        port: 3000,
        host: '0.0.0.0',
        open: true,
        proxy: {
            '/socket.io': {
                target: 'http://127.0.0.1:8787',
                ws: true
            },
            '/api': {
                target: 'http://127.0.0.1:8787'
            }
        }
    }
})
