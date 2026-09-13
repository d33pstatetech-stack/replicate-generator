@echo off
REM Double-click to serve the SPA on http://localhost:8000 - fixes NetworkError/CORS for file://
REM NOTE: serves public/ (the live app). The stale root index.html was removed 2026-09-13.
cd /d "%~dp0public"
echo Serving %CD% on http://localhost:8000
echo Press Ctrl+C to stop
python -m http.server 8000
pause
