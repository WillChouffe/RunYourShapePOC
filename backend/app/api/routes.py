"""API endpoints for route generation."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.models.route import RouteRequest, RouteResponse, GPXRouteRequest, GPXRouteResponse
from app.services.shapes import load_symbol
from app.services.routing import generate_route
from app.services.gpx import create_gpx_for_route


router = APIRouter(prefix="/route", tags=["routes"])


@router.post("", response_model=RouteResponse)
async def generate_route_endpoint(request: RouteRequest):
    """
    Generate a running route that matches a symbol shape.
    
    This endpoint:
    1. Loads the street graph around the start point
    2. Loads the requested symbol
    3. Transforms and snaps the symbol to the street network
    4. Returns the resulting route coordinates and distance
    """
    # Load symbol
    try:
        symbol = load_symbol(request.symbol_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Symbol '{request.symbol_id}' not found"
        )
    
    # Generate route
    try:
        coordinates, distance_m = generate_route(
            symbol.polyline,
            request.start_lat,
            request.start_lon,
            request.target_distance_km
        )
        
        return RouteResponse(
            coordinates=coordinates,
            distance_m=distance_m,
            symbol_id=request.symbol_id,
            start=(request.start_lat, request.start_lon)
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating route: {str(e)}"
        )


@router.post("/gpx", response_model=GPXRouteResponse)
async def generate_route_with_gpx(request: GPXRouteRequest):
    """
    Generate a route and return both JSON data and GPX content.
    """
    # Load symbol
    try:
        symbol = load_symbol(request.symbol_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Symbol '{request.symbol_id}' not found"
        )
    
    # Generate route
    try:
        coordinates, distance_m = generate_route(
            symbol.polyline,
            request.start_lat,
            request.start_lon,
            request.target_distance_km
        )
        
        # Create GPX
        gpx_content = create_gpx_for_route(
            coordinates,
            request.symbol_id,
            distance_m
        )
        
        return GPXRouteResponse(
            coordinates=coordinates,
            distance_m=distance_m,
            symbol_id=request.symbol_id,
            start=(request.start_lat, request.start_lon),
            gpx_content=gpx_content
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating route: {str(e)}"
        )


@router.post("/gpx/download")
async def download_gpx(request: GPXRouteRequest):
    """
    Generate a route and return GPX file for download.
    """
    # Load symbol
    try:
        symbol = load_symbol(request.symbol_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Symbol '{request.symbol_id}' not found"
        )
    
    # Generate route
    try:
        coordinates, distance_m = generate_route(
            symbol.polyline,
            request.start_lat,
            request.start_lon,
            request.target_distance_km
        )
        
        # Create GPX
        gpx_content = create_gpx_for_route(
            coordinates,
            request.symbol_id,
            distance_m
        )
        
        # Return as downloadable file
        filename = f"{request.symbol_id}_{distance_m/1000:.1f}km.gpx"
        return Response(
            content=gpx_content,
            media_type="application/gpx+xml",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating route: {str(e)}"
        )

