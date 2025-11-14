/**
 * Controls component - UI panel for route generation
 */
import { useState, useEffect } from 'react';
import type { Symbol, MapPosition } from '../types';
import { getSymbols } from '../api';
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
  isGenerating,
  hasRoute,
  routeDistance,
}: ControlsProps) {
  const canGenerate = startPoint !== null && selectedSymbol !== null && !isGenerating;
  
  return (
    <div className="controls-panel">
      <div className="panel-header">
        <h1 className="panel-title">SHAPE ROUTE GENERATOR</h1>
        <p className="panel-subtitle">Create running routes matching geometric shapes</p>
      </div>
      
      {/* Start Point Info */}
      <div className="control-group">
        <label className="control-label">START POINT</label>
        {startPoint ? (
          <div className="location-display">
            <span className="location-coords">
              {startPoint.lat.toFixed(4)}, {startPoint.lon.toFixed(4)}
            </span>
            <span className="location-hint">Click map to change</span>
          </div>
        ) : (
          <div className="location-placeholder">
            Click on the map to set start point
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
        <label className="control-label">SHAPE</label>
        {symbols.length > 0 ? (
          <select
            value={selectedSymbol || ''}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="symbol-select"
          >
            <option value="" disabled>Select a shape...</option>
            {symbols.map((symbol) => (
              <option key={symbol.id} value={symbol.id}>
                {symbol.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="no-symbols">
            No shapes available. Upload an SVG file first.
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
          <li>Click on the map to set your starting point</li>
          <li>Adjust the target distance using the slider</li>
          <li>Select a shape from the dropdown</li>
          <li>Click "Generate Route" to create your path</li>
          <li>Download the GPX file to use with your GPS device</li>
        </ol>
      </div>
    </div>
  );
}

