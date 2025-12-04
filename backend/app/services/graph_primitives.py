"""
Extract geometric primitives (segments, arcs) from OSM graph.

This module analyzes a street network graph and identifies:
- Long straight segments
- Curved sections (arcs)
- Key intersections (junctions)
"""
import math
import numpy as np
from typing import List, Tuple, Dict, Optional, Set
from dataclasses import dataclass
import networkx as nx

from app.services.shape_skeletons import PrimitiveType, CurvatureDirection


@dataclass
class GraphPrimitive:
    """A geometric primitive extracted from the graph."""
    type: PrimitiveType
    nodes: List[int]  # Sequence of node IDs
    
    # Geometry
    start_point: Tuple[float, float]  # (lat, lon)
    end_point: Tuple[float, float]
    length_m: float
    
    # For segments: bearing (0-360, 0=north)
    # For arcs: average bearing
    bearing: float
    
    # For arcs: curvature info
    curvature: CurvatureDirection = CurvatureDirection.ANY
    arc_angle: float = 0.0  # Total turn angle
    
    # Quality metrics
    straightness: float = 1.0  # 1.0 = perfectly straight
    
    def __hash__(self):
        return hash(tuple(self.nodes))


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lon points."""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing (0-360) from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    
    x = math.sin(dlambda) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def angle_difference(angle1: float, angle2: float) -> float:
    """Calculate the smallest difference between two angles (-180 to 180)."""
    diff = (angle2 - angle1 + 180) % 360 - 180
    return diff


def classify_curvature(bearings: List[float]) -> Tuple[CurvatureDirection, float]:
    """
    Classify the curvature of a sequence of bearings.
    
    Returns:
        (direction, total_turn_angle)
    """
    if len(bearings) < 2:
        return CurvatureDirection.ANY, 0.0
    
    total_turn = 0.0
    for i in range(1, len(bearings)):
        turn = angle_difference(bearings[i-1], bearings[i])
        total_turn += turn
    
    if abs(total_turn) < 15:
        return CurvatureDirection.ANY, total_turn
    elif total_turn > 0:
        return CurvatureDirection.RIGHT, total_turn
    else:
        return CurvatureDirection.LEFT, total_turn


def extract_path_from_graph(
    graph: nx.MultiDiGraph,
    start_node: int,
    min_length_m: float = 100,
    max_length_m: float = 5000,
    straightness_threshold: float = 0.7
) -> Optional[GraphPrimitive]:
    """
    Extract a primitive starting from a node, following the most
    promising path until it curves too much or reaches a junction.
    """
    if start_node not in graph:
        return None
    
    path_nodes = [start_node]
    current = start_node
    total_length = 0.0
    bearings = []
    visited = {start_node}
    
    start_data = graph.nodes[start_node]
    start_lat, start_lon = start_data['y'], start_data['x']
    
    # Follow the path
    while total_length < max_length_m:
        # Get neighbors
        neighbors = list(graph.successors(current))
        neighbors = [n for n in neighbors if n not in visited]
        
        if not neighbors:
            break
        
        # If multiple choices (junction), stop here
        if len(neighbors) > 1 and total_length > min_length_m:
            break
        
        # Pick the neighbor that continues most straight
        current_data = graph.nodes[current]
        current_lat, current_lon = current_data['y'], current_data['x']
        
        best_neighbor = None
        best_score = -1
        
        for neighbor in neighbors:
            neighbor_data = graph.nodes[neighbor]
            n_lat, n_lon = neighbor_data['y'], neighbor_data['x']
            
            # Calculate bearing to this neighbor
            new_bearing = calculate_bearing(current_lat, current_lon, n_lat, n_lon)
            
            # Score based on continuation (prefer straight)
            if bearings:
                turn = abs(angle_difference(bearings[-1], new_bearing))
                score = 180 - turn  # Higher score for straighter
            else:
                score = 100  # First segment, any direction ok
            
            if score > best_score:
                best_score = score
                best_neighbor = neighbor
        
        if best_neighbor is None:
            break
        
        # Add to path
        neighbor_data = graph.nodes[best_neighbor]
        n_lat, n_lon = neighbor_data['y'], neighbor_data['x']
        
        segment_length = haversine_distance(current_lat, current_lon, n_lat, n_lon)
        total_length += segment_length
        
        new_bearing = calculate_bearing(current_lat, current_lon, n_lat, n_lon)
        bearings.append(new_bearing)
        
        path_nodes.append(best_neighbor)
        visited.add(best_neighbor)
        current = best_neighbor
    
    if total_length < min_length_m or len(path_nodes) < 2:
        return None
    
    # Calculate straightness
    end_data = graph.nodes[path_nodes[-1]]
    end_lat, end_lon = end_data['y'], end_data['x']
    direct_distance = haversine_distance(start_lat, start_lon, end_lat, end_lon)
    straightness = direct_distance / total_length if total_length > 0 else 0
    
    # Classify as segment or arc
    curvature, arc_angle = classify_curvature(bearings)
    
    if straightness > straightness_threshold:
        ptype = PrimitiveType.SEGMENT
    else:
        ptype = PrimitiveType.ARC
    
    avg_bearing = np.mean(bearings) if bearings else 0
    
    return GraphPrimitive(
        type=ptype,
        nodes=path_nodes,
        start_point=(start_lat, start_lon),
        end_point=(end_lat, end_lon),
        length_m=total_length,
        bearing=avg_bearing,
        curvature=curvature,
        arc_angle=arc_angle,
        straightness=straightness
    )


def find_junction_nodes(graph: nx.MultiDiGraph, min_degree: int = 3) -> List[int]:
    """Find nodes that are junctions (degree >= min_degree)."""
    junctions = []
    for node in graph.nodes:
        degree = graph.in_degree(node) + graph.out_degree(node)
        if degree >= min_degree:
            junctions.append(node)
    return junctions


def extract_primitives_from_graph(
    graph: nx.MultiDiGraph,
    min_length_m: float = 150,
    max_primitives: int = 200
) -> List[GraphPrimitive]:
    """
    Extract geometric primitives from the entire graph.
    
    Strategy:
    1. Find junction nodes (important intersections)
    2. From each junction, extract paths in each direction
    3. Also sample from non-junction nodes for coverage
    """
    primitives: List[GraphPrimitive] = []
    used_nodes: Set[int] = set()
    
    # Start from junctions
    junctions = find_junction_nodes(graph, min_degree=3)
    print(f"Found {len(junctions)} junction nodes")
    
    # Extract from junctions first
    for junction in junctions[:100]:  # Limit for performance
        primitive = extract_path_from_graph(graph, junction, min_length_m)
        if primitive and primitive.nodes[0] not in used_nodes:
            primitives.append(primitive)
            used_nodes.update(primitive.nodes[:3])  # Mark start nodes as used
        
        if len(primitives) >= max_primitives:
            break
    
    # If we need more, sample from other nodes
    if len(primitives) < max_primitives // 2:
        all_nodes = list(graph.nodes)
        np.random.shuffle(all_nodes)
        
        for node in all_nodes[:500]:
            if node in used_nodes:
                continue
            
            primitive = extract_path_from_graph(graph, node, min_length_m)
            if primitive:
                primitives.append(primitive)
                used_nodes.update(primitive.nodes[:3])
            
            if len(primitives) >= max_primitives:
                break
    
    print(f"Extracted {len(primitives)} primitives from graph")
    return primitives


def find_connected_primitives(
    graph: nx.MultiDiGraph,
    primitives: List[GraphPrimitive],
    max_gap_m: float = 300
) -> Dict[int, List[int]]:
    """
    Build a connectivity map between primitives.
    
    Returns:
        Dict mapping primitive index to list of connectable primitive indices
    """
    connections: Dict[int, List[int]] = {i: [] for i in range(len(primitives))}
    
    for i, p1 in enumerate(primitives):
        for j, p2 in enumerate(primitives):
            if i >= j:
                continue
            
            # Check if end of p1 is near start of p2
            dist1 = haversine_distance(
                p1.end_point[0], p1.end_point[1],
                p2.start_point[0], p2.start_point[1]
            )
            
            # Check if end of p2 is near start of p1
            dist2 = haversine_distance(
                p2.end_point[0], p2.end_point[1],
                p1.start_point[0], p1.start_point[1]
            )
            
            if dist1 < max_gap_m:
                connections[i].append(j)
            if dist2 < max_gap_m:
                connections[j].append(i)
    
    return connections


