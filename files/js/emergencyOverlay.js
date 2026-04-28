/**
 * emergencyOverlay.js
 *
 * Staff-only full-screen emergency popup.
 * This must only initialize on the dedicated emergency control page
 * after a valid staff session exists.
 */

(function attachEmergencyOverlay(root) {
  "use strict";

  const LABELS = {
    en: {
      active: "ACTIVE EMERGENCY",
      type: "Emergency Type",
      severity: "Severity",
      location: "Location",
      instructions: "Instructions",
      exit: "Nearest Safe Exit",
      route: "Evacuation Route",
      timestamp: "Updated",
      controlled: "Only authorized staff can resolve or cancel this emergency.",
      resolve: "Resolve Emergency",
      cancel: "Cancel Emergency",
    },
  };

  let selectedLanguage = "en";
  let elements = null;
  let currentAlert = null;

  function hasStaffSession() {
    try {
      return Boolean(root.DB?.Session?.isLoggedIn?.());
    } catch {
      return false;
    }
  }

  function isEmergencyControlPage() {
    const path = String(root.location?.pathname || "").toLowerCase();
    return (
      path.endsWith("/emergency-control.html") ||
      path.includes("/staff/emergency-control.html")
    );
  }

  function shouldInitOverlay() {
    return hasStaffSession() && isEmergencyControlPage() && root.EmergencyService;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  function buildOverlay() {
    if (document.getElementById("aoEmergencyOverlay")) return;

    const container = document.createElement("div");
    container.id = "aoEmergencyOverlay";
    container.className = "ao-emergency-overlay";
    container.hidden = true;
    container.innerHTML = `
      <div class="ao-emergency-card" role="dialog" aria-modal="true" aria-labelledby="aoEmergencyTitle">
        <div class="ao-emergency-card__glow"></div>
        <header class="ao-emergency-card__header">
          <div class="ao-emergency-status">
            <span class="ao-emergency-status__pulse"></span>
            <span id="aoEmergencyStatus">ACTIVE EMERGENCY</span>
          </div>
          <div class="ao-emergency-tools">
            <label class="ao-emergency-tools__label" for="aoEmergencyLanguage">Language</label>
            <select id="aoEmergencyLanguage" class="ao-emergency-select">
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ar">Arabic</option>
              <option value="zh-CN">Chinese</option>
              <option value="fr">French</option>
            </select>
          </div>
        </header>
        <div class="ao-emergency-card__body">
          <section class="ao-emergency-summary">
            <div class="ao-emergency-icon" aria-hidden="true">!</div>
            <div>
              <p class="ao-emergency-kicker" id="aoEmergencySeverityBadge">HIGH PRIORITY</p>
              <h2 id="aoEmergencyTitle">Emergency Alert</h2>
              <p id="aoEmergencyTimestamp"></p>
            </div>
          </section>
          <section class="ao-emergency-grid">
            <article class="ao-emergency-panel">
              <span class="ao-emergency-panel__label" id="aoLabelType">Emergency Type</span>
              <strong id="aoEmergencyType"></strong>
            </article>
            <article class="ao-emergency-panel">
              <span class="ao-emergency-panel__label" id="aoLabelSeverity">Severity</span>
              <strong id="aoEmergencySeverity"></strong>
            </article>
            <article class="ao-emergency-panel">
              <span class="ao-emergency-panel__label" id="aoLabelLocation">Location</span>
              <strong id="aoEmergencyLocation"></strong>
            </article>
            <article class="ao-emergency-panel">
              <span class="ao-emergency-panel__label" id="aoLabelExit">Nearest Safe Exit</span>
              <strong id="aoEmergencyExit"></strong>
            </article>
          </section>
          <section class="ao-emergency-copy">
            <div class="ao-emergency-copy__block">
              <span class="ao-emergency-panel__label" id="aoLabelInstructions">Instructions</span>
              <p id="aoEmergencyInstructions"></p>
            </div>
            <div class="ao-emergency-copy__block">
              <span class="ao-emergency-panel__label" id="aoLabelRoute">Evacuation Route</span>
              <p id="aoEmergencyRoute"></p>
            </div>
          </section>
          <div class="ao-emergency-controls">
            <p class="ao-emergency-controls__text" id="aoEmergencyControlText"></p>
            <div class="ao-emergency-controls__actions" id="aoEmergencyActions" hidden>
              <button type="button" id="aoResolveBtn" class="ao-action-btn ao-action-btn--resolve">Resolve Emergency</button>
              <button type="button" id="aoCancelBtn" class="ao-action-btn ao-action-btn--cancel">Cancel Emergency</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    elements = {
      container,
      status: container.querySelector("#aoEmergencyStatus"),
      title: container.querySelector("#aoEmergencyTitle"),
      timestamp: container.querySelector("#aoEmergencyTimestamp"),
      severityBadge: container.querySelector("#aoEmergencySeverityBadge"),
      type: container.querySelector("#aoEmergencyType"),
      severity: container.querySelector("#aoEmergencySeverity"),
      location: container.querySelector("#aoEmergencyLocation"),
      exit: container.querySelector("#aoEmergencyExit"),
      instructions: container.querySelector("#aoEmergencyInstructions"),
      route: container.querySelector("#aoEmergencyRoute"),
      language: container.querySelector("#aoEmergencyLanguage"),
      controlsText: container.querySelector("#aoEmergencyControlText"),
      actions: container.querySelector("#aoEmergencyActions"),
      resolveBtn: container.querySelector("#aoResolveBtn"),
      cancelBtn: container.querySelector("#aoCancelBtn"),
      labels: {
        type: container.querySelector("#aoLabelType"),
        severity: container.querySelector("#aoLabelSeverity"),
        location: container.querySelector("#aoLabelLocation"),
        instructions: container.querySelector("#aoLabelInstructions"),
        exit: container.querySelector("#aoLabelExit"),
        route: container.querySelector("#aoLabelRoute"),
      },
    };

    elements.language.addEventListener("change", () => {
      selectedLanguage = elements.language.value;
      renderAlert(currentAlert);
    });

    elements.resolveBtn.addEventListener("click", async () => {
      if (!currentAlert) return;
      try {
        await root.EmergencyService.endAlert(currentAlert.id, "RESOLVED");
      } catch (error) {
        console.error(error);
      }
    });

    elements.cancelBtn.addEventListener("click", async () => {
      if (!currentAlert) return;
      try {
        await root.EmergencyService.endAlert(currentAlert.id, "CANCELLED");
      } catch (error) {
        console.error(error);
      }
    });
  }

  function getStrings() {
    return LABELS[selectedLanguage] || LABELS.en;
  }

  function getTranslatedText(alert) {
    if (!alert) return "";
    return (
      alert.translations?.[selectedLanguage]?.text ||
      alert.translations?.en?.text ||
      alert.sourceText ||
      alert.instructions ||
      ""
    );
  }

  function renderAlert(alert) {
    currentAlert = alert || null;
    if (!elements) buildOverlay();

    if (!currentAlert || !root.EmergencyService.ACTIVE_STATUSES.has(currentAlert.status)) {
      elements.container.hidden = true;
      return;
    }

    const strings = getStrings();
    const severity = String(currentAlert.severity || "medium").toUpperCase();
    const timestamp = new Date(currentAlert.updatedAt || currentAlert.createdAt).toLocaleString();

    elements.container.hidden = false;
    elements.container.dataset.status = String(currentAlert.status || "ACTIVE").toLowerCase();
    elements.status.textContent = strings.active;
    elements.title.textContent = currentAlert.emergencyType || "Emergency Alert";
    elements.timestamp.textContent = `${strings.timestamp}: ${timestamp}`;
    elements.severityBadge.textContent = `${severity} PRIORITY`;
    elements.type.innerHTML = escapeHtml(currentAlert.emergencyType || "Emergency");
    elements.severity.innerHTML = escapeHtml(severity);
    elements.location.innerHTML = escapeHtml(currentAlert.location || "Unknown location");
    elements.exit.innerHTML = escapeHtml(currentAlert.nearestSafeExit || "Await staff guidance");
    elements.instructions.innerHTML = escapeHtml(getTranslatedText(currentAlert));
    elements.route.innerHTML = escapeHtml(
      currentAlert.routeGuidance || currentAlert.instructions || "Follow marked evacuation guidance."
    );
    elements.controlsText.textContent = strings.controlled;
    elements.labels.type.textContent = strings.type;
    elements.labels.severity.textContent = strings.severity;
    elements.labels.location.textContent = strings.location;
    elements.labels.instructions.textContent = strings.instructions;
    elements.labels.exit.textContent = strings.exit;
    elements.labels.route.textContent = strings.route;
    elements.resolveBtn.textContent = strings.resolve;
    elements.cancelBtn.textContent = strings.cancel;

    const canManage = root.EmergencyService.isAuthorizedToManage(currentAlert);
    elements.actions.hidden = !canManage;
  }

  function init() {
    if (!shouldInitOverlay()) return;
    buildOverlay();
    root.EmergencyService.init();
    root.EmergencyService.subscribe((_eventName, _payload, state) => {
      renderAlert(state.currentAlert);
    });
    renderAlert(root.EmergencyService.getCurrentAlert());
  }

  document.addEventListener("DOMContentLoaded", init);
})(typeof window !== "undefined" ? window : globalThis);
