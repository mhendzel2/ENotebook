@echo off
echo ============================================
echo    Electronic Lab Notebook - Starting
echo ============================================
echo.
echo Starting server and client...
echo.
start "ELN Server" cmd /k "cd /d %~dp0apps\server && npm run dev"
timeout /t 3 /nobreak >nul
start "ELN Client" cmd /k "cd /d %~dp0apps\client && npm run dev"
echo.
echo Server: http://localhost:4000
echo Client: http://localhost:5173 (or Electron app)
echo.
echo Press any key to exit this window...
pause >nul
