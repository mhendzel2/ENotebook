@echo off
setlocal enabledelayedexpansion

set "USE_DOCKER=y"
set "USE_DOCKER_DEFAULT=!USE_DOCKER!"
echo Default is: !USE_DOCKER_DEFAULT!

set /p "USE_DOCKER=Use Docker? (y/n) [!USE_DOCKER_DEFAULT!]: "
echo After prompt: USE_DOCKER=!USE_DOCKER!

if "!USE_DOCKER!"=="" (
    echo Was empty, setting default
    set "USE_DOCKER=!USE_DOCKER_DEFAULT!"
)

if /i "!USE_DOCKER!"=="n" echo You chose NO
if /i "!USE_DOCKER!"=="y" echo You chose YES

echo Final value: !USE_DOCKER!
