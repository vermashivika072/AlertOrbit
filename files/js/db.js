/**
 * db.js
 *
 * localStorage-backed utility store for the static AlertOrbit shell.
 * Production deployments should replace these helpers with secure backend APIs.
 */

const DB = (() => {
  const KEYS = {
    USERS: "ca_users",
    SESSION: "ca_session",
    ALERTS: "ca_alerts",
    CONTACTS: "ca_contacts",
    VOICE: "ca_voice",
    CTRL_LOG: "ca_ctrl_log",
    NOTIFS: "ca_notifs",
    MAP_ASSETS: "ao_map_assets",
    MAP_SCENES: "ao_map_scenes",
  };

  const OPEN_ALERT_STATUSES = new Set(["Active", "Investigating", "Escalated", "Evacuating"]);
  const CRISIS_TYPE_ALIASES = {
    Medical: "Medical Emergency",
    Crime: "Security Threat",
    Unknown: "Smoke Detection",
    Natural: "Electrical Failure",
    Fire: "Fire",
  };
  const STATUS_ALIASES = {
    active: "Active",
    investigating: "Investigating",
    resolved: "Resolved",
    escalated: "Escalated",
    evacuating: "Evacuating",
    aborted: "False Alarm",
    cancelled: "False Alarm",
    "false alarm": "False Alarm",
  };
  const TEAM_BY_TYPE = {
    Fire: "Fire & Rescue Unit",
    "Gas Leak": "HazMat Response Team",
    "Smoke Detection": "Building Safety Unit",
    "Medical Emergency": "Medical Response Team",
    "Security Threat": "Security Operations Team",
    "Electrical Failure": "Engineering Response Team",
  };
  const SEVERITY_BY_TYPE = {
    Fire: "Critical",
    "Gas Leak": "High",
    "Smoke Detection": "High",
    "Medical Emergency": "High",
    "Security Threat": "Critical",
    "Electrical Failure": "Medium",
  };

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  }

  function readObj(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch {
      return null;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid() {
    return "ca_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function now() {
    return new Date().toISOString();
  }

  function fmtTime(iso) {
    const date = new Date(iso);
    return (
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      " · " +
      date.toLocaleDateString([], { month: "short", day: "numeric" })
    );
  }

  function fmtDate(iso) {
    const date = new Date(iso);
    return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtClock(iso) {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function titleCase(value) {
    return String(value || "")
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeType(type) {
    const raw = String(type || "Unknown").trim();
    return CRISIS_TYPE_ALIASES[raw] || titleCase(raw) || "Smoke Detection";
  }

  function normalizeSeverity(value, fallbackType) {
    if (!value) return SEVERITY_BY_TYPE[fallbackType] || "Medium";
    const severity = titleCase(value);
    if (["Low", "Medium", "High", "Critical"].includes(severity)) return severity;
    return SEVERITY_BY_TYPE[fallbackType] || "Medium";
  }

  function normalizeStatus(value) {
    const raw = String(value || "active").trim();
    return STATUS_ALIASES[raw.toLowerCase()] || titleCase(raw) || "Active";
  }

  function isOpenStatus(status) {
    return OPEN_ALERT_STATUSES.has(normalizeStatus(status));
  }

  function inferFloorNumber(...values) {
    const text = values.filter(Boolean).join(" ");
    const floorMatch = text.match(/floor\s*(\d+)/i);
    if (floorMatch) return Number(floorMatch[1]);
    const roomMatch = text.match(/\b([1-9]\d{2,3})\b/);
    if (roomMatch) return Number(String(roomMatch[1]).charAt(0));
    return 1;
  }

  function inferRoomNumber(...values) {
    const text = values.filter(Boolean).join(" ");
    const roomMatch = text.match(/\b([1-9]\d{2,3})\b/);
    if (roomMatch) return roomMatch[1];
    const floor = inferFloorNumber(text);
    return `${floor}0${Math.min(9, floor + 2)}`;
  }

  function inferReporter(location, type) {
    const room = inferRoomNumber(location, type);
    return `Desk ${room}`;
  }

  function inferEvacuationStatus(status) {
    const normalized = normalizeStatus(status);
    if (normalized === "Resolved") return "Complete";
    if (normalized === "False Alarm") return "Stand Down";
    if (normalized === "Investigating") return "Assessment In Progress";
    if (normalized === "Escalated") return "Priority Sweep";
    if (normalized === "Evacuating") return "Primary Evacuation";
    return "Guidance Active";
  }

  function inferRouteStatus(type, status) {
    const normalizedType = normalizeType(type);
    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus === "False Alarm") return "safe";
    if (normalizedStatus === "Resolved") return "safe";
    if (normalizedType === "Fire" || normalizedType === "Security Threat") return "blocked";
    if (normalizedType === "Gas Leak" || normalizedStatus === "Escalated") return "caution";
    return "safe";
  }

  function buildRoutePlan(floorNumber, roomNumber, type, status) {
    const numericRoom = Number(String(roomNumber).replace(/\D/g, "") || "101");
    const rowOffset = numericRoom % 5;
    const routeStatus = inferRouteStatus(type, status);
    const startX = 78 + rowOffset * 8;
    const startY = 62 + (Math.max(1, floorNumber) - 1) * 14;
    const corridorY = 112;
    const exitX = routeStatus === "blocked" ? 302 : 278;
    const safeExitLabel = routeStatus === "blocked" ? "East Fire Exit" : "North Safe Exit";
    const cautionZone = routeStatus === "caution";
    const blocked = routeStatus === "blocked";

    return {
      routeStatus,
      floorNumber,
      roomNumber,
      distanceMeters: 36 + (floorNumber * 11) + rowOffset * 3,
      etaMinutes: 1 + floorNumber,
      safeExit: safeExitLabel,
      corridor: `Floor ${floorNumber} spine corridor`,
      steps: [
        `Exit room ${roomNumber} and enter the illuminated corridor.`,
        `Follow AI guidance through the ${cautionZone ? "alternate" : "primary"} lane.`,
        `${blocked ? "Bypass the blocked west segment and reroute east." : "Proceed directly to the nearest protected exit."}`,
        `Stage occupants at ${safeExitLabel}.`,
      ],
      preview: {
        width: 340,
        height: 220,
        roomBox: { x: startX - 30, y: startY - 24, width: 72, height: 46, label: `Room ${roomNumber}` },
        exitBox: { x: 260, y: 86, width: 48, height: 58, label: safeExitLabel },
        hazardBox: blocked
          ? { x: 176, y: 80, width: 44, height: 72, label: "Blocked" }
          : cautionZone
            ? { x: 172, y: 94, width: 56, height: 52, label: "Hazard" }
            : null,
        blockedSegments: blocked ? [{ x1: 172, y1: corridorY, x2: 228, y2: corridorY }] : [],
        evacuees: [
          { x: startX + 12, y: startY + 8, delay: 0 },
          { x: startX + 2, y: startY + 16, delay: 0.6 },
          { x: startX - 8, y: startY + 22, delay: 1.1 },
        ],
        points: blocked
          ? [
              { x: startX + 12, y: startY + 18 },
              { x: startX + 12, y: corridorY },
              { x: 142, y: corridorY },
              { x: 142, y: 158 },
              { x: exitX, y: 158 },
              { x: exitX, y: 118 },
            ]
          : cautionZone
            ? [
                { x: startX + 12, y: startY + 18 },
                { x: startX + 12, y: corridorY },
                { x: 148, y: corridorY },
                { x: 188, y: 146 },
                { x: exitX, y: 146 },
                { x: exitX, y: 114 },
              ]
            : [
                { x: startX + 12, y: startY + 18 },
                { x: startX + 12, y: corridorY },
                { x: 188, y: corridorY },
                { x: exitX, y: corridorY },
                { x: exitX, y: 114 },
              ],
      },
    };
  }

  function buildTimeline(alert) {
    const createdAt = new Date(alert.createdAt || now()).getTime();
    const timeline = [
      {
        id: uid(),
        label: "Alert Ingested",
        detail: `${alert.crisisType} signal validated by the command layer.`,
        at: new Date(createdAt).toISOString(),
      },
      {
        id: uid(),
        label: "Room Isolated",
        detail: `Floor ${alert.floorNumber} / Room ${alert.roomNumber} tagged for containment.`,
        at: new Date(createdAt + 60 * 1000).toISOString(),
      },
      {
        id: uid(),
        label: "AI Route Generated",
        detail: `Primary path to ${alert.routePlan.safeExit} is now available.`,
        at: new Date(createdAt + 2 * 60 * 1000).toISOString(),
      },
    ];

    if (alert.status === "Resolved") {
      timeline.push({
        id: uid(),
        label: "All Clear",
        detail: "Incident closed after verification from the on-site response lead.",
        at: alert.resolvedAt || new Date(createdAt + 15 * 60 * 1000).toISOString(),
      });
    } else if (alert.status === "Escalated") {
      timeline.push({
        id: uid(),
        label: "Escalated Response",
        detail: "Secondary teams dispatched and fallback routes enabled.",
        at: new Date(createdAt + 4 * 60 * 1000).toISOString(),
      });
    } else if (alert.status === "False Alarm") {
      timeline.push({
        id: uid(),
        label: "Stand Down",
        detail: "Sensors cleared and occupants advised to return to normal operations.",
        at: alert.resolvedAt || new Date(createdAt + 9 * 60 * 1000).toISOString(),
      });
    }

    return timeline;
  }

  function buildResponders(alert) {
    return [
      { name: "Command AI", role: "Route Intelligence", state: "Tracking occupant flow" },
      { name: alert.assignedResponseTeam, role: "Primary Team", state: alert.status === "Resolved" ? "Mission complete" : "En route" },
      { name: "Facility Ops", role: "Building Systems", state: alert.status === "Escalated" ? "Ventilation override active" : "Monitoring utilities" },
    ];
  }

  function buildAlertRecord(input, indexHint = 0) {
    const createdAt = input.createdAt || now();
    const crisisType = normalizeType(input.crisisType || input.type);
    const floorNumber = Number(input.floorNumber || inferFloorNumber(input.location, input.roomNumber, input.transcript));
    const roomNumber = String(input.roomNumber || inferRoomNumber(input.location, input.transcript));
    const status = normalizeStatus(input.status);
    const severity = normalizeSeverity(input.severity, crisisType);
    const location = input.location || `Floor ${floorNumber} · Room ${roomNumber}`;
    const assignedResponseTeam = input.assignedResponseTeam || input.assigned_response_team || TEAM_BY_TYPE[crisisType] || "Emergency Coordination Team";
    const routePlan = input.routePlan || buildRoutePlan(floorNumber, roomNumber, crisisType, status);

    const alert = {
      id: input.id || uid(),
      type: crisisType,
      crisisType,
      severity,
      status,
      location,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      transcript: input.transcript || "",
      agency: input.agency || TEAM_BY_TYPE[crisisType] || "Emergency Services",
      roomNumber,
      floorNumber,
      reportedBy: input.reportedBy || inferReporter(location, crisisType),
      assignedResponseTeam,
      evacuationStatus: input.evacuationStatus || inferEvacuationStatus(status),
      routeStatus: input.routeStatus || routePlan.routeStatus,
      nearestSafeExit: input.nearestSafeExit || routePlan.safeExit,
      routePlan,
      emergencyType: input.emergencyType || crisisType,
      incidentSummary: input.incidentSummary || `${crisisType} detected near room ${roomNumber}.`,
      responderStatus: input.responderStatus || buildResponders({ assignedResponseTeam, status }),
      createdAt,
      resolvedAt: input.resolvedAt || null,
      updatedAt: input.updatedAt || createdAt,
      timeline: input.timeline || [],
      metadata: {
        floorLabel: input.metadata?.floorLabel || `Floor ${floorNumber}`,
        occupancy: input.metadata?.occupancy || `${18 + indexHint} occupants monitored`,
        zone: input.metadata?.zone || `Wing ${String.fromCharCode(65 + ((floorNumber + indexHint) % 4))}`,
        ...input.metadata,
      },
    };

    if (!alert.timeline.length) {
      alert.timeline = buildTimeline(alert);
    }

    return alert;
  }

  function normalizeStoredAlerts() {
    const source = read(KEYS.ALERTS);
    const normalized = source.map((alert, index) => buildAlertRecord(alert, index));
    const changed = JSON.stringify(source) !== JSON.stringify(normalized);
    if (changed) write(KEYS.ALERTS, normalized);
    return normalized.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const Users = {
    getAll() {
      return read(KEYS.USERS);
    },

    create(name, email, password, role) {
      const all = this.getAll();
      if (all.find((user) => user.email === email)) {
        return { error: "Email already registered." };
      }

      const user = {
        id: uid(),
        name,
        email,
        password: btoa(password),
        role,
        createdAt: now(),
      };
      all.push(user);
      write(KEYS.USERS, all);
      return { ok: true, user };
    },

    verify(email, password) {
      const all = this.getAll();
      return all.find((user) => user.email === email && user.password === btoa(password)) || null;
    },

    seed() {
      if (!this.getAll().find((user) => user.email === "staff@demo.com")) {
        this.create("Demo Staff", "staff@demo.com", "demo1234", "Dispatcher");
      }
    },
  };

  const Session = {
    get() {
      return readObj(KEYS.SESSION);
    },
    set(user) {
      write(KEYS.SESSION, { ...user, loginAt: now() });
    },
    clear() {
      localStorage.removeItem(KEYS.SESSION);
    },
    isLoggedIn() {
      return !!this.get();
    },
    isAuthorized(roles = []) {
      const session = this.get();
      if (!session) return false;
      if (!roles.length) return true;
      return roles.includes(session.role);
    },
  };

  const Alerts = {
    getAll() {
      return normalizeStoredAlerts();
    },

    findById(id) {
      return this.getAll().find((alert) => alert.id === id) || null;
    },

    create(type, location, lat, lng, transcript, overrides = {}) {
      const all = this.getAll();
      const alert = buildAlertRecord(
        {
          id: overrides.id || uid(),
          type,
          location,
          lat,
          lng,
          transcript,
          status: overrides.status || "Active",
          reportedBy: overrides.reportedBy,
          floorNumber: overrides.floorNumber,
          roomNumber: overrides.roomNumber,
          severity: overrides.severity,
          assignedResponseTeam: overrides.assignedResponseTeam,
          evacuationStatus: overrides.evacuationStatus,
          nearestSafeExit: overrides.nearestSafeExit,
          routePlan: overrides.routePlan,
          createdAt: overrides.createdAt || now(),
          resolvedAt: overrides.resolvedAt || null,
          metadata: overrides.metadata || {},
          responderStatus: overrides.responderStatus,
          timeline: overrides.timeline,
          incidentSummary: overrides.incidentSummary,
        },
        all.length
      );
      all.unshift(alert);
      write(KEYS.ALERTS, all);
      return alert;
    },

    updateStatus(id, status) {
      const all = this.getAll();
      const index = all.findIndex((alert) => alert.id === id);
      if (index === -1) return false;

      const normalizedStatus = normalizeStatus(status);
      const updated = buildAlertRecord(
        {
          ...all[index],
          status: normalizedStatus,
          evacuationStatus: inferEvacuationStatus(normalizedStatus),
          routePlan: buildRoutePlan(all[index].floorNumber, all[index].roomNumber, all[index].crisisType, normalizedStatus),
          updatedAt: now(),
          resolvedAt: ["Resolved", "False Alarm"].includes(normalizedStatus) ? now() : null,
        },
        index
      );

      updated.timeline = [
        ...all[index].timeline,
        {
          id: uid(),
          label: `Status Updated: ${normalizedStatus}`,
          detail:
            normalizedStatus === "Resolved"
              ? "The incident has been closed and evacuation lanes are standing down."
              : normalizedStatus === "False Alarm"
                ? "Building occupants have been informed that no hazard remains."
                : `Response teams shifted the incident state to ${normalizedStatus}.`,
          at: updated.updatedAt,
        },
      ];

      all[index] = updated;
      write(KEYS.ALERTS, all);
      return updated;
    },

    getActive() {
      return this.getAll().filter((alert) => isOpenStatus(alert.status));
    },

    getToday() {
      const today = new Date().toDateString();
      return this.getAll().filter((alert) => new Date(alert.createdAt).toDateString() === today);
    },

    getResolved() {
      return this.getAll().filter((alert) => alert.status === "Resolved");
    },

    stats() {
      const all = this.getAll();
      const types = {};
      all.forEach((alert) => {
        types[alert.crisisType] = (types[alert.crisisType] || 0) + 1;
      });
      return {
        total: all.length,
        active: all.filter((alert) => isOpenStatus(alert.status)).length,
        today: this.getToday().length,
        resolved: all.filter((alert) => alert.status === "Resolved").length,
        types,
      };
    },

    format(alert) {
      return {
        ...alert,
        timeFormatted: fmtTime(alert.createdAt),
        dateFormatted: fmtDate(alert.createdAt),
        clockFormatted: fmtClock(alert.createdAt),
        statusSlug: slugify(alert.status),
        severitySlug: slugify(alert.severity),
      };
    },
  };

  const Contacts = {
    getAll() {
      return read(KEYS.CONTACTS);
    },
    create(name, phone, agency, role) {
      const all = this.getAll();
      const contact = { id: uid(), name, phone, agency: agency || "", role: role || "General", createdAt: now() };
      all.push(contact);
      write(KEYS.CONTACTS, all);
      return contact;
    },
    update(id, data) {
      const all = this.getAll();
      const index = all.findIndex((contact) => contact.id === id);
      if (index === -1) return false;
      all[index] = { ...all[index], ...data };
      write(KEYS.CONTACTS, all);
      return all[index];
    },
    delete(id) {
      write(KEYS.CONTACTS, this.getAll().filter((contact) => contact.id !== id));
    },
  };

  const Voice = {
    getAll() {
      return read(KEYS.VOICE);
    },
    save(alertId, transcript, detectedType, location) {
      const all = this.getAll();
      const log = {
        id: uid(),
        alertId,
        transcript,
        detectedType: normalizeType(detectedType),
        location,
        createdAt: now(),
      };
      all.unshift(log);
      write(KEYS.VOICE, all);
      return log;
    },
    forAlert(alertId) {
      return this.getAll().filter((voice) => voice.alertId === alertId);
    },
    format(voice) {
      return { ...voice, timeFormatted: fmtTime(voice.createdAt) };
    },
  };

  const CtrlLog = {
    getAll() {
      return read(KEYS.CTRL_LOG);
    },
    add(action, detail, staffName) {
      const all = this.getAll();
      const entry = { id: uid(), action, detail, staffName: staffName || "Staff", createdAt: now() };
      all.unshift(entry);
      if (all.length > 200) all.splice(200);
      write(KEYS.CTRL_LOG, all);
      return entry;
    },
    format(entry) {
      return { ...entry, timeFormatted: fmtTime(entry.createdAt) };
    },
  };

  const Notifs = {
    getAll() {
      return read(KEYS.NOTIFS);
    },
    add(title, body, type) {
      const all = this.getAll();
      const notif = { id: uid(), title, body, type: type || "info", read: false, createdAt: now() };
      all.unshift(notif);
      if (all.length > 50) all.splice(50);
      write(KEYS.NOTIFS, all);
      return notif;
    },
    markAllRead() {
      write(KEYS.NOTIFS, this.getAll().map((notif) => ({ ...notif, read: true })));
    },
    clear() {
      write(KEYS.NOTIFS, []);
    },
    unread() {
      return this.getAll().filter((notif) => !notif.read).length;
    },
    format(notif) {
      return {
        ...notif,
        timeFormatted: new Date(notif.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
    },
  };

  const MapAssets = {
    getAll() {
      return read(KEYS.MAP_ASSETS);
    },
    save(asset) {
      const all = this.getAll();
      all.unshift({ id: uid(), createdAt: now(), ...asset });
      write(KEYS.MAP_ASSETS, all.slice(0, 50));
      return all[0];
    },
    clear() {
      write(KEYS.MAP_ASSETS, []);
    },
  };

  const MapScenes = {
    getAll() {
      return read(KEYS.MAP_SCENES);
    },
    save(scene) {
      const all = this.getAll();
      const record = { id: uid(), createdAt: now(), ...scene };
      all.unshift(record);
      write(KEYS.MAP_SCENES, all.slice(0, 20));
      return record;
    },
  };

  function seedDemoContacts() {
    if (Contacts.getAll().length) return;
    Contacts.create("Priya Sharma", "+91 98765 43210", "Medical Bay", "Medical");
    Contacts.create("Ravi Menon", "+91 99887 77665", "Fire & Rescue Unit", "Fire");
    Contacts.create("Aisha Khan", "+91 90909 12345", "Security Operations", "Police");
  }

  function seedDemoAlerts() {
    if (read(KEYS.ALERTS).length) return;

    const seeds = [
      {
        type: "Fire",
        severity: "Critical",
        location: "Floor 3 · Room 308 · Executive Wing",
        roomNumber: "308",
        floorNumber: 3,
        status: "Evacuating",
        reportedBy: "Night Manager",
        assignedResponseTeam: "Fire & Rescue Unit",
        createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        incidentSummary: "Kitchen smoke migrated into the executive corridor. AI rerouting active.",
        metadata: { occupancy: "34 occupants monitored", zone: "Executive Wing" },
      },
      {
        type: "Gas Leak",
        severity: "High",
        location: "Floor 2 · Room 214 · Service Corridor",
        roomNumber: "214",
        floorNumber: 2,
        status: "Investigating",
        reportedBy: "Engineering Desk",
        assignedResponseTeam: "HazMat Response Team",
        createdAt: new Date(Date.now() - 44 * 60 * 1000).toISOString(),
        metadata: { occupancy: "22 occupants monitored", zone: "Service Spine" },
      },
      {
        type: "Smoke Detection",
        severity: "High",
        location: "Floor 1 · Lobby Lounge",
        roomNumber: "104",
        floorNumber: 1,
        status: "Escalated",
        reportedBy: "Lobby Concierge",
        assignedResponseTeam: "Building Safety Unit",
        createdAt: new Date(Date.now() - 74 * 60 * 1000).toISOString(),
        metadata: { occupancy: "48 occupants monitored", zone: "Lobby Deck" },
      },
      {
        type: "Medical Emergency",
        severity: "High",
        location: "Floor 4 · Room 421 · Sky Lounge",
        roomNumber: "421",
        floorNumber: 4,
        status: "Resolved",
        reportedBy: "Guest Services",
        assignedResponseTeam: "Medical Response Team",
        createdAt: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
        resolvedAt: new Date(Date.now() - 98 * 60 * 1000).toISOString(),
        metadata: { occupancy: "8 occupants monitored", zone: "Sky Lounge" },
      },
      {
        type: "Security Threat",
        severity: "Critical",
        location: "Floor 2 · Conference Hall 2A",
        roomNumber: "232",
        floorNumber: 2,
        status: "Active",
        reportedBy: "Convention Desk",
        assignedResponseTeam: "Security Operations Team",
        createdAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
        metadata: { occupancy: "67 occupants monitored", zone: "Convention Core" },
      },
      {
        type: "Electrical Failure",
        severity: "Medium",
        location: "Floor 1 · Operations Room",
        roomNumber: "116",
        floorNumber: 1,
        status: "False Alarm",
        reportedBy: "Control Operator",
        assignedResponseTeam: "Engineering Response Team",
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        resolvedAt: new Date(Date.now() - 4.5 * 60 * 60 * 1000).toISOString(),
        metadata: { occupancy: "15 occupants monitored", zone: "Ops Core" },
      },
    ];

    const created = seeds.map((seed, index) =>
      buildAlertRecord(
        {
          id: uid(),
          ...seed,
        },
        index
      )
    );

    write(KEYS.ALERTS, created.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  function seedDemoVoiceLogs() {
    if (Voice.getAll().length) return;
    const alerts = normalizeStoredAlerts();
    if (!alerts.length) return;

    const transcripts = {
      Fire: "Smoke visible near the executive pantry. Corridor lights switched to evac mode.",
      "Gas Leak": "Sensor cluster reports a pressure anomaly near the service branch.",
      "Smoke Detection": "Lobby lounge alarm triggered after haze was seen near the bar soffit.",
      "Medical Emergency": "Guest requested immediate medical support at the sky lounge booth.",
      "Security Threat": "Security patrol requested controlled evacuation around the conference annex.",
      "Electrical Failure": "Breaker spike cleared after inspection. No residual hazard remains.",
    };

    const logs = alerts.slice(0, 5).map((alert) => ({
      id: uid(),
      alertId: alert.id,
      transcript: transcripts[alert.crisisType] || "Command center voice transcript unavailable.",
      detectedType: alert.crisisType,
      location: alert.location,
      createdAt: alert.createdAt,
    }));
    write(KEYS.VOICE, logs);
  }

  Users.seed();
  seedDemoContacts();

  return {
    Users,
    Session,
    Alerts,
    Contacts,
    Voice,
    CtrlLog,
    Notifs,
    MapAssets,
    MapScenes,
    uid,
    fmtTime,
    fmtDate,
    fmtClock,
    slugify,
    normalizeStatus,
    isOpenStatus,
  };
})();

window.DB = DB;
