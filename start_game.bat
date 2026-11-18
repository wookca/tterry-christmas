@echo off
cd /d "%~dp0"
echo Starting local server: http://localhost:8000/
echo Close this window to stop.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000/"
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p 8000 -c-1 & goto :eof)
echo Python or Node.js is required. Install one of them and run again.
pause
