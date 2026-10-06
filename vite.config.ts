import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 游戏模式（start.bat 默认）：关掉 HMR 推送。
// 改代码不再把正在玩的一局刷掉——store/core/data 这类模块没有 HMR accept 边界，
// Vite 只会发 full-reload，Zustand 里的对局状态随之丢失。
// 代价是改动不自动生效，需要手动 F5；实测 vite 5.4 在 hmr:false 下每次请求都重新
// transform，所以 F5 拿到的仍是最新代码。要热更新就跑 `start.bat dev`。
// trim 是必需的：start.bat 里 `set GAME_MODE=1 && ...` 会把值设成 "1 "（带尾空格）
const gameMode = (process.env.GAME_MODE ?? '').trim() === '1'

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
        hmr: !gameMode,
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
