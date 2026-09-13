@echo off
REM ====================================================================
REM  Make deployment automatic  -  run this ONCE
REM
REM  Pushes this folder to GitHub, gives GitHub permission to deploy to
REM  Cloudflare, and starts the first automatic deploy.
REM
REM  Afterwards you never run a launcher again: change something, run
REM  PUSH TO GITHUB.bat, and it deploys itself.
REM
REM  No password or token is typed into this window. GitHub asks you in
REM  your browser; the Cloudflare token goes into GitHub's own prompt and
REM  straight into its encrypted store.
REM ====================================================================

title Work OS - make deployment automatic
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
if exist "%~dp0auto-deploy.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\auto-deploy.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\auto-deploy.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

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
echo   You will be asked two things. Answer them in this window.
echo.

node auto-deploy.mjs %*

echo.
echo ====================================================================
echo  Finished. Read the message above.
echo ====================================================================
pause
