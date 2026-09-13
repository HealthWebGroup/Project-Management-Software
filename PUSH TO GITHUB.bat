@echo off
REM ====================================================================
REM  Put Work OS on GitHub
REM
REM  Sends this folder to your GitHub repository. Once Cloudflare is
REM  connected to that repository (five clicks, one time - see
REM  DEPLOY-AUTOMATICALLY.md), every push deploys automatically and you
REM  never run the launcher again.
REM
REM  No password or token is typed here. GitHub asks you in your browser.
REM ====================================================================

title Work OS - push to GitHub
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
if exist "%~dp0push.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\push.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\push.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

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
echo   If you are asked a question, answer it - this window can hear you.
echo.

node push.mjs %*

echo.
echo ====================================================================
echo  Finished. Read the message above.
echo ====================================================================
pause
