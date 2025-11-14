@echo off
REM Start script for frontend (Windows)

echo 🎨 Starting Shape Route Generator Frontend...

cd frontend

REM Check if node_modules exists
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
)

REM Create .env if it doesn't exist
if not exist ".env" (
    echo ⚙️  Creating .env file...
    copy .env.example .env
)

REM Start dev server
echo ✅ Starting Vite dev server...
npm run dev

pause

