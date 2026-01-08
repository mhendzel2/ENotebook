@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "BACKUP_DIR=%ROOT%data\backups"
set "TIMESTAMP=%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%" >nul 2>nul

docker container inspect enotebook-postgres >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo [ERROR] PostgreSQL container not found: enotebook-postgres
	echo Run installlocal.bat first.
	pause
	exit /b 1
)

echo Creating PostgreSQL backup...
docker exec enotebook-postgres pg_dump -U enotebook enotebook > "%BACKUP_DIR%\enotebook_%TIMESTAMP%.sql"
if %ERRORLEVEL% neq 0 (
	echo [ERROR] Backup failed.
	pause
	exit /b 1
)
echo Backup saved to: %BACKUP_DIR%\enotebook_%TIMESTAMP%.sql
echo.

:: Keep only last 7 backups
for /f "skip=7 delims=" %%f in ('dir /b /o-d "%BACKUP_DIR%\enotebook_*.sql" 2^>nul') do del "%BACKUP_DIR%\%%f"
pause
