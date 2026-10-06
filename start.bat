@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo    六子战棋 - 一键启动
echo ============================================
echo.

REM ================= 1. 检查 Node.js =================
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    echo 安装完成后重新运行本脚本。
    pause
    exit /b 1
)

REM ================= 2. 安装依赖（如缺失） =================
if not exist "node_modules" (
    echo [1/3] 安装前端依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 前端依赖安装失败！
        pause
        exit /b 1
    )
) else (
    echo [1/3] 前端依赖已存在，跳过安装
)

if not exist "server\node_modules" (
    echo [2/3] 安装后端依赖...
    call npm --prefix server install
    if errorlevel 1 (
        echo [错误] 后端依赖安装失败！
        pause
        exit /b 1
    )
) else (
    echo [2/3] 后端依赖已存在，跳过安装
)

REM ================= 3. 检查端口占用 =================
set "BUSY="
netstat -ano | findstr /C:":8787 " | findstr "LISTENING" >nul 2>nul && set "BUSY=后端端口 8787"
netstat -ano | findstr /C:":3000 " | findstr "LISTENING" >nul 2>nul && set "BUSY=前端端口 3000"
if defined BUSY (
    echo [警告] 检测到 %BUSY% 已被占用，可能已有游戏服务在运行。
    echo         请先停止旧服务再启动，否则新服务会启动失败。
    choice /c YN /m "仍要启动吗 (Y=继续 / N=退出)"
    if errorlevel 2 exit /b 0
)

REM ================= 4. 前端模式 =================
REM 默认游戏模式：改代码不会自动刷新你正在玩的一局，要看最新改动按 F5。
REM 想要热更新（改代码即时生效，但玩的时候可能被刷新）：start.bat dev
set "GAME_MODE=1"
set "MODE_LABEL=游戏模式（不自动刷新，按 F5 看最新改动）"
if /i "%~1"=="dev" (
    set "GAME_MODE=0"
    set "MODE_LABEL=开发模式（HMR 热更新，改代码会刷新页面）"
)

REM ================= 5. 启动前后端 =================
echo [3/3] 启动服务（两个新窗口请保持开启）...
start "六子战棋-后端(8787)" cmd /k "cd /d %~dp0server && node server.js"
REM 注意：`set X=1 && ...` 会把值设成 "1 "（带尾空格），所以 && 前不能留空格
start "六子战棋-前端(3000)" cmd /k "cd /d %~dp0 && set GAME_MODE=%GAME_MODE%&& npm run dev"

echo.
echo 启动完成！
echo   前端模式: %MODE_LABEL%
echo   游戏页面: http://localhost:3000  （浏览器会自动打开）
echo   后端地址: http://localhost:8787
echo   停止服务: 直接关闭对应的服务窗口即可
echo.
pause
