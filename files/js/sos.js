/**
 * sos.js
 *
 * SOS state machine:
 * idle -> countdown -> voice -> active -> idle
 */

const SOSEngine = (() => {
  let state = "idle";
  let countdownTimer = null;
  let seconds = 5;
  let currentAlert = null;
  const ALERT_CREATE_ENDPOINT = `${AlertOrbitConfig.API_BASE}/api/emergency/alerts`;

  const byId = (id) => document.getElementById(id);
  const CIRCUMFERENCE = 2 * Math.PI * 70;

  function showOverlay(id) {
    ["countdownOverlay", "voiceOverlay", "activeOverlay"].forEach((overlayId) => {
      const element = byId(overlayId);
      if (element) element.hidden = overlayId !== id;
    });
  }

  function hideAllOverlays() {
    ["countdownOverlay", "voiceOverlay", "activeOverlay"].forEach((overlayId) => {
      const element = byId(overlayId);
      if (element) element.hidden = true;
    });
  }

  function triggerSOS() {
    if (state !== "idle") return;
    state = "countdown";
    seconds = 3;
    showOverlay("countdownOverlay");
    updateCountdownUI(3);
    vibrate([100, 50, 100]);

    countdownTimer = setInterval(() => {
      seconds -= 1;
      updateCountdownUI(seconds);
      vibrate([80]);
      if (seconds <= 0) {
        clearInterval(countdownTimer);
        proceedToVoice();
      }
    }, 1000);
  }

  function abortSOS() {
    if (state !== "countdown") return;
    clearInterval(countdownTimer);
    state = "idle";
    hideAllOverlays();
    vibrate([50, 30, 50]);
    showToast("Alert aborted");

    if (currentAlert) {
      DB.Alerts.updateStatus(currentAlert.id, "aborted");
      currentAlert = null;
    }
    updateTicker("Alert aborted. System ready.");
  }

  function proceedToVoice() {
    state = "voice";
    showOverlay("voiceOverlay");
    vibrate([200, 100, 200]);

    if (!window.VoiceService || typeof VoiceService.start !== "function") {
      const typedProblem = String(byId("problem-input")?.value || "").trim();
    activateSOS("Unknown", "Emergency Services (112)", typedProblem);
      return;
    }

    VoiceService.start((type, agency, transcript) => {
      handleVoiceResult(type, agency, transcript);
    });

    setTimeout(() => {
      if (state !== "voice") return;
      const typedProblem = String(byId("problem-input")?.value || "").trim();
      handleVoiceResult("Unknown", "Emergency Services (112)", typedProblem);
    }, 15000);
  }

  function handleVoiceResult(type, agency, transcript) {
    if (state !== "voice") return;
    if (window.VoiceService && typeof VoiceService.stop === "function") {
      VoiceService.stop();
    }
    activateSOS(type, agency, transcript);
  }

  function skipVoice() {
    if (state !== "voice") return;
    if (window.VoiceService && typeof VoiceService.stop === "function") {
      VoiceService.stop();
    }
    const typedProblem = String(byId("problem-input")?.value || "").trim();
    activateSOS("Unknown", "Emergency Services (112)", typedProblem);
  }

  function activateSOS(type, agency, transcript) {
    const coords = window.LocationService?.getCoords?.() || { lat: null, lng: null };
    const address = window.LocationService?.getAddress?.() || "Location unavailable";
    const roomInput = byId("room-input");
    const problemInput = byId("problem-input");
    const problemText = String(problemInput?.value || "").trim();
    const combinedText = [transcript, problemText].filter(Boolean).join(" ").trim();
    const detected = _detectEmergencyFromText(combinedText);
    const finalType = type && type !== "Unknown" ? type : detected.type;
    const finalAgency = agency && agency !== "Emergency Services (112)" ? agency : detected.agency;
    const typedRoom = _normalizeRoomNumber(roomInput?.value || "");
    const spokenRoom = _extractRoomNumber(combinedText);
    const roomNumber = typedRoom || spokenRoom;

    if (!roomNumber) {
      showToast("Please type or say a room number like 301 before sending the alert.");
      updateTicker("Room number required before dispatch.");
      return;
    }

    state = "active";
    const floorNumber = _inferFloorFromRoom(roomNumber);
    const incidentSummary = problemText || transcript || `${finalType} reported from room ${roomNumber}.`;

    currentAlert = DB.Alerts.create(finalType, address, coords.lat, coords.lng, transcript, {
      roomNumber,
      floorNumber,
      incidentSummary,
      metadata: {
        source: "sos-overlay",
        enteredProblem: problemText,
      },
    });
    _syncAlertToBackend(currentAlert)
      .then(() => {
        try {
          localStorage.setItem("ao_alert_history_refresh", String(Date.now()));
        } catch (error) {
          console.warn("Unable to notify dashboard about new alert", error);
        }
      })
      .catch((error) => {
        console.warn("Backend alert sync failed", error);
        showToast(_describeBackendFailure(error));
      });

    if (transcript) {
      DB.Voice.save(currentAlert.id, transcript, finalType, address);
    }

    DB.Notifs.add(
      `SOS Alert - ${finalType}`,
      `Room ${roomNumber} · ${address} · Time: ${new Date().toLocaleTimeString()}`,
      "sos"
    );

    showOverlay("activeOverlay");
    populateActiveOverlay(finalType, finalAgency, address);
    vibrate([300, 100, 300, 100, 500]);
    updateTicker(`ACTIVE SOS - ${finalType} - Room ${roomNumber} - ${address} - Dispatching ${finalAgency}`);

    const tickerTrack = byId("tickerTrack");
    if (tickerTrack) {
      const message = `ACTIVE SOS ALERT · ${finalType.toUpperCase()} · ROOM ${roomNumber} · ${address} · ${finalAgency} dispatched · `;
      tickerTrack.innerHTML = `<span>${message}${message}</span>`;
    }

    setTimeout(() => {
      const voiceRow = byId("anVoice");
      if (voiceRow && transcript) {
        voiceRow.querySelector(".an-dot").className = "an-dot an-dot--green";
        voiceRow.classList.remove("an-row--pending");
      }
    }, 1500);

    sendBrowserNotif(finalType, `Room ${roomNumber} · ${address}`);
  }

  function populateActiveOverlay(type, agency, address) {
    const formatTime = (value) => (value ? value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-");
    const set = (id, value) => {
      const element = byId(id);
      if (element) element.textContent = value;
    };

    set("activeType", type);
    set("activeAgency", agency);
    set("activeId", currentAlert ? currentAlert.id.slice(-6).toUpperCase() : "-");
    set("activeTime", formatTime(new Date()));
    set("activeLocation", address || "Sharing your location...");
  }

  function resolveSOS() {
    if (state !== "active" || !currentAlert) return;
    DB.Alerts.updateStatus(currentAlert.id, "resolved");
    _syncStatusToBackend(currentAlert, "Resolved").catch((error) => {
      console.warn("Backend resolve sync failed", error);
    });
    DB.CtrlLog.add("RESOLVED", `Alert #${currentAlert.id.slice(-6).toUpperCase()} marked resolved`, "User");
    currentAlert = null;
    state = "idle";
    hideAllOverlays();
    showToast("Emergency resolved");
    updateTicker("Alert resolved. System monitoring. All clear.");
  }

  function updateCountdownUI(value) {
    const number = byId("crNumber");
    const fill = byId("crFill");
    const desc = byId("ovDesc");

    if (number) number.textContent = value > 0 ? value : "!";
    if (fill) {
      const progress = (5 - value) / 5;
      fill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    }
    if (desc) {
      const messages = [
        "Sharing location and alerting services...",
        "Contacting emergency responders...",
        "Dispatching nearest units...",
        "Alert imminent...",
        "Sending now...",
      ];
      desc.textContent = messages[5 - value] || messages[0];
    }
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function updateTicker(message) {
    const ticker = byId("tickerTrack");
    if (ticker) ticker.innerHTML = `<span>${message} · ${message} · </span>`;
  }

  function sendBrowserNotif(type, address) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("SOS Alert Sent", {
      body: `Emergency type: ${type}\nLocation: ${address}`,
      icon: "/favicon.ico",
      tag: "sos-alert",
    });
  }

  async function _syncAlertToBackend(alert) {
    const payload = {
      crisis_type: alert.crisisType,
      severity: alert.severity,
      room_number: String(alert.roomNumber || "").trim(),
      floor_number: Number(alert.floorNumber || _inferFloorFromRoom(alert.roomNumber)),
      reported_by: alert.reportedBy || "Guest SOS",
      status: alert.status || "Active",
      assigned_response_team: alert.assignedResponseTeam || "Emergency Coordination Team",
      evacuation_status: alert.evacuationStatus || "Guidance Active",
      route_status: alert.routeStatus || "safe",
      nearest_safe_exit: alert.nearestSafeExit || "North Safe Exit",
      details: alert.incidentSummary || alert.transcript || "SOS alert received.",
      metadata: {
        source: "sos-overlay",
        location: alert.location,
      },
    };

    const response = await fetch(ALERT_CREATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Alert create failed with ${response.status}`);
    }
    const result = await response.json();
    currentAlert.backendAlertId = result?.data?.alertId || null;

    const firestoreSync = result?.firestoreSync;
    if (firestoreSync && !firestoreSync.ok) {
      const firestoreError = firestoreSync.error || firestoreSync.reason || "unknown_firestore_error";
      throw new Error(`Firestore sync failed: ${firestoreError}`);
    }

    return result;
  }

  async function _syncStatusToBackend(alert, status) {
    if (!alert?.backendAlertId) return;
    const response = await fetch(`${ALERT_CREATE_ENDPOINT}/${encodeURIComponent(alert.backendAlertId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Alert status update failed with ${response.status}`);
    }
    return response.json();
  }

  function _normalizeRoomNumber(value) {
    const cleaned = String(value || "").trim().toUpperCase();
    if (!cleaned) return "";

    const directRoom = cleaned.match(/\b([A-Z]?\d{2,4}[A-Z]?)\b/);
    if (directRoom?.[1]) return directRoom[1];

    const spokenDigits = _spokenNumberToDigits(cleaned);
    if (spokenDigits.length >= 3) return spokenDigits.slice(0, 4);

    return "";
  }

  function _inferFloorFromRoom(roomNumber) {
    const digits = String(roomNumber || "").match(/\d+/);
    if (!digits) return 1;
    return Number(String(digits[0][0])) || 1;
  }

  function _extractRoomNumber(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";

    const roomPhraseMatch = normalized.match(/\broom(?:\s+number|\s+no\.?|\s+#)?\s*([a-z]?\d{2,4}[a-z]?)/i);
    if (roomPhraseMatch?.[1]) return roomPhraseMatch[1].toUpperCase();

    const spokenPhraseMatch = normalized.match(/\broom(?:\s+number|\s+no\.?|\s+#)?\s+([a-z\s-]+)/i);
    if (spokenPhraseMatch?.[1]) {
      const spokenDigits = _spokenNumberToDigits(spokenPhraseMatch[1]);
      if (spokenDigits.length >= 3) return spokenDigits.slice(0, 4);
    }

    const bareNumberMatch = normalized.match(/\b([1-9]\d{2,3}[a-z]?)\b/i);
    if (bareNumberMatch?.[1]) return bareNumberMatch[1].toUpperCase();

    const spokenAnyDigits = _spokenNumberToDigits(normalized);
    if (spokenAnyDigits.length >= 3) return spokenAnyDigits.slice(0, 4);

    return "";
  }

  function _describeBackendFailure(error) {
    const message = String(error?.message || error || "");
    if (/matching active alert already exists/i.test(message)) {
      return "This room already has an active alert in staff history.";
    }
    if (/room was not found/i.test(message)) {
      return "That room number is not available in the staff database yet.";
    }
    if (/firebase_not_initialized/i.test(message)) {
      return "Firebase did not start in the backend. Restart the backend and check the service account file.";
    }
    if (/missing_alert_id/i.test(message)) {
      return "Alert was created without a valid Firestore document id.";
    }
    if (/firestore_write_failed/i.test(message) || /Firestore sync failed/i.test(message)) {
      return "Alert reached the backend, but Cloud Firestore rejected the write. Check the backend terminal for the exact Firebase error.";
    }
    return "Alert reached this screen, but staff history could not save it. Please make sure the backend is running.";
  }

  function _detectEmergencyFromText(text) {
    if (window.VoiceService && typeof window.VoiceService.detectType === "function") {
      return window.VoiceService.detectType(text || "");
    }
    return { type: "Unknown", agency: "Emergency Services (112)" };
  }

  function _spokenNumberToDigits(text) {
    const parts = String(text || "")
      .toLowerCase()
      .replace(/[^a-z\s-]/g, " ")
      .split(/[\s-]+/)
      .filter(Boolean);

    const map = {
      zero: "0",
      oh: "0",
      o: "0",
      one: "1",
      two: "2",
      to: "2",
      too: "2",
      three: "3",
      four: "4",
      for: "4",
      five: "5",
      six: "6",
      seven: "7",
      eight: "8",
      ate: "8",
      nine: "9",
    };

    return parts.map((part) => map[part] || "").join("");
  }

  return {
    triggerSOS,
    abortSOS,
    skipVoice,
    resolveSOS,
    getState() {
      return state;
    },
    getCurrentAlert() {
      return currentAlert;
    },
  };
})();

window.SOSEngine = SOSEngine;
