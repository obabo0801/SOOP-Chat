@echo off
chcp 65001 > nul
title SOOP Chat 🌳
cd /d "%~dp0"

if not exist "node_modules" (
    npm install
    call "%~f0"
)

cls
npm start --silent
pause