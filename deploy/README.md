# 部署到阿里云（域名 + nginx + HTTPS）

形态：`server/server.js` 一个进程同时提供 **构建后的页面 + `/api` + Socket.IO**，只监听
`127.0.0.1:8787`；nginx 反代 80/443。前端在生产环境连的是 `window.location.origin`，
所以**不需要**配 `VITE_SERVER_URL`，也不用单独开第二个端口。

---

## 0. 先确认三件事（阿里云控制台）

| 项目 | 要求 |
| --- | --- |
| 安全组 | 入方向放行 `80/tcp`、`443/tcp`（`22` 按你习惯）。`8787` **不用**对外开，Node 只听 127.0.0.1 |
| 域名解析 | 一条 A 记录指向服务器公网 IP。**国内节点走 80/443 需要 ICP 备案**，没备案就先用 `http://IP:8787`（把 `HOST=0.0.0.0` 并放行 8787） |
| 系统 | Alibaba Cloud Linux / CentOS 与 Ubuntu/Debian 都可用；脚本会自动处理 SELinux |

## 1. 装 Node 18+（服务器上）

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs nginx
# Alibaba Cloud Linux / CentOS
sudo yum install -y nodejs nginx   # 版本不够时用 nodesource 的 rpm 源
node -v   # 需要 >= 18
```

## 2. 首次部署（在项目根目录的这份代码里跑）

把仓库推到 GitHub 后，在服务器上：

```bash
sudo git clone https://github.com/xiazhiyingguang/liuzizhanqi.git /opt/six-chess-battle
sudo bash /opt/six-chess-battle/deploy/deploy.sh install --domain games.example.com
# CentOS/Alibaba Cloud Linux 上 nginx 的运行用户通常叫 nginx：
#   sudo RUN_USER=nginx bash /opt/six-chess-battle/deploy/deploy.sh install --domain 域名
```

脚本做的事：`npm ci` → `npm run build`（产出 `dist/`）→ 装 `server/` 依赖 →
写 systemd 单元 `six-chess` 并开机自启 → 健康检查 `/api/health` → 写
`/etc/nginx/conf.d/six-chess.conf`（含 WebSocket upgrade 头）→ SELinux 放行反代。

## 3. 签 HTTPS 证书

```bash
sudo certbot --nginx -d games.example.com    # 选 Redirect，自动把上面的站点改成 443
```

## 4. 验证（三条都过才算通）

```bash
curl -fsS http://127.0.0.1:8787/api/health          # Node 自己活着
curl -fsS "https://games.example.com/socket.io/?EIO=4&transport=polling" | head -c 60
#   ↑ 返回 0{"sid":"..."} 才说明 nginx → Node 整条链通了
sudo bash /opt/six-chess-battle/deploy/deploy.sh status
```

浏览器打开域名，两台设备进联机模式互相建房，能同步即成功。
若页面能开但联机不动，几乎一定是 nginx 少了 `Upgrade/Connection` 两行（Socket.IO 退回长轮询）。

## 5. 以后更新

```bash
sudo bash /opt/six-chess-battle/deploy/deploy.sh update
```

`update` 会先查 `/api/rooms`，**有活跃房间时会停下来问你是否继续**（房间只存在内存里，
重启即清空）。确定没人正在打，或者你想强推：`FORCE=1 sudo bash deploy/deploy.sh update`。

## 6. 回滚

```bash
cd /opt/six-chess-battle && git log --oneline -5
sudo git checkout <上一个好版本> && sudo bash deploy/deploy.sh update
```

---

## 已知边界

- **房间是内存态**（`server.js` 里 `rooms = new Map()`）：进程重启 = 全部对局丢失；断线即关房；
  一小时无操作的房间自动清理。要长期运营就得加持久化（Redis/DB），那是另一件事。
- **单进程**：Socket.IO 没配 Redis adapter，别用 `pm2 -i max` 之类的多实例，会把同一房间的两个
  玩家分到不同进程上。
- 音效/立绘都在 `public/` 里随 `dist/` 一起发布，无需额外对象存储。
- `server/Dockerfile` 是历史遗留（`EXPOSE 4000`、不构建前端），本方案不使用它。
