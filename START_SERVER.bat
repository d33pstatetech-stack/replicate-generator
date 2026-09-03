@echo off
REM Double-click to serve the SPA on http://localhost:8000 - fixes NetworkError/CORS for file://
cd /d "%~dp0"
echo Serving %CD% on http://localhost:8000
echo Press Ctrl+C to stop
python -m http.server 8000
pause
