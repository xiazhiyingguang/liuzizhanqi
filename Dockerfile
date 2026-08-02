# 多阶段构建 - 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装所有依赖
RUN npm ci

# 复制源代码
COPY . .

# 使用 Vite 构建（跳过 TypeScript 检查）
RUN npx vite build

# 生产阶段 - 使用 Nginx 服务静态文件
FROM nginx:alpine

# 复制自定义 Nginx 配置
COPY nginx.docker.conf /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 暴露 80 端口
EXPOSE 80

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
