/**
 * notifications.js — Push notification management + real-time polling
 *
 * Uses Notification API for browser push notifications.
 * Polls localStorage every 3 seconds to simulate real-time updates
 * (replace with WebSocket / SSE in production).
 */

const NotifService = (() => {
  let _pollInterval = null;
  let _lastAlertCount = 0;
  let _notifPanelOpen = false;

  function init() {
    _lastAlertCount = DB.Alerts.getAll().length;

    // Show push permission banner if not decided
    if ('Notification' in window && Notification.permission === 'default') {
      const banner = document.getElementById('pushBanner');
      if (banner) {
        setTimeout(() => { banner.hidden = false; }, 2000);
      }
    }

    // Start polling
    _pollInterval = setInterval(_poll, 3000);
    _poll(); // immediate
  }

  function _poll() {
    const alerts = DB.Alerts.getAll();
    const newCount = alerts.length;

    // Detect new alerts since last poll
    if (newCount > _lastAlertCount) {
      const newest = alerts.slice(0, newCount - _lastAlertCount);
      newest.forEach(alert => {
        if (alert.status === 'active') {
          _onNewAlert(alert);
        }
      });
    }
    _lastAlertCount = newCount;

    // Update badge count
    _updateBellBadge();

    // Refresh dashboard views if they are open
    if (typeof refreshDashboard === 'function') refreshDashboard();
  }

  function _onNewAlert(alert) {
    // Add to notif store
    DB.Notifs.add(
      `🚨 New SOS — ${alert.type}`,
      `${alert.location} · ${new Date(alert.createdAt).toLocaleTimeString()}`,
      'sos'
    );

    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification('🚨 SOS Alert Triggered', {
        body:  `Type: ${alert.type}\nLocation: ${alert.location}`,
        icon:  '/favicon.ico',
        badge: '/favicon.ico',
        tag:   'sos-' + alert.id,
        requireInteraction: true,
      });
    }

    // Update bell badge
    _updateBellBadge();

    // Add to panel list
    _addNotifToPanel(alert);

    // Alert count badge in sidebar
    const sbBadge = document.getElementById('sbAlertBadge');
    if (sbBadge) {
      const active = DB.Alerts.getActive().length;
      sbBadge.textContent = active;
    }

    // Flash the document title
    _flashTitle(`🚨 SOS ALERT — ${alert.type}`);
  }

  function _updateBellBadge() {
    const count = DB.Notifs.unread();
    const badge = document.getElementById('bellCount');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function _addNotifToPanel(alert) {
    const list = document.getElementById('npList');
    if (!list) return;

    const empty = list.querySelector('.np-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'np-item np-item--sos';
    item.innerHTML = `
      <span class="np-item__title">🚨 SOS — ${_esc(alert.type)}</span>
      <span class="np-item__body">${_esc(alert.location)}</span>
      <span class="np-item__time">${new Date(alert.createdAt).toLocaleTimeString()}</span>
    `;
    list.prepend(item);
  }

  function _flashTitle(msg) {
    const original = document.title;
    let flashing = true;
    let count = 0;
    const interval = setInterval(() => {
      document.title = flashing ? msg : original;
      flashing = !flashing;
      count++;
      if (count >= 10) {
        clearInterval(interval);
        document.title = original;
      }
    }, 600);
  }

  function _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function requestPushPermission() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(perm => {
      dismissPushBanner();
      if (perm === 'granted') showToast('Push notifications enabled ✓');
    });
  }

  function dismissPushBanner() {
    const b = document.getElementById('pushBanner');
    if (b) b.hidden = true;
  }

  function toggleNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    _notifPanelOpen = !_notifPanelOpen;
    panel.hidden = !_notifPanelOpen;
    if (_notifPanelOpen) {
      DB.Notifs.markAllRead();
      _updateBellBadge();
    }
  }

  function clearNotifs() {
    DB.Notifs.clear();
    const list = document.getElementById('npList');
    if (list) list.innerHTML = '<p class="np-empty">No notifications yet.</p>';
    _updateBellBadge();
  }

  function destroy() {
    if (_pollInterval) clearInterval(_pollInterval);
  }

  return { init, requestPushPermission, dismissPushBanner, toggleNotifPanel, clearNotifs, destroy };
})();

window.NotifService          = NotifService;
window.requestPushPermission = NotifService.requestPushPermission.bind(NotifService);
window.dismissPushBanner     = NotifService.dismissPushBanner.bind(NotifService);
window.toggleNotifPanel      = NotifService.toggleNotifPanel.bind(NotifService);
window.clearNotifs           = NotifService.clearNotifs.bind(NotifService);
