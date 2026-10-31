@echo off
chcp 65001 >nul
title Volatility Desk
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node dev\start.mjs
if errorlevel 1 pause
exit /b 0

:nonode
echo Node.js not found. Install Node 22.13+ or 24+ first: https://nodejs.org/
pause
exit /b 1
