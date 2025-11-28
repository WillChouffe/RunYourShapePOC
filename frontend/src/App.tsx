/**
 * Main App component
 */
import { useState, useEffect } from 'react';
import MapView from './components/MapView';
import Controls from './components/Controls';
import { getSymbols, generateRoute, downloadGPX } from './api';
import { config } from './config';
import type { Symbol, MapPosition, RouteResponse } from './types';
import './App.css';

function App() {
  // Map state
  const [mapCenter, setMapCenter] = useState<MapPosition>(config.defaultMapCenter);
  const [mapZoom, setMapZoom] = useState(config.defaultZoom);
  const [startPoint, setStartPoint] = useState<MapPosition | null>(null);
  
  // Route generation state
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [distance, setDistance] = useState(config.defaultDistance);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Route display state
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [currentRoute, setCurrentRoute] = useState<RouteResponse | null>(null);
  
  // Load symbols on mount
  useEffect(() => {
    loadSymbols();
  }, []);
  
  async function loadSymbols() {
    try {
      const symbolsList = await getSymbols();
      setSymbols(symbolsList);
      
      // Auto-select first symbol if available
      if (symbolsList.length > 0 && !selectedSymbol) {
        setSelectedSymbol(symbolsList[0].id);
      }
    } catch (error) {
      console.error('Error loading symbols:', error);
      alert('Failed to load symbols. Make sure the backend is running.');
    }
  }
  
  function handleMapClick(position: MapPosition) {
    setStartPoint(position);
  }
  
  function handleLocationSearch(position: MapPosition) {
    setStartPoint(position);
    setMapCenter(position);
    setMapZoom(14); // Zoom closer for searched locations
  }
  
  async function handleGenerateRoute() {
    if (!startPoint || !selectedSymbol) return;
    
    setIsGenerating(true);
    
    try {
      const route = await generateRoute({
        symbol_id: selectedSymbol,
        start_lat: startPoint.lat,
        start_lon: startPoint.lon,
        target_distance_km: distance,
      });
      
      setCurrentRoute(route);
      setRouteCoordinates(route.coordinates);
      setRouteDistance(route.distance_m);
    } catch (error) {
      console.error('Error generating route:', error);
      alert('Failed to generate route. Please try a different location or shape.');
    } finally {
      setIsGenerating(false);
    }
  }
  
  async function handleDownloadGPX() {
    if (!startPoint || !selectedSymbol) return;
    
    try {
      const gpxBlob = await downloadGPX({
        symbol_id: selectedSymbol,
        start_lat: startPoint.lat,
        start_lon: startPoint.lon,
        target_distance_km: distance,
      });
      
      // Create download link
      const url = window.URL.createObjectURL(gpxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedSymbol}_${(routeDistance || 0) / 1000}km.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading GPX:', error);
      alert('Failed to download GPX file.');
    }
  }
  
  return (
    <div className="app">
      <div className="map-section">
        <MapView
          center={mapCenter}
          zoom={mapZoom}
          startPoint={startPoint}
          routeCoordinates={routeCoordinates}
          onMapClick={handleMapClick}
        />
      </div>
      
      <Controls
        startPoint={startPoint}
        distance={distance}
        selectedSymbol={selectedSymbol}
        symbols={symbols}
        onDistanceChange={setDistance}
        onSymbolChange={setSelectedSymbol}
        onGenerateRoute={handleGenerateRoute}
        onDownloadGPX={handleDownloadGPX}
        onLocationSearch={handleLocationSearch}
        isGenerating={isGenerating}
        hasRoute={routeCoordinates !== null}
        routeDistance={routeDistance}
      />
    </div>
  );
}

export default App;

