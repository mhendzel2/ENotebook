@echo off
REM ENotebook Docker Management Script
REM Usage: docker-manage.bat [command]

setlocal enabledelayedexpansion

set COMMAND=%1

if "%COMMAND%"=="" (
    echo ENotebook Docker Management
    echo.
    echo Usage: docker-manage.bat [command]
    echo.
    echo Commands:
    echo   start     - Start all containers
    echo   stop      - Stop all containers
    echo   restart   - Restart all containers
    echo   build     - Build/rebuild containers
    echo   logs      - View server logs
    echo   db-logs   - View database logs
    echo   status    - Show container status
    echo   migrate   - Run database migrations
    echo   shell     - Open shell in server container
    echo   db-shell  - Open PostgreSQL shell
    echo   clean     - Remove containers and volumes
    echo.
    goto :eof
)

if "%COMMAND%"=="start" (
    echo Starting ENotebook containers...
    docker-compose up -d
    goto :eof
)

if "%COMMAND%"=="stop" (
    echo Stopping ENotebook containers...
    docker-compose down
    goto :eof
)

if "%COMMAND%"=="restart" (
    echo Restarting ENotebook containers...
    docker-compose restart
    goto :eof
)

if "%COMMAND%"=="build" (
    echo Building ENotebook containers...
    docker-compose build --no-cache
    goto :eof
)

if "%COMMAND%"=="logs" (
    echo Showing server logs ^(Ctrl+C to exit^)...
    docker-compose logs -f server
    goto :eof
)

if "%COMMAND%"=="db-logs" (
    echo Showing database logs ^(Ctrl+C to exit^)...
    docker-compose logs -f postgres
    goto :eof
)

if "%COMMAND%"=="status" (
    echo Container Status:
    docker-compose ps
    goto :eof
)

if "%COMMAND%"=="migrate" (
    echo Running database migrations...
    docker-compose exec server npx prisma migrate deploy
    goto :eof
)

if "%COMMAND%"=="shell" (
    echo Opening shell in server container...
    docker-compose exec server /bin/sh
    goto :eof
)

if "%COMMAND%"=="db-shell" (
    echo Opening PostgreSQL shell...
    docker-compose exec postgres psql -U enotebook -d enotebook
    got
if "%COMMAND%"=="clean" (
    echo WARNING: This will remove all containers and volumes!
    echo Press Ctrl+C to cancel, or any key to continue...
    pause >nul
    docker-compose down -v
    echo Cleanup complete.
    goto :eof
)

echo Unknown command: %COMMAND%
echo Run docker-manage.bat without arguments to see available commands.
