@echo off
cd /d "%~dp0"
echo Local ONLINE test: game http://localhost:8000/  +  server http://localhost:8787/
call npm install
start "Snow server" cmd /c "npm run dev"
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:8000/"
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
npx --yes http-server -p 8000 -c-1
