"""Service for shape-based route generation."""
import numpy as np
import networkx as nx
from typing import List, Tuple
from scipy.spatial.distance import cdist

from app.core.settings import settings
from app.services.osm import (
    get_graph_around_point,
    nearest_node,
    shortest_path,
    nodes_to_coordinates,
    calculate_path_length
)


def transform_polyline(
    polyline: List[Tuple[float, float]],
    scale: float,
    rotation_deg: float,
    translation: Tuple[float, float]
) -> List[Tuple[float, float]]:
    """
    Apply scale, rotation, and translation to a polyline.
    
    Args:
        polyline: List of (x, y) points
        scale: Scale factor
        rotation_deg: Rotation in degrees
        translation: (dx, dy) translation
    
    Returns:
        Transformed polyline
    """
    arr = np.array(polyline)
    
    # Scale
    arr = arr * scale
    
    # Rotate
    angle_rad = np.deg2rad(rotation_deg)
    cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
    rotation_matrix = np.array([
        [cos_a, -sin_a],
        [sin_a, cos_a]
    ])
    arr = arr @ rotation_matrix.T
    
    # Translate
    arr = arr + np.array(translation)
    
    return [(float(x), float(y)) for x, y in arr]


def snap_polyline_to_graph(
    polyline: List[Tuple[float, float]],
    graph: nx.MultiDiGraph,
    max_distance_m: float = None
) -> Tuple[List[int], float]:
    """
    Snap each point in a polyline to nearest graph nodes.
    
    The polyline is in (lat, lon) coordinates.
    
    Args:
        polyline: List of (lat, lon) points
        graph: NetworkX graph
        max_distance_m: Maximum snap distance in meters
    
    Returns:
        Tuple of (snapped_nodes, success_rate)
        - snapped_nodes: List of node IDs
        - success_rate: Fraction of points successfully snapped
    """
    if max_distance_m is None:
        max_distance_m = settings.max_snap_distance_m
    
    snapped_nodes = []
    successful_snaps = 0
    
    for lat, lon in polyline:
        try:
            node = nearest_node(graph, lat, lon)
            
            # Check if node is within acceptable distance
            node_data = graph.nodes[node]
            node_lat, node_lon = node_data['y'], node_data['x']
            
            # Simple euclidean distance check (rough approximation)
            # For more accuracy, could use haversine distance
            dist_deg = np.sqrt((lat - node_lat)**2 + (lon - node_lon)**2)
            dist_m = dist_deg * 111000  # Rough conversion: 1 degree ≈ 111km
            
            if dist_m <= max_distance_m:
                snapped_nodes.append(node)
                successful_snaps += 1
            else:
                # Still add the node but don't count as successful
                snapped_nodes.append(node)
        except Exception as e:
            print(f"Error snapping point ({lat}, {lon}): {e}")
            # Skip this point
            continue
    
    success_rate = successful_snaps / len(polyline) if polyline else 0
    return snapped_nodes, success_rate


def build_route_from_nodes(
    graph: nx.MultiDiGraph,
    nodes: List[int]
) -> Tuple[List[int], float]:
    """
    Build a complete route by finding shortest paths between consecutive nodes.
    
    Args:
        graph: NetworkX graph
        nodes: List of target node IDs to visit in order
    
    Returns:
        Tuple of (route_nodes, total_distance_m)
        - route_nodes: Complete list of node IDs forming the route
        - total_distance_m: Total distance in meters
    """
    if not nodes:
        return [], 0.0
    
    route_nodes = []
    
    for i in range(len(nodes) - 1):
        start, end = nodes[i], nodes[i + 1]
        
        # Skip if same node
        if start == end:
            if not route_nodes:
                route_nodes.append(start)
            continue
        
        # Find shortest path
        try:
            path = shortest_path(graph, start, end)
            
            # Add path, avoiding duplicates at connection points
            if not route_nodes:
                route_nodes.extend(path)
            else:
                route_nodes.extend(path[1:])  # Skip first node (already in route)
        except Exception as e:
            print(f"Error finding path from {start} to {end}: {e}")
            # Just add the end node to keep going
            if not route_nodes:
                route_nodes.append(start)
            route_nodes.append(end)
    
    # Calculate total distance
    total_distance = calculate_path_length(graph, route_nodes)
    
    return route_nodes, total_distance


def generate_route(
    symbol_polyline: List[Tuple[float, float]],
    start_lat: float,
    start_lon: float,
    target_distance_km: float,
    graph: nx.MultiDiGraph = None
) -> Tuple[List[Tuple[float, float]], float]:
    """
    Generate a route that matches a symbol shape.
    
    This is the main routing algorithm. It:
    1. Loads the street graph around the start point
    2. Tries multiple rotations and scales of the normalized symbol
    3. Snaps the transformed symbol to the graph
    4. Builds a connected route through the snapped nodes
    
    Args:
        symbol_polyline: Normalized symbol polyline (centered at origin, unit length)
        start_lat: Starting latitude
        start_lon: Starting longitude
        target_distance_km: Target distance in kilometers
        graph: Optional pre-loaded graph (for testing)
    
    Returns:
        Tuple of (coordinates, distance_m)
        - coordinates: List of (lat, lon) points forming the route
        - distance_m: Total distance in meters
    """
    # Load graph if not provided
    if graph is None:
        # Use a larger radius to ensure we have enough space
        radius_km = max(target_distance_km * 0.8, settings.default_graph_radius_km)
        graph = get_graph_around_point(start_lat, start_lon, radius_km)
    
    # The normalized polyline is in abstract units
    # We need to convert it to lat/lon space
    
    # Estimate scale: target distance in km, symbol has normalized length 1.0
    # This gives us the scale in km, but we need it in degrees
    # Rough approximation: 1 degree ≈ 111 km at equator
    target_scale_km = target_distance_km
    target_scale_deg = target_scale_km / 111.0
    
    # Try multiple rotations
    rotations = [0, 45, 90, 135, 180, 225, 270, 315]
    best_route = None
    best_distance = 0
    best_success_rate = 0
    
    for rotation in rotations:
        # Transform the polyline
        # Start with the target scale
        for scale_factor in [1.0, 0.9, 0.8, 1.1, 1.2]:
            scale = target_scale_deg * scale_factor
            
            # Translate so it's centered near the start point
            transformed = transform_polyline(
                symbol_polyline,
                scale,
                rotation,
                (start_lat, start_lon)
            )
            
            # Snap to graph
            snapped_nodes, success_rate = snap_polyline_to_graph(transformed, graph)
            
            # Need reasonable success rate
            if success_rate < 0.3:
                continue
            
            # Build route
            route_nodes, distance_m = build_route_from_nodes(graph, snapped_nodes)
            
            # Check if this is better than previous attempts
            # Prefer routes that are closer to target distance and have better snap rate
            distance_km = distance_m / 1000.0
            distance_error = abs(distance_km - target_distance_km) / target_distance_km
            
            # Score combining success rate and distance accuracy
            score = success_rate * (1.0 - distance_error * 0.5)
            best_score = best_success_rate * (1.0 - abs(best_distance / 1000.0 - target_distance_km) / target_distance_km * 0.5) if best_route else 0
            
            if score > best_score:
                best_route = route_nodes
                best_distance = distance_m
                best_success_rate = success_rate
    
    # Convert best route to coordinates
    if best_route:
        coordinates = nodes_to_coordinates(graph, best_route)
        return coordinates, best_distance
    else:
        # Fallback: just return a small route near the start
        start_node = nearest_node(graph, start_lat, start_lon)
        return [(start_lat, start_lon)], 0.0

