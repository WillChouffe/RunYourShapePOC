#!/bin/bash
# Upload example SVG shapes to the backend

echo "📤 Uploading example shapes to backend..."

API_URL="${1:-http://localhost:8000}"

for file in examples/*.svg; do
    filename=$(basename "$file")
    echo "Uploading $filename..."
    curl -X POST "$API_URL/symbols" \
         -F "file=@$file" \
         -w "\nStatus: %{http_code}\n\n"
done

echo "✅ Done! Refresh the frontend to see the shapes."

