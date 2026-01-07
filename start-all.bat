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
echo [OK] PostgreSQL is running on localhost:5433
echo.

echo Starting server and client...
echo.
start "ELN Server" cmd /k "cd /d %~dp0apps\server ^&^& npm run dev"
timeout /t 3 /nobreak >nul
start "ELN Client" cmd /k "cd /d %~dp0apps\client ^&^& npm run dev"
echo.
echo Server: http://localhost:4000
echo Client: http://localhost:5173 (or Electron app)
echo.
echo Press any key to exit this window...
pause >nul
