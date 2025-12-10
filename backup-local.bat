@echo off
setlocal
set BACKUP_DIR=%~dp0data\backups
set TIMESTAMP=%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
echo Creating backup...
copy "%~dp0apps\server\data\local.db" "%BACKUP_DIR%\local_%TIMESTAMP%.db"
echo Backup saved to: %BACKUP_DIR%\local_%TIMESTAMP%.db
echo.
:: Keep only last 7 backups
for /f "skip=7 delims=" %%f in ('dir /b /o-d "%BACKUP_DIR%\local_*.db" 2>nul') do del "%BACKUP_DIR%\%%f"
echo.
pause
