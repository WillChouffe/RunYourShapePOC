"""Data models for SVG symbols."""
from pydantic import BaseModel
from typing import List, Tuple


class SymbolMetadata(BaseModel):
    """Metadata for an uploaded SVG symbol."""
    id: str
    name: str
    original_filename: str
    num_points: int
    normalized_length: float = 1.0


class NormalizedSymbol(BaseModel):
    """A normalized symbol with its polyline."""
    metadata: SymbolMetadata
    polyline: List[Tuple[float, float]]


class SymbolListResponse(BaseModel):
    """Response for listing symbols."""
    symbols: List[SymbolMetadata]

