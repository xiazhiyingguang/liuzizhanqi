@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo    六子战棋 - 停止服务
echo ============================================
echo.

REM 收集占用 3000/8787 端口的进程 PID（自动去重）
set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":3000 " ^| findstr "LISTENING"') do call :add %%p
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":8787 " ^| findstr "LISTENING"') do call :add %%p

if not defined PIDS (
    echo 没有发现运行中的服务（端口 3000 / 8787 均未被占用）。
    echo.
    pause
    exit /b 0
)

echo 发现以下进程：%PIDS%
echo.
for %%p in (%PIDS%) do (
    echo [停止] PID %%p ...
    taskkill /PID %%p /F >nul 2>nul && echo   已停止 || echo   停止失败（可能已被结束）
)

echo.
echo 验证端口状态...
netstat -ano | findstr /C:":3000 " | findstr "LISTENING" >nul 2>nul && echo   [警告] 前端端口 3000 仍在监听 || echo   [OK] 前端端口 3000 已释放
netstat -ano | findstr /C:":8787 " | findstr "LISTENING" >nul 2>nul && echo   [警告] 后端端口 8787 仍在监听 || echo   [OK] 后端端口 8787 已释放

echo.
echo 注意：以上只按端口查进程，若 3000/8787 被其他程序占用也会一并结束。
echo.
pause
exit /b 0

REM 去重添加 PID
:add
set "p=%~1"
for %%d in (%PIDS%) do if "%%d"=="%p%" goto :eof
set "PIDS=%PIDS% %p%"
goto :eof
