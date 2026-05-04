"""
Pattern matching engine for finding shape-like structures in road networks.

This module searches for sequences of road segments/arcs that match
the abstract skeleton of a shape (heart, star, etc.) with tolerance
for angle variations, length ratios, etc.
"""
import math
from typing import List, Tuple, Dict, Optional, Set
from dataclasses import dataclass
import networkx as nx
import numpy as np

from app.services.shape_skeletons import (
    ShapeSkeleton, SkeletonPrimitive, PrimitiveType, CurvatureDirection
)
from app.services.graph_primitives import (
    GraphPrimitive, haversine_distance, calculate_bearing, angle_difference,
    extract_primitives_from_graph, find_junction_nodes
)
from app.services.osm import shortest_path, nodes_to_coordinates, calculate_path_length


@dataclass
class MatchCandidate:
    """A candidate match for a shape pattern."""
    primitives: List[GraphPrimitive]
    nodes: List[int]  # All nodes in order
    score: float  # Lower is better
    total_length_m: float
    
    # Diagnostics
    angle_errors: List[float] = None
    length_errors: List[float] = None
    closure_gap_m: float = 0.0
    
    def __lt__(self, other):
        return self.score < other.score


def score_primitive_match(
    skeleton_prim: SkeletonPrimitive,
    graph_prim: GraphPrimitive,
    prev_bearing: Optional[float] = None,
    reference_length: float = 500.0
) -> Tuple[float, Dict]:
    """
    Score how well a graph primitive matches a skeleton primitive.
    
    Returns:
        (score, diagnostics) - lower score is better match
    """
    score = 0.0
    diagnostics = {}
    
    # Type matching
    if skeleton_prim.type != graph_prim.type:
        # Penalize type mismatch, but don't reject completely
        # (a slightly curved road might still work as a "segment")
        if skeleton_prim.type == PrimitiveType.SEGMENT and graph_prim.straightness > 0.6:
            score += 20  # Acceptable
        elif skeleton_prim.type == PrimitiveType.ARC and graph_prim.straightness < 0.9:
            score += 20  # Acceptable
        else:
            score += 100  # Bad mismatch
        diagnostics['type_penalty'] = score
    
    # Length ratio check
    expected_length = reference_length * skeleton_prim.length_ratio
    length_error = abs(graph_prim.length_m - expected_length) / expected_length
    length_tolerance = skeleton_prim.length_tolerance
    
    if length_error <= length_tolerance:
        score += length_error * 30
    else:
        score += 30 + (length_error - length_tolerance) * 50
    diagnostics['length_error'] = length_error
    
    # Angle check (relative to previous direction)
    if prev_bearing is not None:
        actual_turn = angle_difference(prev_bearing, graph_prim.bearing)
        expected_turn = skeleton_prim.angle
        angle_error = abs(angle_difference(expected_turn, actual_turn))
        
        if angle_error <= skeleton_prim.angle_tolerance:
            score += angle_error * 0.5
        else:
            score += skeleton_prim.angle_tolerance * 0.5 + (angle_error - skeleton_prim.angle_tolerance) * 2
        diagnostics['angle_error'] = angle_error
    
    # Curvature direction (for arcs)
    if skeleton_prim.type == PrimitiveType.ARC:
        if skeleton_prim.curvature != CurvatureDirection.ANY:
            if skeleton_prim.curvature != graph_prim.curvature:
                score += 50  # Wrong curve direction
                diagnostics['curvature_penalty'] = 50
    
    diagnostics['total_score'] = score
    return score, diagnostics


def search_pattern_from_node(
    graph: nx.MultiDiGraph,
    start_node: int,
    skeleton: ShapeSkeleton,
    target_length_m: float,
    max_depth: int = 20
) -> Optional[MatchCandidate]:
    """
    Search for a pattern match starting from a specific node.
    
    Uses a beam search approach: at each step, keep the best partial matches
    and try to extend them with the next skeleton primitive.
    """
    reference_length = target_length_m / skeleton.num_primitives
    
    start_data = graph.nodes[start_node]
    start_lat, start_lon = start_data['y'], start_data['x']
    
    # Initialize beam with starting point
    # Each entry: (nodes_so_far, primitives_matched, current_score, last_bearing)
    beam = [([start_node], [], 0.0, None)]
    beam_width = 10
    
    for prim_idx, skel_prim in enumerate(skeleton.primitives):
        new_beam = []
        
        for nodes, matched_prims, score, last_bearing in beam:
            current_node = nodes[-1]
            current_data = graph.nodes[current_node]
            current_lat, current_lon = current_data['y'], current_data['x']
            
            # Try to find paths from current node that match this primitive
            candidates = explore_paths_for_primitive(
                graph, current_node, skel_prim, 
                reference_length, last_bearing,
                max_depth=max_depth
            )
            
            for path_nodes, path_prim, prim_score in candidates:
                total_score = score + prim_score
                new_nodes = nodes + path_nodes[1:]  # Avoid duplicating connection node
                new_prims = matched_prims + [path_prim]
                new_bearing = path_prim.bearing
                
                new_beam.append((new_nodes, new_prims, total_score, new_bearing))
        
        if not new_beam:
            return None  # Couldn't match this primitive
        
        # Keep best candidates (beam search)
        new_beam.sort(key=lambda x: x[2])
        beam = new_beam[:beam_width]
    
    if not beam:
        return None
    
    # Take the best match
    best_nodes, best_prims, best_score, _ = beam[0]
    
    # Check closure if needed
    closure_gap = 0.0
    if skeleton.closed and len(best_nodes) >= 2:
        end_data = graph.nodes[best_nodes[-1]]
        end_lat, end_lon = end_data['y'], end_data['x']
        closure_gap = haversine_distance(start_lat, start_lon, end_lat, end_lon)
        
        # Penalize if not closed properly
        if closure_gap > 500:  # More than 500m gap
            best_score += closure_gap / 10
    
    total_length = sum(p.length_m for p in best_prims)
    
    return MatchCandidate(
        primitives=best_prims,
        nodes=best_nodes,
        score=best_score,
        total_length_m=total_length,
        closure_gap_m=closure_gap
    )


def explore_paths_for_primitive(
    graph: nx.MultiDiGraph,
    start_node: int,
    skel_prim: SkeletonPrimitive,
    reference_length: float,
    prev_bearing: Optional[float],
    max_depth: int = 15
) -> List[Tuple[List[int], GraphPrimitive, float]]:
    """
    Explore paths from start_node that could match the skeleton primitive.
    
    Returns list of (path_nodes, graph_primitive, score) tuples.
    """
    results = []
    target_length = reference_length * skel_prim.length_ratio
    min_length = target_length * (1 - skel_prim.length_tolerance)
    max_length = target_length * (1 + skel_prim.length_tolerance)
    
    # BFS to explore paths
    # State: (current_node, path_nodes, total_length, bearings)
    queue = [(start_node, [start_node], 0.0, [])]
    visited_states = set()
    
    start_data = graph.nodes[start_node]
    start_lat, start_lon = start_data['y'], start_data['x']
    
    while queue and len(results) < 20:
        current, path, length, bearings = queue.pop(0)
        
        state_key = (current, len(path))
        if state_key in visited_states:
            continue
        visited_states.add(state_key)
        
        # Check if this path is a valid match
        if length >= min_length:
            # Create a graph primitive for this path
            current_data = graph.nodes[current]
            end_lat, end_lon = current_data['y'], current_data['x']
            
            direct_dist = haversine_distance(start_lat, start_lon, end_lat, end_lon)
            straightness = direct_dist / length if length > 0 else 0
            
            # Classify type
            if straightness > 0.7:
                ptype = PrimitiveType.SEGMENT
            else:
                ptype = PrimitiveType.ARC
            
            # Calculate curvature
            total_turn = sum(
                angle_difference(bearings[i-1], bearings[i]) 
                for i in range(1, len(bearings))
            ) if len(bearings) > 1 else 0
            
            if abs(total_turn) < 20:
                curvature = CurvatureDirection.ANY
            elif total_turn > 0:
                curvature = CurvatureDirection.RIGHT
            else:
                curvature = CurvatureDirection.LEFT
            
            avg_bearing = np.mean(bearings) if bearings else prev_bearing or 0
            
            graph_prim = GraphPrimitive(
                type=ptype,
                nodes=path,
                start_point=(start_lat, start_lon),
                end_point=(end_lat, end_lon),
                length_m=length,
                bearing=avg_bearing,
                curvature=curvature,
                arc_angle=total_turn,
                straightness=straightness
            )
            
            score, _ = score_primitive_match(
                skel_prim, graph_prim, prev_bearing, reference_length
            )
            
            results.append((path, graph_prim, score))
        
        # Continue exploring if under max length
        if length < max_length and len(path) < max_depth:
            current_data = graph.nodes[current]
            current_lat, current_lon = current_data['y'], current_data['x']
            
            for neighbor in graph.successors(current):
                if neighbor in path:
                    continue
                
                neighbor_data = graph.nodes[neighbor]
                n_lat, n_lon = neighbor_data['y'], neighbor_data['x']
                
                seg_length = haversine_distance(current_lat, current_lon, n_lat, n_lon)
                new_bearing = calculate_bearing(current_lat, current_lon, n_lat, n_lon)
                
                new_path = path + [neighbor]
                new_length = length + seg_length
                new_bearings = bearings + [new_bearing]
                
                queue.append((neighbor, new_path, new_length, new_bearings))
    
    # Sort by score (best first)
    results.sort(key=lambda x: x[2])
    return results[:5]  # Return top 5


def find_best_pattern_match(
    graph: nx.MultiDiGraph,
    skeleton: ShapeSkeleton,
    target_length_m: float,
    center_lat: float,
    center_lon: float,
    search_radius_m: float = 3000,
    max_candidates: int = 30
) -> Optional[MatchCandidate]:
    """
    Search the graph for the best match to a shape skeleton.
    
    Args:
        graph: OSM road network graph
        skeleton: Shape skeleton to match
        target_length_m: Target route length in meters
        center_lat, center_lon: Center of search area
        search_radius_m: Radius to search in
        max_candidates: Max starting points to try
    
    Returns:
        Best MatchCandidate or None
    """
    print(f"\n=== PATTERN MATCHING: {skeleton.name} ===")
    print(f"Target length: {target_length_m/1000:.1f} km")
    print(f"Skeleton has {skeleton.num_primitives} primitives")
    
    # Find candidate starting nodes (prefer junctions)
    junctions = find_junction_nodes(graph, min_degree=3)
    
    # Score junctions by proximity to center
    scored_nodes = []
    for node in junctions:
        data = graph.nodes[node]
        dist = haversine_distance(center_lat, center_lon, data['y'], data['x'])
        if dist <= search_radius_m:
            scored_nodes.append((dist, node))
    
    # If not enough junctions, add regular nodes
    if len(scored_nodes) < max_candidates:
        for node in graph.nodes:
            if node in [n for _, n in scored_nodes]:
                continue
            data = graph.nodes[node]
            dist = haversine_distance(center_lat, center_lon, data['y'], data['x'])
            if dist <= search_radius_m:
                scored_nodes.append((dist, node))
    
    scored_nodes.sort()
    candidate_nodes = [node for _, node in scored_nodes[:max_candidates]]
    
    print(f"Trying {len(candidate_nodes)} candidate starting points...")
    
    best_match: Optional[MatchCandidate] = None
    
    for i, start_node in enumerate(candidate_nodes):
        match = search_pattern_from_node(
            graph, start_node, skeleton, target_length_m
        )
        
        if match is not None:
            # Adjust score based on how close to target length
            length_error = abs(match.total_length_m - target_length_m) / target_length_m
            adjusted_score = match.score + length_error * 50
            match.score = adjusted_score
            
            if i < 5 or (match and match.score < 200):
                data = graph.nodes[start_node]
                print(f"  Candidate {i+1} ({data['y']:.5f}, {data['x']:.5f}): "
                      f"score={match.score:.1f}, length={match.total_length_m/1000:.2f}km, "
                      f"gap={match.closure_gap_m:.0f}m")
            
            if best_match is None or match.score < best_match.score:
                best_match = match
                
                # Early exit if we find a great match
                if match.score < 100 and length_error < 0.15:
                    print(f"  ✓ Good match found, stopping early")
                    break
    
    if best_match:
        print(f"\nBest match: score={best_match.score:.1f}, "
              f"length={best_match.total_length_m/1000:.2f}km")
    else:
        print("No valid pattern match found")
    
    return best_match


def build_route_from_match(
    graph: nx.MultiDiGraph,
    match: MatchCandidate,
    close_loop: bool = True
) -> Tuple[List[int], float]:
    """
    Build a complete route from a pattern match.
    
    Fills in gaps between primitives using shortest paths.
    """
    if not match or not match.nodes:
        return [], 0.0
    
    route_nodes = []
    
    # Add all nodes, using shortest paths to fill gaps
    for i, node in enumerate(match.nodes):
        if not route_nodes:
            route_nodes.append(node)
        elif node != route_nodes[-1]:
            # Check if directly connected
            if graph.has_edge(route_nodes[-1], node):
                route_nodes.append(node)
            else:
                # Need shortest path to connect
                try:
                    path = shortest_path(graph, route_nodes[-1], node)
                    route_nodes.extend(path[1:])
                except:
                    route_nodes.append(node)
    
    # Close the loop if needed
    if close_loop and len(route_nodes) >= 2:
        start = route_nodes[0]
        end = route_nodes[-1]
        if start != end:
            try:
                closing_path = shortest_path(graph, end, start)
                route_nodes.extend(closing_path[1:])
            except:
                pass
    
    # Calculate total length
    total_length = calculate_path_length(graph, route_nodes)
    
    return route_nodes, total_length


