"""Main FastAPI application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import settings
from app.api import symbols, routes
from app.services.geocoding import geocode_address


# Create FastAPI app
app = FastAPI(
    title="Shape Route Generator API",
    description="Generate running routes that match uploaded SVG shapes",
    version="0.1.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(symbols.router)
app.include_router(routes.router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Shape Route Generator API",
        "version": "0.1.0",
        "endpoints": {
            "symbols": "/symbols",
            "route": "/route",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/geocode")
async def geocode(address: str):
    """Geocode an address to lat/lon coordinates."""
    result = geocode_address(address)
    if result:
        lat, lon = result
        return {"lat": lat, "lon": lon, "address": address}
    else:
        return {"error": "Address not found"}, 404


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True
    )

