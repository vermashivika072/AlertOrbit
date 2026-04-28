/**
 * dashboard.js - Staff dashboard controller
 * Handles: auth guard, view switching, alert intelligence, voice logs,
 * metrics, notifications, and shared UI state.
 */

;(function guardAuth() {
  if (!DB.Session.isLoggedIn()) {
    window.location.href = "staff-login.html";
  }
})();

let _currentView = "overview";
let _alertCache = [];
let _activeAlertDetailId = null;
let _usingBackendAlerts = false;
let _alertHistoryError = "";
let _alertHistoryPoller = null;
const _validDashboardViews = new Set(["overview", "alerts", "voice"]);
const _alertViewState = {
  page: 1,
  pageSize: 6,
  sortKey: "createdAt",
  sortDir: "desc",
  totalFiltered: 0,
};
const ALERT_HISTORY_ENDPOINT = `${AlertOrbitConfig.API_BASE}/api/emergency/alerts/history`;
const ALERT_STATUS_ENDPOINT = (alertId) =>
  `${AlertOrbitConfig.API_BASE}/api/emergency/alerts/${encodeURIComponent(alertId)}/status`;
const ALERT_HISTORY_REFRESH_MS = 5000;

document.addEventListener("DOMContentLoaded", () => {
  _loadUserInfo();
  _bindDashboardInteractions();
  _primeAlertHistory().finally(() => {
    const requestedView = _getRequestedDashboardView();
    if (requestedView === "overview") {
      refreshDashboard();
      _syncTopbarUtilityState();
    } else {
      switchView(requestedView);
    }
  });

  if (window.NotifService && typeof window.NotifService.init === "function") {
    window.NotifService.init();
  }

  document.addEventListener("click", (event) => {
    const panel = document.getElementById("notifPanel");
    const bell = document.getElementById("topbarBell");
    if (panel && bell && !panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) {
      panel.hidden = true;
    }

    const sidebar = document.getElementById("sidebar");
    const menuBtn = document.getElementById("menuBtn");
    if (sidebar && menuBtn && sidebar.classList.contains("open") && !sidebar.contains(event.target) && !menuBtn.contains(event.target)) {
      sidebar.classList.remove("open");
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "ao_alert_history_refresh") {
      _refreshAlertHistory({ silent: false });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      _refreshAlertHistory({ silent: true });
    }
  });

  _startAlertHistoryPolling();
});

function _bindDashboardInteractions() {
  _bindOverlayDismiss("alertDetailModal", closeAlertDetailModal);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAlertDetailModal();
  });
}

function _bindOverlayDismiss(id, onClose) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) onClose();
  });
}

function refreshDashboard() {
  if (_currentView === "overview") _renderOverview();
  if (_currentView === "alerts") _renderAlertTable();
  if (_currentView === "voice") _renderVoiceLogs();

  _updateMetrics();
  _updateSidebarBadge();
}
window.refreshDashboard = refreshDashboard;

function switchView(view) {
  _currentView = _normalizeDashboardView(view);

  document.querySelectorAll(".sb-link").forEach((link) => {
    const isActive = link.dataset.view === _currentView;
    link.classList.toggle("sb-link--active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });

  const titles = {
    overview: "Overview",
    alerts: "Alert History",
    voice: "Voice Logs",
  };
  _setText("topbarTitle", titles[_currentView] || "Dashboard");

  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = true;
  });

  const target = document.getElementById("view" + _currentView.charAt(0).toUpperCase() + _currentView.slice(1));
  if (target) target.hidden = false;

  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");

  const renderers = {
    overview: _renderOverview,
    alerts: _renderAlertTable,
    voice: _renderVoiceLogs,
  };
  _setDashboardViewUrl(_currentView);
  _syncTopbarUtilityState();
  if (renderers[_currentView]) renderers[_currentView]();
  return false;
}
window.switchView = switchView;

function openAlertHistory() {
  return switchView("alerts");
}
window.openAlertHistory = openAlertHistory;

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.toggle("open");
}
window.toggleSidebar = toggleSidebar;

function _normalizeDashboardView(view) {
  return _validDashboardViews.has(view) ? view : "overview";
}

function _getRequestedDashboardView() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("view");
  const fromHash = (window.location.hash || "").replace(/^#/, "");
  return _normalizeDashboardView(fromQuery || fromHash || "overview");
}

function _setDashboardViewUrl(view) {
  const url = new URL(window.location.href);
  if (view === "overview") {
    url.searchParams.delete("view");
    url.hash = "";
  } else {
    url.searchParams.set("view", view);
    url.hash = "";
  }
  window.history.replaceState({}, "", url);
}

function _syncTopbarUtilityState() {
  document.querySelectorAll("[data-topbar-view]").forEach((link) => {
    const isActive = link.dataset.topbarView === _currentView;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function _loadUserInfo() {
  const user = DB.Session.get();
  if (!user) return;
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  _setText("sbAvatar", initials);
  _setText("sbUname", user.name);
  _setText("sbUrole", user.role || "Staff");
}

function _updateMetrics() {
  const stats = _getAlertStats();
  _setText("metActive", stats.active);
  _setText("metToday", stats.today);
  _setText("metResolved", stats.resolved);
  _setText("metVoice", DB.Voice.getAll().length);
}

function _renderOverview() {
  _updateMetrics();
  _renderFeed("overviewFeed", _getDashboardAlerts().slice(0, 8));
  _renderTypeChart();
  _updateSidebarBadge();
  _renderAlertSummary(_getDashboardAlerts());
}

function _renderFeed(containerId, alerts) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!alerts.length) {
    container.innerHTML = '<p class="feed-empty">No alerts yet. Monitoring...</p>';
    return;
  }

  container.innerHTML = alerts
    .map((alertItem) => {
      const alert = DB.Alerts.format(alertItem);
      return `
        <div class="feed-item">
          <div class="fi-dot fi-dot--${alert.statusSlug}"></div>
          <div class="fi-body">
            <div class="fi-type">${_esc(alert.crisisType)} · ${_esc(alert.severity)}</div>
            <div class="fi-meta">Floor ${_esc(alert.floorNumber)} · Room ${_esc(alert.roomNumber)} · ${_esc(alert.assignedResponseTeam)}</div>
          </div>
          <div class="fi-time">${alert.timeFormatted}</div>
          <div class="fi-status fi-status--${alert.statusSlug}">${_esc(alert.status)}</div>
        </div>
      `;
    })
    .join("");
}

function _renderTypeChart() {
  const chart = document.getElementById("typeChart");
  if (!chart) return;

  const stats = _getAlertStats();
  const total = Math.max(1, Object.values(stats.types).reduce((sum, value) => sum + value, 0));
  const types = [
    { key: "Fire", cls: "fire" },
    { key: "Gas Leak", cls: "medical" },
    { key: "Smoke Detection", cls: "unknown" },
    { key: "Medical Emergency", cls: "medical" },
    { key: "Security Threat", cls: "crime" },
    { key: "Electrical Failure", cls: "unknown" },
  ];

  chart.innerHTML = types
    .map((type) => {
      const count = stats.types[type.key] || 0;
      const pct = Math.round((count / total) * 100);
      return `
        <div class="tc-row">
          <span class="tc-label">${_esc(type.key)}</span>
          <div class="tc-bar-wrap">
            <div class="tc-bar tc-bar--${type.cls}" style="width:${pct}%"></div>
          </div>
          <span class="tc-count">${count}</span>
        </div>
      `;
    })
    .join("");
}

function _updateSidebarBadge() {
  const badge = document.getElementById("sbAlertBadge");
  if (badge) badge.textContent = _getActiveDashboardAlerts().length;
}

function _renderAlertTable() {
  _applyAlertFilters();
}

function filterAlerts() {
  _alertViewState.page = 1;
  _applyAlertFilters();
}
window.filterAlerts = filterAlerts;

function _applyAlertFilters() {
  const search = (document.getElementById("alertSearch")?.value || "").toLowerCase();
  const type = document.getElementById("alertFilter")?.value || "";
  const status = document.getElementById("alertStatus")?.value || "";
  const severity = document.getElementById("alertSeverity")?.value || "";
  const sortValue = document.getElementById("alertSort")?.value || "createdAt:desc";
  const [sortKey, sortDir] = sortValue.split(":");

  _alertViewState.sortKey = sortKey || "createdAt";
  _alertViewState.sortDir = sortDir || "desc";

  let filtered = [..._alertCache];
  if (search) {
    filtered = filtered.filter((alert) =>
      [
        alert.id,
        alert.crisisType,
        alert.severity,
        alert.location,
        alert.roomNumber,
        alert.reportedBy,
        alert.assignedResponseTeam,
        alert.status,
        alert.evacuationStatus,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }
  if (type) filtered = filtered.filter((alert) => alert.crisisType === type);
  if (status) filtered = filtered.filter((alert) => alert.status === status);
  if (severity) filtered = filtered.filter((alert) => alert.severity === severity);

  filtered.sort((left, right) => _compareAlerts(left, right, _alertViewState.sortKey, _alertViewState.sortDir));
  _alertViewState.totalFiltered = filtered.length;

  _renderAlertSummary(filtered);
  _renderAlertTableRows(filtered);
  _renderAlertPagination(filtered.length);
}

function _compareAlerts(left, right, key, direction) {
  const dir = direction === "asc" ? 1 : -1;
  const severityWeight = { Critical: 4, High: 3, Medium: 2, Low: 1 };

  let a = left[key];
  let b = right[key];
  if (key === "severity") {
    a = severityWeight[left.severity] || 0;
    b = severityWeight[right.severity] || 0;
  }
  if (key === "createdAt") {
    a = new Date(left.createdAt).getTime();
    b = new Date(right.createdAt).getTime();
  }
  if (key === "roomNumber" || key === "floorNumber") {
    a = Number(a);
    b = Number(b);
  }

  if (a === b) return 0;
  return a > b ? dir : -dir;
}

function _renderAlertSummary(alerts) {
  const openCount = alerts.filter((alert) => DB.isOpenStatus(alert.status)).length;
  const criticalCount = alerts.filter((alert) => alert.severity === "Critical").length;
  const floorsImpacted = new Set(alerts.map((alert) => alert.floorNumber)).size;

  _setText("alertSummaryOpen", `${openCount} open`);
  _setText("alertSummaryCritical", `${criticalCount} critical`);
  _setText("alertSummaryFloors", `${floorsImpacted} floors impacted`);

  const meta = document.getElementById("alertHistoryMeta");
  if (meta) {
    meta.textContent = _alertHistoryError
      ? _alertHistoryError
      : alerts.length
        ? `Showing ${alerts.length} incident records with route guidance, response team context, and evacuation status.`
        : "No records match the current filter. Adjust the search or severity filters.";
  }
}

function _renderAlertTableRows(alerts) {
  const tbody = document.getElementById("alertTableBody");
  if (!tbody) return;

  if (!alerts.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${_esc(_alertHistoryError || "No alerts match the current filters.")}</td></tr>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(alerts.length / _alertViewState.pageSize));
  if (_alertViewState.page > totalPages) _alertViewState.page = totalPages;

  const start = (_alertViewState.page - 1) * _alertViewState.pageSize;
  const pageItems = alerts.slice(start, start + _alertViewState.pageSize);

  tbody.innerHTML = pageItems
    .map((alertItem) => {
      const alert = DB.Alerts.format(alertItem);
      const canAct = DB.isOpenStatus(alert.status);
      return `
        <tr>
          <td>
            <div class="tbl-mono">#${_esc(alert.id.slice(-6).toUpperCase())}</div>
            <div class="tbl-subline">${_esc(alert.metadata.zone || "Active zone")}</div>
          </td>
          <td>
            <div class="tbl-type-wrap">
              <strong>${_esc(alert.dateFormatted)}</strong>
              <span class="tbl-subline">${_esc(alert.clockFormatted)}</span>
            </div>
          </td>
          <td>
            <div class="tbl-type-wrap">
              <span class="tbl-type">${_esc(alert.crisisType)}</span>
              <span class="tbl-subline">${_esc(alert.incidentSummary)}</span>
            </div>
          </td>
          <td><span class="tbl-severity tbl-severity--${_esc(alert.severitySlug)}">${_esc(alert.severity)}</span></td>
          <td>
            <div class="tbl-type-wrap">
              <strong>${_esc(alert.roomNumber)}</strong>
              <span class="tbl-subline">${_esc(alert.location)}</span>
            </div>
          </td>
          <td>Floor ${_esc(alert.floorNumber)}</td>
          <td><span class="tbl-status fi-status--${alert.statusSlug}">${_esc(alert.status)}</span></td>
          <td>
            <div class="tbl-team-wrap">
              <strong>${_esc(alert.assignedResponseTeam)}</strong>
              <span class="tbl-subline">${_esc(alert.reportedBy)}</span>
            </div>
          </td>
          <td>
            <div class="tbl-evac-wrap">
              <span class="tbl-route tbl-route--${_esc(alert.routeStatus)}">${_esc(alert.evacuationStatus)}</span>
              <span class="tbl-subline">${_esc(alert.nearestSafeExit)}</span>
            </div>
          </td>
          <td>
            <div class="tbl-actions">
              ${canAct ? `<button class="tbl-btn tbl-btn--resolve" onclick="staffResolveAlert('${alert.id}')">Resolve</button>` : ""}
              ${canAct ? `<button class="tbl-btn tbl-btn--abort" onclick="staffAbortAlert('${alert.id}')">False Alarm</button>` : ""}
              <button class="tbl-btn tbl-btn--detail" onclick="viewAlertDetail('${alert.id}')">View Details</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function _renderAlertPagination(totalItems) {
  const container = document.getElementById("alertPagination");
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / _alertViewState.pageSize));
  const currentPage = Math.min(_alertViewState.page, totalPages);
  const start = totalItems ? (_alertViewState.page - 1) * _alertViewState.pageSize + 1 : 0;
  const end = Math.min(totalItems, _alertViewState.page * _alertViewState.pageSize);

  const buttons = [];
  buttons.push(`<button class="alert-page-btn" ${currentPage === 1 ? "disabled" : ""} onclick="setAlertPage(${currentPage - 1})">Prev</button>`);
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      buttons.push(`<button class="alert-page-btn ${page === currentPage ? "is-active" : ""}" onclick="setAlertPage(${page})">${page}</button>`);
    } else if (Math.abs(page - currentPage) === 2) {
      buttons.push('<span class="alert-page-btn" aria-hidden="true">...</span>');
    }
  }
  buttons.push(`<button class="alert-page-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="setAlertPage(${currentPage + 1})">Next</button>`);

  container.innerHTML = `
    <div class="alert-pagination__meta">Showing ${start}-${end} of ${totalItems} alerts</div>
    <div class="alert-pagination__actions">${buttons.join("")}</div>
  `;
}

function setAlertPage(page) {
  const totalPages = Math.max(1, Math.ceil(_alertViewState.totalFiltered / _alertViewState.pageSize));
  _alertViewState.page = Math.max(1, Math.min(page, totalPages));
  _applyAlertFilters();
}
window.setAlertPage = setAlertPage;

async function staffResolveAlert(id) {
  const updated = await _updateAlertStatus(id, "Resolved");
  const user = DB.Session.get();
  DB.CtrlLog.add("RESOLVED", `Alert #${id.slice(-6).toUpperCase()} resolved via dashboard`, user?.name);
  _renderAlertTable();
  _renderOverview();
  _renderControlPanel();
  if (_activeAlertDetailId === id && updated) _renderAlertDetail(updated);
  showToast("Alert marked as resolved.");
}
window.staffResolveAlert = staffResolveAlert;

async function staffAbortAlert(id) {
  const updated = await _updateAlertStatus(id, "False Alarm");
  const user = DB.Session.get();
  DB.CtrlLog.add("ABORTED", `Alert #${id.slice(-6).toUpperCase()} marked false alarm via dashboard`, user?.name);
  _renderAlertTable();
  _renderOverview();
  _renderControlPanel();
  if (_activeAlertDetailId === id && updated) _renderAlertDetail(updated);
  showToast("Alert marked as false alarm.");
}
window.staffAbortAlert = staffAbortAlert;

function viewAlertDetail(id) {
  const alert = _findAlertById(id);
  if (!alert) return;

  _activeAlertDetailId = id;
  const modal = document.getElementById("alertDetailModal");
  if (modal) modal.hidden = false;
  _renderAlertDetail(alert);
}
window.viewAlertDetail = viewAlertDetail;

function _renderAlertDetail(alert) {
  const title = document.getElementById("alertDetailTitle");
  const body = document.getElementById("alertDetailBody");
  const footer = document.getElementById("alertDetailFooter");
  if (!body) return;

  const item = DB.Alerts.format(alert);
  if (title) title.textContent = `${item.crisisType} - Room ${item.roomNumber}`;

  const voiceLogs = DB.Voice.forAlert(item.id);
  const transcript = voiceLogs.length ? voiceLogs[0].transcript : item.transcript || "No voice transcript has been stored for this incident.";
  const timelineHtml = item.timeline
    .map((entry) => `
      <div class="timeline-item">
        <span class="timeline-dot"></span>
        <div class="timeline-card">
          <strong>${_esc(entry.label)}</strong>
          <p>${_esc(entry.detail)}</p>
          <span>${_esc(DB.fmtTime(entry.at))}</span>
        </div>
      </div>
    `)
    .join("");

  const respondersHtml = (item.responderStatus || [])
    .map(
      (person) => `
        <div class="responder-item">
          <div>
            <strong>${_esc(person.name)}</strong>
            <span>${_esc(person.role)}</span>
          </div>
          <div class="responder-state">${_esc(person.state)}</div>
        </div>
      `
    )
    .join("");

  body.innerHTML = `
    <div class="alert-detail-main">
      <section class="detail-panel detail-panel--hero">
        <div class="detail-hero-top">
          <div class="detail-hero-copy">
            <h3>${_esc(item.crisisType)}</h3>
            <p>${_esc(item.incidentSummary)}</p>
          </div>
          <div class="detail-hero-badges">
            <span class="tbl-severity tbl-severity--${_esc(item.severitySlug)}">${_esc(item.severity)}</span>
            <span class="tbl-status fi-status--${item.statusSlug}">${_esc(item.status)}</span>
            <span class="tbl-route tbl-route--${_esc(item.routeStatus)}">${_esc(item.evacuationStatus)}</span>
          </div>
        </div>
        <div class="detail-kpis">
          <div class="detail-kpi">
            <span class="detail-kpi__label">Nearest Exit</span>
            <div class="detail-kpi__value">${_esc(item.nearestSafeExit)}</div>
          </div>
          <div class="detail-kpi">
            <span class="detail-kpi__label">Route Distance</span>
            <div class="detail-kpi__value">${_esc(item.routePlan.distanceMeters)} m</div>
          </div>
          <div class="detail-kpi">
            <span class="detail-kpi__label">Estimated Clear Time</span>
            <div class="detail-kpi__value">${_esc(item.routePlan.etaMinutes)} min</div>
          </div>
          <div class="detail-kpi">
            <span class="detail-kpi__label">Response Team</span>
            <div class="detail-kpi__value">${_esc(item.assignedResponseTeam)}</div>
          </div>
        </div>
      </section>

      <section class="detail-panel">
        <h3 class="detail-panel__title">Incident Snapshot</h3>
        <div class="detail-grid">
          <div class="detail-chip">
            <span class="detail-chip__label">Alert ID</span>
            <span class="detail-chip__value">#${_esc(item.id.slice(-6).toUpperCase())}</span>
          </div>
          <div class="detail-chip">
            <span class="detail-chip__label">Reported By</span>
            <span class="detail-chip__value">${_esc(item.reportedBy)}</span>
          </div>
          <div class="detail-chip">
            <span class="detail-chip__label">Affected Location</span>
            <span class="detail-chip__value">Floor ${_esc(item.floorNumber)} · Room ${_esc(item.roomNumber)}</span>
          </div>
          <div class="detail-chip">
            <span class="detail-chip__label">Timestamp</span>
            <span class="detail-chip__value">${_esc(item.dateFormatted)} · ${_esc(item.clockFormatted)}</span>
          </div>
          <div class="detail-chip">
            <span class="detail-chip__label">Operational Zone</span>
            <span class="detail-chip__value">${_esc(item.metadata.zone || "Monitoring zone")}</span>
          </div>
          <div class="detail-chip">
            <span class="detail-chip__label">Occupancy Status</span>
            <span class="detail-chip__value">${_esc(item.metadata.occupancy || "Occupancy data unavailable")}</span>
          </div>
        </div>
      </section>

      <section class="detail-panel detail-panel--map">
        <h3 class="detail-panel__title">Evacuation Route Preview</h3>
        <div class="detail-route-layout">
          <div class="route-preview">${_buildRoutePreview(item)}</div>
          <div class="route-side">
            ${item.routePlan.steps
              .map(
                (step, index) => `
                  <div class="route-step">
                    <strong>Step ${index + 1}</strong>
                    ${_esc(step)}
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </section>
    </div>

    <div class="alert-detail-side">
      <section class="detail-panel">
        <h3 class="detail-panel__title">Voice Transcript</h3>
        <div class="route-step">
          <strong>Captured Transcript</strong>
          ${_esc(transcript)}
        </div>
      </section>

      <section class="detail-panel">
        <h3 class="detail-panel__title">Response Timeline</h3>
        <div class="timeline-list">${timelineHtml}</div>
      </section>

      <section class="detail-panel">
        <h3 class="detail-panel__title">Responder Status</h3>
        <div class="responder-list">${respondersHtml}</div>
      </section>

    </div>
  `;

  if (footer) {
    footer.innerHTML = `
      <div class="detail-actions detail-actions--footer">
        <button type="button" class="btn-cancel" onclick="closeAlertDetailModal()">Close</button>
        <a class="vt-btn" href="navigation.html">Open Navigation</a>
        ${DB.isOpenStatus(item.status) ? `<button type="button" class="btn-cancel" onclick="staffAbortAlert('${item.id}')">Flag False Alarm</button>` : ""}
        ${DB.isOpenStatus(item.status) ? `<button type="button" class="vt-btn vt-btn--primary" onclick="staffResolveAlert('${item.id}')">Mark Resolved</button>` : ""}
      </div>
    `;
  }
}

function _buildRoutePreview(alert) {
  const preview = alert.routePlan.preview;
  const path = preview.points.map((point) => `${point.x},${point.y}`).join(" ");
  const blockedSegments = (preview.blockedSegments || [])
    .map((segment) => `<line class="route-preview__blocked" x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" />`)
    .join("");
  const evacuees = (preview.evacuees || [])
    .map(
      (dot) => `
        <circle class="route-preview__evacuee" cx="${dot.x}" cy="${dot.y}" r="4" style="animation-delay:${dot.delay || 0}s"></circle>
      `
    )
    .join("");

  return `
    <svg viewBox="0 0 ${preview.width} ${preview.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Evacuation route preview">
      <defs>
        <pattern id="route-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" class="route-preview__grid" fill="none"></path>
        </pattern>
      </defs>
      <rect width="${preview.width}" height="${preview.height}" rx="22" fill="url(#route-grid)"></rect>
      <line class="route-preview__corridor" x1="56" y1="112" x2="292" y2="112"></line>
      <line class="route-preview__corridor" x1="140" y1="112" x2="140" y2="176"></line>
      <rect class="route-preview__room" x="${preview.roomBox.x}" y="${preview.roomBox.y}" width="${preview.roomBox.width}" height="${preview.roomBox.height}" rx="14"></rect>
      <rect class="route-preview__exit" x="${preview.exitBox.x}" y="${preview.exitBox.y}" width="${preview.exitBox.width}" height="${preview.exitBox.height}" rx="14"></rect>
      ${preview.hazardBox ? `<rect class="route-preview__hazard" x="${preview.hazardBox.x}" y="${preview.hazardBox.y}" width="${preview.hazardBox.width}" height="${preview.hazardBox.height}" rx="14"></rect>` : ""}
      <polyline class="route-preview__path route-preview__path--${_esc(alert.routeStatus)}" points="${path}"></polyline>
      ${blockedSegments}
      ${evacuees}
      <text class="route-preview__label" x="${preview.roomBox.x + 10}" y="${preview.roomBox.y + 28}">${_esc(preview.roomBox.label)}</text>
      <text class="route-preview__label" x="${preview.exitBox.x + 6}" y="${preview.exitBox.y + 32}">Exit</text>
      ${preview.hazardBox ? `<text class="route-preview__label" x="${preview.hazardBox.x + 8}" y="${preview.hazardBox.y + 28}">${_esc(preview.hazardBox.label)}</text>` : ""}
    </svg>
  `;
}

function closeAlertDetailModal() {
  const modal = document.getElementById("alertDetailModal");
  const footer = document.getElementById("alertDetailFooter");
  if (modal) modal.hidden = true;
  if (footer) {
    footer.innerHTML = '<button type="button" class="btn-cancel" onclick="closeAlertDetailModal()">Close</button>';
  }
  _activeAlertDetailId = null;
}
window.closeAlertDetailModal = closeAlertDetailModal;

function exportAlerts() {
  const alerts = _getDashboardAlerts();
  const rows = [[
    "Alert ID",
    "Date",
    "Time",
    "Crisis Type",
    "Severity",
    "Status",
    "Room Number",
    "Floor Number",
    "Reported By",
    "Assigned Response Team",
    "Evacuation Status",
    "Nearest Exit",
  ]];

  alerts.forEach((alertItem) => {
    const alert = DB.Alerts.format(alertItem);
    rows.push([
      alert.id.slice(-6).toUpperCase(),
      alert.dateFormatted,
      alert.clockFormatted,
      alert.crisisType,
      alert.severity,
      alert.status,
      alert.roomNumber,
      alert.floorNumber,
      alert.reportedBy,
      alert.assignedResponseTeam,
      alert.evacuationStatus,
      alert.nearestSafeExit,
    ]);
  });

  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `alert-history-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
window.exportAlerts = exportAlerts;

function _renderVoiceLogs(logs = null) {
  const container = document.getElementById("voiceLogList");
  if (!container) return;
  const source = logs || DB.Voice.getAll();

  if (!source.length) {
    container.innerHTML = '<p class="feed-empty">No voice logs recorded yet.</p>';
    return;
  }

  container.innerHTML = source
    .map((log) => {
      const entry = DB.Voice.format(log);
      return `
        <div class="vl-card">
          <div class="vlc-head">
            <span class="vlc-id">ALERT #${_esc(entry.alertId.slice(-6).toUpperCase())}</span>
            <span class="vlc-type vlc-type--${_esc(DB.slugify(entry.detectedType))}">${_esc(entry.detectedType)}</span>
            <span class="vlc-time">${entry.timeFormatted}</span>
          </div>
          <div class="vlc-transcript">"${_esc(entry.transcript || "No transcript recorded.")}"</div>
          <div class="vlc-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${_esc(entry.location || "Unknown location")}
          </div>
        </div>
      `;
    })
    .join("");
}

function filterVoiceLogs() {
  const query = (document.getElementById("voiceSearch")?.value || "").toLowerCase();
  const logs = DB.Voice.getAll().filter((log) =>
    [log.transcript, log.detectedType, log.location].join(" ").toLowerCase().includes(query)
  );

  if (!logs.length) {
    const container = document.getElementById("voiceLogList");
    if (container) container.innerHTML = '<p class="feed-empty">No matching transcripts.</p>';
    return;
  }

  _renderVoiceLogs(logs);
}
window.filterVoiceLogs = filterVoiceLogs;

function _renderControlPanel() {
  const active = _getActiveDashboardAlerts();
  const hasActive = active.length > 0;
  const latest = active[0];

  const banner = document.getElementById("cpBanner");
  const status = document.getElementById("cpStatus");
  const detail = document.getElementById("cpDetail");
  const abortBtn = document.getElementById("cpAbortBtn");
  const resolveBtn = document.getElementById("cpResolveBtn");

  if (banner) banner.className = "cp-banner" + (hasActive ? " cp-banner--active" : "");
  if (status) status.textContent = hasActive ? `${active.length} Active Emergency Alert${active.length > 1 ? "s" : ""}` : "No Active Emergency";
  if (detail) {
    detail.textContent = hasActive
      ? `${latest.crisisType} on Floor ${latest.floorNumber} · Room ${latest.roomNumber} · ${latest.evacuationStatus}`
      : "System is monitoring. All clear.";
  }
  if (abortBtn) abortBtn.disabled = !hasActive;
  if (resolveBtn) resolveBtn.disabled = !hasActive;

  _renderControlLog();
}

async function staffAbortSOS() {
  const active = _getActiveDashboardAlerts();
  if (!active.length) return;
  const user = DB.Session.get();
  for (const alert of active) {
    await _updateAlertStatus(alert.id, "False Alarm");
  }
  DB.CtrlLog.add("ABORTED", `${active.length} alert(s) marked false alarm by staff`, user?.name);
  _renderControlPanel();
  _renderOverview();
  _renderAlertTable();
  showToast("Active alerts marked as false alarm.");
}
window.staffAbortSOS = staffAbortSOS;

async function staffResolveSOS() {
  const active = _getActiveDashboardAlerts();
  if (!active.length) return;
  const user = DB.Session.get();
  for (const alert of active) {
    await _updateAlertStatus(alert.id, "Resolved");
  }
  DB.CtrlLog.add("RESOLVED", `${active.length} alert(s) resolved by staff`, user?.name);
  _renderControlPanel();
  _renderOverview();
  _renderAlertTable();
  showToast("Active alerts resolved.");
}
window.staffResolveSOS = staffResolveSOS;

function staffDispatch() {
  const user = DB.Session.get();
  DB.CtrlLog.add("DISPATCH", "Manual dispatch initiated by staff", user?.name);
  _renderControlLog();
  showToast("Manual dispatch sent.");
}
window.staffDispatch = staffDispatch;

function _renderControlLog() {
  const list = document.getElementById("cpLogList");
  if (!list) return;
  const entries = DB.CtrlLog.getAll().slice(0, 50);

  if (!entries.length) {
    list.innerHTML = '<p class="feed-empty">No actions taken yet.</p>';
    return;
  }

  const icons = {
    RESOLVED: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    ABORTED: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    DISPATCH: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.64 19 19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42A2 2 0 0 1 3.6 1h3"/></svg>',
  };

  list.innerHTML = entries
    .map((entry) => {
      const formatted = DB.CtrlLog.format(entry);
      return `
        <div class="cp-log-item">
          <span class="cpl-icon">${icons[entry.action] || ""}</span>
          <span class="cpl-text"><strong>${_esc(entry.staffName)}</strong> - ${_esc(entry.detail)}</span>
          <span class="cpl-time">${formatted.timeFormatted}</span>
        </div>
      `;
    })
    .join("");
}

function showToast(message, duration = 3000) {
  let toast = document.getElementById("dashToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "dashToast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, duration);
}
window.showToast = showToast;

function _setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

async function _primeAlertHistory() {
  try {
    await _refreshAlertHistory({ silent: false });
  } catch (error) {
    console.warn("Backend alert history unavailable.", error);
    _alertCache = [];
    _usingBackendAlerts = false;
    _alertHistoryError = "Live alert history could not be loaded from the backend. Start the backend and refresh to view saved staff alerts.";
  }
}

function _startAlertHistoryPolling() {
  if (_alertHistoryPoller) window.clearInterval(_alertHistoryPoller);
  _alertHistoryPoller = window.setInterval(() => {
    _refreshAlertHistory({ silent: true });
  }, ALERT_HISTORY_REFRESH_MS);
}

async function _refreshAlertHistory({ silent = false } = {}) {
  try {
    const alerts = await _fetchBackendAlerts();
    _alertCache = alerts;
    _usingBackendAlerts = true;
    _alertHistoryError = "";

    if (!silent) {
      refreshDashboard();
    } else if (_currentView === "alerts" || _currentView === "overview") {
      refreshDashboard();
    }
    return alerts;
  } catch (error) {
    if (!_alertCache.length) {
      _usingBackendAlerts = false;
      _alertHistoryError = "Live alert history could not be loaded from the backend. Start the backend and refresh to view saved staff alerts.";
      if (!silent) refreshDashboard();
    }
    throw error;
  }
}

async function _fetchBackendAlerts() {
  const response = await fetch(ALERT_HISTORY_ENDPOINT);
  if (!response.ok) {
    throw new Error(`Alert history request failed with ${response.status}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  return items.map(_normalizeBackendAlert);
}

function _normalizeBackendAlert(alert) {
  const routePreview = alert.routePreview || {};
  const roomNumber = String(alert.roomNumber || "");
  const floorNumber = Number(alert.floorNumber || 0);
  const nearestExit = alert.nearestSafeExit || routePreview.nearestSafeExit || "Safe Exit";
  return {
    id: alert.alertId || String(alert.id),
    backendAlertId: alert.alertId || null,
    backendRowId: alert.id,
    type: alert.crisisType,
    crisisType: alert.crisisType,
    severity: alert.severity,
    status: alert.status,
    location: `Floor ${floorNumber} · Room ${roomNumber}`,
    lat: null,
    lng: null,
    transcript: alert.details || "",
    agency: alert.assignedResponseTeam,
    roomNumber,
    floorNumber,
    reportedBy: alert.reportedBy,
    assignedResponseTeam: alert.assignedResponseTeam,
    evacuationStatus: alert.evacuationStatus,
    routeStatus: alert.routeStatus || routePreview.routeStatus || "safe",
    nearestSafeExit: nearestExit,
    routePlan: {
      routeStatus: alert.routeStatus || routePreview.routeStatus || "safe",
      floorNumber,
      roomNumber,
      distanceMeters: routePreview.distanceMeters || 0,
      etaMinutes: routePreview.etaMinutes || 0,
      safeExit: nearestExit,
      corridor: `Floor ${floorNumber} protected corridor`,
      steps: Array.isArray(routePreview.steps) ? routePreview.steps : [],
      preview: {
        width: 340,
        height: 220,
        roomBox: { x: 68, y: 56, width: 72, height: 46, label: `Room ${roomNumber}` },
        exitBox: { x: 260, y: 86, width: 48, height: 58, label: nearestExit },
        hazardBox: null,
        blockedSegments: Array.isArray(routePreview.blockedSegments) ? routePreview.blockedSegments : [],
        evacuees: [],
        points: Array.isArray(routePreview.points) ? routePreview.points : [],
      },
    },
    emergencyType: alert.crisisType,
    incidentSummary: alert.details || `${alert.crisisType} detected near room ${roomNumber}.`,
    responderStatus: Array.isArray(alert.responderStatus) ? alert.responderStatus : [],
    createdAt: alert.createdAt,
    resolvedAt: ["Resolved", "False Alarm"].includes(alert.status) ? alert.updatedAt : null,
    updatedAt: alert.updatedAt,
    timeline: Array.isArray(alert.timeline) ? alert.timeline : [],
    metadata: alert.metadata || {},
  };
}

function _getDashboardAlerts() {
  return _alertCache.slice();
}

function _getActiveDashboardAlerts() {
  return _alertCache.filter((alert) => DB.isOpenStatus(alert.status));
}

function _getAlertStats() {
  const all = _getDashboardAlerts();
  const types = {};
  all.forEach((alert) => {
    types[alert.crisisType] = (types[alert.crisisType] || 0) + 1;
  });
  const today = new Date().toDateString();
  return {
    total: all.length,
    active: all.filter((alert) => DB.isOpenStatus(alert.status)).length,
    today: all.filter((alert) => new Date(alert.createdAt).toDateString() === today).length,
    resolved: all.filter((alert) => alert.status === "Resolved").length,
    types,
  };
}

function _findAlertById(id) {
  return _alertCache.find((alert) => alert.id === id) || null;
}

async function _updateAlertStatus(id, status) {
  const alert = _findAlertById(id);
  if (!alert) return null;

  if (_usingBackendAlerts && alert.backendAlertId) {
    const response = await fetch(ALERT_STATUS_ENDPOINT(alert.backendAlertId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Status update failed with ${response.status}`);
    }
    const payload = await response.json();
    const normalized = _normalizeBackendAlert(payload.data);
    _alertCache = _alertCache.map((item) => (item.id === id ? normalized : item));
    try {
      localStorage.setItem("ao_alert_history_refresh", String(Date.now()));
    } catch (error) {
      console.warn("Unable to notify other views about updated alert status", error);
    }
    return normalized;
  }

  const updated = DB.Alerts.updateStatus(id, status);
  _alertCache = DB.Alerts.getAll();
  return updated;
}

function _esc(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
