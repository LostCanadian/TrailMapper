# TrailMapper Web App Design Plan

## 1. Product goals
- Load a trail reconstruction-derived overhead export (initially 2D raster/vector).
- Overlay mapping references (satellite + base maps via Mapbox and/or OpenStreetMap tiles).
- Georeference scan data by selecting control points in both scan-space and map-space.
- Warp scan data to map coordinates and export georeferenced outputs.
- Leave a clear path for 2.5D/3D visualization later without replatforming.

## 2. Recommended technical stack
- **Frontend framework:** React + TypeScript + Vite.
- **Map engine (2D GIS):** MapLibre GL JS (open-source, Mapbox-style API).
  - Works with OSM and Mapbox vector/raster tiles.
- **3D rendering layer:** Three.js in a synchronized canvas overlay.
  - Keep 3D as optional module (lazy-loaded) for future 2.5D.
- **State management:** Zustand (lightweight) + React Query for async jobs.
- **Math/geo libraries:**
  - `proj4` for projection transforms.
  - `@turf/turf` for geometric utility operations.
  - `ml-matrix` or `opencv.js` for solving transform models.
- **Backend:** Node.js (Fastify/Nest) for job orchestration and persistence.
- **Spatial persistence:** Postgres + PostGIS.
- **Binary/object storage:** S3-compatible bucket for scan exports, tiles, snapshots.
- **Worker queue:** BullMQ or Temporal for heavier warp/reprojection jobs.

## 3. High-level architecture

### 3.1 Client modules
1. **Data Ingestion UI**
   - Upload overhead orthographic image (PNG/TIFF), optional vector outlines, metadata.
   - Capture source coordinate system (local scan units, unknown CRS, or known EPSG).
2. **Reference Map UI**
   - Basemap picker (satellite, terrain, OSM).
   - Opacity and blending controls for scan overlay.
3. **Control Point Editor**
   - Left pane: scan image with pickable points.
   - Right pane: map view with corresponding picks.
   - Residual error display per point and total RMS error.
4. **Transform/Warp Panel**
   - Choose model: Similarity, Affine, Projective, Thin Plate Spline (TPS).
   - Real-time preview and error diagnostics.
5. **Export Panel**
   - Export GeoTIFF/COG, GeoJSON footprints, and control-point reports.

### 3.2 Backend services
- **Project Service:** projects, datasets, revision history.
- **Georef Service:** transformation solver, outlier detection, warp execution.
- **Tile/Imagery Service:** tile provider credentials, layer catalogs.
- **Export Service:** build deliverables and signed download links.

## 4. Georeferencing workflow (user-facing)
1. Create project and upload scan overhead.
2. Pick map reference layer and target CRS (default EPSG:3857 for editing; optionally export EPSG:4326 or local UTM zone).
3. Add at least 3–4 control points (more recommended).
4. Solve initial transform with **Affine** (good baseline).
5. Inspect residuals and RMS error; mark suspected outliers.
6. If non-linear distortion exists, switch to **TPS** and compare errors.
7. Lock transformation, preview overlay at multiple zoom levels.
8. Export georeferenced assets.

## 5. Transformation model strategy
- **Similarity (4 params):** translation + rotation + uniform scale.
  - Use when data is rigid and scale-consistent.
- **Affine (6 params):** adds shear/non-uniform scale.
  - Default for many practical overhead recon alignments.
- **Projective/Homography (8 dof):** perspective-like distortions.
  - Useful for camera-derived imagery with perspective effects.
- **Thin Plate Spline (non-linear):** local warping for reconstruction drift.
  - Best for compensating uneven deformation but can overfit; regularization slider recommended.

## 6. Data model (core entities)
- **Project**: id, name, owner, defaultCRS, createdAt.
- **Dataset**: id, projectId, sourceType, fileUri, boundsLocal.
- **ControlPointPair**: id, datasetId, sourceX/sourceY(/sourceZ optional), lon/lat or targetX/targetY, weight, enabled.
- **TransformRevision**: id, datasetId, modelType, params, rmsError, maxError, createdBy.
- **ExportArtifact**: id, revisionId, type, uri, status.

## 7. Preparing for future 2.5D/3D support
- Store optional **Z** for source control points now.
- Abstract renderers behind an interface:
  - `MapViewport2D` (MapLibre)
  - `SceneViewport3D` (Three.js)
- Keep transformation APIs dimension-aware (`transform2D`, `transform3D`).
- Add optional DEM/DSM layer support later to drape scan meshes on terrain.

## 8. UX recommendations
- Side-by-side synchronized panes with identical zoom shortcuts.
- Snap tools (corners, intersections, trail centerline nodes).
- Keyboard-driven point pairing for speed.
- Confidence heatmap showing local warp distortion.
- Undo/redo stack and revision compare view.

## 9. Integration options: OSM vs Mapbox
- **OSM-only path:** lower cost, fully open stack; combine with open satellite providers where licensing allows.
- **Mapbox path:** richer satellite styles and APIs; watch usage costs and token controls.
- Keep provider abstraction so switching requires config, not code changes.

## 10. Suggested phased roadmap

### Phase 1 (MVP: 4–6 weeks)
- Upload overhead image.
- Basemap overlay (MapLibre + OSM/Mapbox tiles).
- Manual control-point pairing.
- Affine solve + RMS/error table.
- Export world-file + GeoTIFF.

### Phase 2
- TPS/projective models.
- Outlier detection and robust fit (RANSAC).
- Saved revisions and diff view.

### Phase 3
- 2.5D preview (Three.js overlay).
- Optional mesh/point-cloud import and terrain draping.
- Collaborative editing and review workflow.

## 11. Risks and mitigations
- **Control-point quality variance:** add guidance and point-quality scoring.
- **Overfitting with non-linear models:** regularization controls + cross-validation metrics.
- **Large raster performance:** pyramids/overviews, COG tiling, worker-based resampling.
- **Provider lock-in:** stable provider abstraction and generic style config.

## 12. First implementation decisions to lock early
1. Canonical internal CRS for editing (`EPSG:3857` vs project-local).
2. Initial transform model default (recommend Affine).
3. Export formats required by downstream GIS users.
4. Token/licensing strategy for basemap providers.
