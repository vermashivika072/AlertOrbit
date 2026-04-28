(function attachPushAdapter(root) {
  "use strict";

  function createPushAdapter(options = {}) {
    return {
      channel: "push",
      async send(notification) {
        if (!options.endpoint) {
          return {
            status: "queued-placeholder",
            note: "Attach a backend push route. Example provider: Firebase Cloud Messaging through server-side credentials.",
            preview: notification.deliveryBlueprint?.inApp || [],
          };
        }

        const response = await fetch(options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notification),
        });
        return response.json();
      },
    };
  }

  root.PushAdapterFactory = { createPushAdapter };
})(typeof window !== "undefined" ? window : globalThis);
