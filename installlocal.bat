@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    Electronic Lab Notebook - Local Install
echo    (PostgreSQL via Docker)
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

:: Check for Docker
docker.exe --version >nul 2>nul
if errorlevel 1 (
    :: Docker Desktop sometimes isn't on PATH for the current terminal session.
    :: Try common install locations and temporarily add them to PATH.
    if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" (
        set "PATH=%ProgramFiles%\Docker\Docker\resources\bin;!PATH!"
    ) else if exist "%ProgramFiles(x86)%\Docker\Docker\resources\bin\docker.exe" (
        set "PATH=%ProgramFiles(x86)%\Docker\Docker\resources\bin;!PATH!"
    )
)

docker.exe --version >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    echo.
    echo After installing Docker Desktop:
    echo 1. Start Docker Desktop
    echo 2. Wait for it to fully start (whale icon in system tray^)
    echo 3. Run this installer again
    pause
    exit /b 1
)

:: Check if Docker is running
docker.exe info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not running.
    echo Please start Docker Desktop and wait for it to fully initialize.
    echo.
    echo Troubleshooting:
    echo - In a NEW terminal window, run: where docker
    echo - Then run: docker version
    pause
    exit /b 1
)

echo [OK] Docker found and running.
echo.

:: Choose host port for PostgreSQL (avoid conflicts with any local PostgreSQL service)
set "PG_HOST_PORT=5432"
netstat -ano | findstr /C:":5432" | findstr /C:"LISTENING" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set "PG_HOST_PORT=5433"
    echo [INFO] Port 5432 is already in use. Using port !PG_HOST_PORT! for the Docker PostgreSQL container.
    echo.
)

:: Set installation directory
set "INSTALL_DIR=%~dp0"
cd /d "%INSTALL_DIR%"

echo [INFO] Installation directory: %INSTALL_DIR%
echo.

:: Create local data directory for offline cache
echo [STEP 1/8] Creating local data directories...
if not exist "%INSTALL_DIR%data" mkdir "%INSTALL_DIR%data"
if not exist "%INSTALL_DIR%data\cache" mkdir "%INSTALL_DIR%data\cache"
if not exist "%INSTALL_DIR%data\attachments" mkdir "%INSTALL_DIR%data\attachments"
if not exist "%INSTALL_DIR%data\exports" mkdir "%INSTALL_DIR%data\exports"
if not exist "%INSTALL_DIR%data\logs" mkdir "%INSTALL_DIR%data\logs"
if not exist "%INSTALL_DIR%data\postgres" mkdir "%INSTALL_DIR%data\postgres"
echo [OK] Local data directories created.
echo.

:: Setup PostgreSQL via Docker
echo [STEP 2/8] Setting up PostgreSQL database via Docker...

:: If a previous install attempt created the container, remove it so we can ensure correct port mapping.
docker.exe container inspect enotebook-postgres >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Existing PostgreSQL container found. Recreating it...
    docker.exe stop enotebook-postgres >nul 2>nul
    docker.exe rm enotebook-postgres >nul 2>nul
)

echo [INFO] Creating PostgreSQL container...
docker.exe run -d ^
    --name enotebook-postgres ^
    -e POSTGRES_USER=enotebook ^
    -e POSTGRES_PASSWORD=enotebook_secure_pwd ^
    -e POSTGRES_DB=enotebook ^
    -p %PG_HOST_PORT%:5432 ^
    -v "%INSTALL_DIR%data\postgres:/var/lib/postgresql/data" ^
    postgres:15-alpine

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create PostgreSQL container.
    echo Make sure port %PG_HOST_PORT% is not in use.
    echo If a container named enotebook-postgres already exists, remove it with:
    echo   docker rm -f enotebook-postgres
    pause
    exit /b 1
)

echo [INFO] Waiting for PostgreSQL to start...
set "WAITED_SECS=0"
:wait_postgres
docker.exe ps --format "{{.Names}}" | findstr /x "enotebook-postgres" >nul 2>nul
if %ERRORLEVEL% equ 0 goto :postgres_running
set /a WAITED_SECS+=2
if %WAITED_SECS% geq 60 goto :postgres_not_running
timeout /t 2 >nul
goto :wait_postgres

:postgres_not_running
echo [ERROR] PostgreSQL container is not running after %WAITED_SECS% seconds.
echo You can inspect logs with: docker logs enotebook-postgres
pause
exit /b 1

:postgres_running
echo [OK] PostgreSQL is running on localhost:%PG_HOST_PORT%
echo [INFO] PostgreSQL host port: %PG_HOST_PORT%
echo.

:: Install root dependencies
echo [STEP 3/8] Installing root dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install root dependencies.
    pause
    exit /b 1
)
echo [OK] Root dependencies installed.
echo.

:: Build shared package
echo [STEP 4/8] Building shared package...
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

:: Install and setup server (PostgreSQL mode)
echo [STEP 5/8] Setting up local server with PostgreSQL...
cd apps\server

:: Create .env file for PostgreSQL database
echo DB_PROVIDER="postgresql"> .env
echo DATABASE_URL="postgresql://enotebook:enotebook_secure_pwd@localhost:%PG_HOST_PORT%/enotebook?schema=public">> .env
echo PORT=4000>> .env
echo NODE_ENV=development>> .env
echo SYNC_SERVER_URL=>> .env

:: Create server data directory
if not exist "data" mkdir "data"

:: Install dependencies
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install server dependencies.
    pause
    exit /b 1
)

:: Ensure schema is set to PostgreSQL
echo [INFO] Ensuring Prisma schema uses PostgreSQL...
powershell -Command "(Get-Content prisma\schema.prisma) -replace 'provider = \"sqlite\"', 'provider = \"postgresql\"' | Set-Content prisma\schema.prisma"

echo [INFO] Running database migrations...
call npx prisma db push --accept-data-loss
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to push database schema.
    pause
    exit /b 1
)

call npx prisma generate
echo [OK] PostgreSQL database configured.
cd ..\..
echo.

:: Install client dependencies
echo [STEP 6/8] Installing client dependencies...
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
echo [STEP 7/8] Creating local configuration...
(
echo {
echo   "mode": "local",
echo   "database": {
echo     "type": "postgresql",
echo     "host": "localhost",
echo     "port": %PG_HOST_PORT%,
echo     "name": "enotebook",
echo     "containerName": "enotebook-postgres"
echo   },
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
echo [STEP 8/8] Creating default admin user...
cd apps\server

:: Use Node.js directly to create the user
node -e "const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcrypt'); const prisma = new PrismaClient(); async function main() { try { const existing = await prisma.user.findFirst(); if (!existing) { const passwordHash = await bcrypt.hash('changeme', 12); await prisma.user.create({ data: { name: 'Local Admin', email: 'admin@local', role: 'admin', passwordHash, active: true } }); console.log('[OK] Default admin user created.'); } else { console.log('[INFO] Users already exist, skipping.'); } } catch(e) { console.log('[INFO] ' + e.message); } finally { await prisma.$disconnect(); } } main();"

cd ..\..
echo.

:: Create startup scripts
echo Creating startup scripts...

:: Create start-server.bat
if not exist "%INSTALL_DIR%start-server.bat" (
(
echo @echo off
echo setlocal
echo cd /d "%%~dp0"
echo.
echo echo Checking PostgreSQL database...
echo docker ps --format "{{.Names}}" ^| findstr /x "enotebook-postgres" ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo Starting PostgreSQL container...
echo     docker start enotebook-postgres ^>nul 2^>nul
echo     if %%ERRORLEVEL%% neq 0 ^(
echo         echo [ERROR] PostgreSQL container not found. Run installlocal.bat first.
echo         pause
echo         exit /b 1
echo     ^)
echo     echo Waiting for PostgreSQL to start...
echo     timeout /t 5 /nobreak ^>nul
echo ^)
echo echo [OK] PostgreSQL is running.
echo.
echo cd apps\server
echo echo Starting ELN Server on http://localhost:4000
echo call npm run dev
) > "%INSTALL_DIR%start-server.bat"
)

:: Create start-client.bat
if not exist "%INSTALL_DIR%start-client.bat" (
(
echo @echo off
echo setlocal
echo cd /d "%%~dp0"
echo.
echo echo ============================================
echo echo    Electronic Lab Notebook - Starting
echo echo ============================================
echo echo.
echo.
echo :: Check Docker
echo docker info ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo [ERROR] Docker is not running. Please start Docker Desktop.
echo     pause
echo     exit /b 1
echo ^)
echo.
echo :: Ensure PostgreSQL is running
echo echo Checking PostgreSQL database...
echo docker ps --format "{{.Names}}" ^| findstr /x "enotebook-postgres" ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo Starting PostgreSQL container...
echo     docker start enotebook-postgres ^>nul 2^>nul
echo     if %%ERRORLEVEL%% neq 0 ^(
echo         echo [ERROR] PostgreSQL container not found. Run installlocal.bat first.
echo         pause
echo         exit /b 1
echo     ^)
echo     echo Waiting for PostgreSQL to initialize...
echo     timeout /t 5 /nobreak ^>nul
echo ^)
echo echo [OK] PostgreSQL is running.
echo echo.
echo.
echo :: Start server in background
echo echo Starting ELN Server...
echo start "ELN Server" /min cmd /c "cd /d %%~dp0apps\server ^&^& npm run dev"
echo.
echo :: Wait for server to start
echo echo Waiting for server to initialize...
echo timeout /t 3 /nobreak ^>nul
echo.
echo :: Start client
echo echo Starting ELN Client...
echo cd apps\client
echo call npm run dev
) > "%INSTALL_DIR%start-client.bat"
)

:: Create start-all.bat (opens both in separate windows)
if not exist "%INSTALL_DIR%start-all.bat" (
(
echo @echo off
echo setlocal
echo cd /d "%%~dp0"
echo.
echo echo ============================================
echo echo    Electronic Lab Notebook - Starting
echo echo ============================================
echo echo.
echo.
echo :: Check Docker
echo docker info ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo [ERROR] Docker is not running. Please start Docker Desktop.
echo     pause
echo     exit /b 1
echo ^)
echo.
echo :: Ensure PostgreSQL is running
echo echo Checking PostgreSQL database...
echo docker ps --format "{{.Names}}" ^| findstr /x "enotebook-postgres" ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo Starting PostgreSQL container...
echo     docker start enotebook-postgres ^>nul 2^>nul
echo     if %%ERRORLEVEL%% neq 0 ^(
echo         echo [ERROR] PostgreSQL container not found. Run installlocal.bat first.
echo         pause
echo         exit /b 1
echo     ^)
echo     echo Waiting for PostgreSQL to initialize...
echo     timeout /t 5 /nobreak ^>nul
echo ^)
echo echo [OK] PostgreSQL is running on localhost:%PG_HOST_PORT%
echo echo.
echo.
echo echo Starting server and client...
echo echo.
echo start "ELN Server" cmd /k "cd /d %%~dp0apps\server ^&^& npm run dev"
echo timeout /t 3 /nobreak ^>nul
echo start "ELN Client" cmd /k "cd /d %%~dp0apps\client ^&^& npm run dev"
echo echo.
echo echo Server: http://localhost:4000
echo echo Client: http://localhost:5173 ^(or Electron app^)
echo echo.
echo echo Press any key to exit this window...
echo pause ^>nul
) > "%INSTALL_DIR%start-all.bat"
)

:: Create database management scripts
(
echo @echo off
echo echo ============================================
echo echo    ELN - Database Management
echo echo ============================================
echo echo.
echo echo 1. Start PostgreSQL
echo echo 2. Stop PostgreSQL
echo echo 3. Restart PostgreSQL
echo echo 4. View PostgreSQL logs
echo echo 5. PostgreSQL shell ^(psql^)
echo echo 6. Exit
echo echo.
echo set /p choice=Select option: 
echo.
echo if "%%choice%%"=="1" docker start enotebook-postgres ^&^& echo PostgreSQL started.
echo if "%%choice%%"=="2" docker stop enotebook-postgres ^&^& echo PostgreSQL stopped.
echo if "%%choice%%"=="3" docker restart enotebook-postgres ^&^& echo PostgreSQL restarted.
echo if "%%choice%%"=="4" docker logs -f enotebook-postgres
echo if "%%choice%%"=="5" docker exec -it enotebook-postgres psql -U enotebook -d enotebook
echo if "%%choice%%"=="6" exit /b 0
echo.
echo pause
) > "%INSTALL_DIR%manage-db.bat"

:: Create sync-now.bat for manual sync when connected
if not exist "%INSTALL_DIR%sync-now.bat" (
(
echo @echo off
echo echo ============================================
echo echo    ELN - Manual Sync to Central Server
echo echo ============================================
echo echo.
echo cd /d "%%~dp0apps\server"
echo echo To enable sync:
echo echo 1. Edit apps\server\.env
echo echo 2. Set SYNC_SERVER_URL to your central PostgreSQL server
echo echo 3. Run this script again
echo echo.
echo pause
) > "%INSTALL_DIR%sync-now.bat"
)

:: Create backup script
if not exist "%INSTALL_DIR%backup-local.bat" (
(
echo @echo off
echo setlocal
echo set BACKUP_DIR=%%~dp0data\backups
echo set TIMESTAMP=%%date:~-4%%%%date:~4,2%%%%date:~7,2%%_%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%
echo set TIMESTAMP=%%TIMESTAMP: =0%%
echo if not exist "%%BACKUP_DIR%%" mkdir "%%BACKUP_DIR%%"
echo echo Creating PostgreSQL backup...
echo docker exec enotebook-postgres pg_dump -U enotebook enotebook ^> "%%BACKUP_DIR%%\enotebook_%%TIMESTAMP%%.sql"
echo echo Backup saved to: %%BACKUP_DIR%%\enotebook_%%TIMESTAMP%%.sql
echo echo.
echo :: Keep only last 7 backups
echo for /f "skip=7 delims=" %%%%f in ^('dir /b /o-d "%%BACKUP_DIR%%\enotebook_*.sql" 2^>nul'^) do del "%%BACKUP_DIR%%\%%%%f"
echo echo.
echo pause
) > "%INSTALL_DIR%backup-local.bat"
)

:: Create stop-all script
(
echo @echo off
echo echo Stopping ELN services...
echo taskkill /FI "WINDOWTITLE eq ELN Server*" /F ^>nul 2^>nul
echo taskkill /FI "WINDOWTITLE eq ELN Client*" /F ^>nul 2^>nul
echo echo.
echo echo Do you want to stop the PostgreSQL database? ^(y/n^)
echo set /p stopdb=
echo if /i "%%stopdb%%"=="y" ^(
echo     docker stop enotebook-postgres
echo     echo PostgreSQL stopped.
echo ^)
echo echo.
echo echo All services stopped.
echo pause
) > "%INSTALL_DIR%stop-all.bat"

echo [OK] Startup scripts created.
echo.

echo ============================================
echo    Installation Complete!
echo ============================================
echo.
echo Database: PostgreSQL running in Docker
echo   - Container: enotebook-postgres
echo   - Port: %PG_HOST_PORT%
echo   - Data stored in: data\postgres\
echo.
echo To start the application:
echo   - Run: start-client.bat (starts DB + server + client)
echo   - Or: start-all.bat (opens in separate windows)
echo.
echo Database management:
echo   - Run: manage-db.bat
echo.
echo Default login (for API testing):
echo   - Email: admin@local
echo   - Password: changeme (change this!)
echo.
echo ============================================
echo.
pause
