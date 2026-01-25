@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "ASSUME_YES=0"
set "DELETE_DATA=0"
set "DELETE_NODE_MODULES=0"

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--yes" set "ASSUME_YES=1"
if /i "%~1"=="--delete-data" set "DELETE_DATA=1"
if /i "%~1"=="--delete-node-modules" set "DELETE_NODE_MODULES=1"
shift
goto :parse_args
:args_done

echo ============================================
echo    Electronic Lab Notebook - Local Uninstall
echo ============================================
echo.
echo This will:
echo - Stop and remove Docker container: enotebook-postgres
if "%DELETE_DATA%"=="1" (
  echo - Delete local data/config: data\postgres, apps\server\.env, apps\server\data\local.db, config.local.json
) else (
  echo - Keep local data/config (use --delete-data to remove)
)
if "%DELETE_NODE_MODULES%"=="1" (
  echo - Delete node_modules (root, apps/server, apps/client, packages/shared)
)
echo.

if "%ASSUME_YES%"=="0" (
  set /p CONFIRM="Proceed? (y/n) [n]: "
  if "%CONFIRM%"=="" set "CONFIRM=n"
  if /i not "%CONFIRM%"=="y" (
    echo Aborted.
    exit /b 0
  )
)

:: Docker cleanup (safe if Docker isn't installed)
where docker >nul 2>nul
if %ERRORLEVEL% equ 0 (
  docker container inspect enotebook-postgres >nul 2>nul
  if %ERRORLEVEL% equ 0 (
    echo [INFO] Stopping container enotebook-postgres...
    docker stop enotebook-postgres >nul 2>nul
    echo [INFO] Removing container enotebook-postgres...
    docker rm enotebook-postgres >nul 2>nul
  ) else (
    echo [INFO] Docker container enotebook-postgres not found.
  )
) else (
  echo [INFO] Docker CLI not found; skipping container removal.
)

if "%DELETE_DATA%"=="1" (
  if exist "%ROOT%data\postgres" (
    echo [INFO] Deleting %ROOT%data\postgres
    rmdir /s /q "%ROOT%data\postgres" >nul 2>nul
  )
  if exist "%ROOT%apps\server\.env" (
    echo [INFO] Deleting %ROOT%apps\server\.env
    del /f /q "%ROOT%apps\server\.env" >nul 2>nul
  )
  if exist "%ROOT%apps\server\data\local.db" (
    echo [INFO] Deleting %ROOT%apps\server\data\local.db
    del /f /q "%ROOT%apps\server\data\local.db" >nul 2>nul
  )
  if exist "%ROOT%config.local.json" (
    echo [INFO] Deleting %ROOT%config.local.json
    del /f /q "%ROOT%config.local.json" >nul 2>nul
  )
)

if "%DELETE_NODE_MODULES%"=="1" (
  if exist "%ROOT%node_modules" (
    echo [INFO] Deleting %ROOT%node_modules
    rmdir /s /q "%ROOT%node_modules" >nul 2>nul
  )
  if exist "%ROOT%apps\server\node_modules" (
    echo [INFO] Deleting %ROOT%apps\server\node_modules
    rmdir /s /q "%ROOT%apps\server\node_modules" >nul 2>nul
  )
  if exist "%ROOT%apps\client\node_modules" (
    echo [INFO] Deleting %ROOT%apps\client\node_modules
    rmdir /s /q "%ROOT%apps\client\node_modules" >nul 2>nul
  )
  if exist "%ROOT%packages\shared\node_modules" (
    echo [INFO] Deleting %ROOT%packages\shared\node_modules
    rmdir /s /q "%ROOT%packages\shared\node_modules" >nul 2>nul
  )
)

echo.
echo [OK] Local uninstall complete.
exit /b 0
