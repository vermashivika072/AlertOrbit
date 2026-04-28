(function attachEmailAdapter(root) {
  "use strict";

  function createEmailAdapter(options = {}) {
    return {
      channel: "email",
      async send(notification) {
        if (!options.endpoint) {
          return {
            status: "queued-placeholder",
            note: "Attach a secure backend email route. Example providers: SendGrid, SES, Postmark, or custom SMTP relay.",
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

  root.EmailAdapterFactory = { createEmailAdapter };
})(typeof window !== "undefined" ? window : globalThis);
