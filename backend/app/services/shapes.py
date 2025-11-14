"""Service for parsing and normalizing SVG shapes."""
import json
from pathlib import Path
from typing import List, Tuple
import numpy as np
from lxml import etree
from svgpathtools import parse_path, Path as SvgPath

from app.core.settings import settings
from app.models.symbol import SymbolMetadata, NormalizedSymbol


def parse_svg_to_points(svg_content: str, num_samples: int = 100) -> List[Tuple[float, float]]:
    """
    Parse SVG content and extract the main path as a list of 2D points.
    
    Args:
        svg_content: Raw SVG file content
        num_samples: Number of points to sample along the path
    
    Returns:
        List of (x, y) tuples representing the path
    """
    # Parse SVG XML
    root = etree.fromstring(svg_content.encode('utf-8'))
    
    # Find all path elements (namespace-aware)
    namespaces = {'svg': 'http://www.w3.org/2000/svg'}
    paths = root.xpath('//svg:path', namespaces=namespaces)
    
    # Also try without namespace
    if not paths:
        paths = root.xpath('//path')
    
    if not paths:
        raise ValueError("No <path> elements found in SVG")
    
    # Take the first path (or combine multiple if needed)
    path_data = paths[0].get('d')
    if not path_data:
        raise ValueError("Path element has no 'd' attribute")
    
    # Parse path using svgpathtools
    svg_path = parse_path(path_data)
    
    # Sample points along the path
    points = []
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        point = svg_path.point(t)
        points.append((point.real, point.imag))
    
    return points


def normalize_polyline(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """
    Normalize a polyline:
    1. Translate centroid to (0, 0)
    2. Scale so total length is 1.0
    
    Args:
        points: List of (x, y) tuples
    
    Returns:
        Normalized list of (x, y) tuples
    """
    if len(points) < 2:
        raise ValueError("Need at least 2 points to normalize")
    
    arr = np.array(points)
    
    # 1. Translate to center
    centroid = arr.mean(axis=0)
    centered = arr - centroid
    
    # 2. Calculate total length
    diffs = np.diff(centered, axis=0)
    segment_lengths = np.sqrt((diffs ** 2).sum(axis=1))
    total_length = segment_lengths.sum()
    
    if total_length == 0:
        raise ValueError("Polyline has zero length")
    
    # 3. Scale to unit length
    normalized = centered / total_length
    
    return [(float(x), float(y)) for x, y in normalized]


def save_symbol(symbol_id: str, metadata: SymbolMetadata, polyline: List[Tuple[float, float]]):
    """
    Save a normalized symbol to disk.
    
    Args:
        symbol_id: Unique identifier for the symbol
        metadata: Symbol metadata
        polyline: Normalized polyline
    """
    symbol_data = {
        'metadata': metadata.model_dump(),
        'polyline': polyline
    }
    
    output_path = settings.symbols_dir / f"{symbol_id}.json"
    with open(output_path, 'w') as f:
        json.dump(symbol_data, f, indent=2)


def load_symbol(symbol_id: str) -> NormalizedSymbol:
    """
    Load a normalized symbol from disk.
    
    Args:
        symbol_id: Unique identifier for the symbol
    
    Returns:
        NormalizedSymbol object
    
    Raises:
        FileNotFoundError: If symbol doesn't exist
    """
    symbol_path = settings.symbols_dir / f"{symbol_id}.json"
    
    if not symbol_path.exists():
        raise FileNotFoundError(f"Symbol {symbol_id} not found")
    
    with open(symbol_path, 'r') as f:
        data = json.load(f)
    
    return NormalizedSymbol(
        metadata=SymbolMetadata(**data['metadata']),
        polyline=data['polyline']
    )


def list_symbols() -> List[SymbolMetadata]:
    """
    List all available symbols.
    
    Returns:
        List of SymbolMetadata objects
    """
    symbols = []
    
    for symbol_file in settings.symbols_dir.glob("*.json"):
        try:
            with open(symbol_file, 'r') as f:
                data = json.load(f)
                symbols.append(SymbolMetadata(**data['metadata']))
        except Exception as e:
            print(f"Error loading symbol {symbol_file}: {e}")
    
    return symbols


def process_svg_upload(svg_content: str, symbol_id: str, original_filename: str) -> NormalizedSymbol:
    """
    Process an uploaded SVG file: parse, normalize, and save.
    
    Args:
        svg_content: Raw SVG file content
        symbol_id: Unique identifier for this symbol
        original_filename: Original uploaded filename
    
    Returns:
        NormalizedSymbol object
    """
    # Parse SVG to points
    points = parse_svg_to_points(svg_content, num_samples=settings.shape_sample_points)
    
    # Normalize
    normalized_points = normalize_polyline(points)
    
    # Create metadata
    metadata = SymbolMetadata(
        id=symbol_id,
        name=symbol_id,
        original_filename=original_filename,
        num_points=len(normalized_points),
        normalized_length=1.0
    )
    
    # Save to disk
    save_symbol(symbol_id, metadata, normalized_points)
    
    return NormalizedSymbol(metadata=metadata, polyline=normalized_points)

