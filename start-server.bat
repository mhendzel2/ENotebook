@echo off
setlocal
cd /d "%~dp0"

echo Checking PostgreSQL database...
docker ps --format "{{.Names}}" | findstr /x "enotebook-postgres" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Starting PostgreSQL container...
    docker start enotebook-postgres >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] PostgreSQL container not found. Run installlocal.bat first.
        pause
        exit /b 1
    )
    echo Waiting for PostgreSQL to start...
    timeout /t 5 /nobreak >nul
)
echo [OK] PostgreSQL is running.

cd apps\server
echo Starting ELN Server on http://localhost:4000
call npm run dev
