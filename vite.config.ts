import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // GitHub Pages 子路径托管（https://<owner>.github.io/liuzizhanqi/）
    base: '/liuzizhanqi/',
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
