"""
Keypoint-based route generation - GPSArtify-style approach.

Instead of snapping every point of an SVG, this approach:
1. Extracts KEY POINTS from the shape (vertices, inflection points)
2. Projects these keypoints to nearby intersections
3. Tests multiple configurations to find the best fit
4. Connects keypoints with paths that follow the shape's curves
"""
import math
from typing import List, Tuple, Dict, Optional
import numpy as np
import networkx as nx
from itertools import product

from app.services.osm import (
    get_graph_around_point,
    nearest_node,
    shortest_path,
    nodes_to_coordinates,
    calculate_path_length,
)


def extract_keypoints(
    polyline: List[Tuple[float, float]],
    num_keypoints: int = 8,
    angle_threshold: float = 25.0
) -> List[Tuple[int, Tuple[float, float]]]:
    """
    Extract key points from a polyline based on curvature/angle changes.
    
    Returns list of (original_index, (x, y)) for each keypoint.
    """
    if len(polyline) < 3:
        return [(i, p) for i, p in enumerate(polyline)]
    
    # Calculate angle at each point
    angles = []
    for i in range(1, len(polyline) - 1):
        p0 = np.array(polyline[i - 1])
        p1 = np.array(polyline[i])
        p2 = np.array(polyline[i + 1])
        
        v1 = p0 - p1
        v2 = p2 - p1
        
        # Calculate angle between vectors
        dot = np.dot(v1, v2)
        det = v1[0] * v2[1] - v1[1] * v2[0]
        angle = math.degrees(math.atan2(det, dot))
        angles.append((i, abs(180 - abs(angle)), polyline[i]))
    
    # Sort by angle (sharpest corners first)
    angles.sort(key=lambda x: -x[1])
    
    # Select points with significant angle changes
    keypoints = [(0, polyline[0])]  # Always include start
    
    selected_indices = {0, len(polyline) - 1}
    
    for idx, angle, point in angles:
        if len(keypoints) >= num_keypoints - 1:
            break
        if angle > angle_threshold:
            # Check if not too close to already selected points
            min_dist = min(abs(idx - s) for s in selected_indices)
            if min_dist > len(polyline) // (num_keypoints * 2):
                keypoints.append((idx, point))
                selected_indices.add(idx)
    
    # If we don't have enough keypoints, sample uniformly
    if len(keypoints) < num_keypoints:
        step = len(polyline) // (num_keypoints - len(keypoints) + 1)
        for i in range(step, len(polyline) - 1, step):
            if i not in selected_indices and len(keypoints) < num_keypoints - 1:
                keypoints.append((i, polyline[i]))
                selected_indices.add(i)
    
    # Always include end point (or close the loop to start)
    if len(polyline) - 1 not in selected_indices:
        keypoints.append((len(polyline) - 1, polyline[-1]))
    
    # Sort by original index
    keypoints.sort(key=lambda x: x[0])
    
    return keypoints


def find_candidate_intersections(
    graph: nx.MultiDiGraph,
    target_lat: float,
    target_lon: float,
    max_distance_m: float = 500,
    max_candidates: int = 5
) -> List[Tuple[int, float]]:
    """
    Find candidate intersection nodes near a target point.
    
    Returns list of (node_id, distance_m) sorted by distance.
    """
    candidates = []
    
    for node in graph.nodes:
        data = graph.nodes[node]
        node_lat, node_lon = data['y'], data['x']
        
        # Approximate distance
        dy = (target_lat - node_lat) * 111_000
        dx = (target_lon - node_lon) * 111_000 * math.cos(math.radians(target_lat))
        dist = math.sqrt(dx*dx + dy*dy)
        
        if dist <= max_distance_m:
            # Prefer intersections (higher degree nodes)
            degree = graph.in_degree(node) + graph.out_degree(node)
            # Boost score for intersections
            effective_dist = dist / (1 + 0.1 * max(0, degree - 2))
            candidates.append((node, dist, effective_dist))
    
    # Sort by effective distance
    candidates.sort(key=lambda x: x[2])
    
    return [(node, dist) for node, dist, _ in candidates[:max_candidates]]


def score_path_curvature(
    graph: nx.MultiDiGraph,
    path_nodes: List[int],
    target_curve: List[Tuple[float, float]],
    ll_to_xy
) -> float:
    """
    Score how well a path follows the curvature of a target shape segment.
    Lower is better.
    """
    if len(path_nodes) < 2 or len(target_curve) < 2:
        return 0.0
    
    # Get path coordinates
    path_coords = []
    for node in path_nodes:
        data = graph.nodes[node]
        x, y = ll_to_xy.transform(data['x'], data['y'])
        path_coords.append((x, y))
    
    # Sample points along path and measure distance to target curve
    total_deviation = 0.0
    num_samples = min(10, len(path_coords))
    
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        
        # Interpolate point on path
        path_idx = min(int(t * (len(path_coords) - 1)), len(path_coords) - 2)
        path_t = t * (len(path_coords) - 1) - path_idx
        px = path_coords[path_idx][0] + path_t * (path_coords[path_idx + 1][0] - path_coords[path_idx][0])
        py = path_coords[path_idx][1] + path_t * (path_coords[path_idx + 1][1] - path_coords[path_idx][1])
        
        # Find closest point on target curve
        min_dist = float('inf')
        for cx, cy in target_curve:
            dist = math.sqrt((px - cx)**2 + (py - cy)**2)
            min_dist = min(min_dist, dist)
        
        total_deviation += min_dist
    
    return total_deviation / num_samples


def generate_keypoint_route(
    symbol_polyline: List[Tuple[float, float]],
    start_lat: float,
    start_lon: float,
    target_distance_km: float,
    graph: nx.MultiDiGraph = None
) -> Tuple[List[Tuple[float, float]], float, Dict]:
    """
    Generate a route using the keypoint-based approach.
    
    1. Scale and position the shape
    2. Extract keypoints
    3. Find candidate intersections for each keypoint
    4. Try combinations and pick the best
    5. Connect with shortest paths
    """
    from pyproj import Transformer
    
    print(f"\n=== KEYPOINT ROUTE GENERATION ===")
    print(f"Target: {target_distance_km} km")
    print(f"Input points: {len(symbol_polyline)}")
    
    # Create transformers
    ll_to_xy = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    xy_to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    
    # Convert start point
    start_x, start_y = ll_to_xy.transform(start_lon, start_lat)
    
    # Calculate scale
    original_length = sum(
        math.dist(symbol_polyline[i], symbol_polyline[i+1])
        for i in range(len(symbol_polyline) - 1)
    )
    if original_length == 0:
        return [(start_lat, start_lon)], 0.0, {"error": "empty_polyline"}
    
    target_length_m = target_distance_km * 1000
    scale = target_length_m / original_length
    
    # Scale the polyline
    scaled = [(x * scale, y * scale) for x, y in symbol_polyline]
    
    # Load graph if needed
    if graph is None:
        radius_km = max(target_distance_km * 0.5, 2.0)
        graph = get_graph_around_point(start_lat, start_lon, radius_km)
    
    print(f"Graph: {graph.number_of_nodes()} nodes")
    
    if graph.number_of_nodes() < 10:
        return [(start_lat, start_lon)], 0.0, {"error": "graph_too_small"}
    
    # Try multiple rotations
    best_route = None
    best_distance = 0
    best_score = float('inf')
    best_rotation = 0
    
    for rotation in range(0, 360, 30):
        # Rotate
        angle_rad = math.radians(rotation)
        cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
        rotated = [
            (x * cos_a - y * sin_a, x * sin_a + y * cos_a)
            for x, y in scaled
        ]
        
        # Translate to start point (first point at start)
        dx = start_x - rotated[0][0]
        dy = start_y - rotated[0][1]
        positioned = [(x + dx, y + dy) for x, y in rotated]
        
        # Extract keypoints (8-12 for good shape definition)
        num_kp = min(12, max(6, len(symbol_polyline) // 10))
        keypoint_data = extract_keypoints(positioned, num_keypoints=num_kp)
        
        print(f"  Rotation {rotation}°: {len(keypoint_data)} keypoints")
        
        # Convert keypoints to GPS
        keypoints_gps = []
        keypoints_local = []
        for idx, (x, y) in keypoint_data:
            lon, lat = xy_to_ll.transform(x, y)
            keypoints_gps.append((lat, lon))
            keypoints_local.append((x, y))
        
        # Find candidate intersections for each keypoint
        all_candidates = []
        for lat, lon in keypoints_gps:
            candidates = find_candidate_intersections(
                graph, lat, lon, 
                max_distance_m=400,
                max_candidates=3
            )
            if not candidates:
                # Fall back to nearest node
                try:
                    node = nearest_node(graph, lat, lon)
                    candidates = [(node, 0)]
                except:
                    candidates = []
            all_candidates.append(candidates)
        
        # Check if all keypoints have candidates
        if not all(candidates for candidates in all_candidates):
            continue
        
        # Try a few combinations (not all - too expensive)
        # Strategy: try best candidate for each, then try alternatives for worst-fitting ones
        
        # Start with best candidates
        selected_nodes = [candidates[0][0] for candidates in all_candidates]
        
        # Build route
        route_nodes = []
        total_score = 0
        
        for i in range(len(selected_nodes)):
            start_node = selected_nodes[i]
            end_node = selected_nodes[(i + 1) % len(selected_nodes)]
            
            if start_node == end_node:
                if not route_nodes:
                    route_nodes.append(start_node)
                continue
            
            try:
                path = shortest_path(graph, start_node, end_node)
                
                # Score this path segment
                seg_start_idx = keypoint_data[i][0]
                seg_end_idx = keypoint_data[(i + 1) % len(keypoint_data)][0]
                if seg_end_idx <= seg_start_idx:
                    seg_end_idx += len(positioned)
                
                target_segment = []
                for j in range(seg_start_idx, min(seg_end_idx + 1, len(positioned))):
                    target_segment.append(positioned[j % len(positioned)])
                
                seg_score = score_path_curvature(graph, path, target_segment, ll_to_xy)
                total_score += seg_score
                
                if not route_nodes:
                    route_nodes.extend(path)
                else:
                    route_nodes.extend(path[1:])
                    
            except Exception as e:
                # Direct connection failed, just add the node
                if not route_nodes:
                    route_nodes.append(start_node)
                route_nodes.append(end_node)
                total_score += 1000  # Penalty
        
        if not route_nodes:
            continue
        
        # Calculate distance
        distance_m = calculate_path_length(graph, route_nodes)
        distance_error = abs(distance_m - target_length_m) / target_length_m
        
        # Combine scores
        combined_score = total_score + distance_error * 500
        
        print(f"    → path_score={total_score:.0f}, dist={distance_m/1000:.2f}km, combined={combined_score:.0f}")
        
        if combined_score < best_score:
            best_score = combined_score
            best_route = route_nodes
            best_distance = distance_m
            best_rotation = rotation
    
    if best_route is None:
        print("No valid route found")
        return [(start_lat, start_lon)], 0.0, {"error": "no_route"}
    
    # Convert to coordinates
    coordinates = nodes_to_coordinates(graph, best_route)
    
    print(f"\n=== BEST ROUTE ===")
    print(f"Rotation: {best_rotation}°")
    print(f"Score: {best_score:.0f}")
    print(f"Distance: {best_distance/1000:.2f} km")
    
    diagnostics = {
        "mode": "keypoint",
        "rotation": best_rotation,
        "score": best_score,
        "num_keypoints": num_kp,
    }
    
    return coordinates, best_distance, diagnostics


