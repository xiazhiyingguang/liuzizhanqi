#!/usr/bin/env bash
# 六子战棋 · 服务器部署脚本（在阿里云主机上执行，需要 root 或可用 sudo）
#
#   首次： sudo bash deploy/deploy.sh install --domain games.example.com
#   更新： sudo bash deploy/deploy.sh update
#   状态： sudo bash deploy/deploy.sh status
#
# 形态：Node 只监听 127.0.0.1:8787（页面 + /api + Socket.IO 同一个端口），
#       nginx 反代 80，HTTPS 交给 certbot 自己补（见 README 第 4 步）。
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/six-chess-battle}
REPO=${REPO:-https://github.com/xiazhiyingguang/liuzizhanqi.git}
SERVICE=${SERVICE:-six-chess}
PORT=${PORT:-8787}
HOST=${HOST:-127.0.0.1}
DOMAIN=${DOMAIN:-}
RUN_USER=${RUN_USER:-www-data}
NODE_MIN=18

COMMAND=${1:-help}
shift || true
for arg in "$@"; do
    case "$arg" in
        --domain=*) DOMAIN="${arg#*=}" ;;
        --port=*) PORT="${arg#*=}" ;;
        --app-dir=*) APP_DIR="${arg#*=}" ;;
        --repo=*) REPO="${arg#*=}" ;;
        *) echo "忽略未知参数：$arg" >&2 ;;
    esac
done

log() { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

health_url() { echo "http://${HOST}:${PORT}/api/health"; }

wait_healthy() {
    for _ in $(seq 1 20); do
        if curl -fsS "$(health_url)" >/dev/null 2>&1; then return 0; fi
        sleep 0.5
    done
    return 1
}

preflight() {
    command -v git >/dev/null || die "缺 git：先 yum install -y git 或 apt-get install -y git"
    command -v curl >/dev/null || die "缺 curl"
    command -v node >/dev/null || die "缺 Node：请先装 Node ${NODE_MIN}+（见 deploy/README.md 第 1 步）"
    local major
    major=$(node -p 'process.versions.node.split(".")[0]')
    [ "$major" -ge "$NODE_MIN" ] || die "Node 版本过低（当前 $(node -v)），需要 ${NODE_MIN}+"
    id "$RUN_USER" >/dev/null 2>&1 || die "运行用户 $RUN_USER 不存在（可用 RUN_USER=root 覆盖）"
}

fetch_code() {
    if [ -d "$APP_DIR/.git" ]; then
        log "拉取最新代码：$APP_DIR"
        git -C "$APP_DIR" fetch --tags origin
        git -C "$APP_DIR" pull --ff-only
    else
        log "克隆仓库到 $APP_DIR"
        mkdir -p "$(dirname "$APP_DIR")"
        git clone "$REPO" "$APP_DIR"
    fi
}

build_app() {
    log "安装依赖并构建前端（dist/）"
    npm --prefix "$APP_DIR" ci
    npm --prefix "$APP_DIR" run build
    log "安装联机服务依赖"
    npm --prefix "$APP_DIR/server" ci --omit=dev
    [ -f "$APP_DIR/dist/index.html" ] || die "构建产物缺失：$APP_DIR/dist/index.html"
}

write_service() {
    log "写入 systemd 单元 /etc/systemd/system/${SERVICE}.service"
    cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=六子战棋（页面 + Socket.IO 联机服务）
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/server
Environment=HOST=${HOST}
Environment=PORT=${PORT}
Environment=NODE_ENV=production
ExecStart=$(command -v node) ${APP_DIR}/server/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable "$SERVICE" >/dev/null 2>&1 || true
}

write_nginx() {
    [ -n "$DOMAIN" ] || { log "未给 --domain，跳过 nginx 配置"; return; }
    command -v nginx >/dev/null || die "要用域名需要先装 nginx（apt-get install -y nginx / yum install -y nginx）"
    log "写入 /etc/nginx/conf.d/${SERVICE}.conf（HTTP 反代，HTTPS 交给 certbot）"
    cat > "/etc/nginx/conf.d/${SERVICE}.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 1m;

    location / {
        proxy_pass http://${HOST}:${PORT};
        proxy_http_version 1.1;
        # 少了这两行，Socket.IO 会退回长轮询：页面打得开，联机却像卡住不动
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # 服务端 pingInterval=10s / pingTimeout=15s，读超时不能比这更短
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
NGINX
    nginx -t
    systemctl reload nginx
    # CentOS/Alibaba Cloud Linux 上 SELinux 会拦 nginx→upstream，表现是 502
    if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
        log "SELinux 为 Enforcing，放开 nginx 反代权限（httpd_can_network_connect）"
        setsebool -P httpd_can_network_connect 1 || log "setsebool 失败，若 nginx 报 502 请手动处理 SELinux"
    fi
}

restart_service() {
    log "启动/重启 ${SERVICE}"
    systemctl restart "$SERVICE"
    wait_healthy || die "健康检查失败：journalctl -u ${SERVICE} -n 50 --no-pager 看日志"
    log "健康检查通过：$(curl -fsS "$(health_url)")"
}

active_rooms() {
    curl -fsS "http://${HOST}:${PORT}/api/rooms" 2>/dev/null | head -c 400 || echo ""
}

case "$COMMAND" in
    install)
        preflight
        fetch_code
        build_app
        write_service
        restart_service
        write_nginx
        cat <<DONE

下一步（有域名才需要）：
  sudo certbot --nginx -d ${DOMAIN:-你的域名}      # 签证书并自动改成 HTTPS
  验证： curl -fsS https://${DOMAIN:-你的域名}/socket.io/?EIO=4&transport=polling
        （返回 0{"sid":"..."} 就说明 nginx → Node 整条链通了）
DONE
        ;;
    update)
        preflight
        rooms=$(active_rooms)
        if [ -n "$rooms" ] && [ "$rooms" != "[]" ] && [ "${FORCE:-}" != "1" ]; then
            printf '\033[33m当前还有活跃房间，重启会把正在打的局全部清掉：\033[0m\n%s\n' "$rooms"
            read -r -p "确认继续？(y/N) " answer
            [ "$answer" = "y" ] || die "已取消（要跳过确认用 FORCE=1）"
        fi
        fetch_code
        build_app
        restart_service
        ;;
    status)
        systemctl status "$SERVICE" --no-pager | head -15 || true
        echo "--- 健康：$(curl -fsS "$(health_url)" || echo 无法访问)"
        echo "--- 房间：$(active_rooms)"
        ;;
    logs)
        journalctl -u "$SERVICE" -n 100 --no-pager
        ;;
    *)
        sed -n '2,12p' "$0"
        ;;
esac
