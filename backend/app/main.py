"""Main FastAPI application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import settings
from app.api import symbols, routes


# Create FastAPI app
app = FastAPI(
    title="Shape Route Generator API",
    description="Generate running routes that match uploaded SVG shapes",
    version="0.1.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True
    )

