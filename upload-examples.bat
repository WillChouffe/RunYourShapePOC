@echo off
REM Upload example SVG shapes to the backend

echo 📤 Uploading example shapes to backend...

set API_URL=http://localhost:8000

if not "%1"=="" set API_URL=%1

for %%f in (examples\*.svg) do (
    echo Uploading %%~nxf...
    curl -X POST "%API_URL%/symbols" -F "file=@%%f"
    echo.
)

echo ✅ Done! Refresh the frontend to see the shapes.
pause

