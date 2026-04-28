(function attachVoiceAdapter(root) {
  "use strict";

  function createVoiceAdapter(options = {}) {
    return {
      channel: "voice",
      async send(notification) {
        if (!options.endpoint) {
          return {
            status: "queued-placeholder",
            note: "Connect a secure backend voice/TTS endpoint. Example providers: Twilio Voice, Azure Speech, or Google Cloud TTS.",
            preview: notification.deliveryBlueprint?.voiceAnnouncement || [],
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

  root.VoiceAdapterFactory = { createVoiceAdapter };
})(typeof window !== "undefined" ? window : globalThis);
