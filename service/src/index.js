"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const VERSION = "0.1.0";
const APP_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(APP_ROOT, "data");
const PID_FILE = path.join(DATA_DIR, "service.pid");
const STATE_FILE = path.join(DATA_DIR, "runtime-state.json");

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 45789,
  browserSecret: "",
  playerPath: "",
  playerArgs: ["{url}"],
  stream: {
    maxStreamingBitrate: 140000000,
    preferStaticUrl: true
  },
  jellyfin: {
    chooseFirstPlayableForFolders: true,
    requestPlaybackInfo: true,
    reportPlaybackStart: true,
    apiTimeoutMs: 12000
  },
  logging: {
    directory: "logs",
    level: "info",
    retentionDays: 14,
    cleanupIntervalHours: 12
  },
  edgeExtension: {
    id: "",
    crxPath: "dist/jellyfin-native-player-bridge.crx",
    version: "0.1.0"
  }
};

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let configPath = path.join(APP_ROOT, "config", "config.json");
let config = null;
let logger = null;
let server = null;
let listenHost = null;
let listenPort = null;
let cleanupTimer = null;

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) {
      parsed.config = argv[i + 1];
      i += 1;
    } else if (arg === "--version") {
      parsed.version = true;
    }
  }
  return parsed;
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveAppPath(value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? value : path.resolve(APP_ROOT, value);
}

function normalizeConfig(rawConfig) {
  const merged = deepMerge(DEFAULT_CONFIG, rawConfig || {});
  merged.port = Number(merged.port);
  if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) {
    throw new Error(`Invalid listener port: ${merged.port}`);
  }

  if (!merged.host || typeof merged.host !== "string") {
    throw new Error("Invalid listener host");
  }

  if (!Array.isArray(merged.playerArgs)) {
    merged.playerArgs = ["{url}"];
  }

  merged.logging.retentionDays = Math.max(1, Number(merged.logging.retentionDays) || 14);
  merged.logging.cleanupIntervalHours = Math.max(1, Number(merged.logging.cleanupIntervalHours) || 12);
  merged.logging.directory = resolveAppPath(merged.logging.directory || "logs");
  merged.jellyfin.apiTimeoutMs = Math.max(1000, Number(merged.jellyfin.apiTimeoutMs) || 12000);
  merged.stream.maxStreamingBitrate = Number(merged.stream.maxStreamingBitrate) || 140000000;
  return merged;
}

function loadConfig() {
  const raw = readJsonFile(configPath, {});
  return normalizeConfig(raw);
}

function redactValue(key, value) {
  if (/token|secret|apikey|api_key|authorization/i.test(key)) {
    return value ? "[redacted]" : value;
  }
  if (typeof value === "string") {
    return value.replace(/(api_key=)[^&\s]+/gi, "$1[redacted]");
  }
  return value;
}

function safeMeta(meta) {
  if (meta === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(meta, redactValue));
  } catch {
    return { value: String(meta) };
  }
}

class Logger {
  constructor(initialConfig) {
    this.configure(initialConfig);
  }

  configure(nextConfig) {
    this.level = LOG_LEVELS[nextConfig.logging.level] ? nextConfig.logging.level : "info";
    this.logDir = nextConfig.logging.directory;
    ensureDir(this.logDir);
  }

  shouldWrite(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  write(level, message, meta) {
    if (!this.shouldWrite(level)) {
      return;
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const entry = {
      ts: now.toISOString(),
      level,
      message,
      meta: safeMeta(meta)
    };
    const line = `${JSON.stringify(entry)}\n`;
    const filePath = path.join(this.logDir, `service-${date}.log`);
    try {
      fs.appendFileSync(filePath, line, "utf8");
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  debug(message, meta) {
    this.write("debug", message, meta);
  }

  info(message, meta) {
    this.write("info", message, meta);
  }

  warn(message, meta) {
    this.write("warn", message, meta);
  }

  error(message, meta) {
    this.write("error", message, meta);
  }

  cleanup(retentionDays) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for (const entry of fs.readdirSync(this.logDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/^service-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) {
          continue;
        }
        const filePath = path.join(this.logDir, entry.name);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed += 1;
        }
      }
    } catch (error) {
      this.warn("Log cleanup failed", { error: error.message });
    }
    if (removed > 0) {
      this.info("Old logs cleaned", { removed });
    }
  }
}

function writeRuntimeState() {
  writeJsonFile(STATE_FILE, {
    pid: process.pid,
    host: listenHost,
    port: listenPort,
    configPath,
    startedAt: new Date().toISOString()
  });
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
}

function removeRuntimeState() {
  for (const filePath of [PID_FILE, STATE_FILE]) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger?.warn("Failed to remove runtime file", { filePath, error: error.message });
      }
    }
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-JEP-Token",
    "Access-Control-Max-Age": "86400"
  };
}

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf8");
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length
  });
  res.end(payload);
}

function sendNoContent(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function sendText(res, statusCode, body, contentType) {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": `${contentType}; charset=utf-8`,
    "Content-Length": payload.length
  });
  res.end(payload);
}

function sendFile(res, statusCode, filePath, contentType) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { ok: false, error: "File not found" });
      return;
    }
  } catch {
    sendJson(res, 404, { ok: false, error: "File not found" });
    return;
  }

  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(res);
}

function getRequestToken(req) {
  const direct = req.headers["x-jep-token"];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function authorize(req) {
  if (!config.browserSecret) {
    return true;
  }
  const requestToken = getRequestToken(req);
  if (!requestToken) {
    return false;
  }
  const expected = Buffer.from(String(config.browserSecret));
  const actual = Buffer.from(requestToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function readRequestJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function joinServerUrl(serverUrl, apiPath) {
  const trimmed = String(serverUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid Jellyfin server URL: ${serverUrl}`);
  }
  return `${trimmed}${apiPath}`;
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === "string" ? body.slice(0, 400) : body;
      const error = new Error(`Jellyfin API returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.detail = detail;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function jellyfinFetch(context, apiPath, options = {}) {
  const url = new URL(joinServerUrl(context.serverUrl, apiPath));
  const query = options.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    Accept: "application/json",
    "X-Emby-Authorization": `MediaBrowser Client="Jellyfin Native Player Bridge", Device="Edge", DeviceId="jellyfin-native-player-bridge", Version="${VERSION}"`,
    "X-Emby-Token": context.token,
    ...(options.headers || {})
  };

  let body = undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  logger.debug("Calling Jellyfin API", {
    method: options.method || "GET",
    url: url.toString()
  });

  return fetchJsonWithTimeout(
    url,
    {
      method: options.method || "GET",
      headers,
      body
    },
    config.jellyfin.apiTimeoutMs
  );
}

function isPlayableItem(item) {
  if (!item) {
    return false;
  }
  return item.MediaType === "Video" || ["Episode", "Movie", "Video", "MusicVideo"].includes(item.Type);
}

async function getItem(context, itemId) {
  return jellyfinFetch(context, `/Users/${encodeURIComponent(context.userId)}/Items/${encodeURIComponent(itemId)}`, {
    query: {
      Fields: "MediaSources,Path,Overview,Genres,ProviderIds,DateCreated"
    }
  });
}

async function getFirstPlayableChild(context, item) {
  const commonQuery = {
    ParentId: item.Id,
    Recursive: "true",
    IncludeItemTypes: "Episode,Movie,Video,MusicVideo",
    SortBy: "ParentIndexNumber,IndexNumber,SortName",
    SortOrder: "Ascending",
    IsMissing: "false",
    Fields: "MediaSources,Path,Overview",
    Limit: 1
  };

  const children = await jellyfinFetch(context, `/Users/${encodeURIComponent(context.userId)}/Items`, {
    query: commonQuery
  });
  if (Array.isArray(children?.Items) && children.Items.length > 0) {
    return children.Items[0];
  }

  if (item.Type === "Series" || item.Type === "Season") {
    const episodes = await jellyfinFetch(context, `/Shows/${encodeURIComponent(item.Id)}/Episodes`, {
      query: {
        UserId: context.userId,
        Fields: "MediaSources,Path,Overview",
        IsMissing: "false",
        SortBy: "ParentIndexNumber,IndexNumber,SortName",
        SortOrder: "Ascending",
        Limit: 1
      }
    });
    if (Array.isArray(episodes?.Items) && episodes.Items.length > 0) {
      return episodes.Items[0];
    }
  }

  return null;
}

async function resolvePlayableItem(context, itemId) {
  const item = await getItem(context, itemId);
  if (isPlayableItem(item)) {
    return { requestedItem: item, playableItem: item, resolvedFromFolder: false };
  }

  if (!config.jellyfin.chooseFirstPlayableForFolders) {
    throw new Error(`Jellyfin item ${item.Name || item.Id} is not a playable video item`);
  }

  const child = await getFirstPlayableChild(context, item);
  if (!child) {
    throw new Error(`No playable video child found under ${item.Name || item.Id}`);
  }
  return { requestedItem: item, playableItem: child, resolvedFromFolder: true };
}

async function requestPlaybackInfo(context, item, startPositionTicks) {
  if (!config.jellyfin.requestPlaybackInfo) {
    return null;
  }

  try {
    return await jellyfinFetch(context, `/Items/${encodeURIComponent(item.Id)}/PlaybackInfo`, {
      method: "POST",
      query: {
        UserId: context.userId,
        StartTimeTicks: startPositionTicks || 0,
        IsPlayback: "true",
        AutoOpenLiveStream: "true",
        MaxStreamingBitrate: config.stream.maxStreamingBitrate
      },
      body: {
        DeviceProfile: {
          MaxStaticBitrate: config.stream.maxStreamingBitrate,
          MaxStreamingBitrate: config.stream.maxStreamingBitrate
        }
      }
    });
  } catch (error) {
    logger.warn("PlaybackInfo request failed, falling back to item media sources", {
      itemId: item.Id,
      error: error.message,
      detail: error.detail
    });
    return null;
  }
}

function selectMediaSource(item, playbackInfo, preferredMediaSourceId) {
  const sources = [
    ...(Array.isArray(playbackInfo?.MediaSources) ? playbackInfo.MediaSources : []),
    ...(Array.isArray(item.MediaSources) ? item.MediaSources : [])
  ];

  const uniqueSources = [];
  const seen = new Set();
  for (const source of sources) {
    const key = source.Id || source.Path || JSON.stringify(source);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSources.push(source);
    }
  }

  if (preferredMediaSourceId) {
    const preferred = uniqueSources.find((source) => source.Id === preferredMediaSourceId);
    if (preferred) {
      return preferred;
    }
  }

  return (
    uniqueSources.find((source) => source.SupportsDirectStream && source.Protocol === "File") ||
    uniqueSources.find((source) => source.Protocol === "File") ||
    uniqueSources[0] ||
    null
  );
}

function sanitizeContainer(container) {
  if (!container || typeof container !== "string") {
    return "";
  }
  const first = container.split(",")[0].trim().toLowerCase();
  return /^[a-z0-9]+$/.test(first) ? first : "";
}

function buildStreamUrl(context, item, mediaSource, playbackInfo, startPositionTicks) {
  const container = sanitizeContainer(mediaSource?.Container || item.Container);
  const suffix = container ? `.${container}` : "";
  const url = new URL(joinServerUrl(context.serverUrl, `/Videos/${encodeURIComponent(item.Id)}/stream${suffix}`));
  url.searchParams.set("Static", "true");
  url.searchParams.set("api_key", context.token);
  if (mediaSource?.Id) {
    url.searchParams.set("MediaSourceId", mediaSource.Id);
  }
  if (mediaSource?.ETag) {
    url.searchParams.set("Tag", mediaSource.ETag);
  }
  if (playbackInfo?.PlaySessionId) {
    url.searchParams.set("PlaySessionId", playbackInfo.PlaySessionId);
  }
  if (startPositionTicks) {
    url.searchParams.set("StartTimeTicks", String(startPositionTicks));
  }
  return url.toString();
}

function fillTemplate(template, values) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] === undefined || values[key] === null ? "" : String(values[key]);
    }
    return match;
  });
}

function buildPlayerArgs(streamUrl, context) {
  const templateValues = {
    url: streamUrl,
    title: context.title || "",
    name: context.title || "",
    itemId: context.itemId || "",
    serverUrl: context.serverUrl || "",
    mediaSourceId: context.mediaSourceId || ""
  };

  const args = config.playerArgs.map((arg) => fillTemplate(arg, templateValues));
  if (!args.some((arg) => arg.includes(streamUrl))) {
    args.push(streamUrl);
  }
  return args;
}

function launchPlayer(streamUrl, launchContext) {
  const playerPath = config.playerPath;
  if (!playerPath || typeof playerPath !== "string") {
    throw new Error("playerPath is not configured");
  }
  if (path.isAbsolute(playerPath) && !fs.existsSync(playerPath)) {
    throw new Error(`Configured playerPath does not exist: ${playerPath}`);
  }

  const args = buildPlayerArgs(streamUrl, launchContext);
  const child = childProcess.spawn(playerPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: path.isAbsolute(playerPath) ? path.dirname(playerPath) : APP_ROOT
  });
  child.unref();
  return {
    pid: child.pid,
    executable: playerPath,
    args
  };
}

async function reportPlaybackStart(context, item, mediaSource, playbackInfo, startPositionTicks) {
  if (!config.jellyfin.reportPlaybackStart) {
    return;
  }

  const body = {
    ItemId: item.Id,
    MediaSourceId: mediaSource?.Id,
    PlaySessionId: playbackInfo?.PlaySessionId,
    PositionTicks: Number(startPositionTicks) || 0,
    CanSeek: true,
    IsPaused: false,
    IsMuted: false,
    PlayMethod: "DirectStream",
    QueueableMediaTypes: ["Video"]
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") {
      delete body[key];
    }
  }

  try {
    await jellyfinFetch(context, "/Sessions/Playing", {
      method: "POST",
      body
    });
    logger.info("Reported Jellyfin playback start", {
      itemId: item.Id,
      itemName: item.Name,
      mediaSourceId: mediaSource?.Id,
      playSessionId: playbackInfo?.PlaySessionId,
      positionTicks: body.PositionTicks
    });
  } catch (error) {
    logger.warn("Failed to report playback start", {
      itemId: item.Id,
      error: error.message
    });
  }
}

function validatePlayPayload(payload) {
  const token = payload.token || payload.accessToken || payload.apiKey;
  const required = {
    serverUrl: payload.serverUrl,
    itemId: payload.itemId,
    userId: payload.userId,
    token
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing play payload fields: ${missing.join(", ")}`);
  }
  return {
    serverUrl: payload.serverUrl,
    itemId: payload.itemId,
    userId: payload.userId,
    token,
    startPositionTicks: Number(payload.startPositionTicks) || 0,
    mediaSourceId: payload.mediaSourceId || ""
  };
}

async function handlePlay(payload) {
  const context = validatePlayPayload(payload);
  const resolved = await resolvePlayableItem(context, context.itemId);
  const playbackInfo = await requestPlaybackInfo(context, resolved.playableItem, context.startPositionTicks);
  const mediaSource = selectMediaSource(resolved.playableItem, playbackInfo, context.mediaSourceId);
  if (!mediaSource) {
    throw new Error(`No media source found for ${resolved.playableItem.Name || resolved.playableItem.Id}`);
  }

  const streamUrl = buildStreamUrl(context, resolved.playableItem, mediaSource, playbackInfo, context.startPositionTicks);
  const title = resolved.playableItem.Name || payload.itemName || resolved.requestedItem.Name || resolved.playableItem.Id;
  const launched = launchPlayer(streamUrl, {
    title,
    itemId: resolved.playableItem.Id,
    serverUrl: context.serverUrl,
    mediaSourceId: mediaSource.Id || ""
  });

  await reportPlaybackStart(context, resolved.playableItem, mediaSource, playbackInfo, context.startPositionTicks);

  logger.info("Playback handed to local player", {
    requestedItemId: resolved.requestedItem.Id,
    requestedItemName: resolved.requestedItem.Name,
    playableItemId: resolved.playableItem.Id,
    playableItemName: resolved.playableItem.Name,
    resolvedFromFolder: resolved.resolvedFromFolder,
    playerPid: launched.pid,
    source: payload.source || "extension",
    pageUrl: payload.pageUrl || ""
  });

  return {
    ok: true,
    requestedItem: {
      id: resolved.requestedItem.Id,
      name: resolved.requestedItem.Name,
      type: resolved.requestedItem.Type
    },
    playableItem: {
      id: resolved.playableItem.Id,
      name: resolved.playableItem.Name,
      type: resolved.playableItem.Type
    },
    resolvedFromFolder: resolved.resolvedFromFolder,
    playerPid: launched.pid
  };
}

function sanitizedConfig() {
  return {
    host: config.host,
    port: config.port,
    playerPath: config.playerPath,
    playerArgs: config.playerArgs,
    logging: config.logging,
    jellyfin: config.jellyfin,
    stream: config.stream,
    edgeExtension: {
      id: config.edgeExtension.id,
      version: config.edgeExtension.version
    },
    browserSecretConfigured: Boolean(config.browserSecret)
  };
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handleExtensionUpdateXml(req, res) {
  if (!config.edgeExtension.id) {
    sendJson(res, 404, { ok: false, error: "Edge extension id is not configured" });
    return;
  }

  const codebase = `http://${listenHost}:${listenPort}/edge-extension/jellyfin-native-player-bridge.crx`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${xmlEscape(config.edgeExtension.id)}">
    <updatecheck codebase="${xmlEscape(codebase)}" version="${xmlEscape(config.edgeExtension.version || VERSION)}" />
  </app>
</gupdate>
`;
  sendText(res, 200, body, "application/xml");
}

function handleExtensionCrx(req, res) {
  const crxPath = resolveAppPath(config.edgeExtension.crxPath || "dist/jellyfin-native-player-bridge.crx");
  sendFile(res, 200, crxPath, "application/x-chrome-extension");
}

function handleUserscript(req, res) {
  const userscriptPath = resolveAppPath("userscript/jellyfin-native-player-bridge.user.js");
  sendFile(res, 200, userscriptPath, "application/javascript");
}

function resetCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  logger.cleanup(config.logging.retentionDays);
  cleanupTimer = setInterval(() => {
    logger.cleanup(config.logging.retentionDays);
  }, config.logging.cleanupIntervalHours * 60 * 60 * 1000);
  cleanupTimer.unref();
}

function reloadConfig() {
  const previousHost = config.host;
  const previousPort = config.port;
  const nextConfig = loadConfig();
  config = nextConfig;
  logger.configure(config);
  resetCleanupTimer();
  const restartRequired = previousHost !== config.host || previousPort !== config.port;
  logger.info("Configuration reloaded", {
    restartRequired,
    host: config.host,
    port: config.port
  });
  return {
    ok: true,
    restartRequired,
    activeListener: {
      host: listenHost,
      port: listenPort
    },
    config: sanitizedConfig()
  };
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        name: "jellyfin-native-player-bridge",
        version: VERSION,
        pid: process.pid,
        host: listenHost,
        port: listenPort,
        startedAt: readJsonFile(STATE_FILE, {}).startedAt || null
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/edge-extension/updates.xml") {
      handleExtensionUpdateXml(req, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/edge-extension/jellyfin-native-player-bridge.crx") {
      handleExtensionCrx(req, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/userscript/jellyfin-native-player-bridge.user.js") {
      handleUserscript(req, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/config") {
      if (!authorize(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      sendJson(res, 200, { ok: true, config: sanitizedConfig() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/play") {
      if (!authorize(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      const payload = await readRequestJson(req);
      const result = await handlePlay(payload);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/reload") {
      if (!authorize(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      sendJson(res, 200, reloadConfig());
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/cleanup-logs") {
      if (!authorize(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      logger.cleanup(config.logging.retentionDays);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/shutdown") {
      if (!authorize(req)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      sendJson(res, 200, { ok: true, message: "Shutting down" });
      logger.info("Shutdown requested");
      setTimeout(() => {
        shutdown(0);
      }, 100);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    logger.error("Request failed", {
      method: req.method,
      path: requestUrl.pathname,
      error: error.message,
      stack: error.stack
    });
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message
    });
  }
}

function start() {
  ensureDir(DATA_DIR);
  config = loadConfig();
  logger = new Logger(config);
  listenHost = config.host;
  listenPort = config.port;
  resetCleanupTimer();

  server = http.createServer((req, res) => {
    route(req, res);
  });

  server.on("clientError", (error, socket) => {
    logger.warn("HTTP client error", { error: error.message });
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  server.listen(listenPort, listenHost, () => {
    writeRuntimeState();
    logger.info("Listener started", {
      version: VERSION,
      host: listenHost,
      port: listenPort,
      configPath
    });
  });
}

function shutdown(exitCode) {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  const finish = () => {
    removeRuntimeState();
    process.exit(exitCode);
  };
  if (server) {
    server.close(() => finish());
    setTimeout(finish, 3000).unref();
  } else {
    finish();
  }
}

process.on("SIGINT", () => {
  logger?.info("SIGINT received");
  shutdown(0);
});

process.on("SIGTERM", () => {
  logger?.info("SIGTERM received");
  shutdown(0);
});

process.on("uncaughtException", (error) => {
  logger?.error("Uncaught exception", { error: error.message, stack: error.stack });
  shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  logger?.error("Unhandled rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

const args = parseArgs(process.argv.slice(2));
if (args.version) {
  console.log(VERSION);
  process.exit(0);
}
if (args.config) {
  configPath = path.resolve(args.config);
}

start();
