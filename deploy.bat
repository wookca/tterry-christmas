@echo off
cd /d "%~dp0"
echo [1/3] Installing wrangler (first time only)...
call npm install
echo [2/3] Checking Cloudflare login...
call npx wrangler whoami | findstr /C:"You are logged in" >nul || call npx wrangler login
echo [3/3] Deploying realtime server to Cloudflare (workers.dev)...
call npx wrangler deploy
echo.
echo Copy the https://....workers.dev address above into js\config.js (SERVER_URL).
pause
