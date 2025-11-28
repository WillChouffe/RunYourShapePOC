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


def simplify_polyline(polyline: List[Tuple[float, float]], num_points: int = 30) -> List[Tuple[float, float]]:
    """
    Simplify a polyline to keep only the most important points.
    Uses Douglas-Peucker-like approach by sampling at regular intervals.
    
    Args:
        polyline: List of (x, y) points
        num_points: Target number of points to keep
    
    Returns:
        Simplified polyline
    """
    if len(polyline) <= num_points:
        return polyline
    
    # Sample at regular intervals
    indices = np.linspace(0, len(polyline) - 1, num_points, dtype=int)
    return [polyline[i] for i in indices]


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
    print(f"\n=== ROUTE GENERATION START ===")
    print(f"Start point: ({start_lat}, {start_lon})")
    print(f"Target distance: {target_distance_km} km (±30% tolerance = {target_distance_km * 0.7:.1f}-{target_distance_km * 1.3:.1f} km)")
    print(f"Symbol points: {len(symbol_polyline)}")
    
    # Load graph if not provided
    if graph is None:
        # Use smaller radius for better performance (max 3 km)
        radius_km = min(target_distance_km * 0.6, 3.0)
        print(f"Loading OSM graph with radius: {radius_km} km...")
        try:
            graph = get_graph_around_point(start_lat, start_lon, radius_km)
            print(f"Graph loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
        except Exception as e:
            print(f"ERROR loading graph: {e}")
            return [(start_lat, start_lon)], 0.0
    
    # The normalized polyline is in abstract units
    # We need to convert it to lat/lon space
    
    # Estimate scale: target distance in km, symbol has normalized length 1.0
    # This gives us the scale in km, but we need it in degrees
    # Rough approximation: 1 degree ≈ 111 km at equator
    target_scale_km = target_distance_km
    target_scale_deg = target_scale_km / 111.0
    
    # Try multiple rotations (reduced for performance)
    rotations = [0, 90, 180, 270]  # 4 main angles instead of 8
    best_route = None
    best_distance = 0
    best_success_rate = 0
    
    attempts = 0
    successful_snaps = 0
    
    print(f"\nTrying {len(rotations)} rotations × 8 scales = {len(rotations) * 8} combinations...")
    
    for rotation in rotations:
        # Transform the polyline
        # Try more scale variations to find the right size
        for scale_factor in [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]:
            attempts += 1
            scale = target_scale_deg * scale_factor
            
            # First transform with rotation and scale (centered at origin)
            arr = np.array(symbol_polyline)
            arr = arr * scale
            
            # Rotate
            angle_rad = np.deg2rad(rotation)
            cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
            rotation_matrix = np.array([
                [cos_a, -sin_a],
                [sin_a, cos_a]
            ])
            arr = arr @ rotation_matrix.T
            
            # Find the closest point to origin (this will be placed at start point)
            distances_to_origin = np.sqrt(np.sum(arr ** 2, axis=1))
            closest_idx = np.argmin(distances_to_origin)
            offset = arr[closest_idx]
            
            # Translate so the closest point is at the start location
            arr = arr - offset + np.array([start_lat, start_lon])
            
            transformed = [(float(x), float(y)) for x, y in arr]
            
            # IMPORTANT: Simplify to reduce zigzags - keep only key points
            # For star: ~25 points is enough to capture 5 branches
            simplified = simplify_polyline(transformed, num_points=25)
            
            # Snap to graph
            snapped_nodes, success_rate = snap_polyline_to_graph(simplified, graph)
            
            # Remove consecutive duplicate nodes to avoid backtracking
            unique_nodes = []
            for node in snapped_nodes:
                if not unique_nodes or node != unique_nodes[-1]:
                    unique_nodes.append(node)
            
            if attempts <= 3:  # Log first 3 attempts
                print(f"  Attempt {attempts}: rotation={rotation}°, scale={scale_factor:.1f}x → snap_rate={success_rate:.1%}")
            
            # Need reasonable success rate (lowered for better results)
            if success_rate < 0.2:
                continue
            
            successful_snaps += 1
            
            # Build route using unique nodes (no consecutive duplicates)
            route_nodes, distance_m = build_route_from_nodes(graph, unique_nodes)
            
            # Check if this is better than previous attempts
            # Prioritize shape matching over exact distance
            distance_km = distance_m / 1000.0
            distance_error = abs(distance_km - target_distance_km) / target_distance_km
            
            # Accept routes within ±30% of target (very tolerant)
            if distance_error > 0.3:
                continue  # Skip routes too far from target
            
            # Score prioritizing snap rate (shape quality) over distance precision
            # Weight: 80% shape quality, 20% distance accuracy
            score = success_rate * (1.0 - distance_error * 0.2)
            best_score = best_success_rate * (1.0 - abs(best_distance / 1000.0 - target_distance_km) / target_distance_km * 0.2) if best_route else 0
            
            if score > best_score:
                best_route = route_nodes
                best_distance = distance_m
                best_success_rate = success_rate
                
                # Early exit if we found a good enough route
                if best_success_rate > 0.6 and distance_error < 0.25:
                    print(f"✓ Excellent route found (snap={best_success_rate:.1%}, dist={distance_km:.2f}km), stopping early")
                    break  # Exit scale factor loop
        
        # Exit rotation loop if excellent route found
        if best_route and best_success_rate > 0.6:
            break  # Exit rotation loop
    
    # Convert best route to coordinates
    print(f"\n=== RESULTS ===")
    print(f"Total attempts: {attempts}")
    print(f"Successful snaps (>20%): {successful_snaps}")
    print(f"Best route found: {'YES' if best_route else 'NO'}")
    
    if best_route:
        print(f"Best success rate: {best_success_rate:.1%}")
        print(f"Route length: {best_distance/1000:.2f} km")
        print(f"Route nodes: {len(best_route)}")
        coordinates = nodes_to_coordinates(graph, best_route)
        return coordinates, best_distance
    else:
        # Fallback: just return a small route near the start
        print(f"⚠️ NO ROUTE FOUND - All combinations failed!")
        print(f"Possible reasons:")
        print(f"  - All snap rates < 20%")
        print(f"  - Scale too large/small for this area")
        print(f"  - Not enough streets in the area")
        start_node = nearest_node(graph, start_lat, start_lon)
        return [(start_lat, start_lon)], 0.0

