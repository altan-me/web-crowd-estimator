/* Crowd Estimator - Vanilla JS
 * Satellite map (XYZ tiles) + polygon drawing + 10 m^2 grid + Jacobs' density painting.
 * All geospatial math (Web Mercator projection, local planar conversion, Shoelace
 * area formula, ray-casting point-in-polygon) is implemented from scratch below.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const TILE_SIZE = 256;
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 22;
  const MAX_TILE_ZOOM = 19; // highest zoom level with real imagery tiles; beyond this we scale up MAX_TILE_ZOOM tiles
  const COUNT_DURATION_MS = 600; // header crowd total count-up
  const TILE_URL = (x, y, z) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  const CELL_SIDE_M = Math.sqrt(10); // ~3.1623 m -> 10 m^2 per cell
  const CELL_AREA_M2 = 10;

  // Compact level codes: a share link lists only the painted blocks, so empty
  // blocks (the majority) cost nothing.
  const DENSITY_CODE = {
    light: "l",
    moderate: "m",
    dense: "d",
    veryDense: "v",
  };
  const LEVEL_BY_CODE = Object.fromEntries(
    Object.entries(DENSITY_CODE).map(([level, code]) => [code, level]),
  );

  const DENSITY = {
    empty: {
      label: "Empty",
      peoplePerM2: 0,
      fill: "rgba(255,255,255,0.04)",
      stroke: "rgba(255,255,255,0.15)",
    },
    light: {
      label: "Light",
      peoplePerM2: 1,
      fill: "rgba(66,165,245,0.55)",
      stroke: "rgba(66,165,245,0.9)",
    },
    moderate: {
      label: "Moderate",
      peoplePerM2: 1.5,
      fill: "rgba(102,187,106,0.55)",
      stroke: "rgba(102,187,106,0.9)",
    },
    dense: {
      label: "Dense",
      peoplePerM2: 2.4,
      fill: "rgba(255,167,38,0.6)",
      stroke: "rgba(255,167,38,0.9)",
    },
    veryDense: {
      label: "Very Dense",
      peoplePerM2: 4.3,
      fill: "rgba(239,83,80,0.65)",
      stroke: "rgba(239,83,80,0.9)",
    },
  };

  const STORAGE_KEY = "crowdEstimator.state.v1";

  // Approximate city coordinates for common IANA time zones, used to pick a
  // sensible starting map location (only when there is no saved localStorage state).
  const TIMEZONE_COORDS = {
    "America/New_York": { lat: 40.7128, lng: -74.006, zoom: 12 },
    "America/Chicago": { lat: 41.8781, lng: -87.6298, zoom: 12 },
    "America/Denver": { lat: 39.7392, lng: -104.9903, zoom: 12 },
    "America/Phoenix": { lat: 33.4484, lng: -112.074, zoom: 12 },
    "America/Los_Angeles": { lat: 34.0522, lng: -118.2437, zoom: 12 },
    "America/Anchorage": { lat: 61.2181, lng: -149.9003, zoom: 11 },
    "Pacific/Honolulu": { lat: 21.3069, lng: -157.8583, zoom: 11 },
    "America/Toronto": { lat: 43.6532, lng: -79.3832, zoom: 12 },
    "America/Vancouver": { lat: 49.2827, lng: -123.1207, zoom: 12 },
    "America/Mexico_City": { lat: 19.4326, lng: -99.1332, zoom: 12 },
    "America/Bogota": { lat: 4.711, lng: -74.0721, zoom: 12 },
    "America/Lima": { lat: -12.0464, lng: -77.0428, zoom: 12 },
    "America/Santiago": { lat: -33.4489, lng: -70.6693, zoom: 12 },
    "America/Caracas": { lat: 10.4806, lng: -66.9036, zoom: 12 },
    "America/Sao_Paulo": { lat: -23.5505, lng: -46.6333, zoom: 12 },
    "America/Argentina/Buenos_Aires": {
      lat: -34.6037,
      lng: -58.3816,
      zoom: 12,
    },
    "America/Havana": { lat: 23.1136, lng: -82.3666, zoom: 12 },
    "Europe/London": { lat: 51.5074, lng: -0.1278, zoom: 12 },
    "Europe/Dublin": { lat: 53.3498, lng: -6.2603, zoom: 12 },
    "Europe/Paris": { lat: 48.8566, lng: 2.3522, zoom: 12 },
    "Europe/Berlin": { lat: 52.52, lng: 13.405, zoom: 12 },
    "Europe/Madrid": { lat: 40.4168, lng: -3.7038, zoom: 12 },
    "Europe/Rome": { lat: 41.9028, lng: 12.4964, zoom: 12 },
    "Europe/Amsterdam": { lat: 52.3676, lng: 4.9041, zoom: 12 },
    "Europe/Brussels": { lat: 50.8503, lng: 4.3517, zoom: 12 },
    "Europe/Vienna": { lat: 48.2082, lng: 16.3738, zoom: 12 },
    "Europe/Warsaw": { lat: 52.2297, lng: 21.0122, zoom: 12 },
    "Europe/Stockholm": { lat: 59.3293, lng: 18.0686, zoom: 12 },
    "Europe/Athens": { lat: 37.9838, lng: 23.7275, zoom: 12 },
    "Europe/Istanbul": { lat: 41.0082, lng: 28.9784, zoom: 12 },
    "Europe/Moscow": { lat: 55.7558, lng: 37.6173, zoom: 12 },
    "Africa/Cairo": { lat: 30.0444, lng: 31.2357, zoom: 12 },
    "Africa/Johannesburg": { lat: -26.2041, lng: 28.0473, zoom: 12 },
    "Africa/Lagos": { lat: 6.5244, lng: 3.3792, zoom: 12 },
    "Africa/Nairobi": { lat: -1.2921, lng: 36.8219, zoom: 12 },
    "Asia/Jerusalem": { lat: 31.7683, lng: 35.2137, zoom: 12 },
    "Asia/Riyadh": { lat: 24.7136, lng: 46.6753, zoom: 12 },
    "Asia/Dubai": { lat: 25.2048, lng: 55.2708, zoom: 12 },
    "Asia/Tehran": { lat: 35.6892, lng: 51.389, zoom: 12 },
    "Asia/Karachi": { lat: 24.8607, lng: 67.0011, zoom: 12 },
    "Asia/Kolkata": { lat: 28.6139, lng: 77.209, zoom: 12 },
    "Asia/Dhaka": { lat: 23.8103, lng: 90.4125, zoom: 12 },
    "Asia/Bangkok": { lat: 13.7563, lng: 100.5018, zoom: 12 },
    "Asia/Jakarta": { lat: -6.2088, lng: 106.8456, zoom: 12 },
    "Asia/Singapore": { lat: 1.3521, lng: 103.8198, zoom: 12 },
    "Asia/Kuala_Lumpur": { lat: 3.139, lng: 101.6869, zoom: 12 },
    "Asia/Ho_Chi_Minh": { lat: 10.8231, lng: 106.6297, zoom: 12 },
    "Asia/Manila": { lat: 14.5995, lng: 120.9842, zoom: 12 },
    "Asia/Hong_Kong": { lat: 22.3193, lng: 114.1694, zoom: 12 },
    "Asia/Shanghai": { lat: 31.2304, lng: 121.4737, zoom: 12 },
    "Asia/Taipei": { lat: 25.033, lng: 121.5654, zoom: 12 },
    "Asia/Tokyo": { lat: 35.6762, lng: 139.6503, zoom: 12 },
    "Asia/Seoul": { lat: 37.5665, lng: 126.978, zoom: 12 },
    "Australia/Perth": { lat: -31.9505, lng: 115.8605, zoom: 12 },
    "Australia/Brisbane": { lat: -27.4698, lng: 153.0251, zoom: 12 },
    "Australia/Sydney": { lat: -33.8688, lng: 151.2093, zoom: 12 },
    "Australia/Melbourne": { lat: -37.8136, lng: 144.9631, zoom: 12 },
    "Pacific/Auckland": { lat: -36.8485, lng: 174.7633, zoom: 12 },
  };

  // Fallback when the resolved time zone isn't in the table above: estimate a
  // longitude band from the browser's UTC offset and use a temperate latitude.
  function offsetFallbackView() {
    const offsetMinutes = new Date().getTimezoneOffset();
    const utcOffsetHours = -offsetMinutes / 60;
    const lng = Math.max(-180, Math.min(180, utcOffsetHours * 15));
    return { lat: 20, lng, zoom: 5 };
  }

  function guessViewFromTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && TIMEZONE_COORDS[tz]) return TIMEZONE_COORDS[tz];
    } catch (e) {
      console.warn("Could not resolve browser time zone", e);
    }
    return offsetFallbackView();
  }

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");
  const hintEl = document.getElementById("hint");
  const tileLoadingEl = document.getElementById("tile-loading");

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const searchEl = document.getElementById("search");
  const searchToggleBtn = document.getElementById("search-toggle");
  const headerEl = document.querySelector(".app-header");

  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");

  const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
  const densityButtons = Array.from(document.querySelectorAll(".density-btn"));

  const undoPointBtn = document.getElementById("undo-point");
  const finishPolygonBtn = document.getElementById("finish-polygon");
  const vertexCountEl = document.getElementById("vertex-count");
  const stepLabelEl = document.getElementById("step-label");
  const stepTextEl = document.getElementById("step-text");
  const drawControlsEl = document.getElementById("draw-controls");

  const densityGroupEl = document.getElementById("density-group");
  const densityLockedEl = document.getElementById("density-locked");
  const densityBarEl = document.getElementById("density-bar");

  const totalAreaEl = document.getElementById("total-area");
  const totalBlocksEl = document.getElementById("total-blocks");
  const totalCrowdEl = document.getElementById("total-crowd");

  const shareBtn = document.getElementById("share-btn");
  const shareBtnTextEl = document.getElementById("share-btn-text");

  const titleDefaultEl = document.getElementById("title-default");
  const titleEstimateEl = document.getElementById("title-estimate");
  const titleCountEl = document.getElementById("title-count");

  const clearAllBtn = document.getElementById("clear-all");

  // ---------------------------------------------------------------------
  // Application state
  // ---------------------------------------------------------------------
  /** @type {{view:{lat:number,lng:number,zoom:number}, polygon:{lat:number,lng:number}[], polygonClosed:boolean, blocks:{id:string,lat:number,lng:number,densityLevel:string}[], totalAreaM2:number, gridMeta:null|{refLat:number,refLng:number,minX:number,minY:number}}} */
  let state = {
    view: { lat: 40.4406, lng: -79.9959, zoom: 17 },
    polygon: [],
    polygonClosed: false,
    blocks: [],
    totalAreaM2: 0,
    gridMeta: null,
  };

  let mode = "pan"; // 'pan' | 'draw' | 'paint'
  let currentDensity = "light";

  let cssWidth = 0;
  let cssHeight = 0;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const tileCache = new Map(); // "z/x/y" -> HTMLImageElement (loaded or loading)
  const pendingTiles = new Set(); // keys of tiles still being fetched, drives the loading indicator
  let drawScheduled = false;

  // Interaction state
  let isPointerDown = false;
  let panStart = null; // {x,y, lat, lng}
  let paintedThisStroke = new Set();
  const activePointers = new Map(); // pointerId -> {x,y}
  let pinchState = null; // {startDist, startZoom, anchorLat, anchorLng}

  // ---------------------------------------------------------------------
  // Web Mercator projection helpers (for rendering the map on screen)
  // ---------------------------------------------------------------------
  function lonToWorldX(lon, zoom) {
    return ((lon + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
  }

  function latToWorldY(lat, zoom) {
    const rad = (lat * Math.PI) / 180;
    return (
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      TILE_SIZE *
      Math.pow(2, zoom)
    );
  }

  function worldXToLon(x, zoom) {
    return (x / (TILE_SIZE * Math.pow(2, zoom))) * 360 - 180;
  }

  function worldYToLat(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * Math.pow(2, zoom));
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function project(lat, lng) {
    const zoom = state.view.zoom;
    const wx = lonToWorldX(lng, zoom);
    const wy = latToWorldY(lat, zoom);
    const cwx = lonToWorldX(state.view.lng, zoom);
    const cwy = latToWorldY(state.view.lat, zoom);
    return { x: cssWidth / 2 + (wx - cwx), y: cssHeight / 2 + (wy - cwy) };
  }

  function unproject(px, py) {
    const zoom = state.view.zoom;
    const cwx = lonToWorldX(state.view.lng, zoom);
    const cwy = latToWorldY(state.view.lat, zoom);
    const wx = cwx + (px - cssWidth / 2);
    const wy = cwy + (py - cssHeight / 2);
    return { lat: worldYToLat(wy, zoom), lng: worldXToLon(wx, zoom) };
  }

  // Meters-per-pixel at the map's current zoom/latitude (standard slippy-map formula).
  function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  // ---------------------------------------------------------------------
  // Local planar (tangent-plane) projection, used for accurate metric math:
  // Shoelace area calculation, grid generation, and ray-casting.
  // ---------------------------------------------------------------------
  function metersPerDegree(refLat) {
    return {
      lat: 111320,
      lng: 111320 * Math.cos((refLat * Math.PI) / 180),
    };
  }

  function toLocalMeters(lat, lng, refLat, refLng) {
    const mpd = metersPerDegree(refLat);
    return { x: (lng - refLng) * mpd.lng, y: (lat - refLat) * mpd.lat };
  }

  function fromLocalMeters(x, y, refLat, refLng) {
    const mpd = metersPerDegree(refLat);
    return { lat: refLat + y / mpd.lat, lng: refLng + x / mpd.lng };
  }

  // Shoelace formula: area of a simple polygon given planar (x,y) points.
  function shoelaceArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  // Ray-casting point-in-polygon test on planar (x,y) points.
  function pointInPolygon(px, py, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x,
        yi = points[i].y;
      const xj = points[j].x,
        yj = points[j].y;
      const intersects =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  // ---------------------------------------------------------------------
  // Grid generation
  // ---------------------------------------------------------------------
  function generateGrid() {
    if (state.polygon.length < 3) {
      state.blocks = [];
      state.totalAreaM2 = 0;
      state.gridMeta = null;
      return;
    }

    const refLat = state.polygon[0].lat;
    const refLng = state.polygon[0].lng;
    const planarPts = state.polygon.map((p) =>
      toLocalMeters(p.lat, p.lng, refLat, refLng),
    );

    state.totalAreaM2 = shoelaceArea(planarPts);

    const xs = planarPts.map((p) => p.x);
    const ys = planarPts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const oldBlocksById = new Map(state.blocks.map((b) => [b.id, b]));
    const newBlocks = [];
    let row = 0;
    for (let y = minY; y < maxY; y += CELL_SIDE_M, row++) {
      let col = 0;
      for (let x = minX; x < maxX; x += CELL_SIDE_M, col++) {
        const cx = x + CELL_SIDE_M / 2;
        const cy = y + CELL_SIDE_M / 2;
        if (pointInPolygon(cx, cy, planarPts)) {
          const id = `r${row}_c${col}`;
          const { lat, lng } = fromLocalMeters(cx, cy, refLat, refLng);
          const existing = oldBlocksById.get(id);
          newBlocks.push({
            id,
            lat,
            lng,
            densityLevel: existing ? existing.densityLevel : "empty",
          });
        }
      }
    }

    state.blocks = newBlocks;
    state.gridMeta = { refLat, refLng, minX, minY };
  }

  function findBlockAt(lat, lng) {
    if (!state.gridMeta) return null;
    const { refLat, refLng, minX, minY } = state.gridMeta;
    const { x, y } = toLocalMeters(lat, lng, refLat, refLng);
    const col = Math.floor((x - minX) / CELL_SIDE_M);
    const row = Math.floor((y - minY) / CELL_SIDE_M);
    const id = `r${row}_c${col}`;
    return state.blocks.find((b) => b.id === id) || null;
  }

  // ---------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------
  function recalcTotals() {
    let crowd = 0;
    for (const b of state.blocks) {
      const density = DENSITY[b.densityLevel] || DENSITY.empty;
      crowd += density.peoplePerM2 * CELL_AREA_M2;
    }
    totalAreaEl.textContent = Math.round(state.totalAreaM2).toLocaleString();
    totalBlocksEl.textContent = state.blocks.length.toLocaleString();
    totalCrowdEl.textContent = Math.round(crowd).toLocaleString();
    updateTitleEstimate(crowd);
    updateWorkflow();
  }

  // ---------------------------------------------------------------------
  // Header estimate
  // ---------------------------------------------------------------------
  // The header title turns into a running crowd total as soon as there is one,
  // counting up to each new value instead of jumping straight to it.
  const reduceMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  let displayedCrowd = 0;
  let countFrame = 0;
  let countTarget = -1;

  function updateTitleEstimate(crowd) {
    const target = Math.round(crowd);
    titleDefaultEl.hidden = target > 0;
    titleEstimateEl.hidden = target === 0;

    if (target === countTarget) return; // already showing or heading there
    countTarget = target;

    if (countFrame) cancelAnimationFrame(countFrame);
    countFrame = 0;

    if (target === 0) {
      displayedCrowd = 0;
      titleCountEl.textContent = "0";
      return;
    }
    countUpTo(target);
  }

  function countUpTo(target) {
    const from = displayedCrowd;
    if (from === target) return; // nothing changed, so nothing to celebrate
    if (reduceMotionQuery.matches) {
      displayedCrowd = target;
      titleCountEl.textContent = target.toLocaleString();
      return;
    }

    let start = null;
    const step = (now) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / COUNT_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      displayedCrowd = Math.round(from + (target - from) * eased);
      titleCountEl.textContent = displayedCrowd.toLocaleString();
      if (t < 1) {
        countFrame = requestAnimationFrame(step);
      } else {
        countFrame = 0;
        displayedCrowd = target;
        titleCountEl.textContent = target.toLocaleString();
      }
    };
    countFrame = requestAnimationFrame(step);
    popCount();
  }

  function popCount() {
    if (reduceMotionQuery.matches) return;
    titleCountEl.animate?.(
      [{ transform: "scale(1.18)" }, { transform: "scale(1)" }],
      { duration: 280, easing: "ease-out" },
    );
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------
  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save state to localStorage", e);
    }
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = Object.assign(state, parsed);
        return true;
      }
      return false;
    } catch (e) {
      console.warn("Failed to load state from localStorage", e);
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Share links
  // ---------------------------------------------------------------------
  const SHARE_BUTTON_LABEL = "Copy share link";
  let shareFeedbackTimer = 0;

  // A share link carries only the polygon and the painted densities. The grid
  // is rebuilt from the polygon on load (generateGrid is deterministic given
  // it) and the view is fitted to the polygon, which keeps the link short.
  function buildShareUrl() {
    const points = state.polygon
      .map((p) => `${p.lat.toFixed(6)}_${p.lng.toFixed(6)}`)
      .join(";");
    const parts = [`p=${points}`];
    if (state.polygonClosed) parts.push("c=1");

    const painted = state.blocks
      .filter((b) => DENSITY_CODE[b.densityLevel])
      .map((b) => `${b.id}:${DENSITY_CODE[b.densityLevel]}`);
    if (painted.length) parts.push(`g=${painted.join(",")}`);

    // The fragment never reaches the server and keeps the service worker's
    // cache lookup matching the plain shell URL.
    return `${location.href.split("#")[0]}#${parts.join("&")}`;
  }

  // Returns null unless the hash holds a usable polygon.
  function parseShareUrl() {
    if (!location.hash) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const rawPoints = params.get("p");
    if (!rawPoints) return null;

    const polygon = rawPoints
      .split(";")
      .map((pair) => {
        const [lat, lng] = pair.split("_");
        return { lat: Number(lat), lng: Number(lng) };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (polygon.length < 3) return null;

    return {
      polygon,
      polygonClosed: params.get("c") === "1",
      densities: params.get("g") || "",
    };
  }

  function applySharedState(shared) {
    state.polygon = shared.polygon;
    state.polygonClosed = shared.polygonClosed;
    // Drop local blocks first, otherwise generateGrid would keep their densities.
    state.blocks = [];
    generateGrid();

    const blocksById = new Map(state.blocks.map((b) => [b.id, b]));
    for (const entry of shared.densities.split(",")) {
      const [id, code] = entry.split(":");
      const level = LEVEL_BY_CODE[code];
      const block = level ? blocksById.get(id) : null;
      if (block) block.densityLevel = level;
    }
  }

  // Centres and zooms so the polygon fills the map area with a small margin.
  function fitViewToPolygon() {
    if (state.polygon.length === 0) return;

    const xs = state.polygon.map((p) => lonToWorldX(p.lng, 0));
    const ys = state.polygon.map((p) => latToWorldY(p.lat, 0));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // World pixels double per zoom level, hence log2 of the required ratio.
    const margin = 0.85;
    const zoom = Math.min(
      Math.log2((cssWidth * margin) / Math.max(maxX - minX, 1e-9)),
      Math.log2((cssHeight * margin) / Math.max(maxY - minY, 1e-9)),
    );

    state.view.lat = worldYToLat((minY + maxY) / 2, 0);
    state.view.lng = worldXToLon((minX + maxX) / 2, 0);
    state.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    scheduleDraw();
    saveState();
  }

  function showShareFeedback(message) {
    shareBtnTextEl.textContent = message;
    if (shareFeedbackTimer) clearTimeout(shareFeedbackTimer);
    shareFeedbackTimer = window.setTimeout(() => {
      shareFeedbackTimer = 0;
      shareBtnTextEl.textContent = SHARE_BUTTON_LABEL;
    }, 1600);
  }

  async function copyShareLink() {
    const url = buildShareUrl();
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        showShareFeedback("Link copied");
        return;
      } catch (err) {
        console.warn("Could not write the share link to the clipboard", err);
      }
    }
    // The clipboard API needs a secure context, so offer the link instead.
    window.prompt("Copy this link:", url);
  }

  // ---------------------------------------------------------------------
  // Tile rendering
  // ---------------------------------------------------------------------
  function getTile(z, x, y) {
    const n = Math.pow(2, z);
    const wrappedX = ((x % n) + n) % n;
    if (y < 0 || y >= n) return null;
    const key = `${z}/${wrappedX}/${y}`;
    let img = tileCache.get(key);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.src = TILE_URL(wrappedX, y, z);
      pendingTiles.add(key);
      updateTileLoadingIndicator();
      const settle = () => {
        pendingTiles.delete(key);
        updateTileLoadingIndicator();
        scheduleDraw();
      };
      img.onload = settle;
      img.onerror = settle;
      tileCache.set(key, img);
    }
    return img;
  }

  function updateTileLoadingIndicator() {
    tileLoadingEl.classList.toggle("visible", pendingTiles.size > 0);
  }

  function drawTiles() {
    const zoom = state.view.zoom;
    // Fetch tiles at a clamped integer zoom, then scale them to match the
    // (possibly fractional, possibly beyond-native-resolution) view zoom.
    const tileZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_TILE_ZOOM, Math.round(zoom)),
    );
    const scale = Math.pow(2, zoom - tileZoom);
    const scaledTile = TILE_SIZE * scale;

    const cwx = lonToWorldX(state.view.lng, zoom);
    const cwy = latToWorldY(state.view.lat, zoom);
    const topLeftX = cwx - cssWidth / 2;
    const topLeftY = cwy - cssHeight / 2;

    const startTileX = Math.floor(topLeftX / scaledTile);
    const startTileY = Math.floor(topLeftY / scaledTile);
    const endTileX = Math.floor((topLeftX + cssWidth) / scaledTile);
    const endTileY = Math.floor((topLeftY + cssHeight) / scaledTile);

    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        const img = getTile(tileZoom, tx, ty);
        const sx = tx * scaledTile - topLeftX;
        const sy = ty * scaledTile - topLeftY;
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, sx, sy, scaledTile, scaledTile);
        } else {
          ctx.fillStyle = "#141a2a";
          ctx.fillRect(sx, sy, scaledTile, scaledTile);
        }
      }
    }
  }

  function drawPolygon() {
    if (state.polygon.length === 0) return;
    const screenPts = state.polygon.map((p) => project(p.lat, p.lng));

    ctx.beginPath();
    screenPts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    if (state.polygonClosed) ctx.closePath();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#4f8cff";
    ctx.stroke();

    if (state.polygonClosed) {
      ctx.fillStyle = "rgba(79,140,255,0.08)";
      ctx.fill();
    }

    ctx.fillStyle = "#4f8cff";
    screenPts.forEach((pt) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawGrid() {
    if (state.blocks.length === 0) return;
    const lat = state.view.lat;
    const mpp = metersPerPixel(lat, state.view.zoom);
    const halfPx = CELL_SIDE_M / mpp / 2;

    for (const block of state.blocks) {
      const center = project(block.lat, block.lng);
      const density = DENSITY[block.densityLevel] || DENSITY.empty;
      ctx.fillStyle = density.fill;
      ctx.strokeStyle = density.stroke;
      ctx.lineWidth = 1;
      const size = halfPx * 2;
      ctx.fillRect(center.x - halfPx, center.y - halfPx, size, size);
      ctx.strokeRect(center.x - halfPx, center.y - halfPx, size, size);
    }
  }

  function draw() {
    drawScheduled = false;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    drawTiles();
    drawGrid();
    drawPolygon();
  }

  function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(draw);
  }

  // ---------------------------------------------------------------------
  // Canvas sizing (device-pixel-ratio aware)
  // ---------------------------------------------------------------------
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleDraw();
  }

  // ---------------------------------------------------------------------
  // UI updates
  // ---------------------------------------------------------------------
  // True on phones and tablets, where the primary pointer can't hover. Touch
  // screens with a mouse attached keep reporting "fine", so they keep the
  // mouse wording.
  const touchPrimaryQuery = window.matchMedia(
    "(hover: none) and (pointer: coarse)",
  );

  function updateHint() {
    const touch = touchPrimaryQuery.matches;
    const press = touch ? "Tap" : "Click";
    if (mode === "pan")
      hintEl.textContent = touch
        ? "Drag to pan, pinch to zoom."
        : "Drag to pan, scroll to zoom.";
    else if (mode === "draw")
      hintEl.textContent =
        `${press} on the map to add polygon vertices, then ` +
        '"Finish & Generate Grid".';
    else
      hintEl.textContent = `${press} or drag over grid blocks to paint the selected density.`;
  }

  function updateVertexCount() {
    const points = state.polygon.length;
    if (points === 0) vertexCountEl.textContent = "No points yet";
    else if (points < 3)
      vertexCountEl.textContent =
        `${points} of 3 points placed, ${3 - points} to go`;
    else if (state.polygonClosed)
      vertexCountEl.textContent = `${points} points, grid generated`;
    else vertexCountEl.textContent = `${points} points, ready to generate the grid`;
    updateWorkflow();
  }

  // The three modes are meant to be used in order, so every state change
  // re-derives which step the user is on and what they should do next.
  function currentStep() {
    const points = state.polygon.length;
    const hasGrid = state.blocks.length > 0;

    if (hasGrid) {
      if (mode !== "paint")
        return {
          step: 3,
          message:
            'Choose "Paint Grid" above, then paint the blocks with a density.',
        };
      if (!state.blocks.some((block) => block.densityLevel !== "empty"))
        return {
          step: 3,
          message:
            "Pick a density below, then tap or drag across the grid blocks.",
        };
      return {
        step: 3,
        message:
          'Keep painting, or read the estimate below. "Clear All" starts over.',
      };
    }

    if (points >= 3)
      return {
        step: 2,
        message:
          'Click "Finish & Generate Grid" when the outline looks right.',
      };
    if (mode === "draw")
      return {
        step: 2,
        message:
          "Tap the map to mark the corners of the area, 3 points minimum.",
      };
    if (points === 0)
      return {
        step: 1,
        message:
          'Pan and zoom to find the area, then choose "Draw Polygon" above.',
      };
    return {
      step: 2,
      message: 'Choose "Draw Polygon" above to add the remaining points.',
    };
  }

  function updateWorkflow() {
    const { step, message } = currentStep();
    stepLabelEl.textContent = `Step ${step} of 3`;
    stepTextEl.textContent = message;
    // The polygon controls only make sense while drawing.
    drawControlsEl.hidden = mode !== "draw";
    undoPointBtn.disabled = state.polygon.length === 0;
    finishPolygonBtn.disabled = state.polygon.length < 3;
    shareBtn.disabled = state.polygon.length < 3;
    const locked = state.blocks.length === 0;
    densityGroupEl.classList.toggle("locked", locked);
    densityLockedEl.hidden = !locked;
    // The mobile density palette only shows once there is a grid to paint.
    const showDensityBar = !locked && mode === "paint";
    densityBarEl.hidden = !showDensityBar;
    document.body.classList.toggle("has-density-bar", showDensityBar);
  }

  function setMode(newMode) {
    mode = newMode;
    modeButtons.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.mode === mode),
    );
    updateHint();
    updateWorkflow();
  }

  function setDensity(newDensity) {
    currentDensity = newDensity;
    densityButtons.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.density === newDensity),
    );
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  // Re-word the hints when the input type changes, e.g. a mouse is plugged into
  // a tablet or the browser starts emulating touch.
  touchPrimaryQuery.addEventListener?.("change", updateHint);

  densityButtons.forEach((btn) => {
    btn.addEventListener("click", () => setDensity(btn.dataset.density));
  });

  zoomInBtn.addEventListener("click", () => {
    state.view.zoom = Math.min(MAX_ZOOM, Math.round(state.view.zoom) + 1);
    scheduleDraw();
    saveState();
  });

  zoomOutBtn.addEventListener("click", () => {
    state.view.zoom = Math.max(MIN_ZOOM, Math.round(state.view.zoom) - 1);
    scheduleDraw();
    saveState();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = unproject(px, py);
      state.view.zoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, state.view.zoom + (e.deltaY < 0 ? 1 : -1)),
      );
      const after = unproject(px, py);
      state.view.lat += before.lat - after.lat;
      state.view.lng += before.lng - after.lng;
      scheduleDraw();
      saveState();
    },
    { passive: false },
  );

  undoPointBtn.addEventListener("click", () => {
    state.polygon.pop();
    state.polygonClosed = false;
    updateVertexCount();
    scheduleDraw();
    saveState();
  });

  finishPolygonBtn.addEventListener("click", () => {
    if (state.polygon.length < 3) return;
    state.polygonClosed = true;
    generateGrid();
    recalcTotals();
    scheduleDraw();
    saveState();
    setMode("paint");
  });

  clearAllBtn.addEventListener("click", () => {
    state.polygon = [];
    state.polygonClosed = false;
    state.blocks = [];
    state.totalAreaM2 = 0;
    state.gridMeta = null;
    updateVertexCount();
    recalcTotals();
    scheduleDraw();
    saveState();
    setMode("draw");
  });

  // The address search stays collapsed to an icon until it is wanted: the header
  // keeps its full width for the crowd total, which matters most on phones.
  function setSearchOpen(open) {
    searchForm.hidden = !open;
    headerEl.classList.toggle("search-open", open);
    searchToggleBtn.setAttribute("aria-expanded", String(open));
    if (open) searchInput.focus();
    else searchInput.blur();
  }

  searchToggleBtn.addEventListener("click", () => {
    setSearchOpen(searchForm.hidden);
  });

  shareBtn.addEventListener("click", copyShareLink);

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setSearchOpen(false);
  });

  // Tapping or clicking anywhere outside collapses it again. Handling this on
  // pointerdown (rather than a blur listener) keeps taps on the toggle itself
  // from collapsing and immediately re-opening the field.
  document.addEventListener("pointerdown", (e) => {
    if (searchForm.hidden || searchEl.contains(e.target)) return;
    setSearchOpen(false);
  });

  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        state.view.lat = parseFloat(results[0].lat);
        state.view.lng = parseFloat(results[0].lon);
        state.view.zoom = 18;
        scheduleDraw();
        saveState();
        // Leave the map unobstructed once the place is found.
        setSearchOpen(false);
      }
    } catch (err) {
      console.warn("Search failed", err);
    }
  });

  // Pointer interaction (unified mouse + touch via Pointer Events)
  function pointerDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointerMidpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startPinch() {
    const [a, b] = Array.from(activePointers.values());
    const mid = pointerMidpoint(a, b);
    const anchor = unproject(mid.x, mid.y);
    pinchState = {
      startDist: pointerDist(a, b),
      startZoom: state.view.zoom,
      anchorLat: anchor.lat,
      anchorLng: anchor.lng,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore: can happen with synthetic/edge-case pointer events.
    }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    activePointers.set(e.pointerId, { x: px, y: py });

    if (activePointers.size === 2) {
      // A second finger arrived: switch to pinch-to-zoom and abandon any pan/draw/paint stroke.
      isPointerDown = false;
      panStart = null;
      paintedThisStroke = new Set();
      startPinch();
      return;
    }
    if (activePointers.size > 2) return;

    isPointerDown = true;
    if (mode === "pan") {
      panStart = { x: px, y: py, lat: state.view.lat, lng: state.view.lng };
    } else if (mode === "draw") {
      const { lat, lng } = unproject(px, py);
      state.polygon.push({ lat, lng });
      state.polygonClosed = false;
      updateVertexCount();
      scheduleDraw();
      saveState();
    } else if (mode === "paint") {
      paintedThisStroke = new Set();
      paintAt(px, py);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: px, y: py });
    }

    if (pinchState && activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values());
      const dist = pointerDist(a, b);
      const mid = pointerMidpoint(a, b);
      const ratio = dist / pinchState.startDist;
      state.view.zoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, pinchState.startZoom + Math.log2(ratio)),
      );
      // Keep the point under the pinch midpoint anchored while zooming.
      const now = unproject(mid.x, mid.y);
      state.view.lat += pinchState.anchorLat - now.lat;
      state.view.lng += pinchState.anchorLng - now.lng;
      scheduleDraw();
      return;
    }

    if (!isPointerDown) return;

    if (mode === "pan" && panStart) {
      const dx = px - panStart.x;
      const dy = py - panStart.y;
      const zoom = state.view.zoom;
      const cwx = lonToWorldX(panStart.lng, zoom) - dx;
      const cwy = latToWorldY(panStart.lat, zoom) - dy;
      state.view.lng = worldXToLon(cwx, zoom);
      state.view.lat = worldYToLat(cwy, zoom);
      scheduleDraw();
    } else if (mode === "paint") {
      paintAt(px, py);
    }
  });

  function endPointer(e) {
    if (e && activePointers.has(e.pointerId)) {
      activePointers.delete(e.pointerId);
    }

    if (activePointers.size < 2) {
      if (pinchState) {
        pinchState = null;
        saveState();
      }
    }

    if (activePointers.size >= 1) {
      // A finger is still down after a pinch ended; don't resume pan/paint from a stale position.
      isPointerDown = false;
      panStart = null;
      return;
    }

    if (!isPointerDown) return;
    isPointerDown = false;
    panStart = null;
    if (mode === "paint" && paintedThisStroke.size > 0) {
      recalcTotals();
      saveState();
    } else if (mode === "pan") {
      saveState();
    }
    paintedThisStroke = new Set();
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", endPointer);

  function paintAt(px, py) {
    const { lat, lng } = unproject(px, py);
    const block = findBlockAt(lat, lng);
    if (!block || paintedThisStroke.has(block.id)) return;
    block.densityLevel = currentDensity;
    paintedThisStroke.add(block.id);
    scheduleDraw();
  }

  window.addEventListener("resize", resizeCanvas);

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    const shared = parseShareUrl();
    const hasSavedState = loadState();
    if (shared) {
      applySharedState(shared);
      // The link has been consumed, so later reloads use the saved state rather
      // than resetting to whatever the link described.
      history.replaceState(null, "", location.pathname + location.search);
    } else if (!hasSavedState) {
      const guess = guessViewFromTimezone();
      state.view.lat = guess.lat;
      state.view.lng = guess.lng;
      state.view.zoom = guess.zoom;
    }
    setMode(state.polygon.length && !state.polygonClosed ? "draw" : mode);
    setDensity(currentDensity);
    updateVertexCount();
    recalcTotals();
    resizeCanvas();
    // Needs the canvas size, so it runs after resizeCanvas.
    if (shared) fitViewToPolygon();
  }

  window.addEventListener("load", init);

  // Registering a service worker makes the app installable ("Add to Home Screen").
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .catch((e) => console.warn("Service worker registration failed", e));
    });
  }
})();
