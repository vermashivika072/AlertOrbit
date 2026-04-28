(function attachDashboardHomeNavigation() {
  "use strict";

  function getDashboardHomeUrl() {
    return window.AlertOrbitConfig?.DASHBOARD_HOME_URL || "dashboard.html?view=overview";
  }

  function isDashboardPage() {
    const pathname = window.location.pathname.replace(/\\/g, "/").toLowerCase();
    return pathname.endsWith("/dashboard.html") || pathname.endsWith("dashboard.html");
  }

  function goToDashboardHome(event) {
    if (event) {
      event.preventDefault();
    }

    if (isDashboardPage() && typeof window.switchView === "function") {
      window.switchView("overview");
      return false;
    }

    window.location.assign(getDashboardHomeUrl());
    return false;
  }

  function bindDashboardHomeLinks() {
    if (document.body?.dataset.dashboardHomeDisabled === "true") {
      return;
    }

    document.querySelectorAll("[data-dashboard-home]").forEach((element) => {
      if (element.dataset.dashboardHomeBound === "true") {
        return;
      }

      element.dataset.dashboardHomeBound = "true";
      element.classList.add("dashboard-home-trigger");
      element.setAttribute("aria-label", element.getAttribute("aria-label") || "Go to Dashboard");

      if (element.tagName === "A") {
        element.setAttribute("href", getDashboardHomeUrl());
      } else {
        element.setAttribute("role", "link");
        if (!element.hasAttribute("tabindex")) {
          element.tabIndex = 0;
        }
      }

      element.addEventListener("click", (event) => {
        if (event.defaultPrevented) {
          return;
        }

        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        if (event.button && event.button !== 0) {
          return;
        }

        goToDashboardHome(event);
      });

      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        goToDashboardHome(event);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", bindDashboardHomeLinks);

  window.AlertOrbitShell = {
    bindDashboardHomeLinks,
    getDashboardHomeUrl,
    goToDashboardHome,
  };
})();
