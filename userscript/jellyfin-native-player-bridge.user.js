// ==UserScript==
// @name         Jellyfin Native Player Bridge
// @namespace    https://github.com/zixin-su/jellyfin-native-player-bridge
// @version      0.1.0
// @description  Intercept Jellyfin Web play buttons and open media through a local native player bridge.
// @author       zixin-su
// @match        __JNPB_JELLYFIN_MATCH__
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      127.0.0.1
// @connect      localhost
// @downloadURL  __JNPB_USERSCRIPT_URL__
// @updateURL    __JNPB_USERSCRIPT_URL__
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    serviceHost: "__JNPB_SERVICE_HOST__",
    servicePort: Number("__JNPB_SERVICE_PORT__") || 45789,
    serviceToken: "__JNPB_SERVICE_TOKEN__",
    source: "tampermonkey"
  };

  if (!CONFIG.serviceHost || CONFIG.serviceHost.startsWith("__JNPB_")) {
    CONFIG.serviceHost = "127.0.0.1";
  }
  if (!CONFIG.serviceToken || CONFIG.serviceToken.startsWith("__JNPB_")) {
    CONFIG.serviceToken = "";
  }

  const PLAY_TEXT_RE = /(播放|继续播放|play|resume|watch now|watch)/i;
  const PLAY_CLASS_RE = /(^|[-_\s])(btnplay|btnresume|play|resume|cardoverlaybutton)([-_\s]|$)/i;
  const UUIDISH_RE = /^[a-f0-9]{8,32}$/i;
  const JELLYFIN_HINT_RE = /(jellyfin|emby|mediabrowser)/i;
  const CARD_SELECTOR = ".card, .cardBox, .cardScalable, .portraitCard, .squareCard, .backdropCard, .listItem, [data-id], [data-itemid], [data-item-id]";

  function asElement(value) {
    if (!value) {
      return null;
    }
    if (value.nodeType === Node.ELEMENT_NODE) {
      return value;
    }
    return value.parentElement || null;
  }

  function storageKeys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function isLikelyJellyfinPage() {
    const html = document.documentElement?.innerHTML?.slice(0, 5000) || "";
    const bodyText = document.body?.textContent || "";
    const localStorageKeys = storageKeys().join(" ");
    return (
      JELLYFIN_HINT_RE.test(html) ||
      JELLYFIN_HINT_RE.test(localStorageKeys) ||
      /jellyfin_credentials/i.test(localStorageKeys) ||
      ((/\/web\/|#!\/|#\/|\/details/i.test(location.href)) && /jellyfin|emby/i.test(bodyText.slice(0, 20000)))
    );
  }

  function normalizeId(value) {
    if (!value) {
      return "";
    }
    const cleaned = String(value).trim().replace(/-/g, "");
    return UUIDISH_RE.test(cleaned) ? cleaned : "";
  }

  function getUrlParamFromText(text, names) {
    if (!text) {
      return "";
    }

    const candidates = [text];
    try {
      const parsed = new URL(text, location.href);
      candidates.push(parsed.search, parsed.hash);
      const hashQuestion = parsed.hash.indexOf("?");
      if (hashQuestion >= 0) {
        candidates.push(parsed.hash.slice(hashQuestion));
      }
    } catch {
      candidates.push(text);
    }

    for (const candidate of candidates) {
      for (const name of names) {
        const match = String(candidate).match(new RegExp(`[?&#]${name}=([^&#]+)`, "i"));
        const id = normalizeId(match && decodeURIComponent(match[1]));
        if (id) {
          return id;
        }
      }
    }
    return "";
  }

  function extractItemIdFromElement(element) {
    let current = element;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 10) {
      const dataset = current.dataset || {};
      const attrs = [
        dataset.id,
        dataset.itemid,
        dataset.itemId,
        dataset.item,
        current.getAttribute("data-id"),
        current.getAttribute("data-itemid"),
        current.getAttribute("data-item-id"),
        current.getAttribute("data-item"),
        current.getAttribute("item-id"),
        current.id
      ];

      for (const value of attrs) {
        const id = normalizeId(value);
        if (id) {
          return id;
        }
      }

      const urls = [
        current.getAttribute("href"),
        current.getAttribute("data-href"),
        current.getAttribute("data-url"),
        current.getAttribute("data-target"),
        current.getAttribute("formaction")
      ];
      for (const value of urls) {
        const id = getUrlParamFromText(value, ["id", "itemId", "itemid"]);
        if (id) {
          return id;
        }
      }

      current = current.parentElement;
      depth += 1;
    }

    const card = element.closest?.(CARD_SELECTOR);
    if (card) {
      const values = [
        card.getAttribute("data-id"),
        card.getAttribute("data-itemid"),
        card.getAttribute("data-item-id"),
        card.querySelector?.("[data-id]")?.getAttribute("data-id"),
        card.querySelector?.("[data-itemid]")?.getAttribute("data-itemid"),
        card.querySelector?.("[data-item-id]")?.getAttribute("data-item-id")
      ];
      for (const value of values) {
        const id = normalizeId(value);
        if (id) {
          return id;
        }
      }

      const links = card.querySelectorAll?.("a[href], [data-href], [data-url]") || [];
      for (const link of links) {
        const id = getUrlParamFromText(
          link.getAttribute("href") || link.getAttribute("data-href") || link.getAttribute("data-url"),
          ["id", "itemId", "itemid"]
        );
        if (id) {
          return id;
        }
      }
    }

    return "";
  }

  function extractItemIdFromPage() {
    return getUrlParamFromText(location.href, ["id", "itemId", "itemid"]);
  }

  function extractStartPositionTicks(element) {
    let current = element;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 10) {
      const dataset = current.dataset || {};
      const values = [
        dataset.startPositionTicks,
        dataset.startpositionticks,
        current.getAttribute("data-start-position-ticks"),
        current.getAttribute("data-startpositionticks"),
        current.getAttribute("data-positionticks")
      ];
      for (const value of values) {
        const ticks = Number(value);
        if (Number.isFinite(ticks) && ticks > 0) {
          return ticks;
        }
      }
      current = current.parentElement;
      depth += 1;
    }
    return 0;
  }

  function getElementText(element) {
    const pieces = [];
    let current = element;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 3) {
      pieces.push(
        current.getAttribute("aria-label") || "",
        current.getAttribute("title") || "",
        current.getAttribute("data-action") || "",
        current.getAttribute("data-command") || "",
        current.getAttribute("class") || "",
        current.textContent || ""
      );
      current = current.parentElement;
      depth += 1;
    }
    return pieces.join(" ").slice(0, 1000);
  }

  function isPlayElement(element) {
    if (!element) {
      return false;
    }

    const target = element.closest(
      [
        "button",
        "a",
        "[role='button']",
        "[data-action]",
        "[data-command]",
        ".btnPlay",
        ".btnResume",
        ".cardOverlayButton"
      ].join(",")
    );
    if (!target) {
      return false;
    }

    const text = getElementText(target);
    if (/shuffle|trailer|预告|随机|菜单|more/i.test(text)) {
      return false;
    }

    return PLAY_TEXT_RE.test(text) || PLAY_CLASS_RE.test(text);
  }

  function readJson(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function serverAddressMatches(server) {
    const values = [
      server.ManualAddress,
      server.LocalAddress,
      server.RemoteAddress,
      server.Address,
      server.Url,
      server.url
    ].filter(Boolean);

    return values.some((value) => {
      try {
        const parsed = new URL(value);
        return parsed.origin === location.origin;
      } catch {
        return false;
      }
    });
  }

  function pickServerAddress(server) {
    const values = [
      server.ManualAddress,
      server.LocalAddress,
      server.RemoteAddress,
      server.Address,
      server.Url,
      server.url,
      location.origin
    ];
    for (const value of values) {
      if (!value) {
        continue;
      }
      try {
        const parsed = new URL(value, location.origin);
        return parsed.origin + parsed.pathname.replace(/\/web\/?$/i, "").replace(/\/$/, "");
      } catch {
        continue;
      }
    }
    return location.origin;
  }

  function credentialsFromKnownKeys() {
    const credentials = readJson(storageGet("jellyfin_credentials"));
    const servers = credentials?.Servers || credentials?.servers;
    if (Array.isArray(servers)) {
      const server =
        servers.find(serverAddressMatches) ||
        servers.find((item) => item.AccessToken && item.UserId) ||
        servers[0];
      if (server?.AccessToken && server?.UserId) {
        return {
          serverUrl: pickServerAddress(server),
          token: server.AccessToken,
          userId: server.UserId
        };
      }
    }

    const keys = [
      "embyservercredentials",
      "servercredentials",
      "apiclientcredentials",
      "jellyfin_apiclient_credentials"
    ];
    for (const key of keys) {
      const value = readJson(storageGet(key));
      const token = value?.AccessToken || value?.accessToken || value?.Token || value?.token;
      const userId = value?.UserId || value?.userId || value?.User?.Id || value?.user?.id;
      if (token && userId) {
        return {
          serverUrl: pickServerAddress(value),
          token,
          userId
        };
      }
    }
    return null;
  }

  function findCredentialObject(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 5) {
      return null;
    }
    const token = value.AccessToken || value.accessToken || value.Token || value.token || value.ApiKey || value.apiKey;
    const userId = value.UserId || value.userId || value.User?.Id || value.user?.id;
    if (token && userId) {
      return {
        serverUrl: pickServerAddress(value),
        token,
        userId
      };
    }
    for (const child of Object.values(value)) {
      const found = findCredentialObject(child, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function readJellyfinCredentials() {
    const known = credentialsFromKnownKeys();
    if (known) {
      return known;
    }

    for (const key of storageKeys()) {
      if (!/jellyfin|emby|server|credential|api|token/i.test(key)) {
        continue;
      }
      const parsed = readJson(storageGet(key));
      const found = findCredentialObject(parsed);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function closestTitle(element) {
    let current = element;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 8) {
      const values = [
        current.getAttribute("aria-label"),
        current.getAttribute("title"),
        current.getAttribute("data-title"),
        current.querySelector?.(".cardText")?.textContent,
        current.querySelector?.(".itemName")?.textContent,
        current.querySelector?.("h1,h2,h3")?.textContent
      ];
      for (const value of values) {
        const text = String(value || "").trim();
        if (text && !PLAY_TEXT_RE.test(text)) {
          return text.slice(0, 200);
        }
      }
      current = current.parentElement;
      depth += 1;
    }
    return document.querySelector("h1")?.textContent?.trim()?.slice(0, 200) || "";
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "right:18px",
      "bottom:18px",
      "max-width:360px",
      "padding:10px 12px",
      "border-radius:6px",
      "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      `background:${isError ? "#8f1d1d" : "#143d2a"}`,
      "color:#fff",
      "box-shadow:0 8px 24px rgba(0,0,0,.28)"
    ].join(";");
    (document.documentElement || document.body).appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  function serviceBaseUrl() {
    return `http://${CONFIG.serviceHost}:${CONFIG.servicePort}`;
  }

  function callService(path, body) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (CONFIG.serviceToken) {
      headers["X-JEP-Token"] = CONFIG.serviceToken;
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${serviceBaseUrl()}${path}`,
        headers,
        data: JSON.stringify(body || {}),
        timeout: 12000,
        onload(response) {
          let payload = {};
          if (response.responseText) {
            try {
              payload = JSON.parse(response.responseText);
            } catch {
              payload = { raw: response.responseText };
            }
          }
          if (response.status < 200 || response.status >= 300 || payload.ok === false) {
            reject(new Error(payload.error || `Service returned HTTP ${response.status}`));
            return;
          }
          resolve(payload);
        },
        onerror() {
          reject(new Error("Local player bridge request failed"));
        },
        ontimeout() {
          reject(new Error("Local player bridge request timed out"));
        }
      });
    });
  }

  async function interceptPlay(event) {
    const eventTarget = asElement(event.target);
    if (!eventTarget || !isLikelyJellyfinPage() || !isPlayElement(eventTarget)) {
      return;
    }

    const target = eventTarget.closest("button,a,[role='button'],[data-action],[data-command]") || eventTarget;
    const itemId = extractItemIdFromElement(target) || extractItemIdFromPage();
    const credentials = readJellyfinCredentials();

    if (!itemId || !credentials) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      const response = await callService("/play", {
        serverUrl: credentials.serverUrl || location.origin,
        itemId,
        userId: credentials.userId,
        token: credentials.token,
        startPositionTicks: extractStartPositionTicks(target),
        itemName: closestTitle(target),
        pageUrl: location.href,
        source: CONFIG.source
      });
      const name = response.playableItem?.name || "Playback sent to local player";
      showToast(name);
    } catch (error) {
      showToast(error.message || "Failed to send playback to local player", true);
      try {
        GM_notification({
          title: "Jellyfin playback failed",
          text: error.message || "Failed to send playback to local player",
          timeout: 3500
        });
      } catch {
        // Ignore notification failures; the in-page toast is enough.
      }
    }
  }

  function onKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    interceptPlay(event);
  }

  document.addEventListener("click", interceptPlay, true);
  document.addEventListener("keydown", onKeyDown, true);
})();
