/**
 * Controls component - UI panel for route generation
 */
import { useState } from 'react';
import type { Symbol, MapPosition } from '../types';
import './Controls.css';

interface ControlsProps {
  startPoint: MapPosition | null;
  distance: number;
  selectedSymbol: string | null;
  symbols: Symbol[];
  onDistanceChange: (distance: number) => void;
  onSymbolChange: (symbolId: string) => void;
  onGenerateRoute: () => void;
  onDownloadGPX: () => void;
  onLocationSearch: (position: MapPosition) => void;
  isGenerating: boolean;
  hasRoute: boolean;
  routeDistance: number | null;
}

export default function Controls({
  startPoint,
  distance,
  selectedSymbol,
  symbols,
  onDistanceChange,
  onSymbolChange,
  onGenerateRoute,
  onDownloadGPX,
  onLocationSearch,
  isGenerating,
  hasRoute,
  routeDistance,
}: ControlsProps) {
  const [locationInput, setLocationInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const canGenerate = startPoint !== null && selectedSymbol !== null && !isGenerating;
  
  // Search for location using Nominatim (OpenStreetMap)
  async function handleLocationSearch() {
    if (!locationInput.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationInput)}&limit=1`
      );
      const data = await response.json();
      
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        onLocationSearch({ lat, lon });
      } else {
        alert('Location not found. Try another search term (e.g., "Paris, France")');
      }
    } catch (error) {
      console.error('Error searching location:', error);
      alert('Error searching for location. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }
  
  return (
    <div className="controls-panel">
      <div className="panel-header">
        <h1 className="panel-title">SHAPE ROUTE GENERATOR</h1>
        <p className="panel-subtitle">Create running routes matching geometric shapes</p>
      </div>
      
      {/* Location Search */}
      <div className="control-group">
        <label className="control-label">LOCATION</label>
        <div className="location-search">
          <input
            type="text"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLocationSearch()}
            placeholder="Enter city or address..."
            className="location-input"
            disabled={isSearching}
          />
          <button
            onClick={handleLocationSearch}
            disabled={isSearching || !locationInput.trim()}
            className="search-button"
          >
            {isSearching ? '...' : 'SEARCH'}
          </button>
        </div>
      </div>
      
      {/* Start Point Info */}
      <div className="control-group">
        <label className="control-label">START POINT</label>
        {startPoint ? (
          <div className="location-display">
            <span className="location-coords">
              {startPoint.lat.toFixed(4)}, {startPoint.lon.toFixed(4)}
            </span>
            <span className="location-hint">Or click map to change</span>
          </div>
        ) : (
          <div className="location-placeholder">
            Search a location above or click on the map
          </div>
        )}
      </div>
      
      {/* Distance Slider */}
      <div className="control-group">
        <label className="control-label">
          DISTANCE: <span className="distance-value">{distance} KM</span>
        </label>
        <input
          type="range"
          min="1"
          max="20"
          step="0.5"
          value={distance}
          onChange={(e) => onDistanceChange(parseFloat(e.target.value))}
          className="distance-slider"
        />
        <div className="slider-labels">
          <span>1 km</span>
          <span>20 km</span>
        </div>
      </div>
      
      {/* Symbol Picker */}
      <div className="control-group">
        <label className="control-label">SHAPE ({symbols.length} available)</label>
        {symbols.length > 0 ? (
          <select
            value={selectedSymbol || ''}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="symbol-select"
          >
            <option value="" disabled>Select a shape...</option>
            {symbols.map((symbol) => (
              <option key={symbol.id} value={symbol.id}>
                {symbol.original_filename.replace('.svg', '')} - {symbol.id.split('_')[0]}
              </option>
            ))}
          </select>
        ) : (
          <div className="no-symbols">
            ⚠️ No shapes loaded. Checking backend connection...
            <br /><small>Backend should be on http://localhost:8001</small>
          </div>
        )}
      </div>
      
      {/* Generate Button */}
      <button
        className="generate-button"
        onClick={onGenerateRoute}
        disabled={!canGenerate}
      >
        {isGenerating ? 'GENERATING...' : 'GENERATE ROUTE'}
      </button>
      
      {/* Route Info & Download */}
      {hasRoute && routeDistance !== null && (
        <div className="route-info">
          <div className="route-distance">
            <span className="label">Generated Route:</span>
            <span className="value">{(routeDistance / 1000).toFixed(2)} km</span>
          </div>
          
          <button
            className="download-button"
            onClick={onDownloadGPX}
          >
            DOWNLOAD GPX
          </button>
        </div>
      )}
      
      {/* Instructions */}
      <div className="instructions">
        <h3>How to use:</h3>
        <ol>
          <li>Search for a city/address or click on the map</li>
          <li>Adjust the target distance (1-20 km)</li>
          <li>Select a shape from the dropdown ({symbols.length} available)</li>
          <li>Click "Generate Route" (takes 10-30 seconds)</li>
          <li>Download the GPX file for your GPS device</li>
        </ol>
        {symbols.length === 0 && (
          <div className="api-status">
            <strong>Debug:</strong> Trying to connect to API at http://localhost:8001/symbols
          </div>
        )}
      </div>
    </div>
  );
}

