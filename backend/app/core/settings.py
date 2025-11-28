"""Application settings and configuration."""
from pydantic_settings import BaseSettings
from pathlib import Path
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    data_dir: Path = Path("./data")
    symbols_dir: Path = Path("./data/symbols")
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    
    # OSM settings
    # Network types: "walk" (pedestrian), "bike" (cycling), "drive" (car), "all" (everything)
    osm_network_type: str = "walk"  # Best for running/walking routes
    osm_cache_dir: Path = Path("./data/osm_cache")
    
    # Route generation settings
    default_graph_radius_km: float = 5.0
    max_snap_distance_m: float = 300.0  # Increased from 200 for better matching
    shape_sample_points: int = 100
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure directories exist
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.symbols_dir.mkdir(parents=True, exist_ok=True)
        self.osm_cache_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()

