/**
 * MapView component - Leaflet map with custom styling
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { MapPosition } from '../types';
import './MapView.css';

// Custom marker icon (neon yellow glowing dot)
const createGlowingMarker = () => {
  return L.divIcon({
    html: `
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle cx="12" cy="12" r="6" fill="#F5E642" filter="url(#glow)" />
        <circle cx="12" cy="12" r="3" fill="#FFF" />
      </svg>
    `,
    className: 'glowing-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

interface MapViewProps {
  center: MapPosition;
  zoom: number;
  startPoint: MapPosition | null;
  routeCoordinates: [number, number][] | null;
  onMapClick: (position: MapPosition) => void;
}

// Component to handle map clicks
function MapClickHandler({ onMapClick }: { onMapClick: (position: MapPosition) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

// Component to fit map bounds to route
function FitBounds({ coordinates }: { coordinates: [number, number][] | null }) {
  const map = useMap();
  
  useEffect(() => {
    if (coordinates && coordinates.length > 0) {
      const bounds = L.latLngBounds(coordinates as [number, number][]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [coordinates, map]);
  
  return null;
}

export default function MapView({
  center,
  zoom,
  startPoint,
  routeCoordinates,
  onMapClick,
}: MapViewProps) {
  const glowingMarkerIcon = useRef(createGlowingMarker());
  
  return (
    <div className="map-container">
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
      >
        {/* Dark map tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        {/* Map click handler */}
        <MapClickHandler onMapClick={onMapClick} />
        
        {/* Start point marker */}
        {startPoint && (
          <Marker
            position={[startPoint.lat, startPoint.lon]}
            icon={glowingMarkerIcon.current}
          />
        )}
        
        {/* Route polyline */}
        {routeCoordinates && routeCoordinates.length > 0 && (
          <>
            <Polyline
              positions={routeCoordinates}
              pathOptions={{
                color: '#F5E642',
                weight: 4,
                opacity: 0.9,
                className: 'route-polyline',
              }}
            />
            <FitBounds coordinates={routeCoordinates} />
          </>
        )}
      </MapContainer>
    </div>
  );
}

