/**
 * main.js
 *
 * Landing page entry point.
 * The SOS wiring is defensive so one optional service failing does not stop
 * the emergency button from working.
 */

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.LocationService && typeof LocationService.init === "function") {
      LocationService.init();
    }
  } catch (error) {
    console.warn("LocationService init failed:", error);
  }

  try {
    _initNetworkMonitor();
  } catch (error) {
    console.warn("Network monitor init failed:", error);
  }

  const sosBtn = document.getElementById("sosBtn");
  if (sosBtn) {
    const trigger = () => {
      if (window.SOSEngine && typeof SOSEngine.triggerSOS === "function") {
        SOSEngine.triggerSOS();
      } else {
        console.error("SOSEngine is unavailable.");
      }
    };

    sosBtn.addEventListener("click", trigger);
    sosBtn.addEventListener("touchend", (event) => {
      event.preventDefault();
      trigger();
    });
    sosBtn.addEventListener("pointerdown", () => sosBtn.classList.add("pressing"));
    sosBtn.addEventListener("pointerup", () => sosBtn.classList.remove("pressing"));
    sosBtn.addEventListener("pointerleave", () => sosBtn.classList.remove("pressing"));
  }

  const abortBtn = document.getElementById("abortBtn");
  if (abortBtn) abortBtn.addEventListener("click", () => window.SOSEngine?.abortSOS?.());

  const skipBtn = document.getElementById("skipVoiceBtn");
  if (skipBtn) skipBtn.addEventListener("click", () => window.SOSEngine?.skipVoice?.());

  const resolveBtn = document.getElementById("resolveBtn");
  if (resolveBtn) resolveBtn.addEventListener("click", () => window.SOSEngine?.resolveSOS?.());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (window.SOSEngine?.getState?.() === "countdown") SOSEngine.abortSOS();
      if (window.SOSEngine?.getState?.() === "voice") SOSEngine.skipVoice();
    }
  });

  ["countdownOverlay", "voiceOverlay"].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener("click", (event) => {
      if (event.target !== element) return;
      if (window.SOSEngine?.getState?.() === "countdown") SOSEngine.abortSOS();
      if (window.SOSEngine?.getState?.() === "voice") SOSEngine.skipVoice();
    });
  });

  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(() => Notification.requestPermission(), 3000);
  }
});

function quickCall(name, number) {
  const canCall = /Mobi|Android|iPhone/i.test(navigator.userAgent);
  if (canCall) {
    window.location.href = `tel:${number}`;
  } else {
    showToast(`Calling ${name} - ${number}`);
  }
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById("toastMsg");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
    }, 200);
  }, duration);
}

function _initNetworkMonitor() {
  const netText = document.getElementById("networkText");
  const netBadge = document.getElementById("netBadge");

  function update() {
    const online = navigator.onLine;
    if (netText) netText.textContent = online ? "Online" : "Offline";
    if (netBadge) {
      netBadge.textContent = online ? "OK" : "ERROR";
      netBadge.className = "sc-badge " + (online ? "sc-badge--ok" : "sc-badge--error");
    }
  }

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

window.quickCall = quickCall;
window.showToast = showToast;
