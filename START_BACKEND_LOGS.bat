@echo off
echo ================================================
echo   BACKEND - Logs Visibles
echo ================================================
echo.
echo Cette fenetre affiche les logs du backend
echo NE LA FERMEZ PAS !
echo.
echo Quand vous generez une route dans le frontend,
echo les logs apparaitront ICI.
echo.
echo ================================================

cd /d "%~dp0backend"

echo Activation de l'environnement virtuel...
call venv\Scripts\activate.bat

echo.
echo Demarrage du backend sur http://localhost:8001
echo.
echo --- LOGS CI-DESSOUS ---
echo.

venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

pause

