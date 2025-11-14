# Shape Route Generator - Frontend

React + TypeScript frontend for generating running routes that match SVG shapes, with a stunning neon-tech UI.

## Features

- **Interactive Map**: Click to set start point, view generated routes
- **Neon Tech UI**: Beautiful dark theme with glowing yellow accents
- **Distance Control**: Slider to adjust target route distance (1-20 km)
- **Shape Selection**: Choose from uploaded SVG symbols
- **GPX Export**: Download routes as GPX files for GPS devices
- **Responsive**: Works on desktop and mobile devices

## Installation

### Prerequisites

- Node.js 18+ and npm (or yarn/pnpm)
- Backend API running on http://localhost:8000 (or configure in `.env`)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (optional):
```bash
cp .env.example .env
```

Edit `.env` to configure the API URL if different from default:
```
VITE_API_BASE_URL=http://localhost:8000
```

## Running the App

Start the development server:

```bash
npm run dev
```

The app will be available at http://localhost:5173

## Building for Production

Build the app:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

The build output will be in the `dist/` directory.

## Usage

1. **Set Start Point**: Click anywhere on the map to set your starting location
2. **Choose Distance**: Use the slider to select target route distance (1-20 km)
3. **Select Shape**: Pick a shape from the dropdown (shapes must be uploaded via backend API first)
4. **Generate Route**: Click "GENERATE ROUTE" to create your path
5. **Download GPX**: Once generated, click "DOWNLOAD GPX" to save the route

## Project Structure

```
frontend/
├── src/
│   ├── main.tsx              # Application entry point
│   ├── App.tsx               # Main app component
│   ├── App.css               # App layout styles
│   ├── styles.css            # Global styles and theme
│   ├── config.ts             # Configuration
│   ├── types.ts              # TypeScript type definitions
│   ├── api.ts                # API client
│   └── components/
│       ├── MapView.tsx       # Leaflet map component
│       ├── MapView.css       # Map styles
│       ├── Controls.tsx      # UI control panel
│       └── Controls.css      # Control panel styles
├── index.html                # HTML template
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies
└── README.md                 # This file
```

## Design System

### Colors

- Background Dark: `#020617`
- Panel Background: `rgba(11, 18, 32, 0.8)`
- Neon Yellow: `#F5E642`
- Text Light: `#E2E8F0`
- Text Grey: `#94A3B8`
- Input Background: `#0F172A`

### Typography

- **Primary Font**: Orbitron (headings, labels, buttons)
- **Secondary Font**: Inter (body text)

### Effects

- **Glow**: Applied to borders, buttons, and markers using box-shadow
- **Backdrop Blur**: Panel has subtle blur effect
- **Animations**: Marker pulse, button hover states

## Dependencies

### Core

- **React 18**: UI framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server

### Map

- **Leaflet**: Map rendering
- **react-leaflet**: React bindings for Leaflet
- **CartoDB Dark**: Dark map tiles

### API

- **axios**: HTTP client for backend communication

## Configuration

### Map Settings

Default settings in `src/config.ts`:

```typescript
defaultMapCenter: { lat: 48.8566, lon: 2.3522 }  // Paris
defaultZoom: 13
defaultDistance: 5  // km
minDistance: 1
maxDistance: 20
```

### API URL

Set via environment variable:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## Troubleshooting

### Map Not Loading

- Check that you have internet connection (map tiles load from CDN)
- Verify CartoDB tile server is accessible
- Check browser console for errors

### Backend Connection Issues

- Ensure backend is running on the configured API URL
- Check CORS settings in backend
- Verify network/firewall settings

### Route Generation Fails

- Ensure you've clicked the map to set start point
- Verify a shape is selected
- Check that backend has shapes uploaded
- Try a different location with denser street network

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Performance Notes

- Route generation typically takes 10-30 seconds
- Complex shapes take longer to process
- Map tiles are cached by browser
- Route polylines with 100+ points may impact performance on older devices

## Future Enhancements

Potential improvements:
- Upload SVG shapes directly from frontend
- Preview shapes before selection
- Save favorite routes
- Share routes via URL
- Display elevation profile
- Support multiple waypoints
- Route history and comparison

## Development Tips

### Hot Module Replacement

Vite provides fast HMR - changes appear instantly without page reload.

### TypeScript Strict Mode

The project uses strict TypeScript settings. All types must be properly defined.

### Styling

- Use CSS custom properties (defined in `styles.css`) for consistent theming
- Follow the neon-tech aesthetic: dark backgrounds, yellow accents, glowing effects
- Keep component styles modular in separate CSS files

### API Integration

All API calls go through `src/api.ts`. Add new endpoints there to keep the API client centralized.

## License

This is a POC (Proof of Concept) project. Use as you wish.

## Credits

- Map data: © OpenStreetMap contributors
- Map tiles: CartoDB Dark Matter
- Icons and fonts: Google Fonts (Orbitron, Inter)

