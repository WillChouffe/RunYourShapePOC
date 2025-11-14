"""API endpoints for symbol management."""
from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List
import uuid

from app.models.symbol import SymbolMetadata, NormalizedSymbol, SymbolListResponse
from app.services.shapes import (
    process_svg_upload,
    load_symbol,
    list_symbols
)


router = APIRouter(prefix="/symbols", tags=["symbols"])


@router.post("", response_model=NormalizedSymbol, status_code=201)
async def upload_symbol(file: UploadFile = File(...)):
    """
    Upload a new SVG symbol.
    
    The SVG will be parsed, normalized, and stored for use in route generation.
    """
    # Validate file type
    if not file.filename.endswith('.svg'):
        raise HTTPException(status_code=400, detail="File must be an SVG")
    
    # Read content
    content = await file.read()
    svg_content = content.decode('utf-8')
    
    # Generate unique ID
    symbol_id = file.filename.rsplit('.', 1)[0]
    # Make it URL-safe
    symbol_id = symbol_id.lower().replace(' ', '_')
    # Add UUID suffix if needed to ensure uniqueness
    symbol_id = f"{symbol_id}_{uuid.uuid4().hex[:8]}"
    
    try:
        # Process the SVG
        normalized_symbol = process_svg_upload(
            svg_content,
            symbol_id,
            file.filename
        )
        return normalized_symbol
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Error processing SVG: {str(e)}"
        )


@router.get("", response_model=SymbolListResponse)
async def get_symbols():
    """
    List all available symbols.
    """
    symbols = list_symbols()
    return SymbolListResponse(symbols=symbols)


@router.get("/{symbol_id}", response_model=NormalizedSymbol)
async def get_symbol(symbol_id: str):
    """
    Get a specific symbol by ID.
    """
    try:
        return load_symbol(symbol_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol_id}' not found")

