@echo off
echo ============================================
echo    ELN - Manual Sync to Central Server
echo ============================================
echo.
cd /d "%~dp0apps\server"
echo To enable sync:
echo 1. Edit apps\server\.env
echo 2. Set SYNC_SERVER_URL to your central PostgreSQL server
echo 3. Run this script again
echo.
pause
