"""Data models for route generation."""
from pydantic import BaseModel, Field
from typing import List, Tuple


class RouteRequest(BaseModel):
    """Request to generate a route."""
    symbol_id: str = Field(..., description="ID of the symbol to use")
    start_lat: float = Field(..., ge=-90, le=90, description="Starting latitude")
    start_lon: float = Field(..., ge=-180, le=180, description="Starting longitude")
    target_distance_km: float = Field(..., gt=0, le=50, description="Target distance in kilometers")


class RouteResponse(BaseModel):
    """Response containing generated route."""
    coordinates: List[Tuple[float, float]] = Field(..., description="List of [lat, lon] pairs")
    distance_m: float = Field(..., description="Total distance in meters")
    symbol_id: str
    start: Tuple[float, float] = Field(..., description="Starting coordinates [lat, lon]")


class GPXRouteRequest(RouteRequest):
    """Request to generate a route and return GPX."""
    pass


class GPXRouteResponse(RouteResponse):
    """Response with route and GPX data."""
    gpx_content: str = Field(..., description="GPX file content as string")

