# Shape Route Generator - Backend

FastAPI backend for generating running routes that match uploaded SVG shapes using OpenStreetMap data.

## Features

- **SVG Symbol Management**: Upload and normalize SVG shapes for use as route templates
- **Route Generation**: Generate running routes that match symbol shapes using real street networks
- **GPX Export**: Export routes as GPX files for use with GPS devices and running apps
- **OSM Integration**: Uses OpenStreetMap data via `osmnx` for accurate street networks

## Installation

### Prerequisites

- Python 3.9 or higher
- pip

### Setup

1. Create and activate a virtual environment:
```bash
python -m venv venv

# On Windows:
venv\Scripts\activate

# On macOS/Linux:
source venv/bin/activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file (optional, defaults work):
```bash
cp .env.example .env
```

## Running the API

Start the development server:

```bash
# From the backend directory:
python -m app.main

# Or using uvicorn directly:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs (interactive Swagger UI)
- **ReDoc**: http://localhost:8000/redoc

## API Endpoints

### Symbol Management

#### Upload SVG Symbol
```bash
POST /symbols
Content-Type: multipart/form-data

# Example with curl:
curl -X POST http://localhost:8000/symbols \
  -F "file=@path/to/shape.svg"
```

Response:
```json
{
  "metadata": {
    "id": "heart_a1b2c3d4",
    "name": "heart_a1b2c3d4",
    "original_filename": "heart.svg",
    "num_points": 100,
    "normalized_length": 1.0
  },
  "polyline": [[0.0, 0.1], [0.05, 0.15], ...]
}
```

#### List Symbols
```bash
GET /symbols

# Example:
curl http://localhost:8000/symbols
```

#### Get Symbol Details
```bash
GET /symbols/{symbol_id}

# Example:
curl http://localhost:8000/symbols/heart_a1b2c3d4
```

### Route Generation

#### Generate Route
```bash
POST /route
Content-Type: application/json

{
  "symbol_id": "heart_a1b2c3d4",
  "start_lat": 43.5,
  "start_lon": -1.5,
  "target_distance_km": 7.0
}

# Example with curl:
curl -X POST http://localhost:8000/route \
  -H "Content-Type: application/json" \
  -d '{
    "symbol_id": "heart_a1b2c3d4",
    "start_lat": 43.5,
    "start_lon": -1.5,
    "target_distance_km": 7.0
  }'
```

Response:
```json
{
  "coordinates": [[43.5001, -1.5002], [43.5005, -1.5008], ...],
  "distance_m": 7234.5,
  "symbol_id": "heart_a1b2c3d4",
  "start": [43.5, -1.5]
}
```

#### Generate Route with GPX
```bash
POST /route/gpx
Content-Type: application/json

{
  "symbol_id": "heart_a1b2c3d4",
  "start_lat": 43.5,
  "start_lon": -1.5,
  "target_distance_km": 7.0
}
```

Response includes both JSON data and GPX content.

#### Download GPX File
```bash
POST /route/gpx/download
Content-Type: application/json

{
  "symbol_id": "heart_a1b2c3d4",
  "start_lat": 43.5,
  "start_lon": -1.5,
  "target_distance_km": 7.0
}
```

Returns a downloadable GPX file.

## How It Works

### SVG Processing

1. **Parse SVG**: Extract path data from uploaded SVG files using `svgpathtools`
2. **Sample Points**: Convert bezier curves to 100 discrete points
3. **Normalize**: 
   - Translate centroid to (0, 0)
   - Scale so total polyline length = 1.0 unit
4. **Store**: Save normalized polyline as JSON for fast loading

### Route Generation

1. **Load Graph**: Download street network around start point using `osmnx`
2. **Transform Shape**: 
   - Scale normalized polyline to target distance
   - Try multiple rotations (0°, 45°, 90°, etc.)
   - Translate to start position
3. **Snap to Streets**: 
   - For each point in transformed shape, find nearest street node
   - Track success rate of snapping
4. **Build Route**: 
   - Connect snapped nodes using shortest path (Dijkstra)
   - Concatenate all segments into complete route
5. **Select Best**: Choose rotation/scale with best snap rate and distance match

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI application entry point
│   ├── api/
│   │   ├── routes.py        # Route generation endpoints
│   │   └── symbols.py       # Symbol management endpoints
│   ├── core/
│   │   └── settings.py      # Configuration and settings
│   ├── models/
│   │   ├── route.py         # Route data models
│   │   └── symbol.py        # Symbol data models
│   └── services/
│       ├── gpx.py           # GPX file generation
│       ├── osm.py           # OpenStreetMap graph loading
│       ├── routing.py       # Shape-based route generation
│       └── shapes.py        # SVG parsing and normalization
├── data/                    # Data storage (created automatically)
│   ├── symbols/             # Normalized symbol JSON files
│   └── osm_cache/           # Cached OSM graph data
├── .env.example             # Example environment variables
├── requirements.txt         # Python dependencies
└── README.md               # This file
```

## Configuration

Environment variables (`.env` file):

```bash
API_HOST=0.0.0.0
API_PORT=8000
DATA_DIR=./data
SYMBOLS_DIR=./data/symbols
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Testing

The backend includes basic error handling and validation. For manual testing:

1. Upload a simple SVG (e.g., a heart or star shape)
2. Note the returned `symbol_id`
3. Generate a route using that symbol
4. Download the GPX file

Example test locations:
- San Francisco: `37.7749, -122.4194`
- Paris: `48.8566, 2.3522`
- London: `51.5074, -0.1278`

## Known Limitations (POC)

- No authentication or user management
- Symbol files not deduplicated
- Graph caching is basic (via osmnx default)
- Route generation can take 10-30 seconds for complex shapes
- No async/background job processing
- Limited error recovery if OSM data unavailable

## Dependencies

Key libraries:
- **FastAPI**: Web framework
- **osmnx**: OpenStreetMap data and graph operations
- **networkx**: Graph algorithms (shortest path)
- **svgpathtools**: SVG parsing
- **gpxpy**: GPX file generation
- **numpy/scipy**: Numerical operations

## Troubleshooting

### OSM Download Errors
If you get timeout errors when downloading OSM data:
- Check internet connection
- Try a different location
- Reduce `default_graph_radius_km` in settings

### SVG Parse Errors
If SVG upload fails:
- Ensure SVG has at least one `<path>` element
- Simplify complex SVGs in an editor first
- Try exporting as "Plain SVG" from design tools

### Route Generation Fails
If route generation returns empty or short routes:
- Try a different rotation (algorithm tries multiple)
- Reduce target distance
- Choose a start point with dense street network
- Use a simpler symbol shape

## Future Improvements

For production, consider:
- Background job queue for route generation
- Caching generated routes
- User accounts and saved routes
- More sophisticated shape matching algorithms
- Route smoothing and optimization
- Support for multiple network types (bike, car)
- Rate limiting and API keys

