const fileInput = document.getElementById('fileInput');
const importStatus = document.getElementById('importStatus');
const canvas = document.getElementById('sourceCanvas');
const ctx = canvas.getContext('2d');
const pairButtons = document.getElementById('pairButtons');
const pairCards = document.getElementById('pairCards');
const addPairBtn = document.getElementById('addPairBtn');
const exportPairsBtn = document.getElementById('exportPairsBtn');
const exportStatus = document.getElementById('exportStatus');
const fitStatus = document.getElementById('fitStatus');
const fitParams = document.getElementById('fitParams');
const residualsEl = document.getElementById('residuals');
const basemapSelect = document.getElementById('basemapSelect');
const mapStatus = document.getElementById('mapStatus');
const gpxInput = document.getElementById('gpxInput');
const showGpxTrack = document.getElementById('showGpxTrack');
const gpxStatus = document.getElementById('gpxStatus');
const sourceScaleInput = document.getElementById('sourceScaleInput');
const resetSourceViewBtn = document.getElementById('resetSourceViewBtn');
const sourceViewStatus = document.getElementById('sourceViewStatus');
const zoomInSourceBtn = document.getElementById('zoomInSourceBtn');
const zoomOutSourceBtn = document.getElementById('zoomOutSourceBtn');

let sourceImage = null;
let pairs = [{ id: 1 }];
let selectedPair = 1;
let markers = [];
const sourceThumbCache = new Map();
const mapThumbCache = new Map();
const THUMB_SIZE = 120;
let metersPerPixel = 1;
let sourceView = null;
let dragState = null;
const sourceCanvasWrap = canvas.parentElement;

const fallbackCenter = [49.8352, -124.5247]; // Powell River, BC
const fallbackZoom = 13;
let elevationRequestId = 0;
let gpxTrackLayer = null;

const map = L.map('map').setView(fallbackCenter, fallbackZoom);
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
});
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri'
});

satelliteLayer.addTo(map);

if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      map.setView([latitude, longitude], 14);
      mapStatus.textContent = `Map centered on your location (${latitude.toFixed(4)}, ${longitude.toFixed(4)}).`;
    },
    () => {
      mapStatus.textContent = 'Location unavailable; using default Powell River, BC center.';
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 }
  );
} else {
  mapStatus.textContent = 'Geolocation not supported; using default Powell River, BC center.';
}

basemapSelect.addEventListener('change', (evt) => {
  mapThumbCache.clear();
  const value = evt.target.value;
  if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
  if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);

  if (value === 'satellite') {
    satelliteLayer.addTo(map);
  } else {
    osmLayer.addTo(map);
  }
  renderPairCards();
});

gpxInput.addEventListener('change', async (evt) => {
  const [gpxFile] = Array.from(evt.target.files || []);
  if (!gpxFile) {
    gpxStatus.textContent = 'No GPX loaded.';
    return;
  }

  try {
    const text = await gpxFile.text();
    const coordinates = parseGpxTrack(text);
    if (coordinates.length < 2) {
      throw new Error('GPX must include at least two track points.');
    }
    setGpxTrack(coordinates);
    gpxStatus.textContent = `Loaded ${coordinates.length} GPX points from ${gpxFile.name}.`;
  } catch (error) {
    gpxStatus.textContent = `Unable to read GPX: ${error.message}`;
  }
});

showGpxTrack.addEventListener('change', () => {
  if (!gpxTrackLayer) {
    showGpxTrack.checked = false;
    return;
  }
  if (showGpxTrack.checked) {
    gpxTrackLayer.addTo(map);
  } else {
    map.removeLayer(gpxTrackLayer);
  }
});

map.on('click', async (evt) => {
  const requestId = ++elevationRequestId;
  const lat = evt.latlng.lat;
  const lng = evt.latlng.lng;

  mapStatus.textContent = `Resolving elevation for ${lat.toFixed(5)}, ${lng.toFixed(5)}…`;

  let elevation = null;
  try {
    elevation = await lookupElevation(lat, lng);
    if (requestId === elevationRequestId) {
      mapStatus.textContent = Number.isFinite(elevation)
        ? `Elevation lookup succeeded: ${elevation.toFixed(2)} m (Open-Meteo elevation API).`
        : 'Elevation lookup returned no data for this location.';
    }
  } catch {
    if (requestId === elevationRequestId) {
      mapStatus.textContent = 'Elevation lookup failed; saved point with latitude/longitude only.';
    }
  }

  upsertPair(selectedPair, {
    target: { lat, lng, elevation }
  });
  refreshMarkers();
  solveAndRender();
});

function parseGpxTrack(rawText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid GPX XML.');
  }

  const points = [
    ...Array.from(doc.querySelectorAll('trkpt')),
    ...Array.from(doc.querySelectorAll('rtept'))
  ];

  return points
    .map((point) => ({
      lat: Number.parseFloat(point.getAttribute('lat')),
      lng: Number.parseFloat(point.getAttribute('lon'))
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function setGpxTrack(coordinates) {
  if (gpxTrackLayer) {
    map.removeLayer(gpxTrackLayer);
  }

  gpxTrackLayer = L.polyline(coordinates, {
    color: '#dbeafe',
    weight: 4,
    opacity: 0.25
  });

  showGpxTrack.disabled = false;
  showGpxTrack.checked = true;
  gpxTrackLayer.addTo(map);

  const bounds = gpxTrackLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

async function lookupElevation(lat, lng) {
  const apiUrl = new URL('https://api.open-meteo.com/v1/elevation');
  apiUrl.searchParams.set('latitude', String(lat));
  apiUrl.searchParams.set('longitude', String(lng));

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Elevation API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const value = Array.isArray(payload.elevation) ? payload.elevation[0] : payload.elevation;
  return Number.isFinite(value) ? value : null;
}

fileInput.addEventListener('change', async (evt) => {
  const files = Array.from(evt.target.files || []);
  const image = files.find((f) => f.type.startsWith('image/'));
  const json = files.find((f) => f.name.toLowerCase().endsWith('.json'));

  if (image) {
    sourceImage = await loadImage(URL.createObjectURL(image));
    sourceView = null;
    sourceThumbCache.clear();
  }

  if (json) {
    const parsed = JSON.parse(await json.text());
    const imported = parsed.points || (parsed.controlPoints || []).map((p) => ({ x: p.sourceX, y: p.sourceY }));
    if (imported.length) {
      pairs = imported.map((point, index) => ({ id: index + 1, source: { x: point.x, y: point.y } }));
      selectedPair = 1;
      sourceThumbCache.clear();
      mapThumbCache.clear();
    }
    if (Number.isFinite(parsed.metersPerPixel) && parsed.metersPerPixel > 0) {
      metersPerPixel = parsed.metersPerPixel;
      sourceScaleInput.value = String(metersPerPixel);
    }
    importStatus.textContent = `Imported ${imported.length} source points. Units: ${parsed.units || 'assumed metres'}.`;
  } else {
    importStatus.textContent = image
      ? 'Loaded image. Add source/map points to georeference.'
      : 'No supported files selected.';
  }

  renderPairButtons();
  renderPairCards();
  drawCanvas();
  solveAndRender();
});

sourceScaleInput.addEventListener('change', () => {
  const value = Number.parseFloat(sourceScaleInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    sourceScaleInput.value = String(metersPerPixel);
    return;
  }
  metersPerPixel = value;
  solveAndRender();
  drawCanvas();
});

resetSourceViewBtn.addEventListener('click', () => {
  sourceView = null;
  drawCanvas();
});

zoomInSourceBtn.addEventListener('click', () => applyZoom(1.1));
zoomOutSourceBtn.addEventListener('click', () => applyZoom(1 / 1.1));

window.addEventListener('resize', () => {
  resizeCanvasToContainer();
  drawCanvas();
});

addPairBtn.addEventListener('click', () => {
  const id = pairs.length ? Math.max(...pairs.map((p) => p.id)) + 1 : 1;
  pairs.push({ id });
  selectedPair = id;
  renderPairButtons();
  renderPairCards();
  drawCanvas();
});

exportPairsBtn.addEventListener('click', () => {
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    units: 'metres',
    metersPerPixel,
    pairs: pairs.map((pair) => ({
      id: pair.id,
      source: pair.source || null,
      target: pair.target || null,
      complete: Boolean(pair.source && pair.target)
    }))
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `trailmapper-pairs-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  const completeCount = exportPayload.pairs.filter((p) => p.complete).length;
  exportStatus.textContent = `Exported ${exportPayload.pairs.length} pair(s), ${completeCount} complete.`;
});

canvas.addEventListener('pointerdown', (evt) => {
  if (!sourceImage) {
    fileInput.click();
    return;
  }
  const point = getCanvasPoint(evt);
  dragState = {
    startCanvasX: point.x,
    startCanvasY: point.y,
    startOffsetX: getView().offsetX,
    startOffsetY: getView().offsetY,
    moved: false,
    pointerId: evt.pointerId
  };
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!dragState || dragState.pointerId !== evt.pointerId) {
    return;
  }
  const point = getCanvasPoint(evt);
  const dx = point.x - dragState.startCanvasX;
  const dy = point.y - dragState.startCanvasY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    dragState.moved = true;
  }
  const view = getView();
  view.offsetX = dragState.startOffsetX + dx;
  view.offsetY = dragState.startOffsetY + dy;
  drawCanvas();
});

canvas.addEventListener('pointerup', (evt) => {
  if (!dragState || dragState.pointerId !== evt.pointerId) {
    return;
  }

  const moved = dragState.moved;
  dragState = null;
  canvas.releasePointerCapture(evt.pointerId);

  if (!moved) {
    const point = getCanvasPoint(evt);
    const sourcePoint = canvasToImage(point.x, point.y);
    if (!sourcePoint) return;
    upsertPair(selectedPair, { source: sourcePoint });
    drawCanvas();
    solveAndRender();
  }
});

canvas.addEventListener('pointercancel', () => {
  dragState = null;
});

canvas.addEventListener(
  'wheel',
  (evt) => {
    if (!sourceImage) {
      return;
    }
    evt.preventDefault();

    const point = getCanvasPoint(evt);
    const before = canvasToImage(point.x, point.y);
    if (!before) return;

    const zoomFactor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyZoom(zoomFactor, point, before);
  },
  { passive: false }
);

function resizeCanvasToContainer() {
  const rect = sourceCanvasWrap.getBoundingClientRect();
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
}

function applyZoom(zoomFactor, anchorPoint = null, imagePoint = null) {
  if (!sourceImage) return;
  const view = getView();
  const pivot = anchorPoint || { x: canvas.width / 2, y: canvas.height / 2 };
  const sourcePivot = imagePoint || canvasToImage(pivot.x, pivot.y);
  if (!sourcePivot) return;

  const nextZoom = Math.min(30, Math.max(view.minZoom, view.zoom * zoomFactor));
  view.zoom = nextZoom;

  const displayScale = baseFitScale() * view.zoom;
  view.offsetX = pivot.x - sourcePivot.x * displayScale;
  view.offsetY = pivot.y - sourcePivot.y * displayScale;
  drawCanvas();
}

function drawSourcePin(x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(8, -10, 9, -20, 0, -28);
  ctx.bezierCurveTo(-9, -20, -8, -10, 0, 0);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -18, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderPairButtons() {
  pairButtons.innerHTML = '';
  pairs.forEach((pair) => {
    const btn = document.createElement('button');
    const state = `${pair.source ? 'S' : '-'}${pair.target ? 'M' : '-'}`;
    btn.textContent = `#${pair.id} ${state}`;
    if (pair.id === selectedPair) btn.classList.add('active');
    btn.onclick = () => {
      selectedPair = pair.id;
      renderPairButtons();
      renderPairCards();
      drawCanvas();
    };
    pairButtons.appendChild(btn);
  });
}

function upsertPair(id, patch) {
  pairs = pairs.map((pair) => (pair.id === id ? { ...pair, ...patch } : pair));
  sourceThumbCache.delete(id);
  mapThumbCache.delete(id);
  renderPairButtons();
  renderPairCards();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function getCanvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

function baseFitScale() {
  return Math.min(canvas.width / sourceImage.width, canvas.height / sourceImage.height);
}

function getView() {
  if (!sourceImage) {
    return null;
  }
  if (!sourceView) {
    const scale = baseFitScale();
    const width = sourceImage.width * scale;
    const height = sourceImage.height * scale;
    sourceView = {
      zoom: 1,
      minZoom: 0.3,
      offsetX: (canvas.width - width) / 2,
      offsetY: (canvas.height - height) / 2
    };
  }
  return sourceView;
}

function canvasToImage(canvasX, canvasY) {
  if (!sourceImage) return null;
  const view = getView();
  const displayScale = baseFitScale() * view.zoom;
  const imageX = (canvasX - view.offsetX) / displayScale;
  const imageY = (canvasY - view.offsetY) / displayScale;
  if (imageX < 0 || imageY < 0 || imageX > sourceImage.width || imageY > sourceImage.height) {
    return null;
  }
  return { x: imageX, y: imageY };
}

function drawCanvas() {
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!sourceImage) {
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Load an image file to begin.', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    sourceViewStatus.textContent = 'Source view: load an image to enable zoom/pan and source point selection.';
    return;
  }

  const view = getView();
  const drawScale = baseFitScale() * view.zoom;
  const drawWidth = sourceImage.width * drawScale;
  const drawHeight = sourceImage.height * drawScale;

  ctx.drawImage(sourceImage, view.offsetX, view.offsetY, drawWidth, drawHeight);

  pairs.forEach((pair) => {
    if (!pair.source) return;
    const x = view.offsetX + pair.source.x * drawScale;
    const y = view.offsetY + pair.source.y * drawScale;
    const markerColor = pair.id === selectedPair ? '#22c55e' : '#38bdf8';
    drawSourcePin(x, y, markerColor);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(pair.id), x + 8, y - 12);
  });

  sourceViewStatus.textContent = `Source view: zoom ${(view.zoom * 100).toFixed(0)}%, offset (${view.offsetX.toFixed(1)}, ${view.offsetY.toFixed(1)}), scale ${metersPerPixel.toFixed(4)} m/px.`;
}

function refreshMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
  pairs.forEach((pair) => {
    if (!pair.target) return;
    const marker = L.marker([pair.target.lat, pair.target.lng], {
      icon: L.divIcon({
        className: 'map-pin-icon',
        html: `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg"><path d="M12 32C12 32 22 19 22 12C22 5.37258 17.5228 0 12 0C6.47715 0 2 5.37258 2 12C2 19 12 32 12 32Z" fill="#38bdf8"/><circle cx="12" cy="12" r="4" fill="white"/></svg>`,
        iconSize: [24, 32],
        iconAnchor: [12, 32]
      })
    }).addTo(map).bindPopup(`Pair #${pair.id}`);
    markers.push(marker);
  });
}

function renderPairCards() {
  pairCards.innerHTML = '';
  pairs.forEach((pair) => {
    const card = document.createElement('article');
    card.className = `pair-card ${pair.id === selectedPair ? 'active' : ''}`;
    card.dataset.pairId = String(pair.id);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Select point pair ${pair.id}`);

    card.addEventListener('click', () => {
      selectedPair = pair.id;
      renderPairButtons();
      renderPairCards();
      drawCanvas();
    });

    const sourceThumb = getSourceThumbnail(pair);
    const mapThumb = getMapThumbnail(pair);

    const sourceText = pair.source
      ? `x=${pair.source.x.toFixed(2)}, y=${pair.source.y.toFixed(2)} px`
      : 'not set';
    const targetText = pair.target
      ? `lat=${pair.target.lat.toFixed(6)}, lng=${pair.target.lng.toFixed(6)}`
      : 'not set';
    const elevationText = Number.isFinite(pair.target?.elevation)
      ? `${pair.target.elevation.toFixed(2)} m`
      : '—';

    card.innerHTML = `
      <h3>Pair #${pair.id}</h3>
      <div class="pair-views">
        <div>
          <img class="pair-thumb" src="${sourceThumb}" alt="Source thumbnail for pair ${pair.id}" />
          <div class="muted">Image point</div>
        </div>
        <div>
          <img class="pair-thumb" src="${mapThumb}" alt="Map thumbnail for pair ${pair.id}" />
          <div class="muted">Reference point</div>
        </div>
      </div>
      <ul class="pair-meta">
        <li>Image location: ${sourceText}</li>
        <li>Map location: ${targetText}</li>
        <li>Elevation: ${elevationText}</li>
      </ul>
    `;

    pairCards.appendChild(card);
  });
}

function getPlaceholderThumb(label) {
  const c = document.createElement('canvas');
  c.width = THUMB_SIZE;
  c.height = THUMB_SIZE;
  const cc = c.getContext('2d');
  cc.fillStyle = '#020617';
  cc.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  cc.strokeStyle = '#475569';
  cc.strokeRect(0.5, 0.5, THUMB_SIZE - 1, THUMB_SIZE - 1);
  cc.fillStyle = '#94a3b8';
  cc.font = '12px sans-serif';
  cc.textAlign = 'center';
  cc.textBaseline = 'middle';
  cc.fillText(label, THUMB_SIZE / 2, THUMB_SIZE / 2);
  return c.toDataURL('image/png');
}

function drawCrosshair(cc, color) {
  cc.strokeStyle = color;
  cc.lineWidth = 1.5;
  cc.beginPath();
  cc.moveTo(THUMB_SIZE / 2, 10);
  cc.lineTo(THUMB_SIZE / 2, THUMB_SIZE - 10);
  cc.moveTo(10, THUMB_SIZE / 2);
  cc.lineTo(THUMB_SIZE - 10, THUMB_SIZE / 2);
  cc.stroke();
}

function getSourceThumbnail(pair) {
  if (!pair.source || !sourceImage) return getPlaceholderThumb('No source');
  if (sourceThumbCache.has(pair.id)) return sourceThumbCache.get(pair.id);

  const c = document.createElement('canvas');
  c.width = THUMB_SIZE;
  c.height = THUMB_SIZE;
  const cc = c.getContext('2d');

  const cropSize = Math.min(120, sourceImage.width, sourceImage.height);
  const sx = Math.max(0, Math.min(sourceImage.width - cropSize, pair.source.x - cropSize / 2));
  const sy = Math.max(0, Math.min(sourceImage.height - cropSize, pair.source.y - cropSize / 2));

  cc.drawImage(sourceImage, sx, sy, cropSize, cropSize, 0, 0, THUMB_SIZE, THUMB_SIZE);
  drawCrosshair(cc, '#22c55e');
  const data = c.toDataURL('image/png');
  sourceThumbCache.set(pair.id, data);
  return data;
}

function latLngToTileXY(lat, lng, zoom) {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function getTileTemplate() {
  if (basemapSelect.value === 'satellite') {
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  }
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}

function getMapThumbnail(pair) {
  if (!pair.target) return getPlaceholderThumb('No map');
  if (mapThumbCache.has(pair.id)) return mapThumbCache.get(pair.id);

  const c = document.createElement('canvas');
  c.width = THUMB_SIZE;
  c.height = THUMB_SIZE;
  const cc = c.getContext('2d');
  cc.fillStyle = '#0f172a';
  cc.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);

  const zoom = Math.max(2, Math.min(18, map.getZoom()));
  const centerTile = latLngToTileXY(pair.target.lat, pair.target.lng, zoom);
  const centerPx = { x: centerTile.x * 256, y: centerTile.y * 256 };
  const startPx = { x: centerPx.x - THUMB_SIZE / 2, y: centerPx.y - THUMB_SIZE / 2 };
  const tileTemplate = getTileTemplate();

  const startTileX = Math.floor(startPx.x / 256);
  const endTileX = Math.floor((startPx.x + THUMB_SIZE) / 256);
  const startTileY = Math.floor(startPx.y / 256);
  const endTileY = Math.floor((startPx.y + THUMB_SIZE) / 256);

  const maxTile = 2 ** zoom;
  for (let tx = startTileX; tx <= endTileX; tx += 1) {
    for (let ty = startTileY; ty <= endTileY; ty += 1) {
      if (ty < 0 || ty >= maxTile) continue;
      const wrappedTx = ((tx % maxTile) + maxTile) % maxTile;
      const url = tileTemplate.replace('{z}', zoom).replace('{x}', wrappedTx).replace('{y}', ty);
      const tile = new Image();
      tile.crossOrigin = 'anonymous';
      tile.src = url;
      const dx = tx * 256 - startPx.x;
      const dy = ty * 256 - startPx.y;
      tile.onload = () => {
        cc.drawImage(tile, dx, dy, 256, 256);
        drawCrosshair(cc, '#38bdf8');
        try {
          const data = c.toDataURL('image/png');
          mapThumbCache.set(pair.id, data);
          const img = pairCards.querySelector(`.pair-card[data-pair-id="${pair.id}"] .pair-views div:nth-child(2) img`);
          if (img) img.src = data;
        } catch {
          mapThumbCache.set(pair.id, getPlaceholderThumb('Map blocked'));
        }
      };
      tile.onerror = () => {
        mapThumbCache.set(pair.id, getPlaceholderThumb('Map tile error'));
      };
    }
  }

  drawCrosshair(cc, '#38bdf8');
  const initial = c.toDataURL('image/png');
  mapThumbCache.set(pair.id, initial);
  return initial;
}

function toMeters(lat, lng) {
  const x = (lng * 20037508.34) / 180;
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  return { x, y: (y * 20037508.34) / 180 };
}

function solveAndRender() {
  const complete = pairs.filter((p) => p.source && p.target);
  if (complete.length < 3) {
    fitStatus.textContent = 'Need 3 completed point pairs.';
    fitParams.textContent = '';
    residualsEl.innerHTML = '';
    return;
  }

  const A = [];
  const b = [];
  complete.forEach((pair) => {
    const s = pair.source;
    const scaledX = s.x * metersPerPixel;
    const scaledY = s.y * metersPerPixel;
    const t = toMeters(pair.target.lat, pair.target.lng);
    A.push([scaledX, scaledY, 1, 0, 0, 0]);
    b.push(t.x);
    A.push([0, 0, 0, scaledX, scaledY, 1]);
    b.push(t.y);
  });

  const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
  const rhs = Array(6).fill(0);

  for (let r = 0; r < A.length; r += 1) {
    for (let i = 0; i < 6; i += 1) {
      rhs[i] += A[r][i] * b[r];
      for (let j = 0; j < 6; j += 1) normal[i][j] += A[r][i] * A[r][j];
    }
  }

  let params;
  try {
    params = gaussJordan(normal, rhs);
  } catch (err) {
    fitStatus.textContent = `Could not solve transform: ${err.message}`;
    fitParams.textContent = '';
    residualsEl.innerHTML = '';
    return;
  }

  const residuals = complete.map((pair) => {
    const s = pair.source;
    const sx = s.x * metersPerPixel;
    const sy = s.y * metersPerPixel;
    const t = toMeters(pair.target.lat, pair.target.lng);
    const x = params[0] * sx + params[1] * sy + params[2];
    const y = params[3] * sx + params[4] * sy + params[5];
    return { id: pair.id, error: Math.hypot(x - t.x, y - t.y) };
  });
  const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r.error ** 2, 0) / residuals.length);

  fitStatus.textContent = `Solved with ${complete.length} points. RMS error: ${rms.toFixed(2)} m`;
  fitParams.textContent = params.map((v) => v.toFixed(6)).join(', ');
  residualsEl.innerHTML = residuals.map((r) => `<li>Pair #${r.id}: ${r.error.toFixed(2)} m</li>`).join('');
}

function gaussJordan(a, b) {
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];

    const d = a[i][i];
    if (Math.abs(d) < 1e-12) throw new Error('degenerate control points');
    for (let c = i; c < n; c += 1) a[i][c] /= d;
    b[i] /= d;

    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const f = a[r][i];
      for (let c = i; c < n; c += 1) a[r][c] -= f * a[i][c];
      b[r] -= f * b[i];
    }
  }
  return b;
}

resizeCanvasToContainer();
drawCanvas();
renderPairButtons();
renderPairCards();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      importStatus.textContent += ' (service worker unavailable in this environment)';
    });
  });
}
