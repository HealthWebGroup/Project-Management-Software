@echo off
REM ====================================================================
REM  Put Cloudflare Access in front of Work OS
REM
REM  This does the last step: creates the Access application, says who
REM  may sign in, reads the AUD tag back, writes it into the config and
REM  redeploys.
REM
REM  It does NOT ask for a password or an API token. It uses the sign-in
REM  wrangler already stored on this computer when you ran the launcher.
REM  If that sign-in is not permitted to manage Access, it stops and
REM  tells you exactly what to click instead.
REM ====================================================================

title Work OS - set up sign-in
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
if exist "%~dp0setup-access.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\setup-access.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\setup-access.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

if not defined PROJ (
  echo.
  echo   Could not find the project. Put this file in the
  echo   work-os-cloudflare folder and run it there.
  echo.
  pause
  exit /b 1
)

cd /d "%PROJ%"

node setup-access.mjs

echo.
echo ====================================================================
echo  Finished. Read the message above.
echo ====================================================================
pause
