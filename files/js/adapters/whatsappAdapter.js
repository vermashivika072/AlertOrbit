(function attachWhatsappAdapter(root) {
  "use strict";

  function createWhatsappAdapter(options = {}) {
    return {
      channel: "whatsapp",
      async send(notification) {
        if (!options.endpoint) {
          return {
            status: "queued-placeholder",
            note: "Attach a secure backend WhatsApp integration route. Example provider: Twilio WhatsApp or Meta-hosted messaging.",
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

  root.WhatsAppAdapterFactory = { createWhatsappAdapter };
})(typeof window !== "undefined" ? window : globalThis);
