"""Service for GPX file generation."""
import gpxpy
import gpxpy.gpx
from typing import List, Tuple
from datetime import datetime


def create_gpx(
    coordinates: List[Tuple[float, float]],
    name: str = "Shape Route",
    description: str = None
) -> str:
    """
    Create a GPX file from a list of coordinates.
    
    Args:
        coordinates: List of (lat, lon) tuples
        name: Track name
        description: Optional track description
    
    Returns:
        GPX file content as string
    """
    # Create GPX object
    gpx = gpxpy.gpx.GPX()
    
    # Create track
    gpx_track = gpxpy.gpx.GPXTrack()
    gpx_track.name = name
    if description:
        gpx_track.description = description
    gpx.tracks.append(gpx_track)
    
    # Create segment
    gpx_segment = gpxpy.gpx.GPXTrackSegment()
    gpx_track.segments.append(gpx_segment)
    
    # Add points
    for lat, lon in coordinates:
        gpx_segment.points.append(gpxpy.gpx.GPXTrackPoint(lat, lon))
    
    # Convert to XML string
    return gpx.to_xml()


def create_gpx_for_route(
    coordinates: List[Tuple[float, float]],
    symbol_id: str,
    distance_m: float
) -> str:
    """
    Create a GPX file for a generated route.
    
    Args:
        coordinates: List of (lat, lon) tuples
        symbol_id: ID of the symbol used
        distance_m: Total distance in meters
    
    Returns:
        GPX file content as string
    """
    distance_km = distance_m / 1000.0
    name = f"{symbol_id} - {distance_km:.2f}km"
    description = f"Route matching '{symbol_id}' shape, approximately {distance_km:.2f}km"
    
    return create_gpx(coordinates, name, description)

