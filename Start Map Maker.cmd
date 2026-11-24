@echo off
title Fangan Map Maker
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install
)
echo.
echo  Fangan Map Maker is running at http://localhost:5178
echo  Keep this window open while you use it. Close it to stop.
echo.
start "" http://localhost:5178
call npm run dev
