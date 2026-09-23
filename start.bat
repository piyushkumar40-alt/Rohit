@echo off
title Flipkart Returns Tracker & Scanner
cd /d "%~dp0"

echo ========================================================
echo   Starting Flipkart Returns Tracker (Web & Mobile)
echo ========================================================
echo.

:: Check if agy-node or node exists
where agy-node >nul 2>nul
if %errorlevel% equ 0 (
    set NODE_CMD=agy-node
    goto START_SERVER
)

where node >nul 2>nul
if %errorlevel% equ 0 (
    set NODE_CMD=node
    goto START_SERVER
)

:: Check Antigravity internal node path
if exist "C:\Users\piyus\AppData\Roaming\Antigravity\bin\agy-node.cmd" (
    set NODE_CMD="C:\Users\piyus\AppData\Roaming\Antigravity\bin\agy-node.cmd"
    goto START_SERVER
)

echo ERROR: Neither agy-node nor node was found on your system!
pause
exit /b 1

:START_SERVER
echo Starting backend server on port 3000...
start "" http://localhost:3000
%NODE_CMD% src\server.js
pause
