@echo off
echo ============================================
echo    ELN - Database Management
echo ============================================
echo.
echo 1. Start PostgreSQL
echo 2. Stop PostgreSQL
echo 3. Restart PostgreSQL
echo 4. View PostgreSQL logs
echo 5. PostgreSQL shell (psql)
echo 6. Exit
echo.
set /p choice=Select option: 

if "%choice%"=="1" docker start enotebook-postgres && echo PostgreSQL started.
if "%choice%"=="2" docker stop enotebook-postgres && echo PostgreSQL stopped.
if "%choice%"=="3" docker restart enotebook-postgres && echo PostgreSQL restarted.
if "%choice%"=="4" docker logs -f enotebook-postgres
if "%choice%"=="5" docker exec -it enotebook-postgres psql -U enotebook -d enotebook
if "%choice%"=="6" exit /b 0

pause
