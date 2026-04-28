const API_BASE = window.ALERTORBIT_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/i, "ws");
const APP_PREFIX = window.location.pathname.replace(/\\/g, "/").includes("/staff/") ? "../" : "";
const resolveAppPath = (path) => `${APP_PREFIX}${String(path || "").replace(/^\.\//, "")}`;

window.AlertOrbitConfig = {
  API_BASE,
  WS_BASE,
  EMERGENCY_WS_URL: `${WS_BASE}/ws/emergency-alerts`,
  EMERGENCY_ALERTS_ENDPOINT: `${API_BASE}/emergency-alerts`,
  TRANSLATE_ENDPOINT: `${API_BASE}/translate`,
  EMERGENCY_CONFIG_ENDPOINT: `${API_BASE}/emergency-config`,
  POST_LOGIN_URL: resolveAppPath("dashboard.html"),
  DASHBOARD_URL: resolveAppPath("dashboard.html"),
  DASHBOARD_HOME_URL: resolveAppPath("dashboard.html?view=overview"),
  STAFF_LOGIN_URL: resolveAppPath("staff-login.html"),
  resolveAppPath,
  SUPPORTED_LANGUAGES: ["en", "hi", "ar", "zh-CN", "fr"],
  SUPPORTED_EMERGENCY_TYPES: [
    "Fire",
    "Medical Emergency",
    "Security Threat",
    "Natural Disaster",
    "Suspicious Activity",
    "Evacuation Notice",
    "System Alert",
  ],
  SUPPORTED_SEVERITIES: ["low", "medium", "high", "critical"],
};

window.API_BASE = API_BASE;
