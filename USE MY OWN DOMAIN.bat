@echo off
REM ====================================================================
REM  Switch Work OS onto task.healthwebgroup.com
REM
REM  Only run this once healthwebgroup.com shows as ACTIVE under
REM  Websites in your Cloudflare dashboard. Before that it cannot work,
REM  and this will tell you so and change nothing.
REM
REM  Your data, boards and people are not touched. This only changes
REM  the web address the app answers on.
REM ====================================================================

title Work OS - switch to task.healthwebgroup.com
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is not installed. Get it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "PROJ="
if exist "%~dp0launch.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\launch.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\launch.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

if not defined PROJ (
  echo.
  echo   Could not find the project. Put this file in the
  echo   work-os-cloudflare folder and run it there.
  echo.
  pause
  exit /b 1
)

cd /d "%PROJ%"

echo.
echo   Switching Work OS to task.healthwebgroup.com
echo.
echo   If the domain is not ready yet, nothing will be changed and
echo   this will tell you what is still missing.
echo.

node launch.mjs --domain

echo.
echo ====================================================================
echo  Finished. A transcript is in launch-log.txt in this folder.
echo ====================================================================
pause
