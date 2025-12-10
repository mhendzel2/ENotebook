@echo off
cd /d "%~dp0apps\client"
echo Starting ELN Client...
call npm run dev
