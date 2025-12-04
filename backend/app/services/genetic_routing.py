"""
Genetic Algorithm based route optimization.

This approach evolves a population of route candidates to find
the best match between a shape and the road network.

Each candidate (chromosome) encodes:
- Center position offset (dx, dy)
- Rotation angle
- Scale factor
- Aspect ratio (stretch x vs y)
"""
import math
import random
from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional, Set
import numpy as np
import networkx as nx

from app.services.osm import (
    nearest_node,
    shortest_path,
    nodes_to_coordinates,
    calculate_path_length,
)


@dataclass
class Chromosome:
    """A candidate solution encoding shape transformation parameters."""
    dx: float  # X offset in meters from center
    dy: float  # Y offset in meters from center
    rotation: float  # Rotation in degrees (0-360)
    scale: float  # Scale multiplier (0.5 - 2.0)
    aspect_x: float  # X stretch (0.7 - 1.4)
    aspect_y: float  # Y stretch (0.7 - 1.4)
    
    # Computed results (filled after evaluation)
    fitness: float = float('inf')
    route_nodes: List[int] = None
    route_length: float = 0.0
    shape_error: float = 0.0
    
    def copy(self) -> 'Chromosome':
        return Chromosome(
            dx=self.dx, dy=self.dy, rotation=self.rotation,
            scale=self.scale, aspect_x=self.aspect_x, aspect_y=self.aspect_y
        )


def create_random_chromosome(
    max_offset: float = 500,
    base_scale: float = 1.0
) -> Chromosome:
    """Create a random chromosome within reasonable bounds."""
    return Chromosome(
        dx=random.uniform(-max_offset, max_offset),
        dy=random.uniform(-max_offset, max_offset),
        rotation=random.uniform(0, 360),
        scale=base_scale * random.uniform(0.7, 1.3),
        aspect_x=random.uniform(0.8, 1.2),
        aspect_y=random.uniform(0.8, 1.2),
    )


def transform_shape(
    polyline: List[Tuple[float, float]],
    chromosome: Chromosome,
    center_x: float,
    center_y: float,
    base_scale: float
) -> List[Tuple[float, float]]:
    """Apply chromosome transformations to a shape."""
    # Convert to numpy for easier math
    points = np.array(polyline)
    
    # Apply scale and aspect ratio
    total_scale = base_scale * chromosome.scale
    points[:, 0] *= total_scale * chromosome.aspect_x
    points[:, 1] *= total_scale * chromosome.aspect_y
    
    # Apply rotation
    angle = math.radians(chromosome.rotation)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    rotated = np.zeros_like(points)
    rotated[:, 0] = points[:, 0] * cos_a - points[:, 1] * sin_a
    rotated[:, 1] = points[:, 0] * sin_a + points[:, 1] * cos_a
    
    # Translate to center + offset
    rotated[:, 0] += center_x + chromosome.dx
    rotated[:, 1] += center_y + chromosome.dy
    
    return [(float(x), float(y)) for x, y in rotated]


def sample_keypoints(
    polyline: List[Tuple[float, float]],
    num_points: int = 8
) -> List[Tuple[float, float]]:
    """Sample evenly-spaced keypoints from polyline."""
    if len(polyline) <= num_points:
        return polyline
    
    indices = np.linspace(0, len(polyline) - 1, num_points, dtype=int)
    return [polyline[i] for i in indices]


# Cache for shortest paths to avoid recomputation
_path_cache: Dict[Tuple[int, int], List[int]] = {}
_cache_hits = 0
_cache_misses = 0


def cached_shortest_path(graph: nx.MultiDiGraph, start: int, end: int) -> List[int]:
    """Cached version of shortest_path."""
    global _cache_hits, _cache_misses
    
    key = (start, end)
    if key in _path_cache:
        _cache_hits += 1
        return _path_cache[key]
    
    _cache_misses += 1
    try:
        path = shortest_path(graph, start, end)
        # Only cache if not too many entries
        if len(_path_cache) < 5000:
            _path_cache[key] = path
        return path
    except:
        return [start, end]


def clear_path_cache():
    """Clear the path cache."""
    global _path_cache, _cache_hits, _cache_misses
    _path_cache = {}
    _cache_hits = 0
    _cache_misses = 0


def evaluate_chromosome(
    chromosome: Chromosome,
    polyline: List[Tuple[float, float]],
    graph: nx.MultiDiGraph,
    center_x: float,
    center_y: float,
    base_scale: float,
    target_length_m: float,
    xy_to_ll,
    num_keypoints: int = 6
) -> Chromosome:
    """
    Evaluate fitness of a chromosome.
    
    Fitness combines:
    - Shape matching error (how well route follows the shape)
    - Distance error (how close to target length)
    - Route quality (connectivity, no dead ends)
    """
    # Transform shape
    transformed = transform_shape(polyline, chromosome, center_x, center_y, base_scale)
    
    # Sample keypoints
    keypoints = sample_keypoints(transformed, num_keypoints)
    
    # Convert to GPS and snap to graph
    snapped_nodes = []
    snap_errors = []
    
    for x, y in keypoints:
        lon, lat = xy_to_ll.transform(x, y)
        try:
            node = nearest_node(graph, lat, lon)
            node_data = graph.nodes[node]
            
            # Calculate snap error
            node_x, node_y = xy_to_ll.transform(node_data['x'], node_data['y'])
            # Actually we need ll_to_xy here, let's approximate
            dx = (lon - node_data['x']) * 111000 * math.cos(math.radians(lat))
            dy = (lat - node_data['y']) * 111000
            error = math.sqrt(dx*dx + dy*dy)
            
            snapped_nodes.append(node)
            snap_errors.append(error)
        except:
            snap_errors.append(1000)  # Penalty for failed snap
    
    if len(snapped_nodes) < 3:
        chromosome.fitness = float('inf')
        return chromosome
    
    # Remove consecutive duplicates
    unique_nodes = [snapped_nodes[0]]
    for node in snapped_nodes[1:]:
        if node != unique_nodes[-1]:
            unique_nodes.append(node)
    
    if len(unique_nodes) < 2:
        chromosome.fitness = float('inf')
        return chromosome
    
    # Build route through keypoints
    route_nodes = []
    connection_failures = 0
    
    for i in range(len(unique_nodes)):
        start = unique_nodes[i]
        end = unique_nodes[(i + 1) % len(unique_nodes)]
        
        if start == end:
            continue
        
        path = cached_shortest_path(graph, start, end)
        if len(path) <= 2 and path[0] != start:
            connection_failures += 1
        
        if not route_nodes:
            route_nodes.extend(path)
        else:
            route_nodes.extend(path[1:])
    
    if not route_nodes:
        chromosome.fitness = float('inf')
        return chromosome
    
    # Calculate route length
    route_length = calculate_path_length(graph, route_nodes)
    
    # Calculate fitness components
    avg_snap_error = np.mean(snap_errors) if snap_errors else 1000
    distance_error = abs(route_length - target_length_m) / target_length_m
    
    # Shape matching: measure how well route follows the transformed shape
    shape_error = calculate_shape_match_error(
        graph, route_nodes, transformed, xy_to_ll
    )
    
    # Combined fitness (lower is better)
    # Weights: shape match is most important, then distance, then snap quality
    fitness = (
        shape_error * 2.0 +           # Shape matching
        distance_error * 100 +         # Distance accuracy
        avg_snap_error * 0.1 +         # Snap quality
        connection_failures * 50       # Connectivity penalty
    )
    
    chromosome.fitness = fitness
    chromosome.route_nodes = route_nodes
    chromosome.route_length = route_length
    chromosome.shape_error = shape_error
    
    return chromosome


def calculate_shape_match_error(
    graph: nx.MultiDiGraph,
    route_nodes: List[int],
    target_shape: List[Tuple[float, float]],
    xy_to_ll
) -> float:
    """
    Calculate how well the route matches the target shape.
    
    Measures average distance from route points to nearest point on shape.
    """
    if not route_nodes or not target_shape:
        return 1000.0
    
    # Sample points along route
    route_coords = []
    for node in route_nodes[::max(1, len(route_nodes)//20)]:  # Sample ~20 points
        data = graph.nodes[node]
        # Approximate conversion to local coords
        x = data['x'] * 111000 * math.cos(math.radians(data['y']))
        y = data['y'] * 111000
        route_coords.append((x, y))
    
    if not route_coords:
        return 1000.0
    
    # Convert target shape to same coordinate system (approximate)
    # target_shape is already in meters
    
    # For each route point, find distance to nearest shape point
    total_error = 0.0
    for rx, ry in route_coords:
        min_dist = float('inf')
        for sx, sy in target_shape:
            # Need to convert sx, sy which are in projected coords
            dist = math.sqrt((rx - sx/111000*111000)**2 + (ry - sy/111000*111000)**2)
            min_dist = min(min_dist, dist)
        total_error += min(min_dist, 500)  # Cap at 500m
    
    return total_error / len(route_coords)


def crossover(parent1: Chromosome, parent2: Chromosome) -> Tuple[Chromosome, Chromosome]:
    """Create two children by crossing over two parents."""
    child1 = parent1.copy()
    child2 = parent2.copy()
    
    # Uniform crossover
    if random.random() < 0.5:
        child1.dx, child2.dx = child2.dx, child1.dx
    if random.random() < 0.5:
        child1.dy, child2.dy = child2.dy, child1.dy
    if random.random() < 0.5:
        child1.rotation, child2.rotation = child2.rotation, child1.rotation
    if random.random() < 0.5:
        child1.scale, child2.scale = child2.scale, child1.scale
    if random.random() < 0.5:
        child1.aspect_x, child2.aspect_x = child2.aspect_x, child1.aspect_x
    if random.random() < 0.5:
        child1.aspect_y, child2.aspect_y = child2.aspect_y, child1.aspect_y
    
    return child1, child2


def mutate(chromosome: Chromosome, mutation_rate: float = 0.2, max_offset: float = 500) -> Chromosome:
    """Apply random mutations to a chromosome."""
    c = chromosome.copy()
    
    if random.random() < mutation_rate:
        c.dx += random.gauss(0, max_offset * 0.2)
        c.dx = max(-max_offset, min(max_offset, c.dx))
    
    if random.random() < mutation_rate:
        c.dy += random.gauss(0, max_offset * 0.2)
        c.dy = max(-max_offset, min(max_offset, c.dy))
    
    if random.random() < mutation_rate:
        c.rotation += random.gauss(0, 30)
        c.rotation = c.rotation % 360
    
    if random.random() < mutation_rate:
        c.scale *= random.uniform(0.9, 1.1)
        c.scale = max(0.5, min(2.0, c.scale))
    
    if random.random() < mutation_rate:
        c.aspect_x *= random.uniform(0.95, 1.05)
        c.aspect_x = max(0.6, min(1.5, c.aspect_x))
    
    if random.random() < mutation_rate:
        c.aspect_y *= random.uniform(0.95, 1.05)
        c.aspect_y = max(0.6, min(1.5, c.aspect_y))
    
    return c


def select_parents(population: List[Chromosome], tournament_size: int = 3) -> Chromosome:
    """Tournament selection."""
    tournament = random.sample(population, min(tournament_size, len(population)))
    return min(tournament, key=lambda c: c.fitness)


def run_genetic_algorithm(
    polyline: List[Tuple[float, float]],
    graph: nx.MultiDiGraph,
    center_lat: float,
    center_lon: float,
    target_distance_km: float,
    population_size: int = 30,
    generations: int = 25,
    elite_size: int = 3
) -> Tuple[List[Tuple[float, float]], float, Dict]:
    """
    Run genetic algorithm to find optimal shape placement.
    
    Returns:
        (coordinates, distance_m, diagnostics)
    """
    from pyproj import Transformer
    
    print(f"\n=== GENETIC ALGORITHM OPTIMIZATION ===")
    print(f"Population: {population_size}, Generations: {generations}")
    
    # Clear path cache for fresh start
    clear_path_cache()
    
    # Setup transformers
    ll_to_xy = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    xy_to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    
    # Convert center to local coords
    center_x, center_y = ll_to_xy.transform(center_lon, center_lat)
    
    # Calculate base scale
    original_length = sum(
        math.dist(polyline[i], polyline[i+1])
        for i in range(len(polyline) - 1)
    )
    target_length_m = target_distance_km * 1000
    base_scale = target_length_m / original_length if original_length > 0 else 1.0
    
    # Determine search radius based on target size
    max_offset = target_length_m * 0.3  # Can shift up to 30% of route length
    
    # Initialize population
    population = []
    
    # Seed with some structured candidates
    for rotation in [0, 45, 90, 135, 180, 225, 270, 315]:
        c = Chromosome(dx=0, dy=0, rotation=rotation, scale=1.0, aspect_x=1.0, aspect_y=1.0)
        population.append(c)
    
    # Fill rest with random
    while len(population) < population_size:
        population.append(create_random_chromosome(max_offset, 1.0))
    
    # Evaluate initial population
    for i, c in enumerate(population):
        evaluate_chromosome(
            c, polyline, graph, center_x, center_y, 
            base_scale, target_length_m, xy_to_ll
        )
    
    population.sort(key=lambda c: c.fitness)
    print(f"Initial best fitness: {population[0].fitness:.1f}")
    
    # Evolution loop
    for gen in range(generations):
        new_population = []
        
        # Keep elite
        for i in range(elite_size):
            new_population.append(population[i].copy())
        
        # Generate rest through crossover and mutation
        while len(new_population) < population_size:
            parent1 = select_parents(population)
            parent2 = select_parents(population)
            
            child1, child2 = crossover(parent1, parent2)
            child1 = mutate(child1, mutation_rate=0.3, max_offset=max_offset)
            child2 = mutate(child2, mutation_rate=0.3, max_offset=max_offset)
            
            new_population.append(child1)
            if len(new_population) < population_size:
                new_population.append(child2)
        
        # Evaluate new population
        for c in new_population[elite_size:]:
            evaluate_chromosome(
                c, polyline, graph, center_x, center_y,
                base_scale, target_length_m, xy_to_ll
            )
        
        population = new_population
        population.sort(key=lambda c: c.fitness)
        
        if gen % 5 == 0 or gen == generations - 1:
            best = population[0]
            print(f"Gen {gen+1}: best_fitness={best.fitness:.1f}, "
                  f"shape_err={best.shape_error:.1f}, len={best.route_length/1000:.2f}km")
    
    # Get best solution
    best = population[0]
    
    if best.route_nodes is None or best.fitness == float('inf'):
        print("No valid solution found")
        return [(center_lat, center_lon)], 0.0, {"error": "no_solution"}
    
    # Convert to coordinates
    coordinates = nodes_to_coordinates(graph, best.route_nodes)
    
    print(f"\n=== BEST SOLUTION ===")
    print(f"Fitness: {best.fitness:.1f}")
    print(f"Rotation: {best.rotation:.1f}°")
    print(f"Scale: {best.scale:.2f}")
    print(f"Offset: ({best.dx:.0f}, {best.dy:.0f})m")
    print(f"Distance: {best.route_length/1000:.2f} km")
    
    diagnostics = {
        "mode": "genetic",
        "fitness": best.fitness,
        "rotation": best.rotation,
        "scale": best.scale,
        "offset_x": best.dx,
        "offset_y": best.dy,
        "shape_error": best.shape_error,
        "generations": generations,
    }
    
    return coordinates, best.route_length, diagnostics

