"""
Direction-locked routing with EXPLICIT crenel construction.

This approach creates visible stair-step patterns by:
1. Decomposing each segment into H (horizontal) and V (vertical) components
2. Finding streets that go in those specific directions
3. Alternating between H and V moves to create the crenel pattern
"""
import math
from typing import List, Tuple, Dict, Optional
import numpy as np
import networkx as nx

from app.services.osm import (
    get_graph_around_point,
    nearest_node,
    shortest_path,
    nodes_to_coordinates,
    calculate_path_length,
)


# Cache for nearest_node calls
_nearest_cache: Dict[Tuple[float, float], int] = {}


def cached_nearest_node(graph: nx.MultiDiGraph, lat: float, lon: float) -> int:
    """Cached version of nearest_node."""
    key = (round(lat, 5), round(lon, 5))
    if key not in _nearest_cache:
        _nearest_cache[key] = nearest_node(graph, lat, lon)
    return _nearest_cache[key]


def clear_cache():
    """Clear the nearest node cache."""
    global _nearest_cache
    _nearest_cache = {}


def get_node_coords(graph: nx.MultiDiGraph, node: int) -> Tuple[float, float]:
    """Get (lat, lon) for a node."""
    data = graph.nodes[node]
    return data['y'], data['x']


def find_neighbor_in_direction(
    graph: nx.MultiDiGraph,
    current_node: int,
    target_direction: str,  # 'N', 'S', 'E', 'W'
    visited: set,
    tolerance_deg: float = 45
) -> Optional[int]:
    """
    Find a neighbor that goes in the specified cardinal direction.
    """
    current_lat, current_lon = get_node_coords(graph, current_node)
    
    # Target bearing based on direction
    target_bearings = {
        'N': 0,
        'E': 90,
        'S': 180,
        'W': 270
    }
    target_bearing = target_bearings[target_direction]
    
    best_neighbor = None
    best_score = float('inf')
    
    for neighbor in graph.successors(current_node):
        if neighbor in visited:
            continue
        
        n_lat, n_lon = get_node_coords(graph, neighbor)
        
        # Calculate bearing to neighbor
        dlat = n_lat - current_lat
        dlon = n_lon - current_lon
        
        # Bearing: 0=N, 90=E, 180=S, 270=W
        bearing = math.degrees(math.atan2(dlon, dlat)) % 360
        
        # Check if within tolerance
        diff = abs(bearing - target_bearing)
        diff = min(diff, 360 - diff)
        
        if diff <= tolerance_deg:
            # Prefer neighbors further in the target direction
            if target_direction in ['N', 'S']:
                progress = abs(dlat)
            else:
                progress = abs(dlon)
            
            score = diff - progress * 1000  # Lower is better
            
            if score < best_score:
                best_score = score
                best_neighbor = neighbor
    
    return best_neighbor


def walk_in_direction(
    graph: nx.MultiDiGraph,
    start_node: int,
    direction: str,
    target_distance_m: float,
    visited: set,
    max_steps: int = 50
) -> Tuple[List[int], float]:
    """
    Walk in a cardinal direction until we've covered the target distance.
    Returns (path, actual_distance).
    """
    path = [start_node]
    current = start_node
    total_distance = 0.0
    local_visited = visited.copy()
    local_visited.add(start_node)
    
    for _ in range(max_steps):
        if total_distance >= target_distance_m * 0.8:  # 80% is good enough
            break
        
        next_node = find_neighbor_in_direction(
            graph, current, direction, local_visited
        )
        
        if next_node is None:
            break
        
        # Calculate distance
        c_lat, c_lon = get_node_coords(graph, current)
        n_lat, n_lon = get_node_coords(graph, next_node)
        
        dist = math.sqrt(
            ((n_lat - c_lat) * 111000)**2 +
            ((n_lon - c_lon) * 111000 * math.cos(math.radians(c_lat)))**2
        )
        
        path.append(next_node)
        local_visited.add(next_node)
        total_distance += dist
        current = next_node
    
    return path, total_distance


def crenel_route(
    graph: nx.MultiDiGraph,
    start_lat: float,
    start_lon: float,
    end_lat: float,
    end_lon: float,
    num_steps: int = 3,
    visited: set = None
) -> List[int]:
    """
    Create a crenel (stair-step) route from start to end.
    
    Instead of going diagonally, alternates between H and V movements.
    """
    if visited is None:
        visited = set()
    
    # Calculate total displacement needed
    dlat = end_lat - start_lat  # North/South (positive = North)
    dlon = end_lon - start_lon  # East/West (positive = East)
    
    # Determine primary directions
    v_dir = 'N' if dlat > 0 else 'S'
    h_dir = 'E' if dlon > 0 else 'W'
    
    # Distance in each direction (in meters)
    v_dist = abs(dlat) * 111000
    h_dist = abs(dlon) * 111000 * math.cos(math.radians(start_lat))
    
    # Distance per step
    v_step = v_dist / num_steps
    h_step = h_dist / num_steps
    
    # Start from nearest node
    current_node = cached_nearest_node(graph, start_lat, start_lon)
    full_path = [current_node]
    visited.add(current_node)
    
    # Alternate between H and V
    for i in range(num_steps):
        # Horizontal step
        if h_step > 50:  # Only if significant
            h_path, _ = walk_in_direction(
                graph, current_node, h_dir, h_step, visited
            )
            if len(h_path) > 1:
                full_path.extend(h_path[1:])
                visited.update(h_path)
                current_node = h_path[-1]
        
        # Vertical step
        if v_step > 50:  # Only if significant
            v_path, _ = walk_in_direction(
                graph, current_node, v_dir, v_step, visited
            )
            if len(v_path) > 1:
                full_path.extend(v_path[1:])
                visited.update(v_path)
                current_node = v_path[-1]
    
    # Connect to end point if needed
    end_node = cached_nearest_node(graph, end_lat, end_lon)
    if current_node != end_node:
        try:
            final_path = shortest_path(graph, current_node, end_node)
            full_path.extend(final_path[1:])
        except:
            pass
    
    return full_path


def create_circle_points(
    center_lat: float,
    center_lon: float,
    radius_m: float,
    num_points: int = 8
) -> List[Tuple[float, float]]:
    """Create points on a circle."""
    points = []
    for i in range(num_points):
        angle = 2 * math.pi * i / num_points
        
        # Offset in meters
        dx = radius_m * math.sin(angle)
        dy = radius_m * math.cos(angle)
        
        # Convert to lat/lon
        lat = center_lat + dy / 111000
        lon = center_lon + dx / (111000 * math.cos(math.radians(center_lat)))
        
        points.append((lat, lon))
    
    return points


def extract_key_vertices(
    polyline: List[Tuple[float, float]],
    num_vertices: int = 8
) -> List[Tuple[float, float]]:
    """
    Extract key vertices (corners) from a normalized polyline.
    Samples uniformly along the polyline.
    """
    if len(polyline) <= num_vertices:
        return polyline
    
    # Sample uniformly
    step = len(polyline) / num_vertices
    indices = [int(i * step) for i in range(num_vertices)]
    
    return [polyline[i] for i in indices]


def scale_and_position_polyline(
    polyline: List[Tuple[float, float]],
    center_lat: float,
    center_lon: float,
    target_perimeter_m: float
) -> List[Tuple[float, float]]:
    """
    Scale and position a normalized polyline to the target location.
    """
    if not polyline:
        return []
    
    arr = np.array(polyline)
    
    # Find bounding box of normalized shape
    min_x, min_y = arr.min(axis=0)
    max_x, max_y = arr.max(axis=0)
    width = max_x - min_x
    height = max_y - min_y
    
    # Center of the shape
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    
    # Scale to target size (perimeter -> approximate diameter)
    target_size_m = target_perimeter_m / math.pi  # Rough diameter
    
    # Scale based on the largest dimension
    max_dim = max(width, height) if max(width, height) > 0 else 1
    scale = target_size_m / max_dim
    
    # Convert to lat/lon
    positioned = []
    for x, y in polyline:
        # Center and scale
        dx = (x - cx) * scale
        dy = (y - cy) * scale
        
        # Convert meters to lat/lon (note: y is inverted for SVG)
        lat = center_lat - dy / 111000  # Invert Y
        lon = center_lon + dx / (111000 * math.cos(math.radians(center_lat)))
        
        positioned.append((lat, lon))
    
    return positioned


def create_heart_points(
    center_lat: float,
    center_lon: float,
    size_m: float
) -> List[Tuple[float, float]]:
    """Create key points of a heart shape."""
    # Heart: bottom point, two side bumps, top indent
    points = []
    
    # Scale factor
    s = size_m / 111000
    cos_lat = math.cos(math.radians(center_lat))
    
    # Bottom point (tip of heart)
    points.append((center_lat - s * 1.2, center_lon))
    
    # Left side
    points.append((center_lat - s * 0.3, center_lon - s * 1.0 / cos_lat))
    
    # Left bump (top of left lobe)
    points.append((center_lat + s * 0.8, center_lon - s * 0.7 / cos_lat))
    
    # Top indent
    points.append((center_lat + s * 0.5, center_lon))
    
    # Right bump (top of right lobe)
    points.append((center_lat + s * 0.8, center_lon + s * 0.7 / cos_lat))
    
    # Right side
    points.append((center_lat - s * 0.3, center_lon + s * 1.0 / cos_lat))
    
    return points


def generate_polygon_route(
    symbol_polyline: List[Tuple[float, float]],
    center_lat: float,
    center_lon: float,
    target_distance_km: float,
    num_vertices: int = 8
) -> Tuple[List[Tuple[float, float]], float, Dict]:
    """
    Generate a route using direction-locked crenel routing.
    NOW USES THE ACTUAL SVG SHAPE!
    """
    print(f"\n=== DIRECTION-LOCKED CRENEL ROUTING ===")
    print(f"Center: ({center_lat}, {center_lon})")
    print(f"Target: {target_distance_km} km")
    print(f"Input polyline: {len(symbol_polyline)} points")
    
    # Clear cache for fresh start
    clear_cache()
    
    target_perimeter_m = target_distance_km * 1000
    
    # Load graph - keep it small for speed
    graph_radius = min(3.0, max(1.5, target_distance_km * 0.4))
    graph = get_graph_around_point(center_lat, center_lon, graph_radius)
    print(f"Graph: {graph.number_of_nodes()} nodes (radius {graph_radius:.1f}km)")
    
    if graph.number_of_nodes() < 50:
        return [(center_lat, center_lon)], 0.0, {"error": "graph_too_small"}
    
    # USE THE ACTUAL SVG POLYLINE!
    if symbol_polyline and len(symbol_polyline) >= 3:
        # Extract key vertices from the SVG
        key_vertices = extract_key_vertices(symbol_polyline, num_vertices=num_vertices)
        # Scale and position at target location
        shape_points = scale_and_position_polyline(
            key_vertices, center_lat, center_lon, target_perimeter_m
        )
        print(f"Shape: {len(shape_points)} vertices from SVG")
    else:
        # Fallback to circle if no valid polyline
        radius_m = target_perimeter_m / (2 * math.pi)
        shape_points = create_circle_points(center_lat, center_lon, radius_m, num_points=8)
        print(f"Shape: octagon fallback (no valid SVG)")
    
    # Try a few rotations
    best_route = None
    best_distance = 0
    best_rotation = 0
    best_error = float('inf')
    
    target_m = target_distance_km * 1000
    
    for rotation_idx in range(4):  # Only 4 rotations for speed
        rotation = rotation_idx * 22.5  # 0, 22.5, 45, 67.5 degrees
        
        # Rotate points
        angle_rad = math.radians(rotation)
        cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
        
        rotated_points = []
        for lat, lon in shape_points:
            # Rotate around center
            dlat = lat - center_lat
            dlon = lon - center_lon
            
            new_dlat = dlat * cos_a - dlon * sin_a
            new_dlon = dlat * sin_a + dlon * cos_a
            
            rotated_points.append((center_lat + new_dlat, center_lon + new_dlon))
        
        # Build route with crenels
        route_nodes = []
        visited = set()
        
        for i in range(len(rotated_points)):
            start = rotated_points[i]
            end = rotated_points[(i + 1) % len(rotated_points)]
            
            # Create crenel route for this segment
            segment = crenel_route(
                graph,
                start[0], start[1],
                end[0], end[1],
                num_steps=2,  # 2 steps = 1 crenel per segment
                visited=visited
            )
            
            if segment:
                if not route_nodes:
                    route_nodes.extend(segment)
                else:
                    # Connect to previous
                    if segment[0] != route_nodes[-1]:
                        try:
                            conn = shortest_path(graph, route_nodes[-1], segment[0])
                            route_nodes.extend(conn[1:])
                        except:
                            pass
                    route_nodes.extend(segment[1:] if segment[0] == route_nodes[-1] else segment)
                
                visited.update(segment)
        
        if len(route_nodes) < 5:
            continue
        
        # Calculate distance
        distance = calculate_path_length(graph, route_nodes)
        error = abs(distance - target_m) / target_m
        
        print(f"  Rotation {rotation:5.1f}°: {len(route_nodes):4d} nodes, "
              f"{distance/1000:.2f}km, error={error*100:.1f}%")
        
        if error < best_error:
            best_error = error
            best_route = route_nodes
            best_distance = distance
            best_rotation = rotation
    
    if best_route is None:
        print("No valid route found")
        return [(center_lat, center_lon)], 0.0, {"error": "no_route"}
    
    # Convert to coordinates
    coordinates = nodes_to_coordinates(graph, best_route)
    
    print(f"\n=== RESULT ===")
    print(f"Rotation: {best_rotation}°")
    print(f"Distance: {best_distance/1000:.2f} km")
    print(f"Error: {best_error*100:.1f}%")
    
    diagnostics = {
        "mode": "crenel",
        "rotation": best_rotation,
        "error_pct": best_error * 100,
    }
    
    return coordinates, best_distance, diagnostics
