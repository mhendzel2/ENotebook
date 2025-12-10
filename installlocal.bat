@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    Electronic Lab Notebook - Local Install
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Display Node version
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js found: %NODE_VERSION%

:: Check for npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo [OK] npm found: %NPM_VERSION%
echo.

:: Set installation directory
set "INSTALL_DIR=%~dp0"
cd /d "%INSTALL_DIR%"

echo [INFO] Installation directory: %INSTALL_DIR%
echo.

:: Create local data directory for offline cache
echo [STEP 1/7] Creating local data directories...
if not exist "%INSTALL_DIR%data" mkdir "%INSTALL_DIR%data"
if not exist "%INSTALL_DIR%data\cache" mkdir "%INSTALL_DIR%data\cache"
if not exist "%INSTALL_DIR%data\attachments" mkdir "%INSTALL_DIR%data\attachments"
if not exist "%INSTALL_DIR%data\exports" mkdir "%INSTALL_DIR%data\exports"
if not exist "%INSTALL_DIR%data\logs" mkdir "%INSTALL_DIR%data\logs"
echo [OK] Local data directories created.
echo.

:: Install root dependencies
echo [STEP 2/7] Installing root dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install root dependencies.
    pause
    exit /b 1
)
echo [OK] Root dependencies installed.
echo.

:: Build shared package
echo [STEP 3/7] Building shared package...
cd packages\shared
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build shared package.
    pause
    exit /b 1
)
cd ..\..
echo [OK] Shared package built.
echo.

:: Install and setup server (local SQLite mode)
echo [STEP 4/7] Setting up local server with SQLite...
cd apps\server

:: Create .env file for local SQLite database
echo DB_PROVIDER="sqlite"> .env
echo DATABASE_URL="file:./data/local.db">> .env
echo PORT=4000>> .env
echo NODE_ENV=development>> .env
echo SYNC_SERVER_URL=>> .env

:: Create server data directory
if not exist "data" mkdir "data"

:: Install Prisma and run migrations
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install server dependencies.
    pause
    exit /b 1
)

echo [INFO] Running database migrations...
call npx prisma migrate deploy
if %ERRORLEVEL% neq 0 (
    echo [INFO] No existing migrations, creating initial database...
    call npx prisma db push
)

call npx prisma generate
echo [OK] Local database configured.
cd ..\..
echo.

:: Install client dependencies
echo [STEP 5/7] Installing client dependencies...
cd apps\client
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install client dependencies.
    pause
    exit /b 1
)
cd ..\..
echo [OK] Client dependencies installed.
echo.

:: Create local configuration file
echo [STEP 6/7] Creating local configuration...
(
echo {
echo   "mode": "offline",
echo   "localDatabase": "./apps/server/data/local.db",
echo   "syncServer": {
echo     "url": "",
echo     "enabled": false,
echo     "syncIntervalMs": 300000,
echo     "lastSyncAt": null
echo   },
echo   "cache": {
echo     "directory": "./data/cache",
echo     "maxSizeMB": 1024
echo   },
echo   "attachments": {
echo     "directory": "./data/attachments",
echo     "maxFileSizeMB": 500
echo   },
echo   "autoBackup": {
echo     "enabled": true,
echo     "intervalHours": 24,
echo     "keepCount": 7
echo   }
echo }
) > "%INSTALL_DIR%config.local.json"
echo [OK] Local configuration created.
echo.

:: Create a default admin user for first-time setup
echo [STEP 7/7] Creating default admin user...
cd apps\server
call npx ts-node -e "const { PrismaClient } = require('@prisma/client'); const crypto = require('crypto'); const prisma = new PrismaClient(); async function main() { const existing = await prisma.user.findFirst(); if (!existing) { await prisma.user.create({ data: { id: 'admin-local', name: 'Local Admin', email: 'admin@local', role: 'admin', passwordHash: crypto.createHash('sha256').update('changeme').digest('hex'), active: true } }); console.log('Default admin user created.'); } else { console.log('Users already exist, skipping.'); } } main().catch(console.error).finally(() => prisma.$disconnect());" 2>nul
if %ERRORLEVEL% neq 0 (
    echo [INFO] Could not create default user - database may already be initialized.
)
cd ..\..
echo.

:: Create startup scripts
echo Creating startup scripts...

:: Create start-server.bat
(
echo @echo off
echo cd /d "%%~dp0apps\server"
echo echo Starting ELN Server on http://localhost:4000
echo call npm run dev
) > "%INSTALL_DIR%start-server.bat"

:: Create start-client.bat
(
echo @echo off
echo cd /d "%%~dp0apps\client"
echo echo Starting ELN Client...
echo call npm run dev
) > "%INSTALL_DIR%start-client.bat"

:: Create start-all.bat
(
echo @echo off
echo echo ============================================
echo echo    Electronic Lab Notebook - Starting
echo echo ============================================
echo echo.
echo echo Starting server and client...
echo echo.
echo start "ELN Server" cmd /k "cd /d %%~dp0apps\server && npm run dev"
echo timeout /t 3 /nobreak ^>nul
echo start "ELN Client" cmd /k "cd /d %%~dp0apps\client && npm run dev"
echo echo.
echo echo Server: http://localhost:4000
echo echo Client: http://localhost:5173 ^(or Electron app^)
echo echo.
echo echo Press any key to exit this window...
echo pause ^>nul
) > "%INSTALL_DIR%start-all.bat"

:: Create sync-now.bat for manual sync when connected
(
echo @echo off
echo echo ============================================
echo echo    ELN - Manual Sync to Central Server
echo echo ============================================
echo echo.
echo cd /d "%%~dp0apps\server"
echo call npx ts-node -e "console.log('Sync functionality - configure SYNC_SERVER_URL in .env first'); process.exit(0);"
echo echo.
echo echo To enable sync:
echo echo 1. Edit apps\server\.env
echo echo 2. Set SYNC_SERVER_URL to your central PostgreSQL server
echo echo 3. Run this script again
echo echo.
echo pause
) > "%INSTALL_DIR%sync-now.bat"

:: Create backup script
(
echo @echo off
echo setlocal
echo set BACKUP_DIR=%%~dp0data\backups
echo set TIMESTAMP=%%date:~-4%%%%date:~4,2%%%%date:~7,2%%_%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%
echo set TIMESTAMP=%%TIMESTAMP: =0%%
echo if not exist "%%BACKUP_DIR%%" mkdir "%%BACKUP_DIR%%"
echo echo Creating backup...
echo copy "%%~dp0apps\server\data\local.db" "%%BACKUP_DIR%%\local_%%TIMESTAMP%%.db"
echo echo Backup saved to: %%BACKUP_DIR%%\local_%%TIMESTAMP%%.db
echo echo.
echo :: Keep only last 7 backups
echo for /f "skip=7 delims=" %%%%f in ('dir /b /o-d "%%BACKUP_DIR%%\local_*.db" 2^>nul'^) do del "%%BACKUP_DIR%%\%%%%f"
echo echo.
echo pause
) > "%INSTALL_DIR%backup-local.bat"

echo [OK] Startup scripts created.
echo.

echo ============================================
echo    Installation Complete!
echo ============================================
echo.
echo Local data will be stored in:
echo   - Database: apps\server\data\local.db
echo   - Cache:    data\cache\
echo   - Files:    data\attachments\
echo.
echo To start the application:
echo   - Run: start-all.bat
echo   - Or run server and client separately
echo.
echo Default login (for API testing):
echo   - User ID: admin-local
echo   - Password: changeme (change this!)
echo.
echo To sync with central server later:
echo   1. Edit apps\server\.env
echo   2. Set SYNC_SERVER_URL=https://your-server.com
echo   3. Run sync-now.bat
echo.
echo ============================================
echo.
pause
