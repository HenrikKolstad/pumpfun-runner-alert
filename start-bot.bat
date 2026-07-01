@echo off
title pump.fun runner alert
cd /d "%~dp0"
:loop
echo [%date% %time%] starting pump.fun runner alert...
node --env-file=.env index.js
echo [%date% %time%] bot exited (code %errorlevel%) - restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
