@echo off
REM ====================================================================
REM  Work OS - launch on Cloudflare
REM
REM  Double-click this file from anywhere. It finds the project itself.
REM
REM  The window stays INTERACTIVE on purpose. Cloudflare asks a question
REM  the first time an account publishes, and you have to be able to
REM  answer it. The launcher writes its own launch-log.txt, so nothing is
REM  lost by leaving the window able to talk to you.
REM
REM  Nothing here asks for a password or an API token.
REM ====================================================================

title Work OS - launch on Cloudflare
setlocal

REM --- Is Node installed? -------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is not installed on this computer.
  echo.
  echo   Install it from https://nodejs.org - pick the LTS button, click
  echo   Next through the installer, then double-click this file again.
  echo.
  pause
  exit /b 1
)

REM --- Find the project ---------------------------------------------
set "PROJ="
if exist "%~dp0launch.mjs" set "PROJ=%~dp0"
if not defined PROJ if exist "%~dp0work-os-cloudflare\launch.mjs" set "PROJ=%~dp0work-os-cloudflare\"
if not defined PROJ if exist "%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\launch.mjs" set "PROJ=%USERPROFILE%\Desktop\Health Web Group\Project Management software\work-os-cloudflare\"

if not defined PROJ (
  echo.
  echo   Could not find the project.
  echo.
  echo   It should be the folder called  work-os-cloudflare  with a file
  echo   called  launch.mjs  inside it. Copy this .bat into that folder
  echo   and double-click it there.
  echo.
  pause
  exit /b 1
)

cd /d "%PROJ%"

echo.
echo   Project: %PROJ%
echo.
echo   If you are asked a question, answer it - this window can hear you.
echo.

node launch.mjs

echo.
echo ====================================================================
echo  Finished.
echo.
echo  A transcript was saved to  launch-log.txt  in this folder.
echo  Tell Claude it is there and it will read it - nothing to copy.
echo ====================================================================
pause
