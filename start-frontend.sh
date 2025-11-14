#!/bin/bash
# Start script for frontend (Unix/macOS)

echo "🎨 Starting Shape Route Generator Frontend..."

cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "⚙️  Creating .env file..."
    cp .env.example .env
fi

# Start dev server
echo "✅ Starting Vite dev server..."
npm run dev

