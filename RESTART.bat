@echo off
echo ================================================
echo   Shape Route Generator - Redemarrage Complet
echo ================================================
echo.

cd /d "%~dp0"

echo [1/3] Arret des serveurs existants...
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Backend*" 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Frontend*" 2>nul
timeout /t 2 /nobreak >nul

echo [2/3] Demarrage du backend (port 8001)...
start "Backend API" cmd /k "cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload"

timeout /t 5 /nobreak

echo [3/3] Demarrage du frontend (port 5173)...
start "Frontend Vite" cmd /k "cd frontend && npm run dev"

timeout /t 3 /nobreak

echo.
echo ================================================
echo   SERVEURS DEMARRES !
echo ================================================
echo.
echo Backend:  http://localhost:8001
echo   - API Docs: http://localhost:8001/docs
echo   - Symbols: http://localhost:8001/symbols
echo.
echo Frontend: http://localhost:5173
echo.
echo NOUVELLES FONCTIONNALITES:
echo   - 4 formes disponibles dans le dropdown
echo   - Recherche d'adresse (ex: "Paris, France")
echo   - CORS correctement configure
echo.
echo Appuyez sur une touche pour ouvrir l'application...
pause >nul

start http://localhost:5173

echo.
echo Pour arreter : fermez les fenetres Backend et Frontend
echo.
pause

