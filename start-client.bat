@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo [ERROR] Docker is not running. Start Docker Desktop and try again.
	pause
	exit /b 1
)

set "PG_HOST_PORT=5432"
for /f "usebackq tokens=2 delims=:" %%p in (`docker port enotebook-postgres 5432/tcp 2^>nul ^| findstr /i "0.0.0.0"`) do (
	set "PG_HOST_PORT=%%p"
	goto :got_port
)
:got_port

docker container inspect enotebook-postgres >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo [ERROR] PostgreSQL container not found: enotebook-postgres
	echo Run installlocal.bat first.
	pause
	exit /b 1
)

docker start enotebook-postgres >nul 2>nul

echo Starting ELN Server...
start "ELN Server" /min cmd /c "set DB_PROVIDER=postgresql ^& set DATABASE_URL=postgresql://enotebook:enotebook_secure_pwd@localhost:%PG_HOST_PORT%/enotebook?schema=public ^& cd /d %ROOT%apps\server ^&^& npm run dev"

echo Waiting for server to initialize...
timeout /t 3 >nul

echo Starting ELN Client...
cd /d "%ROOT%apps\client"
call npm run dev
