@echo off
echo ======================================
echo   Shape Route Generator - Demarrage
echo ======================================
echo.

cd /d "%~dp0"

echo [1/2] Demarrage du backend sur http://localhost:8001...
start "Backend API" cmd /k "cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001"

timeout /t 5 /nobreak

echo [2/2] Demarrage du frontend sur http://localhost:5173...
start "Frontend Vite" cmd /k "cd frontend && npm run dev"

timeout /t 3 /nobreak

echo.
echo ======================================
echo   PRET !
echo ======================================
echo.
echo Backend:  http://localhost:8001
echo Frontend: http://localhost:5173
echo API Docs: http://localhost:8001/docs
echo.
echo Les 4 exemples SVG sont deja uploades :
echo   - Heart
echo   - Star
echo   - Lightning
echo   - Circle
echo.
echo Appuyez sur une touche pour ouvrir le navigateur...
pause >nul

start http://localhost:5173

echo.
echo Pour arreter les serveurs, fermez les fenetres Backend et Frontend.
echo.
pause

