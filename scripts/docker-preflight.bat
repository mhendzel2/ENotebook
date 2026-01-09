@echo off
setlocal enabledelayedexpansion

REM Ensure Docker CLI is available - Docker Desktop sometimes is not on PATH
where docker >nul 2>nul
if errorlevel 1 (
    set "DOCKER_EXE="

    REM Try common Docker Desktop install locations
    if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
    if not defined DOCKER_EXE if exist "%LocalAppData%\Programs\Docker\Docker\resources\bin\docker.exe" set "DOCKER_EXE=%LocalAppData%\Programs\Docker\Docker\resources\bin\docker.exe"

    if defined DOCKER_EXE (
        for %%d in ("!DOCKER_EXE!") do set "DOCKER_BIN=%%~dpd"
        set "PATH=!DOCKER_BIN!;!PATH!"
        echo [INFO] Docker CLI found at "!DOCKER_EXE!".
        echo [INFO] Added "!DOCKER_BIN!" to PATH for this session.
    ) else (
        echo [ERROR] Docker CLI (docker.exe) is not installed or not in PATH.
        echo.
        echo Option A: Install Docker Desktop from https://www.docker.com/products/docker-desktop
        echo Option B: Re-run this installer and choose local PostgreSQL (no Docker)
        endlocal & exit /b 1
    )
)

REM Check if Docker is running
docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not running.
    echo Please start Docker Desktop and wait for it to fully initialize.
    echo.
    echo Or re-run this installer and choose local PostgreSQL (no Docker).
    endlocal & exit /b 1
)

echo [OK] Docker found and running.
echo.

REM Choose a host port for the Postgres container - avoid conflict with local PostgreSQL on 5432
set "PG_HOST_PORT="

REM If the container already exists, reuse its published port
docker container inspect enotebook-postgres >nul 2>nul
if not errorlevel 1 (
    for /f "tokens=2 delims=:" %%p in ('docker port enotebook-postgres 5432/tcp 2^>nul ^| findstr /r /c:"0\.0\.0\.0:"') do set "PG_HOST_PORT=%%p"
)

if defined PG_HOST_PORT goto :done

REM Pick a free host port to publish 5432/tcp (5432-5440)
for /l %%P in (5432,1,5440) do (
    netstat -ano -p tcp | findstr /R /C:":%%P .*LISTENING" >nul 2>nul
    if errorlevel 1 (
        set "PG_HOST_PORT=%%P"
        goto :done
    )
)

echo [ERROR] Could not find a free TCP port in range 5432-5440 for Docker PostgreSQL.
endlocal & exit /b 1

:done
if not "!PG_HOST_PORT!"=="5432" (
    echo [WARNING] Host port 5432 is in use.
    echo [INFO] Docker PostgreSQL will use localhost:!PG_HOST_PORT!.
    echo.
)

endlocal & set "PG_HOST_PORT=%PG_HOST_PORT%" & exit /b 0
