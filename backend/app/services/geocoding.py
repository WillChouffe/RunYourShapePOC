"""Geocoding service for address search."""
import requests
from typing import Optional, Tuple


def geocode_address(address: str) -> Optional[Tuple[float, float]]:
    """
    Geocode an address using Nominatim (OpenStreetMap).
    
    Args:
        address: Address string to geocode
    
    Returns:
        Tuple of (lat, lon) or None if not found
    """
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": address,
        "format": "json",
        "limit": 1
    }
    headers = {
        "User-Agent": "ShapeRouteGenerator/0.1"
    }
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        
        results = response.json()
        if results and len(results) > 0:
            lat = float(results[0]["lat"])
            lon = float(results[0]["lon"])
            return (lat, lon)
        
        return None
    except Exception as e:
        print(f"Geocoding error: {e}")
        return None

