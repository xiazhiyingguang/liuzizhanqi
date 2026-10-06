# 抽卡演出（已停用）

此功能按用户要求从游戏中停用。主菜单不再导入或渲染 `HeroSummon`，因此其组件、样式、图片预加载和音效播放不会进入游戏运行路径。

源码、抽卡 WebP、音效及生成脚本继续保留，便于以后单独复用。

- 页面和特效：本目录中的 `HeroSummon.tsx`、`hero-summon.css`。
- 图片加载：`summon-images.ts`、`src/data/summon-image-manifest.ts`。
- 音效：`src/audio/summon-audio.ts`、`public/sounds/summon/`。
- 轻量立绘：`public/hero-images/summon/`。
- 生成脚本：`scripts/generate-summon-sounds.mjs`、`scripts/optimize-summon-images.py`。
- 历史浏览器验证：`scripts/e2e/summon-check.mjs`；该脚本依赖已移除的菜单入口，仅在重新接入功能后使用。
