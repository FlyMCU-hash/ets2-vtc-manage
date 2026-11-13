@echo off
cd /d "%~dp0"
call npm run pack
if errorlevel 1 goto fail
echo OK
echo %~dp0
goto done
:fail
echo FAILED
:done
pause
