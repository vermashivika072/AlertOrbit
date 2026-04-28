/**
 * smartIndoorNavigation.js
 *
 * Setup
 * - Required package: MapLibre GL JS
 * - Basemap: OpenStreetMap raster tiles
 * - Include in HTML:
 *   <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
 *   <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
 *   <script src="./js/smartIndoorNavigation.js"></script>
 * - Example usage:
 *   const nav = new SmartIndoorNavigation.NavigationEngine({
 *     containerId: "indoorMap",
 *     venueId: "hotel-a",
 *     buildingId: "main-tower"
 *   });
 *   await nav.init();
 *   nav.loadIndoorMap(SmartIndoorNavigation.EXAMPLE_INDOOR_MAP);
 *   nav.setUserPosition({ coordinates: [77.5947, 12.97175], floor: 2, label: "Room 201" });
 *   const plan = nav.generateEvacuationPlan();
 * - Integration points:
 *   incident engine -> updateDynamicConditions(...)
 *   crowd analytics -> updateDynamicConditions({ crowdByEdgeId: { edgeId: density } })
 *   IoT sensors -> updateDynamicConditions({ unsafeZoneIds: ["fire-zone-f2-west"] })
 *   AR overlays / multi-building routing -> use venueId, buildingId, floor metadata
 */

(function attachSmartIndoorNavigation(root) {
  "use strict";

  const DEFAULT_CENTER = [77.5946, 12.9717];
  const DEFAULT_ZOOM = 20;
  const DEFAULT_FLOOR = 1;
  const SOURCE_IDS = {
    indoor: "ao-indoor-map",
    route: "ao-evac-route",
    user: "ao-user-position",
    dynamicExits: "ao-dynamic-exits",
    dynamicHazards: "ao-dynamic-hazards",
  };

  const EDGE_KIND = "path-segment";
  const EXIT_KIND = "exit";
  const NODE_KIND = "routing-node";

  const DEFAULT_STYLE = {
    version: 8,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm-base",
        type: "raster",
        source: "osm-raster",
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };

  function createEmptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function getFeatureId(feature) {
    return feature.id || feature.properties.id || feature.properties.nodeId || feature.properties.zoneId || null;
  }

  function getFeatureFloor(feature) {
    return toFiniteNumber(feature.properties.floor, DEFAULT_FLOOR);
  }

  function getFeatureKind(feature) {
    return String(feature.properties.kind || "").toLowerCase();
  }

  function getFeatureLabel(feature, fallback) {
    return feature.properties.name || feature.properties.label || feature.properties.id || fallback;
  }

  function getCoordinates(feature) {
    const geometry = feature.geometry || {};
    if (geometry.type === "Point") {
      return geometry.coordinates;
    }
    if (geometry.type === "LineString") {
      return geometry.coordinates;
    }
    if (geometry.type === "Polygon") {
      return geometry.coordinates[0] || [];
    }
    return [];
  }

  function computeBounds(geojson) {
    const allCoords = [];
    (geojson.features || []).forEach((feature) => {
      const coords = flattenCoordinates(getCoordinates(feature));
      coords.forEach((coord) => allCoords.push(coord));
    });

    if (!allCoords.length) {
      return null;
    }

    let minLng = allCoords[0][0];
    let minLat = allCoords[0][1];
    let maxLng = allCoords[0][0];
    let maxLat = allCoords[0][1];

    allCoords.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });

    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }

  function flattenCoordinates(coords) {
    if (!Array.isArray(coords)) {
      return [];
    }
    if (typeof coords[0] === "number") {
      return [coords];
    }
    return coords.flatMap(flattenCoordinates);
  }

  function distanceBetween(a, b) {
    if (!a || !b) {
      return Number.POSITIVE_INFINITY;
    }

    const [lngA, latA] = a.coordinates;
    const [lngB, latB] = b.coordinates;
    const lngDelta = lngA - lngB;
    const latDelta = latA - latB;
    const floorPenalty = Math.abs((a.floor || 0) - (b.floor || 0)) * 0.0015;
    return Math.sqrt((lngDelta * lngDelta) + (latDelta * latDelta)) + floorPenalty;
  }

  function directionHint(fromNode, toNode) {
    if (!fromNode || !toNode) {
      return "ahead";
    }

    const [fromLng] = fromNode.coordinates;
    const [toLng] = toNode.coordinates;
    const delta = toLng - fromLng;

    if (Math.abs(delta) < 0.00003) {
      return "ahead";
    }
    return delta > 0 ? "right" : "left";
  }

  class PriorityQueue {
    constructor() {
      this.items = [];
    }

    enqueue(value, priority) {
      this.items.push({ value, priority });
      this.items.sort((left, right) => left.priority - right.priority);
    }

    dequeue() {
      return this.items.shift();
    }

    get size() {
      return this.items.length;
    }
  }

  class NavigationEngine {
    constructor(options = {}) {
      this.containerId = options.containerId;
      this.venueId = options.venueId || "alertorbit-hotel";
      this.buildingId = options.buildingId || "main-building";
      this.mapStyle = cloneJson(options.mapStyle || DEFAULT_STYLE);
      this.center = options.center || DEFAULT_CENTER;
      this.zoom = toFiniteNumber(options.zoom, DEFAULT_ZOOM);
      this.maplibre = options.maplibre || root.maplibregl;
      this.map = null;
      this.activeFloor = toFiniteNumber(options.initialFloor, DEFAULT_FLOOR);
      this.autoFit = options.autoFit !== false;
      this.indoorGeoJSON = createEmptyFeatureCollection();
      this.graph = { nodes: new Map(), edges: new Map(), exits: [] };
      this.userPosition = null;
      this.lastPlan = null;
      this.unsubscribeLiveUpdates = null;
      this.dynamicState = {
        crowdByEdgeId: {},
        blockedEdgeIds: new Set(),
        blockedNodeIds: new Set(),
        unsafeZoneIds: new Set(),
        unsafeExitIds: new Set(),
        crowdedExitIds: new Set(),
      };
    }

    async init() {
      if (!this.maplibre) {
        throw new Error("MapLibre GL JS is required. Load maplibregl before initializing SmartIndoorNavigation.");
      }
      if (!this.containerId) {
        throw new Error("containerId is required to initialize SmartIndoorNavigation.");
      }

      this.map = new this.maplibre.Map({
        container: this.containerId,
        style: this.mapStyle,
        center: this.center,
        zoom: this.zoom,
      });

      this.map.addControl(new this.maplibre.NavigationControl(), "top-right");

      await new Promise((resolve) => {
        this.map.on("load", resolve);
      });

      this.#ensureSources();
      this.#ensureLayers();
      this.#applyFloorFilter();
      return this;
    }

    loadIndoorMap(geojson) {
      if (!geojson || geojson.type !== "FeatureCollection") {
        throw new Error("Indoor map data must be a GeoJSON FeatureCollection.");
      }

      this.indoorGeoJSON = cloneJson(geojson);
      this.#rebuildGraph();
      this.#setSourceData(SOURCE_IDS.indoor, this.indoorGeoJSON);
      this.#refreshDynamicOverlays();
      this.#applyFloorFilter();

      if (this.autoFit) {
        const bounds = computeBounds(this.indoorGeoJSON);
        if (bounds) {
          this.map.fitBounds(bounds, { padding: 40, duration: 0 });
        }
      }

      return this.indoorGeoJSON;
    }

    setActiveFloor(floor) {
      this.activeFloor = toFiniteNumber(floor, DEFAULT_FLOOR);
      this.#applyFloorFilter();
      return this.activeFloor;
    }

    setUserPosition(position) {
      if (!position || !Array.isArray(position.coordinates)) {
        throw new Error("User position must include coordinates: [lng, lat].");
      }

      this.userPosition = {
        coordinates: position.coordinates,
        floor: toFiniteNumber(position.floor, this.activeFloor),
        label: position.label || "Current position",
      };

      this.setActiveFloor(this.userPosition.floor);
      this.#setSourceData(SOURCE_IDS.user, {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              id: "user-position",
              label: this.userPosition.label,
              floor: this.userPosition.floor,
            },
            geometry: {
              type: "Point",
              coordinates: this.userPosition.coordinates,
            },
          },
        ],
      });

      return this.userPosition;
    }

    updateDynamicConditions(update = {}) {
      if (update.crowdByEdgeId) {
        this.dynamicState.crowdByEdgeId = { ...this.dynamicState.crowdByEdgeId, ...update.crowdByEdgeId };
      }
      if (update.blockedEdgeIds) {
        this.dynamicState.blockedEdgeIds = new Set(update.blockedEdgeIds);
      }
      if (update.blockedNodeIds) {
        this.dynamicState.blockedNodeIds = new Set(update.blockedNodeIds);
      }
      if (update.unsafeZoneIds) {
        this.dynamicState.unsafeZoneIds = new Set(update.unsafeZoneIds);
      }
      if (update.unsafeExitIds) {
        this.dynamicState.unsafeExitIds = new Set(update.unsafeExitIds);
      }
      if (update.crowdedExitIds) {
        this.dynamicState.crowdedExitIds = new Set(update.crowdedExitIds);
      }

      this.#refreshDynamicOverlays();
      if (this.userPosition) {
        this.lastPlan = this.generateEvacuationPlan();
      }
      return this.dynamicState;
    }

    attachLiveUpdateFeed(subscribeFn) {
      if (typeof subscribeFn !== "function") {
        throw new Error("attachLiveUpdateFeed expects a subscribe function.");
      }

      if (typeof this.unsubscribeLiveUpdates === "function") {
        this.unsubscribeLiveUpdates();
      }

      this.unsubscribeLiveUpdates = subscribeFn((payload) => {
        this.updateDynamicConditions(payload);
      });
      return this.unsubscribeLiveUpdates;
    }

    generateEvacuationPlan(options = {}) {
      const position = options.position || this.userPosition;
      if (!position) {
        throw new Error("Call setUserPosition(...) before generating an evacuation plan.");
      }

      const startNode = this.#findNearestNode(position);
      if (!startNode) {
        throw new Error("Unable to snap current position to the indoor routing graph.");
      }

      const maxAlternatives = Math.max(1, toFiniteNumber(options.maxAlternatives, 2));
      const allowElevators = Boolean(options.allowElevators);
      const viableRoutes = [];

      this.graph.exits.forEach((exitFeature) => {
        const exitNodeId = exitFeature.properties.nodeId || exitFeature.properties.connectedNode;
        const exitId = getFeatureId(exitFeature);
        if (!exitNodeId || this.dynamicState.unsafeExitIds.has(exitId)) {
          return;
        }

        const route = this.#runAStar(startNode.id, exitNodeId, { allowElevators });
        if (!route) {
          return;
        }

        viableRoutes.push({
          exit: {
            id: exitId,
            name: getFeatureLabel(exitFeature, "Emergency exit"),
            floor: getFeatureFloor(exitFeature),
            feature: exitFeature,
          },
          route,
          score: route.totalCost,
          geometryDistance: route.distance,
          crowdPenalty: route.crowdPenalty,
          hazardPenalty: route.hazardPenalty,
        });
      });

      if (!viableRoutes.length) {
        throw new Error("No safe evacuation route is currently available.");
      }

      const physicallyClosest = viableRoutes
        .slice()
        .sort((left, right) => left.geometryDistance - right.geometryDistance)[0];

      viableRoutes.sort((left, right) => left.score - right.score);
      const primary = viableRoutes[0];
      const alternatives = viableRoutes.slice(1, 1 + maxAlternatives);
      const guidance = this.#buildGuidance(primary, physicallyClosest, alternatives);
      const plan = {
        venueId: this.venueId,
        buildingId: this.buildingId,
        floor: position.floor,
        generatedAt: new Date().toISOString(),
        startNode,
        primary,
        alternatives,
        guidance,
      };

      this.lastPlan = plan;
      this.renderEvacuationRoute(primary.route);
      return plan;
    }

    reroute(options = {}) {
      return this.generateEvacuationPlan(options);
    }

    renderEvacuationRoute(route) {
      const features = route.path.map((node, index) => ({
        type: "Feature",
        properties: {
          id: `route-segment-${index}`,
          floor: node.floor,
        },
        geometry: {
          type: "Point",
          coordinates: node.coordinates,
        },
      }));

      const line = {
        type: "Feature",
        properties: {
          id: "evacuation-line",
          floor: this.activeFloor,
        },
        geometry: {
          type: "LineString",
          coordinates: route.path.map((node) => node.coordinates),
        },
      };

      this.#setSourceData(SOURCE_IDS.route, {
        type: "FeatureCollection",
        features: [line, ...features],
      });
    }

    clearRoute() {
      this.lastPlan = null;
      this.#setSourceData(SOURCE_IDS.route, createEmptyFeatureCollection());
    }

    destroy() {
      if (typeof this.unsubscribeLiveUpdates === "function") {
        this.unsubscribeLiveUpdates();
        this.unsubscribeLiveUpdates = null;
      }
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
    }

    #ensureSources() {
      [
        SOURCE_IDS.indoor,
        SOURCE_IDS.route,
        SOURCE_IDS.user,
        SOURCE_IDS.dynamicExits,
        SOURCE_IDS.dynamicHazards,
      ].forEach((sourceId) => {
        if (!this.map.getSource(sourceId)) {
          this.map.addSource(sourceId, {
            type: "geojson",
            data: createEmptyFeatureCollection(),
          });
        }
      });
    }

    #ensureLayers() {
      const layers = [
        {
          id: "ao-rooms",
          type: "fill",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "room"],
          paint: {
            "fill-color": "#dfe8ff",
            "fill-opacity": 0.45,
            "fill-outline-color": "#6f7ca9",
          },
        },
        {
          id: "ao-hallways",
          type: "fill",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "hallway"],
          paint: {
            "fill-color": "#f4f4f1",
            "fill-opacity": 0.75,
          },
        },
        {
          id: "ao-restricted",
          type: "fill",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "restricted-zone"],
          paint: {
            "fill-color": "#4d5258",
            "fill-opacity": 0.55,
          },
        },
        {
          id: "ao-safe-zones",
          type: "fill",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "safe-zone"],
          paint: {
            "fill-color": "#2f9e44",
            "fill-opacity": 0.18,
          },
        },
        {
          id: "ao-stairs",
          type: "circle",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "stairwell"],
          paint: {
            "circle-radius": 7,
            "circle-color": "#1f6feb",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        },
        {
          id: "ao-elevators",
          type: "circle",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], "elevator"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#9c6ade",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        },
        {
          id: "ao-route-network",
          type: "line",
          source: SOURCE_IDS.indoor,
          filter: ["==", ["get", "kind"], EDGE_KIND],
          paint: {
            "line-color": "#6a737d",
            "line-width": 3,
            "line-opacity": 0.4,
          },
        },
        {
          id: "ao-dynamic-hazards",
          type: "fill",
          source: SOURCE_IDS.dynamicHazards,
          paint: {
            "fill-color": "#e03131",
            "fill-opacity": 0.35,
          },
        },
        {
          id: "ao-exits-safe",
          type: "circle",
          source: SOURCE_IDS.dynamicExits,
          filter: ["==", ["get", "status"], "safe"],
          paint: {
            "circle-radius": 8,
            "circle-color": "#2f9e44",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        },
        {
          id: "ao-exits-crowded",
          type: "circle",
          source: SOURCE_IDS.dynamicExits,
          filter: ["==", ["get", "status"], "crowded"],
          paint: {
            "circle-radius": 8,
            "circle-color": "#f08c00",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        },
        {
          id: "ao-exits-unsafe",
          type: "circle",
          source: SOURCE_IDS.dynamicExits,
          filter: ["==", ["get", "status"], "unsafe"],
          paint: {
            "circle-radius": 8,
            "circle-color": "#e03131",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        },
        {
          id: "ao-evac-route",
          type: "line",
          source: SOURCE_IDS.route,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": "#2f9e44",
            "line-width": 6,
            "line-opacity": 0.95,
          },
        },
        {
          id: "ao-user-position",
          type: "circle",
          source: SOURCE_IDS.user,
          paint: {
            "circle-radius": 8,
            "circle-color": "#111827",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        },
      ];

      layers.forEach((layer) => {
        if (!this.map.getLayer(layer.id)) {
          this.map.addLayer(layer);
        }
      });
    }

    #applyFloorFilter() {
      if (!this.map) {
        return;
      }

      const floorFilter = ["==", ["coalesce", ["get", "floor"], DEFAULT_FLOOR], this.activeFloor];
      [
        "ao-rooms",
        "ao-hallways",
        "ao-restricted",
        "ao-safe-zones",
        "ao-stairs",
        "ao-elevators",
        "ao-route-network",
        "ao-dynamic-hazards",
        "ao-exits-safe",
        "ao-exits-crowded",
        "ao-exits-unsafe",
        "ao-user-position",
      ].forEach((layerId) => {
        if (!this.map.getLayer(layerId)) {
          return;
        }

        const baseFilter = this.map.getFilter(layerId);
        if (!baseFilter) {
          this.map.setFilter(layerId, floorFilter);
          return;
        }

        const preserved = Array.isArray(baseFilter) && baseFilter[0] === "all" ? baseFilter.slice(1) : [baseFilter];
        const withoutFloor = preserved.filter((entry) => {
          return !(Array.isArray(entry) && JSON.stringify(entry).includes("\"floor\""));
        });
        this.map.setFilter(layerId, ["all", ...withoutFloor, floorFilter]);
      });
    }

    #rebuildGraph() {
      const nodes = new Map();
      const edges = new Map();
      const exits = [];

      (this.indoorGeoJSON.features || []).forEach((feature) => {
        const kind = getFeatureKind(feature);
        const featureId = getFeatureId(feature);

        if (feature.geometry.type === "Point" && feature.properties.nodeId) {
          nodes.set(feature.properties.nodeId, {
            id: feature.properties.nodeId,
            featureId,
            kind,
            label: getFeatureLabel(feature, feature.properties.nodeId),
            floor: getFeatureFloor(feature),
            coordinates: feature.geometry.coordinates,
          });
        }

        if (kind === EXIT_KIND) {
          exits.push(feature);
        }

        if (kind === EDGE_KIND) {
          const startNodeId = feature.properties.startNode;
          const endNodeId = feature.properties.endNode;
          if (!startNodeId || !endNodeId) {
            return;
          }

          const startNode = nodes.get(startNodeId) || {
            id: startNodeId,
            floor: getFeatureFloor(feature),
            coordinates: feature.geometry.coordinates[0],
            label: startNodeId,
          };
          const endNode = nodes.get(endNodeId) || {
            id: endNodeId,
            floor: getFeatureFloor(feature),
            coordinates: feature.geometry.coordinates[feature.geometry.coordinates.length - 1],
            label: endNodeId,
          };

          if (!nodes.has(startNodeId)) {
            nodes.set(startNodeId, startNode);
          }
          if (!nodes.has(endNodeId)) {
            nodes.set(endNodeId, endNode);
          }

          const distance = distanceBetween(startNode, endNode);
          const edgeRecord = {
            id: featureId || `${startNodeId}-${endNodeId}`,
            kind,
            startNodeId,
            endNodeId,
            floor: getFeatureFloor(feature),
            connectorType: feature.properties.connectorType || "hallway",
            isBidirectional: feature.properties.isBidirectional !== false,
            weight: toFiniteNumber(feature.properties.weight, distance),
            zoneIds: Array.isArray(feature.properties.zoneIds) ? feature.properties.zoneIds.slice() : [],
            geometry: feature.geometry.coordinates,
          };

          if (!edges.has(startNodeId)) {
            edges.set(startNodeId, []);
          }
          if (!edges.has(endNodeId)) {
            edges.set(endNodeId, []);
          }

          edges.get(startNodeId).push(edgeRecord);
          if (edgeRecord.isBidirectional) {
            edges.get(endNodeId).push({
              ...edgeRecord,
              startNodeId: edgeRecord.endNodeId,
              endNodeId: edgeRecord.startNodeId,
            });
          }
        }
      });

      this.graph = { nodes, edges, exits };
    }

    #findNearestNode(position) {
      let bestNode = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      this.graph.nodes.forEach((node) => {
        const candidateDistance = distanceBetween(
          { coordinates: position.coordinates, floor: position.floor },
          node
        );

        if (candidateDistance < bestDistance) {
          bestDistance = candidateDistance;
          bestNode = node;
        }
      });

      return bestNode;
    }

    #runAStar(startNodeId, goalNodeId, options = {}) {
      const open = new PriorityQueue();
      const gScore = new Map([[startNodeId, 0]]);
      const fScore = new Map([[startNodeId, this.#heuristic(startNodeId, goalNodeId)]]);
      const cameFrom = new Map();
      const routeMeta = new Map();

      open.enqueue(startNodeId, fScore.get(startNodeId));

      while (open.size) {
        const current = open.dequeue().value;
        if (current === goalNodeId) {
          return this.#buildRouteResult(cameFrom, routeMeta, current);
        }

        const currentEdges = this.graph.edges.get(current) || [];
        currentEdges.forEach((edge) => {
          if (this.dynamicState.blockedEdgeIds.has(edge.id)) {
            return;
          }
          if (this.dynamicState.blockedNodeIds.has(edge.endNodeId)) {
            return;
          }
          if (!options.allowElevators && edge.connectorType === "elevator") {
            return;
          }

          const traversalCost = this.#edgeTraversalCost(edge);
          if (!Number.isFinite(traversalCost)) {
            return;
          }

          const tentative = (gScore.get(current) || Number.POSITIVE_INFINITY) + traversalCost;
          if (tentative >= (gScore.get(edge.endNodeId) || Number.POSITIVE_INFINITY)) {
            return;
          }

          cameFrom.set(edge.endNodeId, current);
          routeMeta.set(edge.endNodeId, edge);
          gScore.set(edge.endNodeId, tentative);
          const estimate = tentative + this.#heuristic(edge.endNodeId, goalNodeId);
          fScore.set(edge.endNodeId, estimate);
          open.enqueue(edge.endNodeId, estimate);
        });
      }

      return null;
    }

    #heuristic(fromNodeId, toNodeId) {
      const fromNode = this.graph.nodes.get(fromNodeId);
      const toNode = this.graph.nodes.get(toNodeId);
      return distanceBetween(fromNode, toNode);
    }

    #edgeTraversalCost(edge) {
      const crowdLevel = toFiniteNumber(this.dynamicState.crowdByEdgeId[edge.id], 0);
      const crowdMultiplier = 1 + Math.min(crowdLevel, 10) * 0.18;

      let connectorPenalty = 0;
      if (edge.connectorType === "stairs") {
        connectorPenalty = 0.00008;
      } else if (edge.connectorType === "elevator") {
        connectorPenalty = 500;
      }

      const hazardPenalty = edge.zoneIds.some((zoneId) => this.dynamicState.unsafeZoneIds.has(zoneId)) ? 1000 : 0;
      return (edge.weight * crowdMultiplier) + connectorPenalty + hazardPenalty;
    }

    #buildRouteResult(cameFrom, routeMeta, currentNodeId) {
      const reversedPath = [];
      const usedEdges = [];
      let cursor = currentNodeId;

      while (cursor) {
        const node = this.graph.nodes.get(cursor);
        if (node) {
          reversedPath.push(node);
        }
        const edge = routeMeta.get(cursor);
        if (edge) {
          usedEdges.push(edge);
        }
        cursor = cameFrom.get(cursor);
      }

      const path = reversedPath.reverse();
      const edges = usedEdges.reverse();
      const distance = edges.reduce((total, edge) => total + edge.weight, 0);
      const crowdPenalty = edges.reduce((total, edge) => {
        return total + (toFiniteNumber(this.dynamicState.crowdByEdgeId[edge.id], 0) * 0.18 * edge.weight);
      }, 0);
      const hazardPenalty = edges.reduce((total, edge) => {
        return total + (edge.zoneIds.some((zoneId) => this.dynamicState.unsafeZoneIds.has(zoneId)) ? 1000 : 0);
      }, 0);

      return {
        path,
        edges,
        distance,
        crowdPenalty,
        hazardPenalty,
        totalCost: distance + crowdPenalty + hazardPenalty,
      };
    }

    #buildGuidance(primary, physicallyClosest, alternatives) {
      const firstTransition = primary.route.path[1];
      const turn = directionHint(primary.route.path[0], firstTransition);
      const nextLandmark = firstTransition ? firstTransition.label : primary.exit.name;
      const primaryExitId = primary.exit.id;
      const closestExitId = physicallyClosest.exit.id;

      let opening = `Proceed to ${nextLandmark} on your ${turn}, then continue to ${primary.exit.name}.`;
      if (closestExitId !== primaryExitId) {
        const isCrowded = this.dynamicState.crowdedExitIds.has(closestExitId);
        const isUnsafe = this.dynamicState.unsafeExitIds.has(closestExitId);
        const reason = isUnsafe ? "unsafe" : isCrowded ? "crowded" : "slower to reach safely";
        opening = `${physicallyClosest.exit.name} is ${reason}. Proceed to ${nextLandmark} on your ${turn}, then continue to ${primary.exit.name}.`;
      }

      return {
        shortText: opening,
        primaryExit: primary.exit.name,
        alternateExits: alternatives.map((route) => route.exit.name),
      };
    }

    #refreshDynamicOverlays() {
      const exitFeatures = this.graph.exits.map((feature) => {
        const id = getFeatureId(feature);
        let status = "safe";
        if (this.dynamicState.unsafeExitIds.has(id)) {
          status = "unsafe";
        } else if (this.dynamicState.crowdedExitIds.has(id)) {
          status = "crowded";
        }

        return {
          type: "Feature",
          properties: {
            id,
            name: getFeatureLabel(feature, "Emergency exit"),
            floor: getFeatureFloor(feature),
            status,
          },
          geometry: feature.geometry,
        };
      });

      const hazardFeatures = (this.indoorGeoJSON.features || []).filter((feature) => {
        return this.dynamicState.unsafeZoneIds.has(getFeatureId(feature));
      }).map((feature) => ({
        type: "Feature",
        properties: {
          id: getFeatureId(feature),
          floor: getFeatureFloor(feature),
        },
        geometry: feature.geometry,
      }));

      this.#setSourceData(SOURCE_IDS.dynamicExits, {
        type: "FeatureCollection",
        features: exitFeatures,
      });
      this.#setSourceData(SOURCE_IDS.dynamicHazards, {
        type: "FeatureCollection",
        features: hazardFeatures,
      });
    }

    #setSourceData(sourceId, data) {
      if (!this.map) {
        return;
      }
      const source = this.map.getSource(sourceId);
      if (source) {
        source.setData(data);
      }
    }
  }

  const EXAMPLE_INDOOR_MAP = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "hall-f1", kind: "hallway", floor: 1, name: "Ground Floor Hallway" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59455, 12.97166],
            [77.59483, 12.97166],
            [77.59483, 12.97174],
            [77.59455, 12.97174],
            [77.59455, 12.97166],
          ]],
        },
      },
      {
        type: "Feature",
        properties: { id: "room-101", kind: "room", floor: 1, name: "Room 101" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59455, 12.97174],
            [77.59465, 12.97174],
            [77.59465, 12.97180],
            [77.59455, 12.97180],
            [77.59455, 12.97174],
          ]],
        },
      },
      {
        type: "Feature",
        properties: { id: "maintenance-f1", kind: "restricted-zone", floor: 1, name: "Maintenance Room" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59473, 12.97174],
            [77.59483, 12.97174],
            [77.59483, 12.97180],
            [77.59473, 12.97180],
            [77.59473, 12.97174],
          ]],
        },
      },
      {
        type: "Feature",
        properties: { id: "assembly-zone", kind: "safe-zone", floor: 1, name: "Assembly Zone" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59483, 12.97160],
            [77.59495, 12.97160],
            [77.59495, 12.97175],
            [77.59483, 12.97175],
            [77.59483, 12.97160],
          ]],
        },
      },
      {
        type: "Feature",
        properties: { id: "hall-f2", kind: "hallway", floor: 2, name: "Second Floor Hallway" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59455, 12.97179],
            [77.59483, 12.97179],
            [77.59483, 12.97187],
            [77.59455, 12.97187],
            [77.59455, 12.97179],
          ]],
        },
      },
      {
        type: "Feature",
        properties: { id: "room-201", kind: "room", floor: 2, name: "Room 201", nodeId: "f2-room-201" },
        geometry: {
          type: "Point",
          coordinates: [77.59460, 12.97183],
        },
      },
      {
        type: "Feature",
        properties: { id: "stair-c-f1", kind: "stairwell", floor: 1, name: "Stairwell C", nodeId: "f1-stair-c" },
        geometry: {
          type: "Point",
          coordinates: [77.59472, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: { id: "stair-c-f2", kind: "stairwell", floor: 2, name: "Stairwell C", nodeId: "f2-stair-c" },
        geometry: {
          type: "Point",
          coordinates: [77.59472, 12.97183],
        },
      },
      {
        type: "Feature",
        properties: { id: "elevator-a-f2", kind: "elevator", floor: 2, name: "Elevator A", nodeId: "f2-elevator-a" },
        geometry: {
          type: "Point",
          coordinates: [77.59479, 12.97183],
        },
      },
      {
        type: "Feature",
        properties: { id: "f1-hall-mid", kind: NODE_KIND, floor: 1, name: "Ground Hallway", nodeId: "f1-hall-mid" },
        geometry: {
          type: "Point",
          coordinates: [77.59466, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: { id: "f1-exit-a-node", kind: NODE_KIND, floor: 1, name: "Exit A Landing", nodeId: "f1-exit-a-node" },
        geometry: {
          type: "Point",
          coordinates: [77.59457, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: { id: "f1-exit-b-node", kind: NODE_KIND, floor: 1, name: "Exit B Landing", nodeId: "f1-exit-b-node" },
        geometry: {
          type: "Point",
          coordinates: [77.59482, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: { id: "f2-hall-mid", kind: NODE_KIND, floor: 2, name: "Second Floor Hallway", nodeId: "f2-hall-mid" },
        geometry: {
          type: "Point",
          coordinates: [77.59467, 12.97183],
        },
      },
      {
        type: "Feature",
        properties: { id: "exit-a", kind: EXIT_KIND, floor: 1, name: "Exit A", nodeId: "f1-exit-a-node" },
        geometry: {
          type: "Point",
          coordinates: [77.59457, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: { id: "exit-b", kind: EXIT_KIND, floor: 1, name: "Exit B", nodeId: "f1-exit-b-node" },
        geometry: {
          type: "Point",
          coordinates: [77.59482, 12.97170],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-room201-to-hall",
          kind: EDGE_KIND,
          floor: 2,
          startNode: "f2-room-201",
          endNode: "f2-hall-mid",
          connectorType: "hallway",
          zoneIds: ["fire-zone-f2-west"],
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59460, 12.97183],
            [77.59467, 12.97183],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-hall-to-stair-f2",
          kind: EDGE_KIND,
          floor: 2,
          startNode: "f2-hall-mid",
          endNode: "f2-stair-c",
          connectorType: "hallway",
          zoneIds: ["fire-zone-f2-west"],
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59467, 12.97183],
            [77.59472, 12.97183],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-hall-to-elevator-f2",
          kind: EDGE_KIND,
          floor: 2,
          startNode: "f2-hall-mid",
          endNode: "f2-elevator-a",
          connectorType: "hallway",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59467, 12.97183],
            [77.59479, 12.97183],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-stair-f2-to-f1",
          kind: EDGE_KIND,
          floor: 2,
          startNode: "f2-stair-c",
          endNode: "f1-stair-c",
          connectorType: "stairs",
          weight: 0.00022,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59472, 12.97183],
            [77.59472, 12.97170],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-stair-to-hall-f1",
          kind: EDGE_KIND,
          floor: 1,
          startNode: "f1-stair-c",
          endNode: "f1-hall-mid",
          connectorType: "hallway",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59472, 12.97170],
            [77.59466, 12.97170],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-hall-to-exit-a",
          kind: EDGE_KIND,
          floor: 1,
          startNode: "f1-hall-mid",
          endNode: "f1-exit-a-node",
          connectorType: "hallway",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59466, 12.97170],
            [77.59457, 12.97170],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          id: "edge-hall-to-exit-b",
          kind: EDGE_KIND,
          floor: 1,
          startNode: "f1-hall-mid",
          endNode: "f1-exit-b-node",
          connectorType: "hallway",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [77.59466, 12.97170],
            [77.59482, 12.97170],
          ],
        },
      },
      {
        type: "Feature",
        properties: { id: "fire-zone-f2-west", kind: "unsafe-zone", floor: 2, name: "Smoke Affected Zone" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [77.59455, 12.97179],
            [77.59466, 12.97179],
            [77.59466, 12.97187],
            [77.59455, 12.97187],
            [77.59455, 12.97179],
          ]],
        },
      },
    ],
  };

  const SmartIndoorNavigation = {
    DEFAULT_STYLE,
    EXAMPLE_INDOOR_MAP,
    NavigationEngine,
  };

  root.SmartIndoorNavigation = SmartIndoorNavigation;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = SmartIndoorNavigation;
  }
})(typeof window !== "undefined" ? window : globalThis);
