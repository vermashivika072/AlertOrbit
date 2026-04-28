(function attachSmsAdapter(root) {
  "use strict";

  function createSmsAdapter(options = {}) {
    return {
      channel: "sms",
      async send(notification) {
        if (!options.endpoint) {
          return {
            status: "queued-placeholder",
            note: "Configure a secure backend SMS endpoint. Example provider: Twilio via server-side credentials.",
            preview: notification.sourceText,
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

  root.SMSAdapterFactory = { createSmsAdapter };
})(typeof window !== "undefined" ? window : globalThis);
