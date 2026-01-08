@echo off
echo Stopping ELN services...
taskkill /FI "WINDOWTITLE eq ELN Server*" /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq ELN Client*" /F >nul 2>nul
echo.
echo Do you want to stop the PostgreSQL database? (y/n)
set /p stopdb=
if /i "%stopdb%"=="y" (
    docker stop enotebook-postgres
    echo PostgreSQL stopped.
)
echo.
echo All services stopped.
pause
