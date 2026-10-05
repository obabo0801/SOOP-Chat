@echo off
chcp 65001 > nul
title SOOP Chat 🌳
cd /d "%~dp0"

if not exist "node_modules" (
  call npm install

  if errorlevel 1 (
    pause
    exit /b 1
  )
)

cls
call npm start --silent
pause
