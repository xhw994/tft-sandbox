@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0dist\index.html" (
  start "" "%~dp0dist\index.html"
) else (
  echo 未找到 dist\index.html，请先运行 npm run build 构建产物。
  pause
)
