"""Service for shape-based route generation."""
import math
from typing import Dict, List, Optional, Tuple

import networkx as nx
import numpy as np
from pyproj import Transformer

from app.core.settings import settings
from app.services.osm import (
    calculate_path_length,
    get_graph_around_point,
    nearest_node,
    nodes_to_coordinates,
    shortest_path,
)


def polyline_length(points: List[Tuple[float, float]]) -> float:
    """Calculate the total length of a polyline."""
    if len(points) < 2:
        return 0.0

    return sum(math.dist(points[i], points[i + 1]) for i in range(len(points) - 1))


def scale_points(points: List[Tuple[float, float]], scale: float) -> List[Tuple[float, float]]:
    """Scale all points by a factor."""
    return [(x * scale, y * scale) for x, y in points]


def rotate_points(points: List[Tuple[float, float]], angle_deg: float) -> List[Tuple[float, float]]:
    """Rotate points around origin."""
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    return [(x * cos_a - y * sin_a, x * sin_a + y * cos_a) for x, y in points]


def translate_points(points: List[Tuple[float, float]], dx: float, dy: float) -> List[Tuple[float, float]]:
    """Translate points by an offset."""
    return [(x + dx, y + dy) for x, y in points]


def resample_polyline(points: List[Tuple[float, float]], spacing_m: float) -> List[Tuple[float, float]]:
    """Resample a polyline at regular spacing to reduce zigzags."""
    if len(points) < 2:
        return points

    cumulative = [0.0]
    for i in range(1, len(points)):
        cumulative.append(cumulative[-1] + math.dist(points[i - 1], points[i]))

    total_length = cumulative[-1]
    if total_length == 0:
        return points

    num_samples = max(int(total_length / spacing_m) + 1, 2)
    sample_distances = np.linspace(0, total_length, num_samples)

    resampled = []
    seg_idx = 0
    for target_d in sample_distances:
        while seg_idx < len(cumulative) - 2 and cumulative[seg_idx + 1] < target_d:
            seg_idx += 1

        p1 = np.array(points[seg_idx])
        p2 = np.array(points[seg_idx + 1])
        seg_len = cumulative[seg_idx + 1] - cumulative[seg_idx]
        if seg_len == 0:
            resampled.append(tuple(p1))
            continue

        t = (target_d - cumulative[seg_idx]) / seg_len
        interp = p1 + t * (p2 - p1)
        resampled.append((float(interp[0]), float(interp[1])))

    return resampled


def rotate_start(points: List[Tuple[float, float]], start_idx: int) -> List[Tuple[float, float]]:
    """Rotate the list so that start_idx becomes index 0."""
    if not points:
        return points
    return points[start_idx:] + points[:start_idx]


def create_local_transformer(lat: float, lon: float) -> Tuple[Transformer, Transformer]:
    """Create transformers for local projection around a point using Web Mercator."""
    ll_to_xy = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    xy_to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    return ll_to_xy, xy_to_ll


def rough_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in meters between two lat/lon points."""
    dy = (lat1 - lat2) * 111_000
    avg_lat = math.radians((lat1 + lat2) / 2.0)
    dx = (lon1 - lon2) * 85_000 * math.cos(avg_lat)
    return math.hypot(dx, dy)


def snap_points_to_graph(
    polyline: List[Tuple[float, float]],
    graph: nx.MultiDiGraph,
    max_distance_m: float = None
) -> Tuple[List[int], float, float]:
    """
    Snap each (lat, lon) point to the nearest graph node.

    Returns:
        snapped_nodes: list of node ids (duplicates kept)
        success_rate: fraction of points within max_distance_m
        avg_error_m: average snap distance in meters
    """
    if max_distance_m is None:
        max_distance_m = settings.max_snap_distance_m

    snapped_nodes: List[int] = []
    distances: List[float] = []
    successes = 0

    for lat, lon in polyline:
        try:
            node = nearest_node(graph, lat, lon)
        except Exception:
            continue

        node_data = graph.nodes[node]
        node_lat, node_lon = node_data["y"], node_data["x"]
        # Approximate meters using haversine simplification
        dy = (lat - node_lat) * 111_000
        dx = (lon - node_lon) * 85_000 * math.cos(math.radians(lat))
        dist = math.hypot(dx, dy)

        distances.append(dist)
        if dist <= max_distance_m:
            successes += 1

        snapped_nodes.append(node)

    success_rate = successes / len(polyline) if polyline else 0.0
    avg_error = sum(distances) / len(distances) if distances else float("inf")
    return snapped_nodes, success_rate, avg_error


def build_route_from_nodes(
    graph: nx.MultiDiGraph,
    nodes: List[int]
) -> Tuple[List[int], float]:
    """Build a connected route by chaining shortest paths between nodes."""
    if not nodes:
        return [], 0.0

    route_nodes: List[int] = []

    for i in range(len(nodes) - 1):
        start, end = nodes[i], nodes[i + 1]
        if start == end:
            if not route_nodes:
                route_nodes.append(start)
            continue

        try:
            path = shortest_path(graph, start, end)
            if not route_nodes:
                route_nodes.extend(path)
            else:
                route_nodes.extend(path[1:])
        except Exception:
            if not route_nodes:
                route_nodes.append(start)
            route_nodes.append(end)

    total_distance = calculate_path_length(graph, route_nodes)
    return route_nodes, total_distance


def generate_projected_route(
    symbol_polyline: List[Tuple[float, float]],
    start_lat: float,
    start_lon: float,
    target_distance_km: float,
    graph: nx.MultiDiGraph = None
) -> Tuple[List[Tuple[float, float]], float, Dict[str, float]]:
    """
    Generate a route by projecting the desired symbol around a specific start point.

    Returns a tuple of (coordinates, distance_m, diagnostics).
    """
    print("\n=== ROUTE GENERATION (projection mode) ===")
    print(f"Start: ({start_lat}, {start_lon})  Target: {target_distance_km} km")
    print(f"Symbol points: {len(symbol_polyline)}")

    base_length = polyline_length(symbol_polyline)
    if base_length == 0:
        diagnostics = {"mode": "projection", "score": float("inf"), "success_rate": 0.0}
        return [(start_lat, start_lon)], 0.0, diagnostics

    target_distance_m = target_distance_km * 1000
    scale = target_distance_m / base_length
    scaled_points = scale_points(symbol_polyline, scale)
    scaled_length = polyline_length(scaled_points)

    if graph is None:
        radius_km = min(max(target_distance_km * 0.6, 1.0), settings.default_graph_radius_km)
        print(f"Loading graph with radius {radius_km:.1f} km")
        graph = get_graph_around_point(start_lat, start_lon, radius_km)
        print(f"Graph loaded: {graph.number_of_nodes()} nodes")

    ll_to_xy, xy_to_ll = create_local_transformer(start_lat, start_lon)
    start_x, start_y = ll_to_xy.transform(start_lon, start_lat)

    rotations = list(range(0, 360, 30))
    spacing_m = max(40.0, min(120.0, target_distance_m / 80))

    best_route_nodes = None
    best_distance = 0.0
    best_score = float("inf")
    best_success = 0.0
    best_rotation = None
    best_avg_error = None
    best_distance_error = None

    fallback_points = None

    for rotation in rotations:
        rotated = rotate_points(scaled_points, rotation)
        if not rotated:
            continue

        rotated_arr = np.array(rotated)
        distances_from_center = np.linalg.norm(rotated_arr, axis=1)
        start_idx = int(np.argmax(distances_from_center))
        rotated = rotate_start(rotated, start_idx)

        x0, y0 = rotated[0]
        translated = translate_points(rotated, start_x - x0, start_y - y0)
        resampled_local = resample_polyline(translated, spacing_m)
        if not resampled_local:
            continue

        gps_points = []
        for x, y in resampled_local:
            lon, lat = xy_to_ll.transform(x, y)
            gps_points.append((lat, lon))

        if fallback_points is None:
            fallback_points = gps_points

        snapped_nodes, success_rate, avg_error = snap_points_to_graph(gps_points, graph)

        if not snapped_nodes or success_rate < 0.4:
            continue

        deduped_nodes: List[int] = []
        for node in snapped_nodes:
            if not deduped_nodes or node != deduped_nodes[-1]:
                deduped_nodes.append(node)

        if len(deduped_nodes) < 2:
            continue

        route_nodes, distance_m = build_route_from_nodes(graph, deduped_nodes)
        if not route_nodes:
            continue

        distance_error = abs(distance_m - target_distance_m) / target_distance_m
        score = avg_error + distance_error * 100 - success_rate * 10

        print(
            f"Rotation {rotation:3d}° → snap={success_rate:.1%}, "
            f"avg_err={avg_error:.1f}m, dist={distance_m/1000:.2f}km, score={score:.1f}"
        )

        if score < best_score:
            best_score = score
            best_route_nodes = route_nodes
            best_distance = distance_m
            best_success = success_rate
            best_rotation = rotation
            best_avg_error = avg_error
            best_distance_error = distance_error

            if success_rate > 0.75 and distance_error < 0.1:
                print("✓ Good match found, stopping early.")
                break

    if best_route_nodes:
        coords = nodes_to_coordinates(graph, best_route_nodes)
        metadata = {
            "mode": "projection",
            "score": best_score,
            "success_rate": best_success,
            "rotation": float(best_rotation) if best_rotation is not None else None,
            "avg_error_m": best_avg_error,
            "distance_error_pct": (best_distance_error or 0.0) * 100,
        }
        print(f"Best snap rate: {best_success:.1%}")
        print(f"Route length: {best_distance/1000:.2f} km")
        return coords, best_distance, metadata

    print("⚠️  Unable to snap shape to streets, returning projected polyline.")
    metadata = {"mode": "projection", "score": float("inf"), "success_rate": 0.0}
    if fallback_points:
        return fallback_points, scaled_length, metadata

    return [(start_lat, start_lon)], 0.0, metadata


def generate_search_route(
    symbol_polyline: List[Tuple[float, float]],
    search_center_lat: float,
    search_center_lon: float,
    target_distance_km: float,
    search_radius_km: Optional[float] = None
) -> Tuple[List[Tuple[float, float]], float, Dict[str, float]]:
    """
    Explore multiple candidate start points within a radius and keep the best match.
    """
    print("\n=== ROUTE GENERATION (search mode) ===")
    if search_radius_km is None:
        search_radius_km = max(1.5, target_distance_km * 0.8)

    # Build a graph covering the search region
    radius_km = min(search_radius_km * 1.2 + target_distance_km * 0.3, settings.default_graph_radius_km * 1.5)
    radius_km = max(radius_km, target_distance_km * 0.6, 1.5)
    print(f"Search radius: {search_radius_km:.1f} km (graph radius {radius_km:.1f} km)")
    graph = get_graph_around_point(search_center_lat, search_center_lon, radius_km)
    print(f"Graph for search: {graph.number_of_nodes()} nodes")

    if graph.number_of_nodes() == 0:
        return generate_projected_route(
            symbol_polyline,
            search_center_lat,
            search_center_lon,
            target_distance_km
        )

    # Rank nodes by distance to the center of the search
    ranked_nodes = []
    for node in graph.nodes:
        data = graph.nodes[node]
        dist_m = rough_distance_m(search_center_lat, search_center_lon, data["y"], data["x"])
        ranked_nodes.append((dist_m, node))

    ranked_nodes.sort(key=lambda item: item[0])
    max_candidates = min(20, len(ranked_nodes))
    candidate_nodes = [node for _, node in ranked_nodes[:max_candidates]]

    # Always include the closest node as first candidate
    if not candidate_nodes:
        candidate_nodes = list(graph.nodes)[:1]

    best_result = None
    best_total_score = float("inf")

    for candidate in candidate_nodes:
        data = graph.nodes[candidate]
        candidate_lat, candidate_lon = data["y"], data["x"]
        coords, distance_m, diagnostics = generate_projected_route(
            symbol_polyline,
            candidate_lat,
            candidate_lon,
            target_distance_km,
            graph=graph
        )

        candidate_score = diagnostics.get("score", float("inf"))
        candidate_success = diagnostics.get("success_rate", 0.0)
        penalty = rough_distance_m(search_center_lat, search_center_lon, candidate_lat, candidate_lon) / 1000.0
        total_score = candidate_score + penalty

        print(
            f"Candidate start ({candidate_lat:.5f}, {candidate_lon:.5f}) "
            f"→ score={candidate_score:.1f}, success={candidate_success:.1%}, total={total_score:.1f}"
        )

        if total_score < best_total_score:
            best_total_score = total_score
            best_result = (coords, distance_m, {**diagnostics, "start_lat": candidate_lat, "start_lon": candidate_lon})

    if best_result:
        coords, distance_m, diagnostics = best_result
        diagnostics["mode"] = "search"
        diagnostics["search_radius_km"] = search_radius_km
        return coords, distance_m, diagnostics

    print("Search mode failed to find a better candidate, falling back to projection.")
    return generate_projected_route(
        symbol_polyline,
        search_center_lat,
        search_center_lon,
        target_distance_km,
        graph=graph
    )


def generate_pattern_route(
    symbol_polyline: List[Tuple[float, float]],
    center_lat: float,
    center_lon: float,
    target_distance_km: float,
    search_radius_km: Optional[float] = None
) -> Tuple[List[Tuple[float, float]], float, Dict[str, float]]:
    """
    Generate a route using polygon simplification and crenel-tolerant routing.
    
    This approach:
    1. Simplifies the shape to a polygon (4-8 vertices)
    2. Routes between vertices allowing "crenel" (stair-step) patterns
    3. Accepts perpendicular deviations for curved sections
    """
    from app.services.polygon_routing import generate_polygon_route
    
    print(f"\n=== ROUTE GENERATION (polygon + crenel mode) ===")
    print(f"Center: ({center_lat}, {center_lon})")
    print(f"Target: {target_distance_km} km")
    
    if not symbol_polyline or len(symbol_polyline) < 3:
        print("Invalid polyline, falling back to projection")
        return generate_projected_route(
            symbol_polyline,
            center_lat,
            center_lon,
            target_distance_km
        )
    
    # Determine number of vertices based on shape complexity
    # More points for larger distances
    num_vertices = min(8, max(4, int(target_distance_km / 2) + 3))
    
    coordinates, distance_m, diagnostics = generate_polygon_route(
        symbol_polyline,
        center_lat,
        center_lon,
        target_distance_km,
        num_vertices=num_vertices
    )
    
    return coordinates, distance_m, diagnostics


def generate_route(
    symbol_polyline: List[Tuple[float, float]],
    start_lat: float,
    start_lon: float,
    target_distance_km: float,
    mode: str = "projection",
    search_radius_km: Optional[float] = None,
    shape_name: Optional[str] = None
) -> Tuple[List[Tuple[float, float]], float, Dict[str, float]]:
    """
    Entry point for route generation supporting multiple modes.
    
    Modes:
    - "projection": Project SVG shape at exact start point
    - "search": Try multiple start points to find best projection
    - "pattern": Search for road patterns matching shape's abstract skeleton
    """
    if mode == "pattern":
        return generate_pattern_route(
            symbol_polyline,
            start_lat,
            start_lon,
            target_distance_km,
            search_radius_km=search_radius_km
        )
    
    if mode == "search":
        return generate_search_route(
            symbol_polyline,
            start_lat,
            start_lon,
            target_distance_km,
            search_radius_km=search_radius_km
        )

    return generate_projected_route(
        symbol_polyline,
        start_lat,
        start_lon,
        target_distance_km
    )
