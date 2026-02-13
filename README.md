# TrailMapper
Georeferencing for accurately mapping trail reconstructions.

## PWA prototype
This repository now includes a browser-based Progressive Web App that supports:
- Selecting multiple source files (image + optional JSON export).
- Picking paired control points in source space and map space.
- Switching reference basemaps between OpenStreetMap and satellite imagery (Esri World Imagery).
- Defaulting the map to the user's current location when available, with Powell River, BC as fallback.
- Exporting all control-point pairs to JSON for downstream workflows.
- Solving an affine georeference transform and reporting RMS/residual errors in metres.
- Offline caching of core app shell via a service worker.

## Data assumptions for current importer
- Input JSON supports either `points: [{x, y}]` or `controlPoints: [{sourceX, sourceY}]`.
- Export JSON includes `pairs[]` with `source` + `target` values and a completion flag.
- Source units are treated as metres.
- Unknown fields are ignored so schema changes are non-breaking.

## Run locally
Because this is a static PWA, serve files from any static server, for example:

```bash
python -m http.server 4173
```

Then open http://localhost:4173 in your browser.

## Planning docs
- [Georeferencing app design plan](docs/georeferencing-app-design.md)
