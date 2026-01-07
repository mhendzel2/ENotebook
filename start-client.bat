@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo    Electronic Lab Notebook - Starting
echo ============================================
echo.

:: Check Docker
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not running. Please start Docker Desktop.
    pause
    exit /b 1
)

:: Ensure PostgreSQL is running
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
    echo Waiting for PostgreSQL to initialize...
    timeout /t 5 /nobreak >nul
)
echo [OK] PostgreSQL is running.
echo.

:: Start server in background
echo Starting ELN Server...
start "ELN Server" /min cmd /c "cd /d %~dp0apps\server ^&^& npm run dev"

:: Wait for server to start
echo Waiting for server to initialize...
timeout /t 3 /nobreak >nul

:: Start client
echo Starting ELN Client...
cd apps\client
call npm run dev
