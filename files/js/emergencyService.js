/**
 * emergencyService.js
 *
 * Shared frontend service for live emergency alerts, REST access, and
 * websocket synchronization. Uses backend proxy routes so API keys stay off
 * the client.
 */

(function attachEmergencyService(root) {
  "use strict";

  const ACTIVE_STATUSES = new Set(["BROADCASTING", "ACTIVE"]);
  const listeners = new Set();

  let socket = null;
  let socketHeartbeat = null;
  let reconnectTimer = null;
  let initialized = false;
  let currentAlert = null;
  let activeAlerts = [];

  function getSessionActor() {
    const session = root.DB?.Session?.get?.() || null;
    if (!session) return null;
    return {
      user_id: session.id,
      name: session.name,
      role: session.role,
    };
  }

  function notifyListeners(eventName, payload) {
    listeners.forEach((listener) => {
      try {
        listener(eventName, payload, { currentAlert, activeAlerts });
      } catch (error) {
        console.error("EmergencyService listener error", error);
      }
    });
  }

  function normalizeCurrentAlert() {
    currentAlert = activeAlerts.find((alert) => ACTIVE_STATUSES.has(alert.status)) || null;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Request failed with ${response.status}`);
    }
    return response.json();
  }

  async function fetchActiveAlert() {
    const payload = await request(AlertOrbitConfig.EMERGENCY_ALERTS_ENDPOINT);
    activeAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    currentAlert = payload.activeAlert || activeAlerts.find((alert) => ACTIVE_STATUSES.has(alert.status)) || null;
    console.log("Firestore read status:", { count: activeAlerts.length, activeAlert: currentAlert });
    notifyListeners("snapshot", payload);
    return payload;
  }

  async function listAlerts(status) {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    const payload = await request(`${AlertOrbitConfig.EMERGENCY_ALERTS_ENDPOINT}${suffix}`);
    return payload.alerts || [];
  }

  function isAuthorizedToManage(alert) {
    const session = root.DB?.Session?.get?.() || null;
    if (!session || !alert) return false;
    const elevatedRoles = new Set([
      "Admin",
      "Administrator",
      "Dispatcher",
      "Coordinator",
      "Emergency Coordinator",
      "Security",
      "Fire",
      "Medical",
    ]);
    return elevatedRoles.has(session.role) || alert.triggeredBy?.userId === session.id;
  }

  async function createAlert(payload) {
    const actor = getSessionActor();
    if (!actor) {
      throw new Error("A staff session is required to broadcast an emergency.");
    }

    console.log("Emergency payload:", payload);
    const response = await request(AlertOrbitConfig.EMERGENCY_ALERTS_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        actor,
      }),
    });
    console.log("Firestore write status:", response);
    await fetchActiveAlert();
    return response.alert;
  }

  async function updateAlert(alertId, patch) {
    const actor = getSessionActor();
    if (!actor) {
      throw new Error("A staff session is required to update an emergency.");
    }

    console.log("Emergency update payload:", { alertId, patch });
    const response = await request(`${AlertOrbitConfig.EMERGENCY_ALERTS_ENDPOINT}/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...patch,
        actor,
      }),
    });
    console.log("Firestore update status:", response);
    await fetchActiveAlert();
    return response.alert;
  }

  async function endAlert(alertId, status) {
    return updateAlert(alertId, { status });
  }

  async function translatePreview(text, languages = AlertOrbitConfig.SUPPORTED_LANGUAGES) {
    return request(AlertOrbitConfig.TRANSLATE_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        text,
        target_languages: languages,
        source_language: "en",
      }),
    });
  }

  function handleSocketMessage(message) {
    if (!message) return;

    if (message.event === "snapshot") {
      activeAlerts = message.activeAlerts || [];
      currentAlert = message.alert || null;
      console.log("Snapshot listener update:", message);
      notifyListeners("snapshot", message);
      return;
    }

    if (message.alert) {
      const existingIndex = activeAlerts.findIndex((alert) => alert.id === message.alert.id);
      if (ACTIVE_STATUSES.has(message.alert.status)) {
        if (existingIndex >= 0) activeAlerts[existingIndex] = message.alert;
        else activeAlerts.unshift(message.alert);
      } else {
        activeAlerts = activeAlerts.filter((alert) => alert.id !== message.alert.id);
      }
      normalizeCurrentAlert();
      console.log("Snapshot listener event:", message.event || "alert", message.alert);
      notifyListeners(message.event || "alert", message.alert);
    }
  }

  function connectSocket() {
    if (socket) return;

    socket = new WebSocket(AlertOrbitConfig.EMERGENCY_WS_URL);
    socket.addEventListener("open", () => {
      clearInterval(socketHeartbeat);
      socketHeartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 20000);
      console.log("Emergency websocket connected");
      notifyListeners("socket_open", null);
    });

    socket.addEventListener("message", (event) => {
      try {
        handleSocketMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Emergency websocket parse error", error);
      }
    });

    socket.addEventListener("close", () => {
      socket = null;
      clearInterval(socketHeartbeat);
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectSocket();
        }, 2500);
      }
      console.log("Emergency websocket closed");
      notifyListeners("socket_close", null);
    });

    socket.addEventListener("error", () => {
      console.log("Emergency websocket error");
      notifyListeners("socket_error", null);
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    connectSocket();
    fetchActiveAlert().catch((error) => {
      console.warn("Initial emergency snapshot failed", error);
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const EmergencyService = {
    ACTIVE_STATUSES,
    init,
    subscribe,
    fetchActiveAlert,
    listAlerts,
    createAlert,
    updateAlert,
    endAlert,
    translatePreview,
    getCurrentAlert() {
      return currentAlert;
    },
    getActiveAlerts() {
      return activeAlerts.slice();
    },
    getSessionActor,
    isAuthorizedToManage,
  };

  root.EmergencyService = EmergencyService;
})(typeof window !== "undefined" ? window : globalThis);
