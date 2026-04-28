/**
 * emergencyControl.js
 *
 * Protected staff/admin control page for live AlertOrbit emergency management.
 */

(function attachEmergencyControl(root) {
  "use strict";

  const ALLOWED_ROLES = new Set([
    "Admin",
    "Administrator",
    "Dispatcher",
    "Coordinator",
    "Emergency Coordinator",
    "Security",
    "Fire",
    "Medical",
    "Police",
  ]);

  const CROWD_MODELS = {
    normal: { crowdByEdgeId: {}, crowdedExitIds: [], blockedEdgeIds: [], unsafeZoneIds: [] },
    "crowded-exit-b": { crowdByEdgeId: { "edge-hall-to-exit-b": 8 }, crowdedExitIds: ["exit-b"], blockedEdgeIds: [], unsafeZoneIds: [] },
    "crowded-stair-c": { crowdByEdgeId: { "edge-hall-to-stair-f2": 9 }, crowdedExitIds: [], blockedEdgeIds: [], unsafeZoneIds: [] },
  };

  let navigationEngine = null;
  let multilingualService = null;
  let translationsCache = {};
  let channelAdapters = [];
  let lastPlan = null;
  let refreshPreviewTimer = null;

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  function getSession() {
    return root.DB?.Session?.get?.() || null;
  }

  function getCurrentAlert() {
    return root.EmergencyService.getCurrentAlert();
  }

  function ensureAuthorized() {
    const session = getSession();
    if (!session || !ALLOWED_ROLES.has(session.role)) {
      window.location.href = "../staff-login.html";
      return false;
    }
    return true;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function setHtml(id, value) {
    const el = byId(id);
    if (el) el.innerHTML = value;
  }

  function showToast(message, duration = 3200) {
    let toast = document.getElementById("ecToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ecToast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.hidden = true;
      }, 220);
    }, duration);
  }

  function populateEmergencyTypes() {
    const select = byId("ecEmergencyType");
    if (!select) return;

    select.innerHTML = AlertOrbitConfig.SUPPORTED_EMERGENCY_TYPES
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
      .join("");
    if (!select.value && select.options.length) {
      select.value = select.options[0].value;
    }
  }

  function normalizeRoom(value) {
    return String(value || "").trim().toUpperCase();
  }

  function buildLocation(room, location) {
    const cleanRoom = normalizeRoom(room);
    const cleanLocation = String(location || "").trim();
    if (cleanRoom && cleanLocation) return `Room ${cleanRoom} - ${cleanLocation}`;
    if (cleanRoom) return `Room ${cleanRoom}`;
    return cleanLocation;
  }

  function readFormState() {
    const room = normalizeRoom(byId("ecRoom").value);
    const location = byId("ecLocation").value.trim();
    return {
      emergencyType: byId("ecEmergencyType").value,
      severity: byId("ecSeverity").value,
      room,
      location,
      composedLocation: buildLocation(room, location),
      instructions: byId("ecInstructions").value.trim(),
      affectedZones: byId("ecAffectedZones").value.split(",").map((value) => value.trim()).filter(Boolean),
    };
  }

  function updateLiveBanner(alert) {
    if (!alert) {
      setText("ecLiveStatus", "No Active Emergency");
      setText("ecActiveHeadline", "System standing by");
      setText("ecActiveSummary", "No active emergency is being broadcast right now. Staff can prepare a multilingual alert and publish it instantly across the property.");
      setText("ecStatStatus", "CLEAR");
      setText("ecStatSeverity", "-");
      setText("ecStatLocation", "-");
      setText("ecStatUpdated", "-");
      setText("ecMonitorCurrent", "No active emergency.");
      setText("ecMonitorActor", "Awaiting authorized staff action.");
      setText("ecMonitorDuration", "-");
      setText("ecMonitorZones", "-");
      return;
    }

    const created = new Date(alert.createdAt || Date.now());
    const durationMinutes = Math.max(1, Math.round((Date.now() - created.getTime()) / 60000));
    setText("ecLiveStatus", `${alert.status} - ${alert.emergencyType}`);
    setText("ecActiveHeadline", `${alert.emergencyType} at ${alert.location}`);
    setText("ecActiveSummary", alert.routeGuidance || alert.instructions || "Emergency broadcast is active.");
    setText("ecStatStatus", alert.status);
    setText("ecStatSeverity", String(alert.severity || "-").toUpperCase());
    setText("ecStatLocation", [alert.room, alert.location].filter(Boolean).join(" | ") || "-");
    setText("ecStatUpdated", new Date(alert.updatedAt || alert.createdAt).toLocaleTimeString());
    setText("ecMonitorCurrent", `${alert.emergencyType} | ${[alert.room, alert.location].filter(Boolean).join(" | ")}`);
    setText("ecMonitorActor", `${alert.triggeredBy?.name || "Unknown"} (${alert.triggeredBy?.role || "Staff"})`);
    setText("ecMonitorDuration", `${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}`);
    setText("ecMonitorZones", (alert.affectedZones || []).join(", ") || "None provided");
  }

  function syncFormWithAlert(alert) {
    if (!alert) return;
    if (byId("ecEmergencyType") && alert.emergencyType) byId("ecEmergencyType").value = alert.emergencyType;
    if (byId("ecSeverity") && alert.severity) byId("ecSeverity").value = alert.severity;
    if (byId("ecRoom") && alert.room) byId("ecRoom").value = alert.room;
    if (byId("ecLocation") && alert.location) byId("ecLocation").value = alert.location;
    if (byId("ecInstructions") && alert.instructions) byId("ecInstructions").value = alert.instructions;
    if (byId("ecAffectedZones") && Array.isArray(alert.affectedZones)) {
      byId("ecAffectedZones").value = alert.affectedZones.join(", ");
    }
  }

  function updateTranslationPreview(translations, sourceText) {
    translationsCache = translations || {};
    const previewLanguage = byId("ecPreviewLanguage").value;
    const previewText = translationsCache?.[previewLanguage]?.text || sourceText || "Preview unavailable.";
    setText("ecLanguagePreview", previewText);

    const list = byId("ecTranslationList");
    if (!list) return;

    const items = Object.entries(translationsCache);
    if (!items.length) {
      list.innerHTML = '<div class="ec-channel-item">No translations available yet.</div>';
      return;
    }

    list.innerHTML = items.map(([code, payload]) => `
      <div class="ec-channel-item">
        <strong>${escapeHtml(code)}</strong><br />
        <span>Status: ${escapeHtml(payload.status || "translated")}</span><br />
        <span>${escapeHtml((payload.text || "").slice(0, 160))}</span>
      </div>
    `).join("");
  }

  function updateRouteUi(plan) {
    lastPlan = plan || null;
    const routeSummary = byId("ecRouteSummary");
    const routeGuidance = byId("ecRouteGuidance");
    const routeSteps = byId("ecRouteSteps");

    if (!plan) {
      routeSummary.innerHTML = '<span class="ec-chip">Run a route simulation to generate evacuation guidance.</span>';
      routeGuidance.textContent = "Route guidance will appear here once the simulation runs.";
      routeSteps.innerHTML = '<div class="ec-route-item">Run a simulation to generate route steps.</div>';
      return;
    }

    routeSummary.innerHTML = `
      <span class="ec-chip">Nearest safe exit: ${escapeHtml(plan.primary.exit.name)}</span>
      <span class="ec-chip">Primary route: ${escapeHtml(plan.guidance.shortText)}</span>
      <span class="ec-chip">Alternates: ${escapeHtml(plan.guidance.alternateExits.join(", ") || "None")}</span>
    `;
    routeGuidance.textContent = plan.guidance.shortText;
    routeSteps.innerHTML = plan.primary.route.path.map((node, index) => `
      <div class="ec-route-item">
        Step ${index + 1}: ${escapeHtml(node.label || node.id)} on Floor ${escapeHtml(node.floor)}
      </div>
    `).join("");
  }

  function buildSourceMessage(formState, plan) {
    return multilingualService.composeEmergencyMessage({
      venueType: "hotel",
      emergencyType: formState.emergencyType,
      alertMessage: `${formState.instructions} ${plan?.guidance?.shortText || ""}`.trim(),
      severityLevel: formState.severity,
      location: formState.composedLocation,
    });
  }

  async function refreshMultilingualPreview() {
    if (!multilingualService) return;
    const formState = readFormState();
    const plan = lastPlan || runSimulation(false);
    const sourceText = buildSourceMessage(formState, plan);
    const translationPayload = await root.EmergencyService.translatePreview(sourceText);
    updateTranslationPreview(translationPayload.translations, sourceText);
    return { sourceText, translations: translationPayload.translations };
  }

  function renderAssets() {
    const list = byId("ecAssetsList");
    const assets = root.DB.MapAssets.getAll();
    if (!assets.length) {
      list.innerHTML = '<div class="ec-asset-item">No uploaded assets yet.</div>';
      return;
    }

    list.innerHTML = assets.map((asset) => `
      <div class="ec-asset-item">
        <strong>${escapeHtml(asset.name)}</strong><br />
        <span>Type: ${escapeHtml(asset.kind)}</span><br />
        <span>${escapeHtml(asset.note || "")}</span>
      </div>
    `).join("");
  }

  function renderChannels() {
    const list = byId("ecChannelList");
    list.innerHTML = channelAdapters.map((adapter) => `
      <div class="ec-channel-item">
        <strong>${escapeHtml(adapter.channel.toUpperCase())}</strong><br />
        <span>Provider-agnostic placeholder active. Configure a secure backend endpoint before production rollout.</span>
      </div>
    `).join("");
  }

  function applyMapState() {
    if (!navigationEngine) return null;

    const unsafeZoneId = byId("ecUnsafeZoneSelect").value;
    const disabledExit = byId("ecDisabledExitSelect").value;
    const crowdModel = CROWD_MODELS[byId("ecCrowdModelSelect").value] || CROWD_MODELS.normal;

    navigationEngine.updateDynamicConditions({
      crowdByEdgeId: crowdModel.crowdByEdgeId || {},
      crowdedExitIds: crowdModel.crowdedExitIds || [],
      unsafeZoneIds: [unsafeZoneId].filter(Boolean),
      unsafeExitIds: [disabledExit].filter(Boolean),
      blockedEdgeIds: crowdModel.blockedEdgeIds || [],
    });

    return {
      unsafeZoneIds: [unsafeZoneId].filter(Boolean),
      unsafeExitIds: [disabledExit].filter(Boolean),
      crowdByEdgeId: crowdModel.crowdByEdgeId || {},
    };
  }

  function runSimulation(showFeedback = true) {
    if (!navigationEngine) return null;
    applyMapState();
    const plan = navigationEngine.reroute();
    updateRouteUi(plan);
    if (showFeedback) {
      showToast("Evacuation route updated.");
    }
    return plan;
  }

  async function publishAlert() {
    const formState = readFormState();
    const plan = lastPlan || runSimulation(false);
    const translationData = await refreshMultilingualPreview();
    const notification = await multilingualService.createEmergencyNotification({
      venueType: "hotel",
      emergencyType: formState.emergencyType,
      alertMessage: `${formState.instructions} ${plan?.guidance?.shortText || ""}`.trim(),
      severityLevel: formState.severity,
      location: formState.composedLocation,
      languages: AlertOrbitConfig.SUPPORTED_LANGUAGES,
    });

    const channelResults = await Promise.all(channelAdapters.map((adapter) => adapter.send(notification)));
    renderChannelResults(channelResults);

    const payload = {
      emergency_type: formState.emergencyType,
      severity: formState.severity,
      room: formState.room,
      location: formState.composedLocation,
      instructions: formState.instructions,
      nearest_safe_exit: plan?.primary?.exit?.name || "",
      route_guidance: plan?.guidance?.shortText || "",
      route_steps: plan?.primary?.route?.path?.map((node) => `${node.label || node.id} (Floor ${node.floor})`) || [],
      affected_zones: formState.affectedZones,
      translations: translationData.translations,
      source_text: translationData.sourceText,
      navigation_state: {
        floor: byId("ecFloorSelect").value,
        dynamicConditions: applyMapState(),
      },
      metadata: {
        channelResults,
      },
      venue_type: "hotel",
    };
    console.log("Emergency payload:", payload);
    const alert = await root.EmergencyService.createAlert(payload);

    root.DB.CtrlLog.add("DISPATCH", `${formState.emergencyType} broadcast activated from emergency control`, getSession().name);
    showToast("Emergency broadcast activated.");
    updateLiveBanner(alert);
  }

  async function updateActiveAlert() {
    const alert = getCurrentAlert();
    if (!alert) {
      showToast("No active emergency to update.");
      return;
    }

    const formState = readFormState();
    const plan = lastPlan || runSimulation(false);
    const translationData = await refreshMultilingualPreview();
    const nextEmergencyType = formState.emergencyType || alert.emergencyType;
    const nextRoom = formState.room || alert.room || "";
    const nextLocation = formState.composedLocation || alert.location || "";
    const nextInstructions = formState.instructions || alert.instructions || "";

    const patch = {
      emergency_type: nextEmergencyType,
      severity: formState.severity,
      room: nextRoom,
      location: nextLocation,
      instructions: nextInstructions,
      nearest_safe_exit: plan?.primary?.exit?.name || "",
      route_guidance: plan?.guidance?.shortText || "",
      route_steps: plan?.primary?.route?.path?.map((node) => `${node.label || node.id} (Floor ${node.floor})`) || [],
      affected_zones: formState.affectedZones,
      translations: translationData.translations,
      source_text: translationData.sourceText,
      navigation_state: {
        floor: byId("ecFloorSelect").value,
        dynamicConditions: applyMapState(),
      },
    };
    console.log("Emergency update payload:", patch);
    const updated = await root.EmergencyService.updateAlert(alert.id, patch);

    root.DB.CtrlLog.add("UPDATE", `${formState.emergencyType} alert updated by staff`, getSession().name);
    showToast("Emergency alert updated.");
    updateLiveBanner(updated);
  }

  async function cancelActiveAlert() {
    const alert = getCurrentAlert();
    if (!alert) {
      showToast("No active emergency to cancel.");
      return;
    }

    try {
      await root.EmergencyService.endAlert(alert.id, "CANCELLED");
      root.DB.CtrlLog.add("ABORTED", `${alert.emergencyType} alert cancelled by staff`, getSession().name);
      showToast("Emergency cancelled.");
      updateLiveBanner(null);
    } catch (error) {
      showToast("You are not authorized to cancel this emergency.");
    }
  }

  function handleUploads() {
    const input = byId("ecMapUpload");
    input.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) return;

      const lower = file.name.toLowerCase();
      const content = await file.text().catch(() => "");
      if (lower.endsWith(".json") || lower.endsWith(".geojson")) {
        try {
          const geojson = JSON.parse(content);
          navigationEngine.loadIndoorMap(geojson);
          root.DB.MapAssets.save({
            name: file.name,
            kind: "geojson",
            note: "Loaded directly into Smart Indoor Navigation.",
          });
          showToast("Custom GeoJSON map loaded.");
        } catch (error) {
          showToast("Map upload failed. Check your GeoJSON structure.");
        }
      } else {
        root.DB.MapAssets.save({
          name: file.name,
          kind: lower.endsWith(".svg") ? "svg" : "png",
          note: "Asset stored for future calibrated floor-plan registration.",
        });
        showToast("Asset catalogued for later map registration.");
      }

      renderAssets();
      input.value = "";
    });
  }

  function renderChannelResults(results) {
    const list = byId("ecChannelList");
    list.innerHTML = results.map((result, index) => `
      <div class="ec-channel-item">
        <strong>${escapeHtml(channelAdapters[index].channel.toUpperCase())}</strong><br />
        <span>Status: ${escapeHtml(result.status || "queued-placeholder")}</span><br />
        <span>${escapeHtml(result.note || result.preview || "Ready for backend integration.")}</span>
      </div>
    `).join("");
  }

  async function initNavigation() {
    navigationEngine = new root.SmartIndoorNavigation.NavigationEngine({
      containerId: "navigationAdminMap",
      maplibre: root.maplibregl,
      initialFloor: 2,
    });
    await navigationEngine.init();
    navigationEngine.loadIndoorMap(root.SmartIndoorNavigation.EXAMPLE_INDOOR_MAP);
    navigationEngine.setUserPosition({
      coordinates: [77.59460, 12.97183],
      floor: 2,
      label: "Room 201",
    });
    runSimulation(false);
  }

  function bindEvents() {
    byId("ecAlertForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await publishAlert();
      } catch (error) {
        console.error(error);
        showToast("Broadcast failed. Check backend connectivity.");
      }
    });

    byId("ecUpdateBtn").addEventListener("click", async () => {
      try {
        await updateActiveAlert();
      } catch (error) {
        console.error(error);
        showToast("Update failed.");
      }
    });

    byId("ecCancelBtn").addEventListener("click", async () => {
      await cancelActiveAlert();
    });

    byId("ecRefreshPreviewBtn").addEventListener("click", async () => {
      await refreshMultilingualPreview();
      showToast("Preview refreshed.");
    });

    byId("ecPreviewLanguage").addEventListener("change", () => {
      const fallback = buildSourceMessage(readFormState(), lastPlan);
      updateTranslationPreview(translationsCache, fallback);
    });

    ["ecEmergencyType", "ecSeverity", "ecRoom", "ecLocation", "ecAffectedZones", "ecInstructions"].forEach((id) => {
      byId(id).addEventListener("input", () => {
        clearTimeout(refreshPreviewTimer);
        refreshPreviewTimer = setTimeout(() => {
          refreshMultilingualPreview().catch(() => {});
        }, 400);
      });
    });

    byId("ecFloorSelect").addEventListener("change", () => {
      navigationEngine.setActiveFloor(Number(byId("ecFloorSelect").value));
      runSimulation(false);
    });

    byId("ecSimulateRouteBtn").addEventListener("click", () => {
      runSimulation(true);
    });

    byId("ecApplyMapStateBtn").addEventListener("click", () => {
      applyMapState();
      runSimulation(true);
    });

    byId("ecResetMapBtn").addEventListener("click", () => {
      byId("ecUnsafeZoneSelect").value = "";
      byId("ecDisabledExitSelect").value = "";
      byId("ecCrowdModelSelect").value = "normal";
      navigationEngine.updateDynamicConditions({
        crowdByEdgeId: {},
        unsafeZoneIds: [],
        unsafeExitIds: [],
        crowdedExitIds: [],
        blockedEdgeIds: [],
      });
      runSimulation(true);
    });
  }

  function subscribeLiveUpdates() {
    root.EmergencyService.subscribe((_event, _payload, state) => {
      updateLiveBanner(state.currentAlert);
      syncFormWithAlert(state.currentAlert);
    });
  }

  async function init() {
    if (!ensureAuthorized()) return;

    populateEmergencyTypes();
    multilingualService = root.MultilingualCommunication.createService({
      translationProxyUrl: AlertOrbitConfig.TRANSLATE_ENDPOINT,
    });
    channelAdapters = [
      root.SMSAdapterFactory.createSmsAdapter(),
      root.WhatsAppAdapterFactory.createWhatsappAdapter(),
      root.VoiceAdapterFactory.createVoiceAdapter(),
      root.PushAdapterFactory.createPushAdapter(),
      root.EmailAdapterFactory.createEmailAdapter(),
    ];

    root.EmergencyService.init();
    subscribeLiveUpdates();
    bindEvents();
    handleUploads();
    renderAssets();
    renderChannels();
    await initNavigation();
    await refreshMultilingualPreview();
    updateLiveBanner(getCurrentAlert());
    syncFormWithAlert(getCurrentAlert());
  }

  document.addEventListener("DOMContentLoaded", init);
})(typeof window !== "undefined" ? window : globalThis);
