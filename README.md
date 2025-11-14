# Shape Route Generator POC

A full-stack web application that generates running routes matching the shape of uploaded SVG files. Built with FastAPI (Python) and React (TypeScript).

![Neon Tech UI](https://img.shields.io/badge/UI-Neon%20Tech-F5E642?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript)

## 🎯 Overview

This POC demonstrates a unique concept: generating running routes that trace specific shapes on real street networks. Users can:

1. **Upload SVG shapes** (hearts, stars, letters, etc.)
2. **Click on a map** to set a starting point
3. **Choose target distance** (1-20 km)
4. **Generate a route** that matches the shape using real streets
5. **Download GPX** files for GPS devices

The backend uses OpenStreetMap data to create realistic, walkable/runnable routes that approximate the uploaded shape as closely as possible.

## ✨ Features

### Backend (FastAPI + Python)
- **SVG Processing**: Parse and normalize any SVG path into a standard polyline
- **Smart Routing**: Match shapes to real street networks using graph algorithms
- **OSM Integration**: Download and cache street data via `osmnx`
- **GPX Export**: Generate standard GPX files for GPS devices
- **RESTful API**: Clean, documented endpoints

### Frontend (React + TypeScript)
- **Interactive Map**: Leaflet-based map with dark theme
- **Neon Tech UI**: Futuristic interface with glowing yellow accents
- **Real-time Preview**: See routes displayed instantly on the map
- **Responsive Design**: Works on desktop and mobile
- **One-Click Export**: Download routes as GPX files

## 🚀 Quick Start

### Prerequisites

- **Backend**: Python 3.9+, pip
- **Frontend**: Node.js 18+, npm
- Internet connection (for OSM data download)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd RunYourShapePOC
```

### 2. Start the Backend

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the API
python -m app.main
```

Backend will be available at http://localhost:8000

### 3. Start the Frontend

Open a new terminal:

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will be available at http://localhost:5173

### 4. Upload a Shape and Generate a Route

1. Open http://localhost:5173 in your browser
2. First, upload an SVG shape using the backend API:
   ```bash
   curl -X POST http://localhost:8000/symbols \
     -F "file=@examples/heart.svg"
   ```
3. Refresh the frontend to see the new shape in the dropdown
4. Click on the map to set a start point
5. Adjust the distance slider
6. Click "GENERATE ROUTE"
7. Download the GPX file

## 📁 Project Structure

```
RunYourShapePOC/
├── backend/                    # FastAPI backend
│   ├── app/
│   │   ├── main.py            # Application entry point
│   │   ├── api/               # API endpoints
│   │   │   ├── routes.py      # Route generation
│   │   │   └── symbols.py     # Symbol management
│   │   ├── core/
│   │   │   └── settings.py    # Configuration
│   │   ├── models/            # Pydantic models
│   │   │   ├── route.py
│   │   │   └── symbol.py
│   │   └── services/          # Business logic
│   │       ├── shapes.py      # SVG parsing/normalization
│   │       ├── osm.py         # OpenStreetMap integration
│   │       ├── routing.py     # Route generation algorithm
│   │       └── gpx.py         # GPX file generation
│   ├── data/                  # Data storage (auto-created)
│   │   ├── symbols/           # Normalized symbols
│   │   └── osm_cache/         # Cached OSM data
│   ├── requirements.txt
│   └── README.md
│
├── frontend/                  # React + TypeScript frontend
│   ├── src/
│   │   ├── main.tsx          # Entry point
│   │   ├── App.tsx           # Main component
│   │   ├── components/
│   │   │   ├── MapView.tsx   # Leaflet map
│   │   │   └── Controls.tsx  # UI panel
│   │   ├── api.ts            # Backend API client
│   │   ├── config.ts         # Configuration
│   │   └── types.ts          # TypeScript types
│   ├── package.json
│   └── README.md
│
├── examples/                  # Example SVG files
│   ├── heart.svg
│   ├── star.svg
│   └── lightning.svg
│
└── README.md                  # This file
```

## 🔧 How It Works

### SVG Processing

1. **Upload**: User uploads an SVG file via API
2. **Parse**: Extract the main `<path>` element using `svgpathtools`
3. **Sample**: Convert bezier curves to ~100 discrete points
4. **Normalize**: 
   - Translate centroid to origin (0, 0)
   - Scale total length to 1.0 unit
5. **Store**: Save as JSON for fast loading

### Route Generation Algorithm

1. **Load Graph**: Download street network from OpenStreetMap around start point
2. **Transform Shape**:
   - Scale normalized shape to target distance
   - Try multiple rotations (0°, 45°, 90°, etc.)
   - Translate to start position (in lat/lon coordinates)
3. **Snap to Streets**:
   - For each point in transformed shape, find nearest street node
   - Track success rate (what % of points snap successfully)
4. **Build Route**:
   - Connect snapped nodes using shortest path (Dijkstra's algorithm)
   - Concatenate all path segments
5. **Select Best**: Choose rotation with best combination of:
   - High snap success rate
   - Distance close to target

### Technologies

**Backend:**
- **FastAPI**: Modern Python web framework
- **osmnx**: OpenStreetMap data download and processing
- **networkx**: Graph algorithms (shortest path)
- **svgpathtools**: SVG path parsing
- **gpxpy**: GPX file generation

**Frontend:**
- **React 18**: UI framework
- **TypeScript**: Type safety
- **Vite**: Fast build tool
- **Leaflet**: Interactive maps
- **axios**: HTTP client

## 📚 API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Key Endpoints

#### Upload Symbol
```bash
POST /symbols
Content-Type: multipart/form-data

# Example:
curl -X POST http://localhost:8000/symbols \
  -F "file=@heart.svg"
```

#### List Symbols
```bash
GET /symbols

# Example:
curl http://localhost:8000/symbols
```

#### Generate Route
```bash
POST /route
Content-Type: application/json

{
  "symbol_id": "heart_abc123",
  "start_lat": 48.8566,
  "start_lon": 2.3522,
  "target_distance_km": 5.0
}

# Example:
curl -X POST http://localhost:8000/route \
  -H "Content-Type: application/json" \
  -d '{
    "symbol_id": "heart_abc123",
    "start_lat": 48.8566,
    "start_lon": 2.3522,
    "target_distance_km": 5.0
  }'
```

#### Download GPX
```bash
POST /route/gpx/download
Content-Type: application/json

# Returns downloadable GPX file
```

## 🎨 UI Design

The frontend features a **neon-tech aesthetic**:

- **Dark Theme**: Near-black navy background (#020617)
- **Neon Accents**: Glowing yellow (#F5E642) for highlights
- **Glassmorphism**: Semi-transparent panels with backdrop blur
- **Typography**: Orbitron (headings) + Inter (body)
- **Effects**: Glowing borders, animated markers, smooth transitions

### Layout

- **Left 65%**: Interactive Leaflet map with dark tiles
- **Right 35%**: Floating control panel with neon border
- **Responsive**: Stacks vertically on mobile

## 🧪 Testing

### Manual Testing

1. **Upload a Simple Shape**:
   ```bash
   curl -X POST http://localhost:8000/symbols \
     -F "file=@examples/heart.svg"
   ```

2. **Test in Different Locations**:
   - Dense urban: Paris (48.8566, 2.3522)
   - Suburban: suburbs with less connected streets
   - Rural: may struggle due to sparse street networks

3. **Try Different Distances**:
   - Short (1-3 km): Usually works well
   - Medium (5-10 km): Best results
   - Long (15-20 km): May timeout or have lower quality match

### Known Limitations (POC)

- Route generation can take 10-30 seconds
- Complex shapes may not match well in sparse street networks
- No background job processing (synchronous API calls)
- No user authentication or rate limiting
- Limited error recovery if OSM download fails

## 🐛 Troubleshooting

### Backend Won't Start

**Issue**: Missing dependencies
```bash
pip install -r requirements.txt
```

**Issue**: Port 8000 already in use
```bash
# Edit backend/app/core/settings.py or set env var:
export API_PORT=8001
```

### Frontend Build Errors

**Issue**: Node version too old
```bash
# Requires Node 18+
node --version
```

**Issue**: Can't connect to backend
```bash
# Check backend is running
curl http://localhost:8000/health

# Configure API URL in frontend/.env
echo "VITE_API_BASE_URL=http://localhost:8000" > frontend/.env
```

### Route Generation Fails

**Issue**: No route generated
- Try a different starting location with denser streets
- Reduce target distance
- Try a simpler shape
- Check backend logs for errors

**Issue**: Timeout
- OSM download can be slow on first request
- Graph is cached after first download
- Try reducing `default_graph_radius_km` in settings

### Map Not Loading

**Issue**: Blank map
- Check internet connection (tiles load from CDN)
- Check browser console for errors
- Try a different map tile provider

## 🚀 Production Deployment

This is a **POC**, not production-ready. For production, consider:

### Backend
- Add authentication (OAuth2, JWT)
- Use async/background jobs (Celery, RQ)
- Add rate limiting (slowapi)
- Use proper database (PostgreSQL) instead of JSON files
- Add monitoring (Prometheus, Grafana)
- Deploy with Docker + Kubernetes

### Frontend
- Add error boundaries
- Implement service worker for offline support
- Add analytics
- Optimize bundle size
- Use CDN for static assets
- Add E2E tests (Playwright, Cypress)

### Infrastructure
- Use separate domains with HTTPS
- Set up CI/CD pipeline
- Add automated backups
- Configure proper CORS policies
- Use cloud storage for SVG files (S3, GCS)

## 📝 License

This is a Proof of Concept project. Feel free to use, modify, and distribute as you wish.

## 🙏 Credits

- **OpenStreetMap**: Street network data
- **CartoDB**: Dark map tiles
- **osmnx**: OSM Python library by Geoff Boeing
- **Leaflet**: Interactive mapping library
- Fonts: Google Fonts (Orbitron, Inter)

## 🤝 Contributing

This is a POC, but contributions are welcome! Areas for improvement:

- Better shape-matching algorithms
- Support for more SVG features (multiple paths, polygons)
- Route optimization (prefer scenic routes, avoid busy roads)
- User accounts and saved routes
- Social sharing features
- Mobile app version

## 📧 Contact

For questions or issues, please open a GitHub issue.

---

**Happy route tracing! 🏃‍♂️💛**

