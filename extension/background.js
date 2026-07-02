"use strict";

try {
  importScripts("default-config.js");
} catch {
  globalThis.JEP_DEFAULT_CONFIG = globalThis.JEP_DEFAULT_CONFIG || {};
}

const browserApi = globalThis.browser || globalThis.chrome;

const DEFAULTS = {
  serviceHost: "127.0.0.1",
  servicePort: 45789,
  serviceToken: "",
  notifyOnSuccess: false,
  ...globalThis.JEP_DEFAULT_CONFIG
};

function storageGet(keys) {
  return new Promise((resolve) => {
    browserApi.storage.local.get(keys, resolve);
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    browserApi.storage.local.set(value, resolve);
  });
}

async function getSettings() {
  const stored = await storageGet(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    servicePort: Number(stored.servicePort || DEFAULTS.servicePort)
  };
}

function serviceBaseUrl(settings) {
  const host = String(settings.serviceHost || DEFAULTS.serviceHost).trim();
  const port = Number(settings.servicePort || DEFAULTS.servicePort);
  return `http://${host}:${port}`;
}

async function notify(title, message) {
  try {
    await browserApi.notifications.create({
      type: "basic",
      iconUrl: "icon-128.png",
      title,
      message
    });
  } catch {
    await browserApi.notifications.create({
      type: "basic",
      title,
      message
    });
  }
}

async function callService(path, options = {}) {
  const settings = await getSettings();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (settings.serviceToken) {
    headers["X-JEP-Token"] = settings.serviceToken;
  }

  const response = await fetch(`${serviceBaseUrl(settings)}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Service returned HTTP ${response.status}`);
  }
  return body;
}

async function handlePlay(payload, sender) {
  const result = await callService("/play", {
    method: "POST",
    body: {
      ...payload,
      extensionTabUrl: sender?.tab?.url || ""
    }
  });
  const settings = await getSettings();
  if (settings.notifyOnSuccess) {
    await notify("Jellyfin playback sent", result.playableItem?.name || "Opened in local player");
  }
  return result;
}

browserApi.runtime.onInstalled.addListener(async () => {
  const stored = await storageGet(Object.keys(DEFAULTS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) {
      missing[key] = value;
    }
  }
  if (Object.keys(missing).length > 0) {
    await storageSet(missing);
  }
});

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "JEP_GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "JEP_SAVE_SETTINGS") {
    storageSet(message.settings || {})
      .then(() => getSettings())
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "JEP_HEALTH") {
    callService("/health")
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "JEP_RELOAD") {
    callService("/reload", { method: "POST", body: {} })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "JEP_PLAY") {
    handlePlay(message.payload || {}, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch(async (error) => {
        await notify("Jellyfin playback failed", error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  return false;
});
