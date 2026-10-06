import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installRenderQuality } from './core/render-quality'
import { installE2EBridge } from './testing/e2e-bridge'

// 渲染前先把画质档位写到 <html data-quality>，首帧就按目标画质绘制，
// 避免"先按桌面高清画一遍再降级"造成的二次全页重绘
installRenderQuality()
installE2EBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
