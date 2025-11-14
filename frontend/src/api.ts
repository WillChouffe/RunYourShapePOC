/**
 * API client for backend communication
 */
import axios from 'axios';
import { config } from './config';
import type { Symbol, RouteRequest, RouteResponse, GPXRouteResponse } from './types';

const api = axios.create({
  baseURL: config.apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Upload a new SVG symbol
 */
export async function uploadSymbol(file: File): Promise<Symbol> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await api.post('/symbols', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  
  return response.data.metadata;
}

/**
 * Get list of available symbols
 */
export async function getSymbols(): Promise<Symbol[]> {
  const response = await api.get('/symbols');
  return response.data.symbols;
}

/**
 * Generate a route
 */
export async function generateRoute(request: RouteRequest): Promise<RouteResponse> {
  const response = await api.post('/route', request);
  return response.data;
}

/**
 * Generate a route with GPX data
 */
export async function generateRouteWithGPX(request: RouteRequest): Promise<GPXRouteResponse> {
  const response = await api.post('/route/gpx', request);
  return response.data;
}

/**
 * Download GPX file
 */
export async function downloadGPX(request: RouteRequest): Promise<Blob> {
  const response = await api.post('/route/gpx/download', request, {
    responseType: 'blob',
  });
  return response.data;
}

