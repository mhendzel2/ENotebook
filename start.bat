@echo off
setlocal enabledelayedexpansion

echo ============================================
echo    Electronic Lab Notebook - Startup
echo ============================================
echo.

:: Detect installation type
set "INSTALL_DIR=%~dp0"
cd /d "%INSTALL_DIR%"

:: Check if this is a server or local installation
if exist "apps\server\.env" (
    for /f "tokens=2 delims==" %%a in ('findstr /i "DB_TYPE" apps\server\.env 2^>nul') do set DB_TYPE=%%a
    for /f "tokens=2 delims==" %%a in ('findstr /i "SYNC_SERVER_URL" apps\server\.env 2^>nul') do set SYNC_URL=%%a
)

:: Determine installation mode
set MODE=unknown
if exist "config.local.json" (
    set MODE=local
) 
if defined DB_TYPE (
    if /i "%DB_TYPE%"=="postgresql" set MODE=server
)
if "%DB_TYPE%"=="" (
    if exist "apps\server\prisma\dev.db" set MODE=local
    if exist "apps\server\data\local.db" set MODE=local
)

echo Detected installation: %MODE%
echo.

:: ============================================
:: SERVER MODE
:: ============================================
if /i "%MODE%"=="server" (
    echo ============================================
    echo    Starting ELN Server ^(Database Host^)
    echo ============================================
    echo.
    
    :: Check if PM2 is available for production mode
    where pm2 >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo [INFO] PM2 found - using production mode
        echo.
        
        :: Check if already running
        pm2 describe eln-server >nul 2>nul
        if %ERRORLEVEL% equ 0 (
            echo [INFO] ELN Server is already running.
            echo.
            pm2 status eln-server
            echo.
            set /p RESTART="Restart server? (y/n) [n]: "
            if /i "!RESTART!"=="y" (
                echo Restarting server...
                pm2 restart eln-server
            )
        ) else (
            echo Starting ELN Server with PM2...
            cd apps\server
            pm2 start npm --name "eln-server" -- run dev
            pm2 save
            cd ..\..
        )
        
        echo.
        echo Server Status:
        pm2 status eln-server
    ) else (
        echo [INFO] PM2 not found - using development mode
        echo [TIP] Install PM2 for production: npm install -g pm2
        echo.

        echo Starting ELN Server...

        :: If something is already listening on port 4000, it may be an older server instance.
        :: Offer to stop it so the latest code/routes are picked up.
        set HAS_4000_LISTENER=
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do (
            set HAS_4000_LISTENER=1
        )

        if defined HAS_4000_LISTENER (
            echo [WARNING] Port 4000 is already in use.
            set /p RESTART_SERVER="Stop existing server on port 4000 and restart? (y/n) [y]: "
            if "!RESTART_SERVER!"=="" set RESTART_SERVER=y
            if /i "!RESTART_SERVER!"=="y" (
                for /f "tokens=5" %%p in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do (
                    echo Stopping PID %%p...
                    taskkill /PID %%p /F >nul 2>nul
                )
            ) else (
                echo [INFO] Reusing the existing server on port 4000.
            )
            echo.
        )

        start "ELN Server" cmd /k "cd /d %INSTALL_DIR%apps\server && npm run dev"
    )
    
    :: Wait for server to start
    echo.
    echo Waiting for server to start...
    timeout /t 5 /nobreak >nul
    
    :: Check server health
    echo.
    echo Checking server health...
    curl -s http://localhost:4000/health >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo [OK] Server is running at http://localhost:4000
    ) else (
        echo [WARNING] Server may still be starting. Check logs if issues persist.
    )
    
    echo.
    echo ============================================
    echo    Server Started Successfully
    echo ============================================
    echo.
    echo API Endpoint: http://localhost:4000
    echo Health Check: http://localhost:4000/health
    echo.
    echo Client workstations should configure:
    echo   SYNC_SERVER_URL=http://%COMPUTERNAME%:4000
    echo.
    goto :end
)

:: ============================================
:: LOCAL MODE
:: ============================================
if /i "%MODE%"=="local" (
    echo ============================================
    echo    Starting ELN Local ^(Workstation^)
    echo ============================================
    echo.
    
    :: Check for sync server configuration
    if defined SYNC_URL (
        if not "%SYNC_URL%"=="" (
            echo [INFO] Sync server configured: %SYNC_URL%
            echo Checking connectivity...
            curl -s --connect-timeout 3 %SYNC_URL%/health >nul 2>nul
            if %ERRORLEVEL% equ 0 (
                echo [OK] Central server is reachable - sync enabled
            ) else (
                echo [WARNING] Central server unreachable - working in offline mode
                echo           Data will sync when connection is restored.
            )
            echo.
        )
    ) else (
        echo [INFO] No sync server configured - standalone mode
        echo [TIP] Configure SYNC_SERVER_URL in apps\server\.env to enable sync
        echo.
    )
    
    :: Start local server
    echo Starting local ELN server...

    :: If something is already listening on port 4000, it may be an older server instance.
    :: Offer to stop it so the latest code/routes are picked up.
    set HAS_4000_LISTENER=
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do (
        set HAS_4000_LISTENER=1
    )

    if defined HAS_4000_LISTENER (
        echo [WARNING] Port 4000 is already in use.
        set /p RESTART_LOCAL="Stop existing server on port 4000 and restart? (y/n) [y]: "
        if "!RESTART_LOCAL!"=="" set RESTART_LOCAL=y
        if /i "!RESTART_LOCAL!"=="y" (
            for /f "tokens=5" %%p in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do (
                echo Stopping PID %%p...
                taskkill /PID %%p /F >nul 2>nul
            )
        ) else (
            echo [INFO] Reusing the existing server on port 4000.
        )
        echo.
    )

    start "ELN Local Server" cmd /k "cd /d %INSTALL_DIR%apps\server && npm run dev"
    
    :: Wait for server
    echo Waiting for local server...
    timeout /t 4 /nobreak >nul
    
    :: Check if client exists and should be started
    if exist "apps\client\package.json" (
        echo.
        set /p START_CLIENT="Start the client application? (y/n) [y]: "
        if "!START_CLIENT!"=="" set START_CLIENT=y
        
        if /i "!START_CLIENT!"=="y" (
            echo Starting ELN Client...
            start "ELN Client" cmd /k "cd /d %INSTALL_DIR%apps\client && npm run dev"
            
            :: Wait for client
            timeout /t 3 /nobreak >nul
            
            echo.
            echo Opening in browser...
            timeout /t 2 /nobreak >nul
            start "" "http://localhost:5173"
        )
    )
    
    echo.
    echo ============================================
    echo    ELN Local Started Successfully
    echo ============================================
    echo.
    echo Local Server: http://localhost:4000
    echo Client App:   http://localhost:5173 ^(if started^)
    echo.
    if defined SYNC_URL (
        if not "%SYNC_URL%"=="" (
            echo Sync Status: Connected to %SYNC_URL%
        )
    ) else (
        echo Sync Status: Offline ^(standalone mode^)
    )
    echo.
    goto :end
)

:: ============================================
:: UNKNOWN MODE - First time setup
:: ============================================
if /i "%MODE%"=="unknown" (
    echo ============================================
    echo    ELN Not Configured
    echo ============================================
    echo.
    echo It appears ELN has not been installed yet.
    echo.
    echo Please run one of the following:
    echo.
    echo   For DATABASE SERVER ^(central host^):
    echo     installserver.bat
    echo.
    echo   For LOCAL WORKSTATION ^(lab PC^):
    echo     installlocal.bat
    echo.
    echo After installation, run this script again.
    echo.
    
    set /p INSTALL_NOW="Would you like to install now? (server/local/no) [no]: "
    
    if /i "!INSTALL_NOW!"=="server" (
        call "%INSTALL_DIR%installserver.bat"
        goto :end
    )
    
    if /i "!INSTALL_NOW!"=="local" (
        call "%INSTALL_DIR%installlocal.bat"
        goto :end
    )
    
    goto :end
)

:end
echo.
echo Press any key to close this window...
pause >nul
