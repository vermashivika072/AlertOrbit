(function attachEmergencyNavigationDemo() {
  "use strict";

  const VIEWBOX_MIN_RATIO = 0.3;
  const DEFAULT_AREA_ID = "f3-room-301";
  const DEFAULT_FLOOR_ID = "floor-3";
  const ROOM_TYPES = new Set(["guest", "public", "hospitality", "operations"]);

  const state = {
    activeFloorId: DEFAULT_FLOOR_ID,
    selectedAreaId: DEFAULT_AREA_ID,
    emergencyActive: false,
    aiPhase: "standby",
    viewBoxes: {},
    dom: {},
    pan: null,
    didPan: false,
    timers: [],
    mappingPulse: false,
    cursor: { x: 0, y: 0 },
  };

  const DEMO = buildDemoData();
  const areaIndex = new Map();
  const floorIndex = new Map();
  const nodeIndex = new Map();

  DEMO.floors.forEach((floor) => {
    floorIndex.set(floor.id, floor);
    floor.areas.forEach((area) => areaIndex.set(area.id, area));
  });
  Object.values(DEMO.nodes).forEach((node) => nodeIndex.set(node.id, node));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    hydrateUserCard();
    guardSession();
    initializeViewBoxes();
    bindEvents();
    render();
  }

  function cacheDom() {
    state.dom = {
      sidebar: byId("sidebar"),
      floorTabs: byId("floorTabs"),
      startMappingBtn: byId("startMappingBtn"),
      simulateEmergencyBtn: byId("simulateEmergencyBtn"),
      resetDemoBtn: byId("resetDemoBtn"),
      aiIndicatorTitle: byId("aiIndicatorTitle"),
      aiIndicatorMeta: byId("aiIndicatorMeta"),
      topbarAiBadge: byId("topbarAiBadge"),
      sbAlertBadge: byId("sbAlertBadge"),
      mapTitle: byId("mapTitle"),
      scenarioChip: byId("scenarioChip"),
      selectionChip: byId("selectionChip"),
      mapFocusTitle: byId("mapFocusTitle"),
      mapFocusMeta: byId("mapFocusMeta"),
      mapStatusTitle: byId("mapStatusTitle"),
      mapStatusMeta: byId("mapStatusMeta"),
      floorplanSvg: byId("floorplanSvg"),
      mapStage: byId("mapStage"),
      cursorReadout: byId("cursorReadout"),
      zoomInBtn: byId("zoomInBtn"),
      zoomOutBtn: byId("zoomOutBtn"),
      resetViewBtn: byId("resetViewBtn"),
      heroHazardValue: byId("heroHazardValue"),
      heroOccupancyValue: byId("heroOccupancyValue"),
      heroConfidenceValue: byId("heroConfidenceValue"),
      heroResponseValue: byId("heroResponseValue"),
      alertStatusBadge: byId("alertStatusBadge"),
      routeBadge: byId("routeBadge"),
      alertCardBody: byId("alertCardBody"),
      routeCardBody: byId("routeCardBody"),
      occupancyCardBody: byId("occupancyCardBody"),
      recommendationCardBody: byId("recommendationCardBody"),
      quickSelectGrid: byId("quickSelectGrid"),
    };
  }

  function bindEvents() {
    state.dom.startMappingBtn.addEventListener("click", startMappingPulse);
    state.dom.simulateEmergencyBtn.addEventListener("click", toggleEmergencySimulation);
    state.dom.resetDemoBtn.addEventListener("click", resetDemo);
    state.dom.zoomInBtn.addEventListener("click", () => zoomByFactor(0.86));
    state.dom.zoomOutBtn.addEventListener("click", () => zoomByFactor(1.14));
    state.dom.resetViewBtn.addEventListener("click", () => {
      resetViewBox(state.activeFloorId);
      renderMap();
    });

    state.dom.quickSelectGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-area-id]");
      if (!button) {
        return;
      }
      selectArea(button.dataset.areaId, true);
    });

    const svg = state.dom.floorplanSvg;
    svg.addEventListener("click", onSvgClick);
    svg.addEventListener("wheel", onSvgWheel, { passive: false });
    svg.addEventListener("pointerdown", onSvgPointerDown);
    svg.addEventListener("pointermove", onSvgPointerMove);
    svg.addEventListener("pointerup", onSvgPointerUp);
    svg.addEventListener("pointerleave", onSvgPointerUp);
  }

  function guardSession() {
    if (!window.DB?.Session || DB.Session.isLoggedIn()) {
      return;
    }
    window.location.href = AlertOrbitConfig.STAFF_LOGIN_URL;
  }

  function hydrateUserCard() {
    const session = window.DB?.Session?.get?.();
    if (!session) {
      return;
    }
    const initials = (session.name || "AO")
      .split(" ")
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const avatar = document.getElementById("sbAvatar");
    const name = document.getElementById("sbUname");
    const role = document.getElementById("sbUrole");
    if (avatar) avatar.textContent = initials || "AO";
    if (name) name.textContent = session.name || "AlertOrbit Staff";
    if (role) role.textContent = session.role || "Safety Desk";
  }

  function initializeViewBoxes() {
    DEMO.floors.forEach((floor) => resetViewBox(floor.id));
  }

  function render() {
    renderHero();
    renderShellStatus();
    renderFloorTabs();
    renderStatus();
    renderQuickSelect();
    renderMap();
    renderCards();
  }

  function renderHero() {
    const route = getDisplayedRoute();
    state.dom.heroHazardValue.textContent = state.emergencyActive ? "Lobby Fire" : "None";
    state.dom.heroOccupancyValue.textContent = String(DEMO.totalOccupancy);
    state.dom.heroConfidenceValue.textContent = state.aiPhase === "scan" ? "84%" : state.aiPhase === "reroute" ? "91%" : "97%";
    state.dom.heroResponseValue.textContent = route ? formatEta(route.distance) : "Prepared";
  }

  function renderShellStatus() {
    if (!state.dom.sbAlertBadge || !window.DB?.Alerts?.stats) {
      return;
    }
    const stats = DB.Alerts.stats();
    state.dom.sbAlertBadge.textContent = String(stats.active || 0);
  }

  function renderFloorTabs() {
    state.dom.floorTabs.innerHTML = DEMO.floors
      .map((floor) => {
        const selectableCount = floor.areas.filter((area) => area.selectable).length;
        const active = floor.id === state.activeFloorId;
        return `
          <button class="floor-tab${active ? " is-active" : ""}" type="button" data-floor-id="${escapeHtml(floor.id)}">
            <span class="floor-tab__label">${escapeHtml(floor.label)}</span>
            <span class="floor-tab__meta">${selectableCount} zones · ${floor.occupancy} occupants</span>
          </button>
        `;
      })
      .join("");

    state.dom.floorTabs.querySelectorAll("[data-floor-id]").forEach((button) => {
      button.addEventListener("click", () => switchFloor(button.dataset.floorId));
    });
  }

  function renderStatus() {
    const area = getSelectedArea();
    const floor = getActiveFloor();
    const scenarioLabel = state.emergencyActive ? "Emergency Live" : "Scenario Idle";
    const ai = getAiCopy();

    state.dom.mapTitle.textContent = floor.title;
    state.dom.scenarioChip.textContent = scenarioLabel;
    state.dom.selectionChip.textContent = `Origin: ${area.label}`;
    state.dom.mapFocusTitle.textContent = area.label;
    state.dom.mapFocusMeta.textContent = `${area.meta} · ${getFloorById(area.floorId).label}`;
    state.dom.mapStatusTitle.textContent = ai.title;
    state.dom.mapStatusMeta.textContent = ai.meta;
    state.dom.aiIndicatorTitle.textContent = ai.title;
    state.dom.aiIndicatorMeta.textContent = ai.meta;
    state.dom.simulateEmergencyBtn.textContent = state.emergencyActive ? "Reset Simulation" : "Emergency Simulation";
    state.dom.topbarAiBadge.innerHTML = `<span class="li-dot"></span>${escapeHtml(ai.badge)}`;
  }

  function renderQuickSelect() {
    const options = DEMO.floors.flatMap((floor) => floor.areas.filter((area) => area.selectable));
    state.dom.quickSelectGrid.innerHTML = options
      .map((area) => {
        const active = area.id === state.selectedAreaId;
        return `
          <button class="quick-select__btn${active ? " is-active" : ""}" type="button" data-area-id="${escapeHtml(area.id)}">
            <strong>${escapeHtml(area.label)}</strong>
            <span>${escapeHtml(getFloorById(area.floorId).label)}</span>
          </button>
        `;
      })
      .join("");
  }

  function renderCards() {
    renderAlertCard();
    renderRouteCard();
    renderOccupancyCard();
    renderRecommendationCard();
  }

  function renderAlertCard() {
    const context = getEmergencyContext();
    if (!state.emergencyActive) {
      state.dom.alertStatusBadge.className = "info-badge info-badge--idle";
      state.dom.alertStatusBadge.textContent = "Standby";
      state.dom.alertCardBody.innerHTML = `
        <div class="status-stack">
          <div class="status-panel">
            <strong>No live hazard</strong>
            <p>The demo is ready to simulate a multi-floor evacuation event with AI-assisted rerouting.</p>
          </div>
          <div class="status-metrics">
            <div class="metric-block">
              <span>Monitored Floors</span>
              <strong>${DEMO.floors.length}</strong>
            </div>
            <div class="metric-block">
              <span>Tracked Areas</span>
              <strong>${DEMO.floors.reduce((total, floor) => total + floor.areas.length, 0)}</strong>
            </div>
          </div>
        </div>
      `;
      return;
    }

    state.dom.alertStatusBadge.className = "info-badge info-badge--alert";
    state.dom.alertStatusBadge.textContent = "Critical";
    state.dom.alertCardBody.innerHTML = `
      <div class="status-stack">
        <div class="status-panel">
          <strong>${escapeHtml(context.title)}</strong>
          <p>${escapeHtml(context.summary)}</p>
        </div>
        <div class="status-metrics">
          <div class="metric-block">
            <span>Severity</span>
            <strong>High</strong>
          </div>
          <div class="metric-block">
            <span>AI Phase</span>
            <strong>${escapeHtml(getAiCopy().badge)}</strong>
          </div>
        </div>
        <div class="status-panel">
          <strong>Operational impact</strong>
          <p>West atrium access and Stair A are deprioritized. East exit and Stair B are maintained as the safest route.</p>
        </div>
      </div>
    `;
  }

  function renderRouteCard() {
    const route = getDisplayedRoute();
    const floorTrail = route ? unique(route.path.map((node) => getFloorById(node.floorId).label)) : [];
    state.dom.routeBadge.className = `info-badge ${state.emergencyActive ? "info-badge--alert" : "info-badge--cyan"}`;
    state.dom.routeBadge.textContent = state.emergencyActive ? "Adaptive" : "Prepared";

    state.dom.routeCardBody.innerHTML = route
      ? `
          <div class="route-grid">
            <div class="route-panel">
              <strong>${escapeHtml(getSelectedArea().label)} to ${escapeHtml(route.exit.label)}</strong>
              <p>${escapeHtml(route.guidance)}</p>
            </div>
            <div class="route-metrics">
              <div class="metric-block">
                <span>Recommended Exit</span>
                <strong>${escapeHtml(route.exit.label)}</strong>
              </div>
              <div class="metric-block">
                <span>Estimated ETA</span>
                <strong>${formatEta(route.distance)}</strong>
              </div>
            </div>
            <div class="route-panel">
              <strong>Floor sequence</strong>
              <p>${escapeHtml(floorTrail.join(" -> "))}</p>
            </div>
          </div>
        `
      : `
          <div class="route-panel">
            <strong>No route available</strong>
            <p>Select an origin zone to generate a demo evacuation route.</p>
          </div>
        `;
  }

  function renderOccupancyCard() {
    state.dom.occupancyCardBody.innerHTML = `
      <div class="occupancy-stack">
        ${DEMO.floors.map((floor) => {
          const density = Math.min(100, Math.round((floor.occupancy / 90) * 100));
          return `
            <div class="occupancy-row">
              <div class="occupancy-row__meta">
                <strong>${escapeHtml(floor.label)}</strong>
                <span>${escapeHtml(floor.title)}</span>
              </div>
              <div class="occupancy-bar">
                <div class="occupancy-bar__fill" style="width:${density}%"></div>
              </div>
              <span class="occupancy-row__count">${floor.occupancy}</span>
            </div>
          `;
        }).join("")}
        <div class="status-panel">
          <strong>Crowd demo behavior</strong>
          <p>Moving white dots along the active route emulate occupant flow and controlled evacuation density without using live location data.</p>
        </div>
      </div>
    `;
  }

  function renderRecommendationCard() {
    const ai = getAiCopy();
    const items = getRecommendations();
    state.dom.recommendationCardBody.innerHTML = `
      <div class="status-panel">
        <strong>${escapeHtml(ai.title)}</strong>
        <p>${escapeHtml(ai.meta)}</p>
      </div>
      <div class="recommendation-list">
        ${items.map((item, index) => `
          <div class="recommendation-item">
            <span class="recommendation-item__index">${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.body)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderMap() {
    const floor = getActiveFloor();
    const scenario = getRouteScenario();
    const previewRoute = scenario.previewRoute;
    const finalRoute = scenario.finalRoute;
    const previewPath = buildPathDataForFloor(previewRoute?.path || [], floor.id);
    const finalPath = buildPathDataForFloor(finalRoute?.path || [], floor.id);

    const viewBox = state.viewBoxes[floor.id];
    state.dom.floorplanSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    state.dom.floorplanSvg.classList.toggle("is-panning", Boolean(state.pan));

    state.dom.floorplanSvg.innerHTML = `
      <defs>
        <pattern id="mesh-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"></path>
        </pattern>
      </defs>
      <rect x="0" y="0" width="${floor.width}" height="${floor.height}" rx="40" fill="url(#mesh-grid)"></rect>
      <text class="svg-floor-title" x="64" y="86">${escapeHtml(floor.title)}</text>
      <text class="svg-floor-meta" x="64" y="114">${escapeHtml(floor.subtitle)}</text>
      <rect x="0" y="0" width="${floor.width}" height="${floor.height}" fill="transparent"></rect>
      ${floor.safeZones.map(renderSafeZone).join("")}
      ${floor.corridors.map(renderCorridor).join("")}
      ${floor.areas.map(renderArea).join("")}
      ${floor.connectors.map((connector) => renderConnector(connector, scenario)).join("")}
      ${renderHazardOverlay(floor)}
      ${previewPath ? `<path class="svg-route-preview" d="${previewPath}"></path>${renderRouteNodes(previewRoute.path, floor.id, true)}` : ""}
      ${finalPath ? `<path class="svg-route-final" d="${finalPath}"></path>${renderRouteNodes(finalRoute.path, floor.id, false)}` : ""}
      ${renderCrowdDots(finalPath, floor.id)}
      ${renderBlockedZones(floor)}
    `;
  }

  function renderArea(area) {
    const selected = area.id === state.selectedAreaId;
    const hazard = state.emergencyActive && area.id === DEMO.emergency.areaId;
    const kindClass = area.kind;
    return `
      <g class="svg-area svg-area--${escapeHtml(kindClass)}${selected ? " is-selected" : ""}${hazard ? " is-hazard" : ""}" data-area-id="${escapeHtml(area.id)}">
        <rect class="area-body" x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" rx="${area.radius || 28}" ry="${area.radius || 28}"></rect>
        <text class="area-label" x="${area.x + 22}" y="${area.y + 34}">${escapeHtml(area.label)}</text>
        <text class="area-sub" x="${area.x + 22}" y="${area.y + 54}">${escapeHtml(area.meta)}</text>
        <text class="area-occupancy" x="${area.x + 22}" y="${area.y + area.h - 22}">${escapeHtml(area.occupancyText)}</text>
      </g>
    `;
  }

  function renderCorridor(corridor) {
    return `<rect class="svg-corridor" x="${corridor.x}" y="${corridor.y}" width="${corridor.w}" height="${corridor.h}" rx="${corridor.r}" ry="${corridor.r}"></rect>`;
  }

  function renderSafeZone(zone) {
    return `
      <g>
        <rect class="svg-safe-zone" x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="24" ry="24"></rect>
        <text class="svg-safe-zone-label" x="${zone.x + 18}" y="${zone.y + 34}">${escapeHtml(zone.label)}</text>
      </g>
    `;
  }

  function renderConnector(connector, scenario) {
    const isTarget = scenario.finalRoute?.exit?.id === connector.nodeId || scenario.previewRoute?.exit?.id === connector.nodeId;
    const blocked = state.emergencyActive && DEMO.emergency.blockedConnectorIds.includes(connector.nodeId);
    const shellSize = connector.type === "exit" ? 26 : 24;
    const shortLabel = connector.short || connector.label;
    return `
      <g class="svg-connector svg-connector--${escapeHtml(connector.type)}${isTarget ? " is-target" : ""}${blocked ? " is-blocked" : ""}">
        <circle class="connector-shell" cx="${connector.x}" cy="${connector.y}" r="${shellSize}"></circle>
        <circle class="connector-core" cx="${connector.x}" cy="${connector.y}" r="${shellSize - 8}"></circle>
        <text class="connector-label" x="${connector.x}" y="${connector.y + 4}" text-anchor="middle">${escapeHtml(shortLabel)}</text>
      </g>
    `;
  }

  function renderHazardOverlay(floor) {
    if (!state.emergencyActive || floor.id !== DEMO.emergency.floorId) {
      return "";
    }
    const hazardArea = getAreaById(DEMO.emergency.areaId);
    const cx = hazardArea.x + hazardArea.w / 2;
    const cy = hazardArea.y + hazardArea.h / 2;
    return `
      <g>
        <circle class="svg-hazard-core" cx="${cx}" cy="${cy}" r="36"></circle>
        <circle class="svg-hazard-pulse" cx="${cx}" cy="${cy}" r="42"></circle>
        <circle class="svg-hazard-pulse" cx="${cx}" cy="${cy}" r="42" style="animation-delay: 0.6s"></circle>
        <text class="svg-hazard-label" x="${cx + 52}" y="${cy - 10}">Active Fire</text>
        <text class="svg-hazard-label" x="${cx + 52}" y="${cy + 12}" style="font-size:11px; fill:rgba(255,194,203,0.8)">Smoke plume detected</text>
      </g>
    `;
  }

  function renderBlockedZones(floor) {
    if (!state.emergencyActive || state.aiPhase === "scan" || floor.id !== "floor-1") {
      return "";
    }
    const blockX = Math.max(72, (floor.layout?.hallXs?.west || 320) - 132);
    const blockY = (floor.layout?.spineCenterY || 460) - 48;
    return `
      <g>
        <rect class="svg-blocked" x="${blockX}" y="${blockY}" width="224" height="96" rx="28"></rect>
        <text class="svg-hazard-label" x="${blockX + 28}" y="${blockY + 56}" style="font-size:11px">West Atrium Sealed</text>
      </g>
    `;
  }

  function renderRouteNodes(path, floorId, preview) {
    return path
      .filter((node) => node.floorId === floorId)
      .map((node) => `<circle class="svg-route-node${preview ? " svg-route-node--preview" : ""}" cx="${node.x}" cy="${node.y}" r="7"></circle>`)
      .join("");
  }

  function renderCrowdDots(pathData, floorId) {
    if (!state.emergencyActive || !pathData || state.aiPhase === "scan") {
      return "";
    }
    return `
      <path id="crowd-motion-${floorId}" d="${pathData}" fill="none" stroke="transparent"></path>
      <circle class="svg-crowd-dot" r="4.5">
        <animateMotion dur="5.6s" repeatCount="indefinite" path="${pathData}"></animateMotion>
      </circle>
      <circle class="svg-crowd-dot" r="3.4" opacity="0.72">
        <animateMotion dur="6.3s" begin="1.1s" repeatCount="indefinite" path="${pathData}"></animateMotion>
      </circle>
      <circle class="svg-crowd-dot" r="3.8" opacity="0.62">
        <animateMotion dur="7.1s" begin="2.2s" repeatCount="indefinite" path="${pathData}"></animateMotion>
      </circle>
    `;
  }

  function switchFloor(floorId) {
    if (!floorIndex.has(floorId)) {
      return;
    }
    state.activeFloorId = floorId;
    pulseStage("is-switching", 360);
    render();
  }

  function selectArea(areaId, switchToFloor) {
    const area = getAreaById(areaId);
    if (!area) {
      return;
    }
    state.selectedAreaId = areaId;
    if (switchToFloor) {
      state.activeFloorId = area.floorId;
      pulseStage("is-switching", 360);
    }
    render();
  }

  function startMappingPulse() {
    state.mappingPulse = true;
    pulseStage("is-mapping", 1400);
    state.aiPhase = state.emergencyActive ? state.aiPhase : "mapping";
    renderStatus();
    renderCards();
    clearTimeout(state.mappingTimer);
    state.mappingTimer = setTimeout(() => {
      if (!state.emergencyActive) {
        state.aiPhase = "standby";
      }
      render();
    }, 1450);
  }

  function toggleEmergencySimulation() {
    if (state.emergencyActive) {
      resetSimulationOnly();
      render();
      return;
    }

    clearScenarioTimers();
    state.emergencyActive = true;
    state.aiPhase = "scan";
    render();

    state.timers.push(setTimeout(() => {
      state.aiPhase = "reroute";
      render();
    }, 1400));

    state.timers.push(setTimeout(() => {
      state.aiPhase = "locked";
      render();
    }, 3000));
  }

  function resetSimulationOnly() {
    clearScenarioTimers();
    state.emergencyActive = false;
    state.aiPhase = "standby";
  }

  function resetDemo() {
    clearScenarioTimers();
    state.activeFloorId = DEFAULT_FLOOR_ID;
    state.selectedAreaId = DEFAULT_AREA_ID;
    state.emergencyActive = false;
    state.aiPhase = "standby";
    DEMO.floors.forEach((floor) => resetViewBox(floor.id));
    pulseStage("is-switching", 360);
    render();
  }

  function clearScenarioTimers() {
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
  }

  function getAiCopy() {
    switch (state.aiPhase) {
      case "mapping":
        return {
          title: "Spatial Mesh Aligning",
          meta: "Grid anchors, room geometry, and circulation logic are being refreshed for the current floor.",
          badge: "Mapping",
        };
      case "scan":
        return {
          title: "Analyzing Smoke Spread",
          meta: "Sensor fusion is validating the fire boundary and testing the preliminary west-evacuation corridor.",
          badge: "Scanning",
        };
      case "reroute":
        return {
          title: "Recalculating Safe Route",
          meta: "West atrium risk exceeded threshold. Stair A and West Exit are being deprioritized in real time.",
          badge: "Rerouting",
        };
      case "locked":
        return {
          title: "Safe Corridor Locked",
          meta: "AI recommends Stair B and the East Exit as the cleanest evacuation flow for the selected origin.",
          badge: "Locked",
        };
      default:
        return {
          title: "AI Mesh Ready",
          meta: "Spatial model synced across 3 floors and prepared for a demonstration event.",
          badge: "AI Ready",
        };
    }
  }

  function getRecommendations() {
    const area = getSelectedArea();
    if (!state.emergencyActive) {
      return [
        {
          title: "Select any guest or public zone",
          body: "Click a room on the plan or use quick select to change the evacuation origin before starting the scenario.",
        },
        {
          title: "Trigger the emergency simulation",
          body: "The demo will first analyze a preliminary route, then visibly reroute traffic when the lobby fire seals the west atrium.",
        },
        {
          title: "Switch floors while the route persists",
          body: "Floor tabs preserve the same evacuation storyline and reveal each segment of the cross-floor route.",
        },
      ];
    }

    return [
      {
        title: "Move ${area.label} occupants toward the east circulation spine".replace("${area.label}", area.label),
        body: "The active storyline diverts traffic from the west atrium and keeps evacuees on the cleanest corridor available.",
      },
      {
        title: "Use Stair B as the vertical connector",
        body: "Stair A is intentionally deprioritized in the simulation due to smoke migration across the lobby-side core.",
      },
      {
        title: "Stage responders at the east safe zone",
        body: "The safe plaza is highlighted as the presentation-ready regroup point for guest accountability and incident command.",
      },
    ];
  }

  function getDisplayedRoute() {
    return getRouteScenario().finalRoute;
  }

  function getRouteScenario() {
    const previewRoute = computeRoute({
      blockedConnectorIds: [],
      blockedEdgeIds: [],
    });

    const finalRoute = computeRoute({
      blockedConnectorIds: state.emergencyActive && state.aiPhase !== "scan" ? DEMO.emergency.blockedConnectorIds : [],
      blockedEdgeIds: state.emergencyActive && state.aiPhase !== "scan" ? DEMO.emergency.blockedEdgeIds : [],
    });

    if (!state.emergencyActive) {
      return { previewRoute: null, finalRoute: previewRoute };
    }

    if (state.aiPhase === "scan") {
      return { previewRoute, finalRoute: previewRoute };
    }

    if (state.aiPhase === "reroute") {
      return { previewRoute, finalRoute };
    }

    return { previewRoute: null, finalRoute };
  }

  function computeRoute(options) {
    const area = getSelectedArea();
    const startId = area.anchorId;
    const exits = DEMO.exitNodeIds.filter((exitId) => !options.blockedConnectorIds.includes(exitId));
    const candidates = exits
      .map((exitId) => runAStar(startId, exitId, options.blockedEdgeIds))
      .filter(Boolean);

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => left.distance - right.distance);
    const chosen = candidates[0];
    const exitConnector = getConnectorByNodeId(chosen.exitId);
    return {
      path: chosen.path,
      distance: chosen.distance,
      exit: {
        id: exitConnector.nodeId,
        label: exitConnector.label,
      },
      guidance: buildGuidanceText(chosen.path, exitConnector.label),
    };
  }

  function runAStar(startId, goalId, blockedEdgeIds) {
    const open = [{ id: startId, priority: 0 }];
    const gScore = new Map([[startId, 0]]);
    const fScore = new Map([[startId, heuristic(startId, goalId)]]);
    const cameFrom = new Map();

    while (open.length) {
      open.sort((left, right) => left.priority - right.priority);
      const current = open.shift().id;
      if (current === goalId) {
        const pathIds = [current];
        let cursor = current;
        while (cameFrom.has(cursor)) {
          cursor = cameFrom.get(cursor);
          pathIds.push(cursor);
        }
        pathIds.reverse();
        return {
          exitId: goalId,
          distance: gScore.get(goalId) || 0,
          path: pathIds.map((id) => nodeIndex.get(id)),
        };
      }

      DEMO.edges
        .filter((edge) => edge.from === current || edge.to === current)
        .forEach((edge) => {
          if (blockedEdgeIds.includes(edge.id)) {
            return;
          }
          const neighborId = edge.from === current ? edge.to : edge.from;
          const tentative = (gScore.get(current) || Number.POSITIVE_INFINITY) + edge.weight;
          if (tentative >= (gScore.get(neighborId) || Number.POSITIVE_INFINITY)) {
            return;
          }
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentative);
          const estimate = tentative + heuristic(neighborId, goalId);
          fScore.set(neighborId, estimate);
          open.push({ id: neighborId, priority: estimate });
        });
    }

    return null;
  }

  function heuristic(fromId, toId) {
    const from = nodeIndex.get(fromId);
    const to = nodeIndex.get(toId);
    if (!from || !to) {
      return 0;
    }
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const floorPenalty = Math.abs(from.level - to.level) * 180;
    return Math.sqrt((dx * dx) + (dy * dy)) + floorPenalty;
  }

  function buildGuidanceText(path, exitLabel) {
    if (!path || path.length < 2) {
      return `Proceed to ${exitLabel}.`;
    }
    const second = path[1];
    const routeFloors = unique(path.map((node) => getFloorById(node.floorId).label));
    return `Move through ${second.label}, continue via ${routeFloors.join(" -> ")}, and exit through ${exitLabel}.`;
  }

  function buildPathDataForFloor(path, floorId) {
    const sameFloorSegments = [];
    const spineY = getFloorById(floorId)?.layout?.spineCenterY || 460;
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      if (from.floorId === floorId && to.floorId === floorId) {
        sameFloorSegments.push(buildOrthogonalSegment(from, to, spineY));
      }
    }
    return sameFloorSegments.join(" ");
  }

  function buildOrthogonalSegment(from, to, spineY) {
    if (from.x === to.x || from.y === to.y) {
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    const commands = [`M ${from.x} ${from.y}`];
    if (from.y !== spineY) {
      commands.push(`L ${from.x} ${spineY}`);
    }
    if (to.x !== from.x) {
      commands.push(`L ${to.x} ${spineY}`);
    }
    if (to.y !== spineY) {
      commands.push(`L ${to.x} ${to.y}`);
    }
    return commands.join(" ");
  }

  function onSvgClick(event) {
    if (state.didPan) {
      state.didPan = false;
      return;
    }
    const areaNode = event.target.closest("[data-area-id]");
    if (!areaNode) {
      return;
    }
    selectArea(areaNode.getAttribute("data-area-id"), false);
  }

  function onSvgWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 0.9 : 1.1;
    zoomByFactor(factor, eventToSvgPoint(event));
  }

  function onSvgPointerDown(event) {
    if (event.target.closest("[data-area-id]")) {
      return;
    }
    state.pan = {
      originClientX: event.clientX,
      originClientY: event.clientY,
      originViewBox: { ...state.viewBoxes[state.activeFloorId] },
    };
    state.didPan = false;
  }

  function onSvgPointerMove(event) {
    const point = eventToSvgPoint(event);
    state.cursor = point;
    state.dom.cursorReadout.textContent = `X: ${Math.round(point.x)} · Y: ${Math.round(point.y)}`;

    if (!state.pan) {
      return;
    }

    const floor = getActiveFloor();
    const rect = state.dom.floorplanSvg.getBoundingClientRect();
    const deltaX = ((event.clientX - state.pan.originClientX) / rect.width) * state.pan.originViewBox.width;
    const deltaY = ((event.clientY - state.pan.originClientY) / rect.height) * state.pan.originViewBox.height;
    state.viewBoxes[floor.id] = normalizeViewBox(
      {
        x: state.pan.originViewBox.x - deltaX,
        y: state.pan.originViewBox.y - deltaY,
        width: state.pan.originViewBox.width,
        height: state.pan.originViewBox.height,
      },
      floor
    );
    state.didPan = true;
    renderMap();
  }

  function onSvgPointerUp() {
    state.pan = null;
  }

  function zoomByFactor(factor, focusPoint) {
    const floor = getActiveFloor();
    const current = state.viewBoxes[floor.id];
    const point = focusPoint || {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    };
    const nextWidth = clamp(current.width * factor, floor.width * VIEWBOX_MIN_RATIO, floor.width);
    const nextHeight = clamp(current.height * factor, floor.height * VIEWBOX_MIN_RATIO, floor.height);
    state.viewBoxes[floor.id] = normalizeViewBox(
      {
        x: point.x - ((point.x - current.x) * nextWidth) / current.width,
        y: point.y - ((point.y - current.y) * nextHeight) / current.height,
        width: nextWidth,
        height: nextHeight,
      },
      floor
    );
    renderMap();
  }

  function normalizeViewBox(viewBox, floor) {
    const width = clamp(viewBox.width, floor.width * VIEWBOX_MIN_RATIO, floor.width);
    const height = clamp(viewBox.height, floor.height * VIEWBOX_MIN_RATIO, floor.height);
    return {
      width,
      height,
      x: clamp(viewBox.x, 0, floor.width - width),
      y: clamp(viewBox.y, 0, floor.height - height),
    };
  }

  function resetViewBox(floorId) {
    const floor = getFloorById(floorId);
    state.viewBoxes[floorId] = {
      x: 0,
      y: 0,
      width: floor.width,
      height: floor.height,
    };
  }

  function pulseStage(className, duration) {
    state.dom.mapStage.classList.remove(className);
    void state.dom.mapStage.offsetWidth;
    state.dom.mapStage.classList.add(className);
    setTimeout(() => state.dom.mapStage.classList.remove(className), duration);
  }

  function eventToSvgPoint(event) {
    const point = state.dom.floorplanSvg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(state.dom.floorplanSvg.getScreenCTM().inverse());
  }

  function getEmergencyContext() {
    return {
      title: "Lobby electrical fire detected",
      summary: "Smoke build-up around the west atrium creates a believable need for AI rerouting in the demo scenario.",
    };
  }

  function getSelectedArea() {
    return getAreaById(state.selectedAreaId) || DEMO.floors[0].areas[0];
  }

  function getActiveFloor() {
    return getFloorById(state.activeFloorId);
  }

  function getFloorById(floorId) {
    return floorIndex.get(floorId);
  }

  function getAreaById(areaId) {
    return areaIndex.get(areaId);
  }

  function getConnectorByNodeId(nodeId) {
    return DEMO.floors.flatMap((floor) => floor.connectors).find((connector) => connector.nodeId === nodeId);
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatEta(distance) {
    const minutes = Math.max(1, Math.floor(distance / 980));
    const seconds = 18 + (Math.round(distance) % 37);
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function buildDemoData() {
    const width = 1440;
    const height = 920;

    const floors = [
      {
        id: "floor-1",
        label: "Floor 01",
        title: "Arrival and Operations",
        subtitle: "Lobby, guest services, food and event operations",
        level: 1,
        width,
        height,
        occupancy: 74,
        corridors: [
          { x: 150, y: 406, w: 1140, h: 110, r: 34 },
          { x: 650, y: 220, w: 140, h: 310, r: 30 },
          { x: 248, y: 308, w: 110, h: 98, r: 24 },
          { x: 560, y: 286, w: 80, h: 120, r: 22 },
          { x: 1032, y: 308, w: 110, h: 98, r: 24 },
          { x: 210, y: 516, w: 110, h: 74, r: 22 },
          { x: 620, y: 516, w: 80, h: 74, r: 22 },
          { x: 1100, y: 516, w: 80, h: 74, r: 22 },
        ],
        safeZones: [
          { x: 1180, y: 634, w: 168, h: 170, label: "East Safe Plaza" },
        ],
        connectors: [
          { id: "f1-stair-a", nodeId: "n-f1-stair-a", label: "Stair A", short: "ST", type: "stair", x: 466, y: 334 },
          { id: "f1-elevator", nodeId: "n-f1-elevator", label: "Elevator", short: "EL", type: "elevator", x: 720, y: 334 },
          { id: "f1-stair-b", nodeId: "n-f1-stair-b", label: "Stair B", short: "ST", type: "stair", x: 974, y: 334 },
          { id: "f1-west-exit", nodeId: "n-f1-west-exit", label: "West Exit", short: "EX", type: "exit", x: 118, y: 461 },
          { id: "f1-east-exit", nodeId: "n-f1-east-exit", label: "East Exit", short: "EX", type: "exit", x: 1318, y: 461 },
        ],
        areas: [
          { id: "f1-lounge", floorId: "floor-1", anchorId: "n-f1-lounge", label: "Guest Lounge", meta: "Public lounge", kind: "hospitality", x: 72, y: 74, w: 310, h: 234, occupancyText: "11 occupants", selectable: true },
          { id: "f1-kitchen", floorId: "floor-1", anchorId: "n-f1-kitchen", label: "Kitchen", meta: "Back-of-house", kind: "operations", x: 446, y: 74, w: 230, h: 212, occupancyText: "8 staff", selectable: false },
          { id: "f1-conference", floorId: "floor-1", anchorId: "n-f1-conference", label: "Conference Hall", meta: "Event venue", kind: "public", x: 932, y: 74, w: 362, h: 234, occupancyText: "28 attendees", selectable: true },
          { id: "f1-lobby", floorId: "floor-1", anchorId: "n-f1-lobby", label: "Lobby", meta: "Reception atrium", kind: "public", x: 72, y: 590, w: 330, h: 236, occupancyText: "22 guests", selectable: true },
          { id: "f1-restaurant", floorId: "floor-1", anchorId: "n-f1-restaurant", label: "Restaurant", meta: "Dining floor", kind: "hospitality", x: 446, y: 590, w: 356, h: 236, occupancyText: "36 guests", selectable: true },
          { id: "f1-operations", floorId: "floor-1", anchorId: "n-f1-operations", label: "Operations Room", meta: "Security + controls", kind: "operations", x: 998, y: 590, w: 296, h: 236, occupancyText: "6 staff", selectable: true },
        ],
      },
      {
        id: "floor-2",
        label: "Floor 02",
        title: "Guest Wing",
        subtitle: "Guest rooms, family lounge, and housekeeping",
        level: 2,
        width,
        height,
        occupancy: 68,
        corridors: [
          { x: 150, y: 406, w: 1140, h: 110, r: 34 },
          { x: 650, y: 286, w: 140, h: 350, r: 30 },
          { x: 286, y: 280, w: 76, h: 126, r: 20 },
          { x: 596, y: 280, w: 80, h: 126, r: 20 },
          { x: 928, y: 280, w: 80, h: 126, r: 20 },
          { x: 1114, y: 280, w: 80, h: 126, r: 20 },
          { x: 286, y: 516, w: 76, h: 102, r: 20 },
          { x: 596, y: 516, w: 80, h: 102, r: 20 },
          { x: 928, y: 516, w: 80, h: 102, r: 20 },
          { x: 1114, y: 516, w: 80, h: 102, r: 20 },
        ],
        safeZones: [],
        connectors: [
          { id: "f2-stair-a", nodeId: "n-f2-stair-a", label: "Stair A", short: "ST", type: "stair", x: 466, y: 334 },
          { id: "f2-elevator", nodeId: "n-f2-elevator", label: "Elevator", short: "EL", type: "elevator", x: 720, y: 334 },
          { id: "f2-stair-b", nodeId: "n-f2-stair-b", label: "Stair B", short: "ST", type: "stair", x: 974, y: 334 },
        ],
        areas: [
          { id: "f2-room-201", floorId: "floor-2", anchorId: "n-f2-room-201", label: "Room 201", meta: "Guest suite", kind: "guest", x: 72, y: 82, w: 302, h: 198, occupancyText: "2 occupants", selectable: true },
          { id: "f2-room-202", floorId: "floor-2", anchorId: "n-f2-room-202", label: "Room 202", meta: "Guest suite", kind: "guest", x: 484, y: 82, w: 224, h: 198, occupancyText: "1 occupant", selectable: true },
          { id: "f2-room-203", floorId: "floor-2", anchorId: "n-f2-room-203", label: "Room 203", meta: "Guest suite", kind: "guest", x: 816, y: 82, w: 224, h: 198, occupancyText: "2 occupants", selectable: true },
          { id: "f2-room-204", floorId: "floor-2", anchorId: "n-f2-room-204", label: "Room 204", meta: "Guest suite", kind: "guest", x: 1068, y: 82, w: 302, h: 198, occupancyText: "3 occupants", selectable: true },
          { id: "f2-family-lounge", floorId: "floor-2", anchorId: "n-f2-family-lounge", label: "Family Lounge", meta: "Guest amenity", kind: "hospitality", x: 72, y: 618, w: 302, h: 206, occupancyText: "9 occupants", selectable: true },
          { id: "f2-room-205", floorId: "floor-2", anchorId: "n-f2-room-205", label: "Room 205", meta: "Guest suite", kind: "guest", x: 484, y: 618, w: 224, h: 206, occupancyText: "2 occupants", selectable: true },
          { id: "f2-room-206", floorId: "floor-2", anchorId: "n-f2-room-206", label: "Room 206", meta: "Guest suite", kind: "guest", x: 816, y: 618, w: 224, h: 206, occupancyText: "2 occupants", selectable: true },
          { id: "f2-housekeeping", floorId: "floor-2", anchorId: "n-f2-housekeeping", label: "Housekeeping", meta: "Service support", kind: "operations", x: 1068, y: 618, w: 302, h: 206, occupancyText: "5 staff", selectable: true },
        ],
      },
      {
        id: "floor-3",
        label: "Floor 03",
        title: "Sky Guest Wing",
        subtitle: "Premium rooms, wellness lounge, and service support",
        level: 3,
        width,
        height,
        occupancy: 72,
        corridors: [
          { x: 150, y: 406, w: 1140, h: 110, r: 34 },
          { x: 650, y: 286, w: 140, h: 350, r: 30 },
          { x: 286, y: 280, w: 76, h: 126, r: 20 },
          { x: 596, y: 280, w: 80, h: 126, r: 20 },
          { x: 928, y: 280, w: 80, h: 126, r: 20 },
          { x: 1114, y: 280, w: 80, h: 126, r: 20 },
          { x: 286, y: 516, w: 76, h: 102, r: 20 },
          { x: 596, y: 516, w: 80, h: 102, r: 20 },
          { x: 928, y: 516, w: 80, h: 102, r: 20 },
          { x: 1114, y: 516, w: 80, h: 102, r: 20 },
        ],
        safeZones: [],
        connectors: [
          { id: "f3-stair-a", nodeId: "n-f3-stair-a", label: "Stair A", short: "ST", type: "stair", x: 466, y: 334 },
          { id: "f3-elevator", nodeId: "n-f3-elevator", label: "Elevator", short: "EL", type: "elevator", x: 720, y: 334 },
          { id: "f3-stair-b", nodeId: "n-f3-stair-b", label: "Stair B", short: "ST", type: "stair", x: 974, y: 334 },
        ],
        areas: [
          { id: "f3-room-301", floorId: "floor-3", anchorId: "n-f3-room-301", label: "Room 301", meta: "Premium room", kind: "guest", x: 72, y: 82, w: 302, h: 198, occupancyText: "2 occupants", selectable: true },
          { id: "f3-room-302", floorId: "floor-3", anchorId: "n-f3-room-302", label: "Room 302", meta: "Premium room", kind: "guest", x: 484, y: 82, w: 224, h: 198, occupancyText: "1 occupant", selectable: true },
          { id: "f3-wellness", floorId: "floor-3", anchorId: "n-f3-wellness", label: "Wellness Lounge", meta: "Recovery zone", kind: "hospitality", x: 816, y: 82, w: 224, h: 198, occupancyText: "8 occupants", selectable: true },
          { id: "f3-vip-suite", floorId: "floor-3", anchorId: "n-f3-vip-suite", label: "VIP Suite", meta: "Executive stay", kind: "guest", x: 1068, y: 82, w: 302, h: 198, occupancyText: "3 occupants", selectable: true },
          { id: "f3-room-303", floorId: "floor-3", anchorId: "n-f3-room-303", label: "Room 303", meta: "Premium room", kind: "guest", x: 72, y: 618, w: 302, h: 206, occupancyText: "2 occupants", selectable: true },
          { id: "f3-sky-lounge", floorId: "floor-3", anchorId: "n-f3-sky-lounge", label: "Sky Lounge", meta: "Quiet seating", kind: "hospitality", x: 484, y: 618, w: 224, h: 206, occupancyText: "7 occupants", selectable: true },
          { id: "f3-room-304", floorId: "floor-3", anchorId: "n-f3-room-304", label: "Room 304", meta: "Premium room", kind: "guest", x: 816, y: 618, w: 224, h: 206, occupancyText: "2 occupants", selectable: true },
          { id: "f3-service-hub", floorId: "floor-3", anchorId: "n-f3-service-hub", label: "Service Hub", meta: "Support staging", kind: "operations", x: 1068, y: 618, w: 302, h: 206, occupancyText: "5 staff", selectable: true },
        ],
      },
    ];

    const nodes = {
      "n-f1-west-exit": { id: "n-f1-west-exit", floorId: "floor-1", level: 1, label: "West Exit", x: 118, y: 461 },
      "n-f1-hall-west": { id: "n-f1-hall-west", floorId: "floor-1", level: 1, label: "West Hall", x: 328, y: 461 },
      "n-f1-hall-mid": { id: "n-f1-hall-mid", floorId: "floor-1", level: 1, label: "Central Hall", x: 720, y: 461 },
      "n-f1-hall-east": { id: "n-f1-hall-east", floorId: "floor-1", level: 1, label: "East Hall", x: 1112, y: 461 },
      "n-f1-east-exit": { id: "n-f1-east-exit", floorId: "floor-1", level: 1, label: "East Exit", x: 1318, y: 461 },
      "n-f1-stair-a": { id: "n-f1-stair-a", floorId: "floor-1", level: 1, label: "Stair A", x: 466, y: 334 },
      "n-f1-elevator": { id: "n-f1-elevator", floorId: "floor-1", level: 1, label: "Elevator", x: 720, y: 334 },
      "n-f1-stair-b": { id: "n-f1-stair-b", floorId: "floor-1", level: 1, label: "Stair B", x: 974, y: 334 },
      "n-f1-lounge": { id: "n-f1-lounge", floorId: "floor-1", level: 1, label: "Guest Lounge", x: 303, y: 308 },
      "n-f1-kitchen": { id: "n-f1-kitchen", floorId: "floor-1", level: 1, label: "Kitchen", x: 560, y: 286 },
      "n-f1-conference": { id: "n-f1-conference", floorId: "floor-1", level: 1, label: "Conference Hall", x: 1032, y: 308 },
      "n-f1-lobby": { id: "n-f1-lobby", floorId: "floor-1", level: 1, label: "Lobby", x: 264, y: 590 },
      "n-f1-restaurant": { id: "n-f1-restaurant", floorId: "floor-1", level: 1, label: "Restaurant", x: 660, y: 590 },
      "n-f1-operations": { id: "n-f1-operations", floorId: "floor-1", level: 1, label: "Operations Room", x: 1140, y: 590 },

      "n-f2-stair-a": { id: "n-f2-stair-a", floorId: "floor-2", level: 2, label: "Stair A", x: 466, y: 334 },
      "n-f2-elevator": { id: "n-f2-elevator", floorId: "floor-2", level: 2, label: "Elevator", x: 720, y: 334 },
      "n-f2-stair-b": { id: "n-f2-stair-b", floorId: "floor-2", level: 2, label: "Stair B", x: 974, y: 334 },
      "n-f2-hall-west": { id: "n-f2-hall-west", floorId: "floor-2", level: 2, label: "West Hall", x: 328, y: 461 },
      "n-f2-hall-mid": { id: "n-f2-hall-mid", floorId: "floor-2", level: 2, label: "Central Hall", x: 720, y: 461 },
      "n-f2-hall-east": { id: "n-f2-hall-east", floorId: "floor-2", level: 2, label: "East Hall", x: 1112, y: 461 },
      "n-f2-room-201": { id: "n-f2-room-201", floorId: "floor-2", level: 2, label: "Room 201", x: 326, y: 280 },
      "n-f2-room-202": { id: "n-f2-room-202", floorId: "floor-2", level: 2, label: "Room 202", x: 596, y: 280 },
      "n-f2-room-203": { id: "n-f2-room-203", floorId: "floor-2", level: 2, label: "Room 203", x: 928, y: 280 },
      "n-f2-room-204": { id: "n-f2-room-204", floorId: "floor-2", level: 2, label: "Room 204", x: 1114, y: 280 },
      "n-f2-family-lounge": { id: "n-f2-family-lounge", floorId: "floor-2", level: 2, label: "Family Lounge", x: 326, y: 618 },
      "n-f2-room-205": { id: "n-f2-room-205", floorId: "floor-2", level: 2, label: "Room 205", x: 596, y: 618 },
      "n-f2-room-206": { id: "n-f2-room-206", floorId: "floor-2", level: 2, label: "Room 206", x: 928, y: 618 },
      "n-f2-housekeeping": { id: "n-f2-housekeeping", floorId: "floor-2", level: 2, label: "Housekeeping", x: 1114, y: 618 },

      "n-f3-stair-a": { id: "n-f3-stair-a", floorId: "floor-3", level: 3, label: "Stair A", x: 466, y: 334 },
      "n-f3-elevator": { id: "n-f3-elevator", floorId: "floor-3", level: 3, label: "Elevator", x: 720, y: 334 },
      "n-f3-stair-b": { id: "n-f3-stair-b", floorId: "floor-3", level: 3, label: "Stair B", x: 974, y: 334 },
      "n-f3-hall-west": { id: "n-f3-hall-west", floorId: "floor-3", level: 3, label: "West Hall", x: 328, y: 461 },
      "n-f3-hall-mid": { id: "n-f3-hall-mid", floorId: "floor-3", level: 3, label: "Central Hall", x: 720, y: 461 },
      "n-f3-hall-east": { id: "n-f3-hall-east", floorId: "floor-3", level: 3, label: "East Hall", x: 1112, y: 461 },
      "n-f3-room-301": { id: "n-f3-room-301", floorId: "floor-3", level: 3, label: "Room 301", x: 326, y: 280 },
      "n-f3-room-302": { id: "n-f3-room-302", floorId: "floor-3", level: 3, label: "Room 302", x: 596, y: 280 },
      "n-f3-wellness": { id: "n-f3-wellness", floorId: "floor-3", level: 3, label: "Wellness Lounge", x: 928, y: 280 },
      "n-f3-vip-suite": { id: "n-f3-vip-suite", floorId: "floor-3", level: 3, label: "VIP Suite", x: 1114, y: 280 },
      "n-f3-room-303": { id: "n-f3-room-303", floorId: "floor-3", level: 3, label: "Room 303", x: 326, y: 618 },
      "n-f3-sky-lounge": { id: "n-f3-sky-lounge", floorId: "floor-3", level: 3, label: "Sky Lounge", x: 596, y: 618 },
      "n-f3-room-304": { id: "n-f3-room-304", floorId: "floor-3", level: 3, label: "Room 304", x: 928, y: 618 },
      "n-f3-service-hub": { id: "n-f3-service-hub", floorId: "floor-3", level: 3, label: "Service Hub", x: 1114, y: 618 },
    };

    applyStructuredFloorLayouts(floors, nodes);

    const makeEdge = (id, from, to, weight) => edge(id, from, to, weight, nodes);

    const edges = [
      makeEdge("e-f1-west-exit", "n-f1-west-exit", "n-f1-hall-west"),
      makeEdge("e-f1-west-mid", "n-f1-hall-west", "n-f1-hall-mid"),
      makeEdge("e-f1-mid-east", "n-f1-hall-mid", "n-f1-hall-east"),
      makeEdge("e-f1-east-exit", "n-f1-hall-east", "n-f1-east-exit"),
      makeEdge("e-f1-stair-a", "n-f1-hall-west", "n-f1-stair-a"),
      makeEdge("e-f1-elevator", "n-f1-hall-mid", "n-f1-elevator"),
      makeEdge("e-f1-stair-b", "n-f1-hall-east", "n-f1-stair-b"),
      makeEdge("e-f1-lounge", "n-f1-hall-west", "n-f1-lounge"),
      makeEdge("e-f1-lobby", "n-f1-hall-west", "n-f1-lobby"),
      makeEdge("e-f1-kitchen", "n-f1-hall-mid", "n-f1-kitchen"),
      makeEdge("e-f1-restaurant", "n-f1-hall-mid", "n-f1-restaurant"),
      makeEdge("e-f1-conference", "n-f1-hall-east", "n-f1-conference"),
      makeEdge("e-f1-operations", "n-f1-hall-east", "n-f1-operations"),

      makeEdge("e-f2-west-mid", "n-f2-hall-west", "n-f2-hall-mid"),
      makeEdge("e-f2-mid-east", "n-f2-hall-mid", "n-f2-hall-east"),
      makeEdge("e-f2-stair-a", "n-f2-hall-west", "n-f2-stair-a"),
      makeEdge("e-f2-elevator", "n-f2-hall-mid", "n-f2-elevator"),
      makeEdge("e-f2-stair-b", "n-f2-hall-east", "n-f2-stair-b"),
      makeEdge("e-f2-room-201", "n-f2-hall-west", "n-f2-room-201"),
      makeEdge("e-f2-room-202", "n-f2-hall-mid", "n-f2-room-202"),
      makeEdge("e-f2-room-203", "n-f2-hall-mid", "n-f2-room-203"),
      makeEdge("e-f2-room-204", "n-f2-hall-east", "n-f2-room-204"),
      makeEdge("e-f2-family-lounge", "n-f2-hall-west", "n-f2-family-lounge"),
      makeEdge("e-f2-room-205", "n-f2-hall-mid", "n-f2-room-205"),
      makeEdge("e-f2-room-206", "n-f2-hall-mid", "n-f2-room-206"),
      makeEdge("e-f2-housekeeping", "n-f2-hall-east", "n-f2-housekeeping"),

      makeEdge("e-f3-west-mid", "n-f3-hall-west", "n-f3-hall-mid"),
      makeEdge("e-f3-mid-east", "n-f3-hall-mid", "n-f3-hall-east"),
      makeEdge("e-f3-stair-a", "n-f3-hall-west", "n-f3-stair-a"),
      makeEdge("e-f3-elevator", "n-f3-hall-mid", "n-f3-elevator"),
      makeEdge("e-f3-stair-b", "n-f3-hall-east", "n-f3-stair-b"),
      makeEdge("e-f3-room-301", "n-f3-hall-west", "n-f3-room-301"),
      makeEdge("e-f3-room-302", "n-f3-hall-mid", "n-f3-room-302"),
      makeEdge("e-f3-wellness", "n-f3-hall-mid", "n-f3-wellness"),
      makeEdge("e-f3-vip-suite", "n-f3-hall-east", "n-f3-vip-suite"),
      makeEdge("e-f3-room-303", "n-f3-hall-west", "n-f3-room-303"),
      makeEdge("e-f3-sky-lounge", "n-f3-hall-mid", "n-f3-sky-lounge"),
      makeEdge("e-f3-room-304", "n-f3-hall-mid", "n-f3-room-304"),
      makeEdge("e-f3-service-hub", "n-f3-hall-east", "n-f3-service-hub"),

      makeEdge("e-stair-a-1-2", "n-f1-stair-a", "n-f2-stair-a", 220),
      makeEdge("e-stair-a-2-3", "n-f2-stair-a", "n-f3-stair-a", 220),
      makeEdge("e-stair-b-1-2", "n-f1-stair-b", "n-f2-stair-b", 220),
      makeEdge("e-stair-b-2-3", "n-f2-stair-b", "n-f3-stair-b", 220),
      makeEdge("e-elevator-1-2", "n-f1-elevator", "n-f2-elevator", 260),
      makeEdge("e-elevator-2-3", "n-f2-elevator", "n-f3-elevator", 260),
    ];

    return {
      floors,
      nodes,
      edges,
      totalOccupancy: floors.reduce((total, floor) => total + floor.occupancy, 0),
      exitNodeIds: ["n-f1-west-exit", "n-f1-east-exit"],
      emergency: {
        areaId: "f1-lobby",
        floorId: "floor-1",
        blockedConnectorIds: ["n-f1-west-exit", "n-f1-stair-a"],
        blockedEdgeIds: ["e-f1-west-exit", "e-f1-stair-a", "e-stair-a-1-2", "e-stair-a-2-3"],
      },
    };
  }

  function applyStructuredFloorLayouts(floors, nodes) {
    const templates = {
      "floor-1": {
        columns: 3,
        marginX: 96,
        gap: 34,
        topY: 88,
        bottomY: 610,
        topH: 206,
        bottomH: 206,
        spineY: 410,
        spineH: 102,
        branchW: 84,
        coreW: 152,
        connectorY: 338,
        safeZone: { w: 112, h: 214, label: "East Safe Plaza" },
      },
      "floor-2": {
        columns: 4,
        marginX: 88,
        gap: 28,
        topY: 92,
        bottomY: 626,
        topH: 176,
        bottomH: 176,
        spineY: 410,
        spineH: 102,
        branchW: 72,
        coreW: 148,
        connectorY: 336,
      },
      "floor-3": {
        columns: 4,
        marginX: 88,
        gap: 28,
        topY: 92,
        bottomY: 626,
        topH: 176,
        bottomH: 176,
        spineY: 410,
        spineH: 102,
        branchW: 72,
        coreW: 148,
        connectorY: 336,
      },
    };

    floors.forEach((floor) => {
      const template = templates[floor.id];
      if (!template) {
        return;
      }

      const topAreas = floor.areas.slice(0, template.columns);
      const bottomAreas = floor.areas.slice(template.columns);
      const availableWidth = floor.width - (template.marginX * 2);
      const areaWidth = Math.floor((availableWidth - (template.gap * (template.columns - 1))) / template.columns);

      topAreas.forEach((area, index) => {
        setAreaFrame(area, template.marginX + (index * (areaWidth + template.gap)), template.topY, areaWidth, template.topH);
      });
      bottomAreas.forEach((area, index) => {
        setAreaFrame(area, template.marginX + (index * (areaWidth + template.gap)), template.bottomY, areaWidth, template.bottomH);
      });

      const centers = topAreas.map((area) => Math.round(area.x + (area.w / 2)));
      const hallXs = template.columns === 3
        ? { west: centers[0], mid: centers[1], east: centers[2] }
        : { west: centers[0], mid: Math.round((centers[1] + centers[2]) / 2), east: centers[3] };
      const spineCenterY = template.spineY + Math.round(template.spineH / 2);

      floor.layout = {
        spineCenterY,
        hallXs,
        areaWidth,
        topY: template.topY,
        bottomY: template.bottomY,
      };

      floor.corridors = buildStructuredCorridors(floor, topAreas, bottomAreas, template);
      floor.safeZones = floor.id === "floor-1"
        ? [
            {
              x: floor.width - template.safeZone.w - 42,
              y: template.spineY + template.spineH + 52,
              w: template.safeZone.w,
              h: template.safeZone.h,
              label: template.safeZone.label,
            },
          ]
        : [];

      syncAreaNodes(topAreas, true, nodes);
      syncAreaNodes(bottomAreas, false, nodes);
      syncHallNodes(floor.id, hallXs, spineCenterY, nodes);
      syncConnectorNodes(floor, template, hallXs, spineCenterY, nodes);
    });
  }

  function setAreaFrame(area, x, y, width, height) {
    area.x = x;
    area.y = y;
    area.w = width;
    area.h = height;
    area.radius = 28;
  }

  function buildStructuredCorridors(floor, topAreas, bottomAreas, template) {
    const horizontalX = template.marginX - 26;
    const horizontalW = floor.width - (horizontalX * 2);
    const corridors = [
      { x: horizontalX, y: template.spineY, w: horizontalW, h: template.spineH, r: 34 },
      {
        x: Math.round((floor.width / 2) - (template.coreW / 2)),
        y: Math.round(topAreas[0].y + topAreas[0].h - 12),
        w: template.coreW,
        h: Math.round(bottomAreas[0].y - (topAreas[0].y + topAreas[0].h) + 24),
        r: 32,
      },
    ];

    topAreas.forEach((area) => {
      const centerX = Math.round(area.x + (area.w / 2));
      corridors.push({
        x: centerX - Math.round(template.branchW / 2),
        y: Math.round(area.y + area.h - 6),
        w: template.branchW,
        h: Math.max(48, template.spineY - Math.round(area.y + area.h) + 16),
        r: 22,
      });
    });

    bottomAreas.forEach((area) => {
      const centerX = Math.round(area.x + (area.w / 2));
      corridors.push({
        x: centerX - Math.round(template.branchW / 2),
        y: template.spineY + template.spineH - 10,
        w: template.branchW,
        h: Math.max(48, Math.round(area.y - (template.spineY + template.spineH) + 20)),
        r: 22,
      });
    });

    return corridors;
  }

  function syncAreaNodes(areas, isTopRow, nodes) {
    areas.forEach((area) => {
      if (!nodes[area.anchorId]) {
        return;
      }
      nodes[area.anchorId].x = Math.round(area.x + (area.w / 2));
      nodes[area.anchorId].y = isTopRow ? Math.round(area.y + area.h) : area.y;
    });
  }

  function syncHallNodes(floorId, hallXs, spineCenterY, nodes) {
    const westId = `n-${floorId.replace("floor-", "f")}-hall-west`;
    const midId = `n-${floorId.replace("floor-", "f")}-hall-mid`;
    const eastId = `n-${floorId.replace("floor-", "f")}-hall-east`;
    if (nodes[westId]) {
      nodes[westId].x = hallXs.west;
      nodes[westId].y = spineCenterY;
    }
    if (nodes[midId]) {
      nodes[midId].x = hallXs.mid;
      nodes[midId].y = spineCenterY;
    }
    if (nodes[eastId]) {
      nodes[eastId].x = hallXs.east;
      nodes[eastId].y = spineCenterY;
    }
  }

  function syncConnectorNodes(floor, template, hallXs, spineCenterY, nodes) {
    const stairAX = Math.round((hallXs.west + hallXs.mid) / 2);
    const stairBX = Math.round((hallXs.mid + hallXs.east) / 2);
    floor.connectors.forEach((connector) => {
      if (connector.id.endsWith("west-exit")) {
        connector.x = template.marginX - 18;
        connector.y = spineCenterY;
      } else if (connector.id.endsWith("east-exit")) {
        connector.x = floor.width - template.marginX + 18;
        connector.y = spineCenterY;
      } else if (connector.id.endsWith("stair-a")) {
        connector.x = stairAX;
        connector.y = template.connectorY;
      } else if (connector.id.endsWith("elevator")) {
        connector.x = hallXs.mid;
        connector.y = template.connectorY;
      } else if (connector.id.endsWith("stair-b")) {
        connector.x = stairBX;
        connector.y = template.connectorY;
      }

      if (nodes[connector.nodeId]) {
        nodes[connector.nodeId].x = connector.x;
        nodes[connector.nodeId].y = connector.y;
      }
    });
  }

  function edge(id, from, to, weight, nodesLookup) {
    const fromNode = nodesLookup?.[from];
    const toNode = nodesLookup?.[to];
    if (Number.isFinite(weight)) {
      return { id, from, to, weight };
    }
    if (!fromNode || !toNode) {
      return { id, from, to, weight: 180 };
    }
    const dx = (fromNode?.x || 0) - (toNode?.x || 0);
    const dy = (fromNode?.y || 0) - (toNode?.y || 0);
    return { id, from, to, weight: Math.sqrt((dx * dx) + (dy * dy)) };
  }

  window.toggleSidebar = function toggleSidebar() {
    state.dom.sidebar.classList.toggle("open");
  };
})();
