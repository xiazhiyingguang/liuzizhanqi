# 六子战棋 (Six Chess Battle)

双人回合制策略战棋游戏

## 游戏规则

- 6×6棋盘
- 每方选择4个英雄
- 回合制轮流释放技能
- 消灭对方全部英雄获胜

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 构建并启动局域网联机（网页与联机服务使用同一网址）
npm run lan
```

局域网联机的完整步骤见 [ONLINE_GUIDE.md](./ONLINE_GUIDE.md)。

## 技术栈

- React 18
- TypeScript
- Vite
- Zustand (状态管理)
- Tailwind CSS
