@echo off
cd /d "%~dp0apps\server"
echo Starting ELN Server on http://localhost:4000
call npm run dev
