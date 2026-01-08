@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ============================================
echo    Electronic Lab Notebook - Starting
echo ============================================
echo.

docker.exe info >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo [ERROR] Docker is not running. Start Docker Desktop and try again.
	pause
	exit /b 1
)

set "PG_HOST_PORT=5432"
for /f "usebackq tokens=2 delims=:" %%p in (`docker.exe port enotebook-postgres 5432/tcp 2^>nul ^| findstr /i "0.0.0.0"`) do (
	set "PG_HOST_PORT=%%p"
	goto :got_port
)
:got_port

docker.exe container inspect enotebook-postgres >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo [ERROR] PostgreSQL container not found: enotebook-postgres
	echo Run installlocal.bat first.
	pause
	exit /b 1
)

docker.exe start enotebook-postgres >nul 2>nul

echo [OK] PostgreSQL is running on localhost:%PG_HOST_PORT%
echo.

echo Starting server and client...
echo.
start "ELN Server" cmd /k "set DB_PROVIDER=postgresql ^& set DATABASE_URL=postgresql://enotebook:enotebook_secure_pwd@localhost:%PG_HOST_PORT%/enotebook?schema=public ^& cd /d %ROOT%apps\server ^&^& npm run dev"
timeout /t 3 >nul
start "ELN Client" cmd /k "cd /d %ROOT%apps\client ^&^& npm run dev"

echo.
echo Server: http://localhost:4000
echo Client: http://localhost:5173 ^(or Electron app^)
echo.
echo Press any key to exit this window...
pause >nul
