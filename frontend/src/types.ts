/**
 * Type definitions for the application
 */

export interface Symbol {
  id: string;
  name: string;
  original_filename: string;
  num_points: number;
  normalized_length: number;
}

export interface RouteRequest {
  symbol_id: string;
  start_lat: number;
  start_lon: number;
  target_distance_km: number;
}

export interface RouteResponse {
  coordinates: [number, number][];
  distance_m: number;
  symbol_id: string;
  start: [number, number];
}

export interface GPXRouteResponse extends RouteResponse {
  gpx_content: string;
}

export interface MapPosition {
  lat: number;
  lon: number;
}

