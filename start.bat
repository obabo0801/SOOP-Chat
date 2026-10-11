@echo off
chcp 65001 > nul
title SOOP Chat 🌳
cd /d "%~dp0"

if exist "%LOCALAPPDATA%\SOOPChat\node\node.exe" (
  set "PATH=%LOCALAPPDATA%\SOOPChat\node;%PATH%"
)

call npm ls --omit=dev --depth=0 > nul 2>&1
if errorlevel 1 (
  call npm install

  if errorlevel 1 (
    pause
    exit /b 1
  )
)

cls
call npm start --silent
pause
