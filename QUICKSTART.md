# Quick Start Guide

Get the Shape Route Generator running in 5 minutes!

## Prerequisites

✅ **Backend**: Python 3.9+ and pip  
✅ **Frontend**: Node.js 18+ and npm  
✅ **Internet**: Required for downloading map tiles and OSM data

## Option 1: Using Start Scripts (Easiest)

### Windows

1. **Start Backend**:
   ```cmd
   start-backend.bat
   ```

2. **Start Frontend** (in a new terminal):
   ```cmd
   start-frontend.bat
   ```

3. **Upload Example Shapes** (in a new terminal):
   ```cmd
   upload-examples.bat
   ```

4. **Open Browser**: http://localhost:5173

### macOS/Linux

1. **Start Backend**:
   ```bash
   ./start-backend.sh
   ```

2. **Start Frontend** (in a new terminal):
   ```bash
   ./start-frontend.sh
   ```

3. **Upload Example Shapes** (in a new terminal):
   ```bash
   ./upload-examples.sh
   ```

4. **Open Browser**: http://localhost:5173

## Option 2: Manual Setup

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
python -m app.main
```

Backend will be at: http://localhost:8000

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will be at: http://localhost:5173

### Upload Example Shapes

```bash
# Upload a heart shape
curl -X POST http://localhost:8000/symbols -F "file=@examples/heart.svg"

# Upload a star shape
curl -X POST http://localhost:8000/symbols -F "file=@examples/star.svg"

# Upload a lightning shape
curl -X POST http://localhost:8000/symbols -F "file=@examples/lightning.svg"

# Upload a circle
curl -X POST http://localhost:8000/symbols -F "file=@examples/circle.svg"
```

## First Route

1. Open http://localhost:5173
2. Click on the map to set a start point (try a city center)
3. Adjust distance slider to 5 km
4. Select a shape from dropdown
5. Click "GENERATE ROUTE"
6. Wait 10-30 seconds
7. See your shape on the map!
8. Click "DOWNLOAD GPX" to save

## Good Test Locations

- **Paris, France**: 48.8566, 2.3522 (dense streets, works great)
- **San Francisco, USA**: 37.7749, -122.4194 (hilly but good)
- **London, UK**: 51.5074, -0.1278 (dense urban area)
- **Amsterdam, Netherlands**: 52.3676, 4.9041 (flat, good for running)

## Troubleshooting

### "Failed to load symbols"
→ Backend not running. Start it first.

### "Failed to generate route"
→ Try a location with denser streets or reduce distance.

### Map is blank
→ Check internet connection (map tiles load from CDN).

### Backend errors about osmnx
→ First OSM download takes time. Be patient. It's cached after that.

## Next Steps

- Try different shapes
- Test in your own city
- Upload custom SVG files
- Experiment with different distances
- Share your coolest routes!

## API Documentation

Once backend is running:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Need Help?

See the main README.md or open an issue.

---

**Happy route tracing! 🏃‍♂️💛**

