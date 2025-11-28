"""Service for loading and caching OpenStreetMap data."""
import pickle
from pathlib import Path
from typing import Tuple
import osmnx as ox
import networkx as nx

from app.core.settings import settings


# Configure osmnx
ox.settings.use_cache = True
ox.settings.cache_folder = str(settings.osm_cache_dir)


def get_graph_around_point(
    lat: float,
    lon: float,
    radius_km: float = None
) -> nx.MultiDiGraph:
    """
    Load street graph around a point.
    
    Args:
        lat: Latitude of center point
        lon: Longitude of center point
        radius_km: Radius in km (defaults to settings value)
    
    Returns:
        NetworkX MultiDiGraph representing the street network
    """
    if radius_km is None:
        radius_km = settings.default_graph_radius_km
    
    # Convert km to meters
    radius_m = radius_km * 1000
    
    # Download graph
    # Use walk network for pedestrian/runner routes
    graph = ox.graph_from_point(
        (lat, lon),
        dist=radius_m,
        network_type=settings.osm_network_type,
        simplify=True,
        truncate_by_edge=True  # Cut exactly at radius for smaller graph
    )
    
    return graph


def nearest_node(graph: nx.MultiDiGraph, lat: float, lon: float) -> int:
    """
    Find the nearest graph node to a lat/lon point.
    
    Args:
        graph: NetworkX graph
        lat: Latitude
        lon: Longitude
    
    Returns:
        Node ID of nearest node
    """
    return ox.nearest_nodes(graph, lon, lat)


def shortest_path(graph: nx.MultiDiGraph, start_node: int, end_node: int) -> list:
    """
    Calculate shortest path between two nodes.
    
    Args:
        graph: NetworkX graph
        start_node: Starting node ID
        end_node: Ending node ID
    
    Returns:
        List of node IDs representing the path
    
    Raises:
        nx.NetworkXNoPath: If no path exists
    """
    try:
        return nx.shortest_path(graph, start_node, end_node, weight='length')
    except nx.NetworkXNoPath:
        # Return just the start node if no path found
        return [start_node]


def nodes_to_coordinates(graph: nx.MultiDiGraph, nodes: list) -> list:
    """
    Convert a list of node IDs to (lat, lon) coordinates.
    
    Args:
        graph: NetworkX graph
        nodes: List of node IDs
    
    Returns:
        List of (lat, lon) tuples
    """
    coords = []
    for node in nodes:
        node_data = graph.nodes[node]
        coords.append((node_data['y'], node_data['x']))
    return coords


def calculate_path_length(graph: nx.MultiDiGraph, nodes: list) -> float:
    """
    Calculate total length of a path in meters.
    
    Args:
        graph: NetworkX graph
        nodes: List of node IDs
    
    Returns:
        Total path length in meters
    """
    total_length = 0.0
    
    for i in range(len(nodes) - 1):
        u, v = nodes[i], nodes[i + 1]
        # Get edge data
        if graph.has_edge(u, v):
            edge_data = graph.get_edge_data(u, v)
            # Handle MultiDiGraph (multiple edges between nodes)
            if isinstance(edge_data, dict) and 0 in edge_data:
                total_length += edge_data[0].get('length', 0)
            else:
                total_length += edge_data.get('length', 0)
    
    return total_length

