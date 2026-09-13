@echo off
REM ====================================================================
REM  Turn on email-code sign-in for Work OS
REM
REM  Adds One-time PIN as a login method on your Cloudflare Zero Trust
REM  account, lets the Work OS application use it, and restricts sign-in
REM  to @healthwebgroup.com addresses.
REM
REM  No password or API token is asked for. It uses the sign-in wrangler
REM  already stored on this computer. Anything it is not permitted to do,
REM  it tells you about instead of working around.
REM ====================================================================

title Work OS - turn on sign-in
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
if exist "%~dp0setup-login.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\setup-login.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\setup-login.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

if not defined PROJ (
  echo.
  echo   Could not find the project. Put this file in the
  echo   work-os-cloudflare folder and run it there.
  echo.
  pause
  exit /b 1
)

cd /d "%PROJ%"
node setup-login.mjs

echo.
echo ====================================================================
echo  Finished. Read the message above.
echo ====================================================================
pause
