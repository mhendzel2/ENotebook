@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    Electronic Lab Notebook - Server Install
echo    Central Database Server Configuration
echo ============================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] This script should be run as Administrator for best results.
    echo Some operations may fail without elevated privileges.
    echo.
    pause
)

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

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

:: ============================================
:: DATABASE CONFIGURATION
:: ============================================
echo ============================================
echo    Database Configuration
echo ============================================
echo.
echo This server installation supports PostgreSQL (recommended).
echo.

set DB_TYPE=postgresql

set /p DB_HOST="Enter database host [localhost]: "
if "%DB_HOST%"=="" set DB_HOST=localhost

set DEFAULT_PORT=5432

set /p DB_PORT="Enter database port [%DEFAULT_PORT%]: "
if "%DB_PORT%"=="" set DB_PORT=%DEFAULT_PORT%

set /p DB_NAME="Enter database name [eln_production]: "
if "%DB_NAME%"=="" set DB_NAME=eln_production

set /p DB_USER="Enter database username [eln_admin]: "
if "%DB_USER%"=="" set DB_USER=eln_admin

set /p DB_PASSWORD="Enter database password: "
if "%DB_PASSWORD%"=="" (
    echo [ERROR] Database password is required.
    pause
    exit /b 1
)

set /p SERVER_PORT="Enter ELN server port [4000]: "
if "%SERVER_PORT%"=="" set SERVER_PORT=4000

set /p JWT_SECRET="Enter JWT secret key (leave blank to auto-generate): "
if "%JWT_SECRET%"=="" (
    for /f "tokens=*" %%i in ('powershell -Command "[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()"') do set JWT_SECRET=%%i
)

echo.
echo ============================================
echo    Configuration Summary
echo ============================================
echo Database Type: %DB_TYPE%
echo Database Host: %DB_HOST%
echo Database Port: %DB_PORT%
echo Database Name: %DB_NAME%
echo Database User: %DB_USER%
echo Server Port:   %SERVER_PORT%
echo.

set /p CONFIRM="Is this correct? (y/n) [y]: "
if /i "%CONFIRM%"=="n" (
    echo Please run the script again with correct values.
    pause
    exit /b 1
)

echo.

:: Create server data directories
echo [STEP 1/8] Creating server directories...
if not exist "%INSTALL_DIR%data" mkdir "%INSTALL_DIR%data"
if not exist "%INSTALL_DIR%data\attachments" mkdir "%INSTALL_DIR%data\attachments"
if not exist "%INSTALL_DIR%data\exports" mkdir "%INSTALL_DIR%data\exports"
if not exist "%INSTALL_DIR%data\logs" mkdir "%INSTALL_DIR%data\logs"
if not exist "%INSTALL_DIR%data\backups" mkdir "%INSTALL_DIR%data\backups"
echo [OK] Server directories created.
echo.

:: Install root dependencies
echo [STEP 2/8] Installing root dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install root dependencies.
    pause
    exit /b 1
)
echo [OK] Root dependencies installed.
echo.

:: Build shared package
echo [STEP 3/8] Building shared package...
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

:: Configure server for PostgreSQL
echo [STEP 4/8] Configuring server for %DB_TYPE%...
cd apps\server

echo Updating Prisma schema for PostgreSQL...
powershell -Command "(Get-Content prisma\schema.prisma) -replace 'provider = \"sqlite\"', 'provider = \"postgresql\"' | Set-Content prisma\schema.prisma"
set DATABASE_URL=postgresql://%DB_USER%:%DB_PASSWORD%@%DB_HOST%:%DB_PORT%/%DB_NAME%?schema=public

:: Create .env file
echo Creating .env configuration file...
(
echo # ELN Server Configuration - Production
echo # Generated on %DATE% %TIME%
echo.
echo # Database Configuration
echo DATABASE_URL="%DATABASE_URL%"
echo DB_TYPE=%DB_TYPE%
echo.
echo # Server Configuration
echo PORT=%SERVER_PORT%
echo NODE_ENV=production
echo.
echo # Security
echo JWT_SECRET=%JWT_SECRET%
echo.
echo # File Storage
echo ATTACHMENT_DIR=../../data/attachments
echo MAX_FILE_SIZE_MB=500
echo.
echo # Sync Configuration
echo SYNC_ENABLED=true
echo.
echo # Logging
echo LOG_LEVEL=info
echo LOG_DIR=../../data/logs
) > .env

echo [OK] Server configuration created.
echo.

:: Install server dependencies
echo [STEP 5/8] Installing server dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install server dependencies.
    pause
    exit /b 1
)

:: Install database driver
echo Installing PostgreSQL driver...
call npm install pg

echo [OK] Server dependencies installed.
echo.

:: Run database migrations
echo [STEP 6/8] Running database migrations...
echo.
echo [INFO] Make sure your %DB_TYPE% database is running and the database '%DB_NAME%' exists.
echo [INFO] If the database doesn't exist, create it with:
echo        psql -U postgres -c "CREATE DATABASE %DB_NAME%;"
echo        psql -U postgres -c "CREATE USER %DB_USER% WITH PASSWORD '%DB_PASSWORD%';"
echo        psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE %DB_NAME% TO %DB_USER%;"
echo.

set /p DB_READY="Is the database ready? (y/n) [y]: "
if /i "%DB_READY%"=="n" (
    echo Please create the database and run this script again.
    pause
    exit /b 1
)

call npx prisma migrate deploy
if %ERRORLEVEL% neq 0 (
    echo [INFO] No existing migrations found. Pushing schema...
    call npx prisma db push
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to setup database schema.
        echo Please check your database connection settings.
        pause
        exit /b 1
    )
)

call npx prisma generate
echo [OK] Database schema configured.
cd ..\..
echo.

:: Create admin user
echo [STEP 7/8] Creating admin user...
set /p ADMIN_NAME="Enter admin name [Lab Manager]: "
if "%ADMIN_NAME%"=="" set ADMIN_NAME=Lab Manager

set /p ADMIN_EMAIL="Enter admin email [admin@lab.local]: "
if "%ADMIN_EMAIL%"=="" set ADMIN_EMAIL=admin@lab.local

set /p ADMIN_PASSWORD="Enter admin password [changeme]: "
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=changeme

cd apps\server
call npx ts-node -e "const { PrismaClient } = require('@prisma/client'); const crypto = require('crypto'); const prisma = new PrismaClient(); async function main() { const existing = await prisma.user.findFirst({ where: { role: 'admin' } }); if (!existing) { await prisma.user.create({ data: { id: 'admin-server', name: '%ADMIN_NAME%', email: '%ADMIN_EMAIL%', role: 'admin', passwordHash: crypto.createHash('sha256').update('%ADMIN_PASSWORD%').digest('hex'), active: true } }); console.log('Admin user created successfully.'); } else { console.log('Admin user already exists.'); } } main().catch(console.error).finally(() => prisma.$disconnect());" 2>nul
cd ..\..
echo [OK] Admin user configured.
echo.

:: Create server management scripts
echo [STEP 8/8] Creating management scripts...

:: Start server script
(
echo @echo off
echo cd /d "%%~dp0apps\server"
echo echo ============================================
echo echo    ELN Server - Production Mode
echo echo ============================================
echo echo.
echo echo Server starting on http://localhost:%SERVER_PORT%
echo echo Press Ctrl+C to stop the server.
echo echo.
echo call npm run dev
) > "%INSTALL_DIR%start-server.bat"

:: Start server with PM2 (production)
(
echo @echo off
echo cd /d "%%~dp0apps\server"
echo echo Starting ELN Server with PM2...
echo call npx pm2 start npm --name "eln-server" -- run dev
echo call npx pm2 save
echo echo.
echo echo Server started. Use 'pm2 status' to check status.
echo echo Use 'pm2 logs eln-server' to view logs.
echo pause
) > "%INSTALL_DIR%start-server-pm2.bat"

:: Stop server script
(
echo @echo off
echo echo Stopping ELN Server...
echo call npx pm2 stop eln-server
echo echo Server stopped.
echo pause
) > "%INSTALL_DIR%stop-server.bat"

:: Database backup script
(
echo @echo off
echo setlocal
echo set BACKUP_DIR=%%~dp0data\backups
echo set TIMESTAMP=%%date:~-4%%%%date:~4,2%%%%date:~7,2%%_%%time:~0,2%%%%time:~3,2%%%%time:~6,2%%
echo set TIMESTAMP=%%TIMESTAMP: =0%%
echo if not exist "%%BACKUP_DIR%%" mkdir "%%BACKUP_DIR%%"
echo echo Creating database backup...
echo set PGPASSWORD=%DB_PASSWORD%
echo pg_dump -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -F c -f "%%BACKUP_DIR%%\eln_%%TIMESTAMP%%.backup"
echo echo Backup saved to: %%BACKUP_DIR%%
echo echo.
echo :: Keep only last 14 backups
echo for /f "skip=14 delims=" %%%%f in ('dir /b /o-d "%%BACKUP_DIR%%\eln_*.backup" 2^^^>nul'^) do del "%%BACKUP_DIR%%\%%%%f"
echo pause
) > "%INSTALL_DIR%backup-database.bat"

:: Database restore script
(
echo @echo off
echo echo ============================================
echo echo    ELN Database Restore
echo echo ============================================
echo echo.
echo echo Available backups:
echo dir /b /o-d "%%~dp0data\backups\eln_*" 2^>nul
echo echo.
echo set /p BACKUP_FILE="Enter backup filename to restore: "
echo set PGPASSWORD=%DB_PASSWORD%
echo pg_restore -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "%%~dp0data\backups\%%BACKUP_FILE%%"
echo echo.
echo echo Restore complete.
echo pause
) > "%INSTALL_DIR%restore-database.bat"

:: Server status script
(
echo @echo off
echo echo ============================================
echo echo    ELN Server Status
echo echo ============================================
echo echo.
echo echo Checking server status...
echo curl -s http://localhost:%SERVER_PORT%/health
echo echo.
echo echo.
echo echo PM2 Status:
echo call npx pm2 status eln-server 2^>nul
echo echo.
echo pause
) > "%INSTALL_DIR%server-status.bat"

:: View logs script
(
echo @echo off
echo echo ============================================
echo echo    ELN Server Logs
echo echo ============================================
echo echo.
echo echo Recent logs:
echo call npx pm2 logs eln-server --lines 50
) > "%INSTALL_DIR%view-logs.bat"

echo [OK] Management scripts created.
echo.

:: Create Windows service installation script (optional)
(
echo @echo off
echo echo ============================================
echo echo    Install ELN as Windows Service
echo echo ============================================
echo echo.
echo echo This will install ELN Server as a Windows service using NSSM.
echo echo.
echo echo Prerequisites:
echo echo   1. Download NSSM from https://nssm.cc/download
echo echo   2. Extract nssm.exe to a folder in your PATH
echo echo.
echo where nssm ^>nul 2^>nul
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo [ERROR] NSSM not found. Please install it first.
echo     pause
echo     exit /b 1
echo ^)
echo echo.
echo set /p CONFIRM="Install ELN as Windows service? (y/n): "
echo if /i "%%CONFIRM%%"=="y" ^(
echo     nssm install ELNServer "%%~dp0apps\server\node_modules\.bin\ts-node" "%%~dp0apps\server\src\index.ts"
echo     nssm set ELNServer AppDirectory "%%~dp0apps\server"
echo     nssm set ELNServer DisplayName "Electronic Lab Notebook Server"
echo     nssm set ELNServer Description "ELN API Server for laboratory data management"
echo     nssm set ELNServer Start SERVICE_AUTO_START
echo     echo.
echo     echo Service installed. Starting...
echo     nssm start ELNServer
echo     echo Done.
echo ^)
echo pause
) > "%INSTALL_DIR%install-as-service.bat"

echo.
echo ============================================
echo    Server Installation Complete!
echo ============================================
echo.
echo Server Configuration:
echo   - Database: %DB_TYPE%://%DB_HOST%:%DB_PORT%/%DB_NAME%
echo   - API Port: %SERVER_PORT%
echo   - Admin Email: %ADMIN_EMAIL%
echo.
echo Data Directories:
echo   - Attachments: data\attachments\
echo   - Backups:     data\backups\
echo   - Logs:        data\logs\
echo.
echo Management Scripts:
echo   - start-server.bat     : Start server (development)
echo   - start-server-pm2.bat : Start server with PM2 (production)
echo   - stop-server.bat      : Stop server
echo   - server-status.bat    : Check server status
echo   - backup-database.bat  : Backup database
echo   - restore-database.bat : Restore from backup
echo   - view-logs.bat        : View server logs
echo   - install-as-service.bat : Install as Windows service
echo.
echo Client Workstations:
echo   Run 'installlocal.bat' on client PCs, then configure:
echo   - Edit apps\server\.env on each client
echo   - Set SYNC_SERVER_URL=http://%COMPUTERNAME%:%SERVER_PORT%
echo.
echo ============================================
echo.
echo To start the server now, run: start-server.bat
echo.
pause
