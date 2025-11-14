/**
 * Application configuration
 */

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  
  // Default map settings
  defaultMapCenter: {
    lat: 48.8566,
    lon: 2.3522
  } as { lat: number; lon: number },
  
  defaultZoom: 13,
  
  // Default route settings
  defaultDistance: 5,
  minDistance: 1,
  maxDistance: 20,
} as const;

