/**
 * multilingualCommunication.js
 *
 * Setup
 * - Required runtime: modern browser with fetch, or Node.js 18+ with fetch
 * - API: Google Cloud Translation API v2
 * - Environment variables for server-side use:
 *   GOOGLE_CLOUD_TRANSLATION_API_KEY=your_key_here
 *   ALERTORBIT_TRANSLATION_PROXY_URL=https://your-backend.example.com/api/translate (optional)
 * - Production guidance:
 *   keep Google API keys on the server; in the browser use a backend proxy endpoint instead
 * - Example usage:
 *   const comms = MultilingualCommunication.createService({
 *     apiKey: process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY
 *   });
 *   const response = await comms.createEmergencyNotification({
 *     emergencyType: "fire",
 *     alertMessage: "Fire detected on Floor 2. Please evacuate immediately.",
 *     severityLevel: "critical",
 *     location: "Floor 2, East Wing"
 *   });
 * - Integration points:
 *   FastAPI / Express translation endpoint
 *   voice AI adapters
 *   speech-to-text / text-to-speech pipelines
 *   WhatsApp, SMS, in-app push, emergency call workflows
 */

(function attachMultilingualCommunication(root) {
  "use strict";

  const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
  const DEFAULT_TIMEOUT_MS = 8000;
  const DEFAULT_LANGUAGE_CONFIG = [
    { code: "en", label: "English" },
    { code: "hi", label: "Hindi" },
    { code: "ar", label: "Arabic" },
    { code: "zh-CN", label: "Chinese" },
    { code: "fr", label: "French" },
  ];

  function readEnv(name) {
    return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  }

  function hasFetch() {
    return typeof fetch === "function";
  }

  function normalizeLanguageCodes(languages) {
    const selected = Array.isArray(languages) && languages.length ? languages : DEFAULT_LANGUAGE_CONFIG;
    return selected.map((item) => {
      if (typeof item === "string") {
        const matched = DEFAULT_LANGUAGE_CONFIG.find((candidate) => candidate.code === item);
        return matched || { code: item, label: item };
      }
      return item;
    });
  }

  function toSeverity(value) {
    return String(value || "medium").trim().toLowerCase();
  }

  function titleCase(value) {
    return String(value || "")
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function decodeHtmlEntities(text) {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    }

    return String(text || "")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function createAbortSignal(timeoutMs) {
    if (typeof AbortController === "undefined") {
      return { signal: undefined, cancel: () => {} };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      cancel: () => clearTimeout(timer),
    };
  }

  class TranslationServiceError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "TranslationServiceError";
      this.details = details || null;
    }
  }

  class MultilingualCommunicationService {
    constructor(config = {}) {
      this.fetchImpl = config.fetchImpl || (hasFetch() ? fetch.bind(root) : null);
      this.apiKey = config.apiKey || readEnv("GOOGLE_CLOUD_TRANSLATION_API_KEY") || readEnv("GOOGLE_API_KEY") || "";
      this.translationProxyUrl = config.translationProxyUrl || readEnv("ALERTORBIT_TRANSLATION_PROXY_URL") || "";
      this.defaultSourceLanguage = config.defaultSourceLanguage || "en";
      this.defaultLanguages = normalizeLanguageCodes(config.defaultLanguages);
      this.timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
      this.channelAdapters = new Map();
    }

    registerChannelAdapter(channelName, adapter) {
      if (!channelName || typeof adapter?.send !== "function") {
        throw new Error("Channel adapters must provide a send(notification) function.");
      }
      this.channelAdapters.set(channelName, adapter);
      return this;
    }

    composeEmergencyMessage(payload) {
      const emergencyType = titleCase(payload.emergencyType || "Emergency");
      const severity = toSeverity(payload.severityLevel);
      const location = payload.location ? ` at ${payload.location}` : "";
      const coreMessage = String(payload.alertMessage || "").trim();

      const severityLead = {
        low: "Safety update.",
        medium: "Emergency update.",
        high: "Urgent safety update.",
        critical: "Immediate action required.",
      }[severity] || "Emergency update.";

      const actionLine = {
        low: "Please stay calm and follow hotel staff instructions.",
        medium: "Please move carefully to a safe area and follow hotel staff instructions.",
        high: "Please evacuate now using the nearest safe marked route and follow staff instructions.",
        critical: "Please evacuate immediately using the nearest safe marked route and follow staff instructions.",
      }[severity] || "Please follow hotel staff instructions.";

      return `${severityLead} ${emergencyType} reported${location}. ${coreMessage} ${actionLine}`.replace(/\s+/g, " ").trim();
    }

    async translateText(text, targetLanguage, options = {}) {
      if (!text) {
        return "";
      }

      const sourceLanguage = options.sourceLanguage || this.defaultSourceLanguage;
      if (targetLanguage === sourceLanguage) {
        return text;
      }

      const response = await this.#requestTranslation({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: "text",
      });

      const translatedText = response?.data?.translations?.[0]?.translatedText;
      if (!translatedText) {
        throw new TranslationServiceError("Google Translation API returned an empty translation.", response);
      }

      return decodeHtmlEntities(translatedText);
    }

    async translateAlert(text, languages, options = {}) {
      const selectedLanguages = normalizeLanguageCodes(languages || this.defaultLanguages);
      const results = await Promise.all(selectedLanguages.map(async (language) => {
        try {
          const translatedText = await this.translateText(text, language.code, options);
          return {
            languageCode: language.code,
            languageLabel: language.label,
            translatedText,
            status: "translated",
          };
        } catch (error) {
          return {
            languageCode: language.code,
            languageLabel: language.label,
            translatedText: text,
            status: "fallback",
            error: error.message,
          };
        }
      }));

      return results;
    }

    async createEmergencyNotification(payload) {
      const sourceText = this.composeEmergencyMessage(payload);
      const translations = await this.translateAlert(sourceText, payload.languages, {
        sourceLanguage: payload.sourceLanguage || this.defaultSourceLanguage,
      });

      return {
        venueType: payload.venueType || "hotel",
        emergencyType: titleCase(payload.emergencyType || "Emergency"),
        severityLevel: toSeverity(payload.severityLevel),
        location: payload.location || "Unknown location",
        sourceLanguage: payload.sourceLanguage || this.defaultSourceLanguage,
        sourceText,
        translations,
        formattedByLanguage: this.formatTranslationsByLanguage(translations),
        deliveryBlueprint: this.createDeliveryBlueprint(translations),
        createdAt: new Date().toISOString(),
      };
    }

    formatTranslationsByLanguage(translations) {
      return translations.reduce((accumulator, item) => {
        accumulator[item.languageCode] = {
          language: item.languageLabel,
          text: item.translatedText,
          status: item.status,
        };
        return accumulator;
      }, {});
    }

    createDeliveryBlueprint(translations) {
      return {
        inApp: translations.map((item) => ({
          languageCode: item.languageCode,
          message: item.translatedText,
        })),
        voiceAnnouncement: translations.map((item) => ({
          languageCode: item.languageCode,
          script: item.translatedText,
          readyForTts: false,
        })),
        externalChannels: [
          { channel: "sms", ready: false },
          { channel: "whatsapp", ready: false },
          { channel: "phone-bridge", ready: false },
        ],
      };
    }

    async dispatchNotification(notification, channelNames = []) {
      const responses = [];
      for (const channelName of channelNames) {
        const adapter = this.channelAdapters.get(channelName);
        if (!adapter) {
          responses.push({
            channel: channelName,
            status: "skipped",
            reason: "No adapter registered for this channel.",
          });
          continue;
        }

        try {
          const result = await adapter.send(notification);
          responses.push({
            channel: channelName,
            status: "sent",
            result,
          });
        } catch (error) {
          responses.push({
            channel: channelName,
            status: "failed",
            reason: error.message,
          });
        }
      }
      return responses;
    }

    async #requestTranslation(payload) {
      if (!this.fetchImpl) {
        throw new TranslationServiceError("fetch is unavailable in this runtime. Provide fetchImpl in the service config.");
      }

      const requestUrl = this.translationProxyUrl
        ? this.translationProxyUrl
        : `${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(this.apiKey)}`;

      if (!this.translationProxyUrl && !this.apiKey) {
        throw new TranslationServiceError("Missing Google Translation API key. Set GOOGLE_CLOUD_TRANSLATION_API_KEY or provide translationProxyUrl.");
      }

      const { signal, cancel } = createAbortSignal(this.timeoutMs);

      try {
        const response = await this.fetchImpl(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new TranslationServiceError("Translation request failed.", {
            status: response.status,
            body: errorText,
          });
        }

        return await response.json();
      } finally {
        cancel();
      }
    }
  }

  const EXAMPLE_EMERGENCY_PAYLOAD = {
    venueType: "hotel",
    emergencyType: "fire",
    alertMessage: "Fire detected on Floor 2. Please evacuate immediately.",
    severityLevel: "critical",
    location: "Floor 2, East Wing",
    languages: DEFAULT_LANGUAGE_CONFIG,
  };

  const MultilingualCommunication = {
    DEFAULT_LANGUAGE_CONFIG,
    EXAMPLE_EMERGENCY_PAYLOAD,
    TranslationServiceError,
    createService(config) {
      return new MultilingualCommunicationService(config);
    },
    MultilingualCommunicationService,
  };

  root.MultilingualCommunication = MultilingualCommunication;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MultilingualCommunication;
  }
})(typeof window !== "undefined" ? window : globalThis);
