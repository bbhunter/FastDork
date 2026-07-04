// Public build: keep warnings/errors visible, silence development logs.
(() => {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
})();

// FastDork Background Script (Service Worker)

// --- Central Extension Logger ---
const importSaveQueues = new Map();
const CONTENT_SCRIPT_FILES = ["Script/content.js"];

self.addEventListener("error", (event) => {
  console.error(
    "FastDork: Uncaught background error:",
    event.message,
    `${event.filename || "unknown"}:${event.lineno || 0}:${event.colno || 0}`
  );
});

self.addEventListener("unhandledrejection", (event) => {
  console.error(
    "FastDork: Unhandled promise rejection:",
    event.reason?.message || event.reason
  );
  event.preventDefault();
});

// --- Icon Paths ---
const ICON_PATHS_DEFAULT = {
  16: "/img/icon16.png",
  19: "/img/icon19.png",
  24: "/img/icon24.png",
  32: "/img/icon32.png",
  38: "/img/icon38.png",
  48: "/img/icon48.png",
  128: "/img/icon128.png",
};
const ICON_PATHS_BLUE = {
  16: "/img/icon-blue16.png",
  19: "/img/icon-blue19.png",
  24: "/img/icon-blue24.png",
  32: "/img/icon-blue32.png",
  38: "/img/icon-blue38.png",
  48: "/img/icon-blue48.png",
  128: "/img/icon-blue128.png",
};
const ICON_PATHS_GREEN = {
  16: "/img/icon-green16.png",
  19: "/img/icon-green19.png",
  24: "/img/icon-green24.png",
  32: "/img/icon-green32.png",
  38: "/img/icon-green38.png",
  48: "/img/icon-green48.png",
  128: "/img/icon-green128.png",
};
const ICON_PATHS_RED = {
  16: "/img/icon-red16.png",
  19: "/img/icon-red19.png",
  24: "/img/icon-red24.png",
  32: "/img/icon-red32.png",
  38: "/img/icon-red38.png",
  48: "/img/icon-red48.png",
  128: "/img/icon-red128.png",
};

function getActionIconPaths(state = "default") {
  if (state === "blue") return ICON_PATHS_BLUE;
  if (state === "green") return ICON_PATHS_GREEN;
  if (state === "red") return ICON_PATHS_RED;
  return ICON_PATHS_DEFAULT;
}

function getActionVisualState(state = "default") {
  if (state === "blue") {
    return {
      badgeText: "RUN",
      badgeColor: "#0077ff",
      title: "FastDork - scraping",
    };
  }
  if (state === "green") {
    return {
      badgeText: "OK",
      badgeColor: "#00c853",
      title: "FastDork - import complete",
    };
  }
  if (state === "red") {
    return {
      badgeText: "!",
      badgeColor: "#d50000",
      title: "FastDork - CAPTCHA or import blocked",
    };
  }
  return {
    badgeText: "",
    badgeColor: "#f28c28",
    title: "FastDork",
  };
}

let currentActionIconState = "default";
const actionIconImageDataCache = {};
const actionIconImageDataWarningKeys = new Set();
const actionIconTabStateCache = new Map();
const actionIconTabWarningKeys = new Set();

async function getActionIconImageData(state = "default") {
  if (actionIconImageDataCache[state]) {
    return actionIconImageDataCache[state];
  }

  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("OffscreenCanvas/createImageBitmap unavailable in this browser context");
  }

  const imageDataBySize = {};
  const iconPaths = getActionIconPaths(state);

  for (const [size, iconPath] of Object.entries(iconPaths)) {
    const numericSize = Number(size);
    const iconUrl = chrome.runtime.getURL(iconPath.replace(/^\//, ""));
    const response = await fetch(iconUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch action icon asset: ${iconPath}`);
    }

    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(numericSize, numericSize);
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, numericSize, numericSize);
    context.drawImage(bitmap, 0, 0, numericSize, numericSize);
    imageDataBySize[numericSize] = context.getImageData(
      0,
      0,
      numericSize,
      numericSize
    );
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }

  actionIconImageDataCache[state] = imageDataBySize;
  return imageDataBySize;
}

function warnActionIconImageDataOnce(state, context, error) {
  const warningKey = `${state}:${error?.message || error}`;
  if (actionIconImageDataWarningKeys.has(warningKey)) return;
  actionIconImageDataWarningKeys.add(warningKey);
  console.warn(
    `[${context}] Failed to apply "${state}" toolbar icon via imageData fallback:`,
    error
  );
}

function warnActionIconTabOnce(state, context, error) {
  const warningKey = `${state}:${error?.message || error}`;
  if (actionIconTabWarningKeys.has(warningKey)) return;
  actionIconTabWarningKeys.add(warningKey);
  console.warn(
    `[${context}] Failed to apply "${state}" toolbar icon to open tabs:`,
    error
  );
}

async function setActionIconForOpenTabs(state = "default", context = "setActionIcon") {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    warnActionIconTabOnce(state, context, error);
    return 0;
  }

  const iconPaths = getActionIconPaths(state);
  const visualState = getActionVisualState(state);
  let iconImageData = null;
  try {
    iconImageData = await getActionIconImageData(state);
  } catch (error) {
    warnActionIconImageDataOnce(state, `${context}:tabs`, error);
  }

  let appliedCount = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return;

      let tabIconApplied = false;
      try {
        await chrome.action.setIcon({ tabId: tab.id, path: iconPaths });
        tabIconApplied = true;
      } catch (error) {
        warnActionIconTabOnce(state, context, error);
      }

      if (iconImageData) {
        try {
          await chrome.action.setIcon({ tabId: tab.id, imageData: iconImageData });
          tabIconApplied = true;
        } catch (error) {
          warnActionIconTabOnce(state, context, error);
        }
      }

      try {
        await chrome.action.setIcon({ tabId: tab.id, path: iconPaths });
        tabIconApplied = true;
      } catch (error) {
        warnActionIconTabOnce(state, `${context}:final-path`, error);
      }

      if (tabIconApplied) {
        await chrome.action
          .setTitle({ tabId: tab.id, title: visualState.title })
          .catch((error) => warnActionIconTabOnce(state, context, error));
        await chrome.action
          .setBadgeText({ tabId: tab.id, text: visualState.badgeText })
          .catch((error) => warnActionIconTabOnce(state, context, error));
        await chrome.action
          .setBadgeBackgroundColor({
            tabId: tab.id,
            color: visualState.badgeColor,
          })
          .catch((error) => warnActionIconTabOnce(state, context, error));
        if (chrome.action.setBadgeTextColor) {
          await chrome.action
            .setBadgeTextColor({ tabId: tab.id, color: "#ffffff" })
            .catch((error) => warnActionIconTabOnce(state, context, error));
        }
        actionIconTabStateCache.set(tab.id, state);
        appliedCount++;
      } else {
        actionIconTabStateCache.delete(tab.id);
      }
    })
  );

  if (appliedCount > 0) {
    console.log(
      `[${context}] Applied "${state}" toolbar icon to ${appliedCount} open tab(s).`
    );
  }
  return appliedCount;
}

function getCurrentImportActionIconState() {
  if (!isAutoImporting) return currentActionIconState;
  return hasRunnableAutoImportTabs()
    ? "blue"
    : hasCaptchaPendingTabs()
      ? "red"
      : "blue";
}

function reapplyCurrentActionIcon(context = "reapplyCurrentActionIcon") {
  if (currentActionIconState === "default" && !isAutoImporting) return;
  setActionIcon(getCurrentImportActionIconState(), context);
}

async function setActionIcon(state = "default", context = "setActionIcon") {
  let iconApplied = false;
  const appliedMethods = [];
  try {
    const visualState = getActionVisualState(state);
    try {
      await chrome.action.setIcon({ path: getActionIconPaths(state) });
      iconApplied = true;
      appliedMethods.push("global-path");
    } catch (error) {
      console.warn(
        `[${context}] Failed to set "${state}" extension toolbar icon via path:`,
        error
      );
    }
    try {
      await chrome.action.setIcon({
        imageData: await getActionIconImageData(state),
      });
      iconApplied = true;
      appliedMethods.push("global-imageData");
    } catch (imageDataError) {
      warnActionIconImageDataOnce(state, context, imageDataError);
    }
    try {
      await chrome.action.setIcon({ path: getActionIconPaths(state) });
      iconApplied = true;
      appliedMethods.push("global-path-final");
    } catch (error) {
      console.warn(
        `[${context}] Failed to finalize "${state}" extension toolbar icon via path:`,
        error
      );
    }
    const tabAppliedCount = await setActionIconForOpenTabs(state, context);
    if (tabAppliedCount > 0) {
      iconApplied = true;
      appliedMethods.push(`tab-image:${tabAppliedCount}`);
    }
    if (iconApplied) {
      currentActionIconState = state;
    }
    await chrome.action.setTitle({ title: visualState.title }).catch((e) =>
      console.warn(`[${context}] Failed to set action title:`, e)
    );
    await chrome.action.setBadgeText({ text: visualState.badgeText }).catch((e) =>
      console.warn(`[${context}] Failed to set action badge text:`, e)
    );
    await chrome.action
      .setBadgeBackgroundColor({ color: visualState.badgeColor })
      .catch((e) =>
        console.warn(`[${context}] Failed to set action badge color:`, e)
      );
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#ffffff" }).catch((e) =>
        console.warn(`[${context}] Failed to set action badge text color:`, e)
      );
    }
    if (iconApplied) {
      console.log(
        `[${context}] Extension toolbar icon set to "${state}" via ${appliedMethods.join(", ") || "cached-tab-state"}.`
      );
    } else {
      console.warn(`[${context}] No toolbar icon application succeeded for "${state}".`);
    }
  } catch (e) {
    console.warn(`[${context}] Failed to set "${state}" extension toolbar icon:`, e);
  }
}

function reinforceActionIcon(state, context, attempts = 4, intervalMs = 600) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    setTimeout(() => {
      if (currentActionIconState !== state) return;
      setActionIcon(state, `${context}:reinforce-${attempt}`);
    }, attempt * intervalMs);
  }
}

// --- Global State ---
let isAutoImporting = false; // Tracks if an auto-import batch is active
let pendingImports = {};
let pendingResponseWatchdogs = {};
let autoImportTabIds = new Set();
let firstAutoImportTabId = null;
let expectedImportsCount = 0;
const IMPORT_JUST_FINISHED_KEY = "importJustFinished"; // Key for session storage (Auto)
const LAST_AUTO_IMPORT_LIST_KEY = "lastAutoImportListKey"; // Key for the list ID (Auto)
const MANUAL_IMPORT_JUST_FINISHED_KEY = "manualImportJustFinished"; // Key for session storage (Manual)
const LAST_MANUAL_IMPORT_LIST_KEY = "lastManualImportListKey"; // Key for the list ID (Manual)
const LAST_IMPORT_ACTIVITY_KEY = "lastImportActivity";
const LIST_UPDATED_AT_PREFIX = "listUpdatedAt-";
const ENABLE_TAB_FAVICON_STATUS = true;

function ignoreExpectedRuntimeError(error) {
  const message = error?.message || String(error || "");
  if (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist") ||
    message.includes("The message port closed")
  ) {
    return;
  }
  console.warn("FastDork: Ignored runtime message error:", message);
}

function getListUpdatedAtStorageKey(listKey) {
  if (!listKey || listKey === "0") return null;
  return `${LIST_UPDATED_AT_PREFIX}${listKey}`;
}

const STORAGE_KEYS = {
  DEFAULT_SELECTORS: "defaultSiteSelectors",
  USER_SELECTORS: "userSiteSelectors",
  DEFAULTS_INITIALIZED: "defaultsInitialized",
  SITE_CAPTCHA_DEFAULTS_MIGRATED: "siteCaptchaDefaultsMigratedV1",
};
const DEFAULT_DELAY = 500; // Default delay in ms if not provided
const AUTO_IMPORT_TIMEOUT = 20000; // Increased timeout slightly (20s)
const PAGINATION_NAVIGATION_TIMEOUT = 20000;
const CAPTCHA_CHECK_INTERVAL = 8000; // Check every 8 seconds if CAPTCHA is resolved
const CAPTCHA_MAX_WAIT_TIME = 180000; // Give up on CAPTCHA tab after 3 minutes
const CAPTCHA_RECOVERY_MAX_RETRIES = 4; // Retries after CAPTCHA appears resolved
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);
const IMPORT_COMPLETION_KEYS = [
  IMPORT_JUST_FINISHED_KEY,
  LAST_AUTO_IMPORT_LIST_KEY,
  MANUAL_IMPORT_JUST_FINISHED_KEY,
  LAST_MANUAL_IMPORT_LIST_KEY,
];
const SITE_CAPTCHA_CONFIG_KEYS = [
  "captchaUrlPatterns",
  "captchaTextPatterns",
  "captchaSelectors",
];

// --- State Variables (Ensure only one declaration) ---
let currentImportState = {
  isActive: false, // Is any bulk process (dorking/auto-import) running?
  isPaused: false, // DEPRECATED - keeping for compatibility but no longer used for global pause
  pausedTabId: null, // DEPRECATED
  pausedListKey: null, // DEPRECATED
};

// Helper to get storage data asynchronously
function getStorageData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        console.error(
          "BG Storage Error (Get):",
          chrome.runtime.lastError.message
        ); // Log storage errors
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });
}

// Helper to set storage data asynchronously
function setStorageData(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        console.error(
          "BG Storage Error (Set):",
          chrome.runtime.lastError.message
        );
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

// Helper to remove storage data asynchronously
function removeStorageData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        console.error(
          "BG Storage Error (Remove):",
          chrome.runtime.lastError.message
        );
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

function normalizeSafeHttpUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function buildSafeSearchUrl(baseUrl, query, defaultParams = "") {
  if (!normalizeSafeHttpUrl(baseUrl)) return null;
  const params = typeof defaultParams === "string" ? defaultParams : "";
  return normalizeSafeHttpUrl(`${baseUrl}${encodeURIComponent(query)}${params}`);
}

function sanitizeImportedListItem(item) {
  if (typeof item !== "string") return null;
  const cleaned = item
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;

  const blockedSchemeMatch = cleaned.match(
    /^(javascript|data|vbscript|file|chrome|chrome-extension|blob|about):/i
  );
  if (blockedSchemeMatch) return null;

  return cleaned;
}

function getSanitizedImportedItems(data) {
  if (typeof data === "string") {
    return data
      .split("\n")
      .map((item) => sanitizeImportedListItem(item))
      .filter(Boolean);
  }
  if (Array.isArray(data)) {
    return data
      .map((item) => sanitizeImportedListItem(item == null ? "" : String(item)))
      .filter(Boolean);
  }
  return [];
}

function getUniqueImportedItemCount(data) {
  return new Set(getSanitizedImportedItems(data)).size;
}

// --- Function to be injected into the page to update favicon ---
function updateFaviconInPage(iconUrl) {
  const ensureLink = (relValue) => {
    let link = document.querySelector(`link[rel='${relValue}']`);
    if (!link) {
      link = document.createElement("link");
      link.rel = relValue;
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = iconUrl;
  };

  ensureLink("icon");
  ensureLink("shortcut icon");
  console.log("FastDork (Injected): Favicon updated to", iconUrl);
}

function getTabFaviconPath(state = "default") {
  if (state === "blue") return "img/icon-blue48.png";
  if (state === "green") return "img/icon-green48.png";
  if (state === "red") return "img/icon-red48.png";
  return "img/icon48.png";
}

const tabFaviconDataUrlCache = {};

async function getTabFaviconDataUrl(state = "default") {
  const path = getTabFaviconPath(state);
  if (tabFaviconDataUrlCache[path]) {
    return tabFaviconDataUrlCache[path];
  }

  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch icon asset: ${path}`);
  }
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read icon asset: ${path}`));
    reader.readAsDataURL(blob);
  });
  tabFaviconDataUrlCache[path] = dataUrl;
  return dataUrl;
}

function setTabFaviconState(tabId, state = "default") {
  if (!ENABLE_TAB_FAVICON_STATUS) {
    return Promise.resolve();
  }

  return getTabFaviconDataUrl(state)
    .then((iconDataUrl) =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: updateFaviconInPage,
        args: [iconDataUrl],
      })
    )
    .catch((error) => {
      console.warn(
        `FastDork: Error setting tab ${tabId} favicon state "${state}":`,
        error?.message || error
      );
    });
}

// --- Function to check if a tab is part of the current auto-import batch ---
function isTabPartOfAutoImport(tabId) {
  // Check if auto-import is active AND the tab is in our tracking list
  return (
    isAutoImporting &&
    pendingImports.hasOwnProperty(tabId) &&
    pendingImports[tabId]?.isAutoImport === true
  );
}

function hasCaptchaPendingTabs() {
  return Object.values(pendingImports).some(
    (importInfo) => importInfo && importInfo.hasCaptcha === true
  );
}

function getPendingCaptchaInfo() {
  const entry = Object.entries(pendingImports).find(
    ([, importInfo]) => importInfo && importInfo.hasCaptcha === true
  );
  if (!entry) return null;
  const [tabId, importInfo] = entry;
  return {
    tabId: Number(tabId),
    reason: importInfo.captchaReason || "CAPTCHA detected",
    listKey: importInfo.resultListKey || null,
  };
}

function hasRunnableAutoImportTabs() {
  return Object.values(pendingImports).some(
    (importInfo) =>
      importInfo &&
      importInfo.isAutoImport === true &&
      importInfo.hasCaptcha !== true
  );
}

function isAutoImportBlockedByCaptcha() {
  return (
    isAutoImporting &&
    hasCaptchaPendingTabs() &&
    !hasRunnableAutoImportTabs()
  );
}

function notifyCaptchaBlockedIfAllBlocked(context = "captcha") {
  if (!isAutoImportBlockedByCaptcha()) return false;
  const captchaInfo = getPendingCaptchaInfo();
  if (!captchaInfo) return false;

  console.log(
    `[${context}] All remaining auto-import tabs are blocked by CAPTCHA. Notifying popup.`
  );
  chrome.runtime
    .sendMessage({
      type: "IMPORT_PAUSED",
      tabId: captchaInfo.tabId,
      reason: captchaInfo.reason,
      activeListKey: captchaInfo.listKey,
      allRemainingBlocked: true,
    })
    .catch(ignoreExpectedRuntimeError);
  return true;
}

function refreshImportActionIcon() {
  if (!isAutoImporting) {
    setActionIcon("default", "refreshImportActionIcon");
    return;
  }

  setActionIcon(getCurrentImportActionIconState(), "refreshImportActionIcon");
}

function clearPendingResponseWatchdog(tabId) {
  const watchdog = pendingResponseWatchdogs[tabId];
  if (!watchdog) return;
  clearTimeout(watchdog.timerId);
  delete pendingResponseWatchdogs[tabId];
}

function clearAllPendingResponseWatchdogs() {
  Object.keys(pendingResponseWatchdogs).forEach((tabId) => {
    clearPendingResponseWatchdog(Number(tabId));
  });
}

function registerPendingResponseWatchdog(tabId, page, resultListKey) {
  clearPendingResponseWatchdog(tabId);

  const timeoutMs = AUTO_IMPORT_TIMEOUT + 5000;
  const timerId = setTimeout(() => {
    const importInfo = pendingImports[tabId];
    if (!importInfo) {
      clearPendingResponseWatchdog(tabId);
      return;
    }

    // Ignore stale watchdogs for older pages.
    if (importInfo.currentPage !== page) {
      clearPendingResponseWatchdog(tabId);
      return;
    }

    const retries = importInfo.watchdogRetries || 0;
    if (retries < 1) {
      importInfo.watchdogRetries = retries + 1;
      console.warn(
        `[BG watchdog:T${tabId} P${page}] No response in ${timeoutMs}ms. Retrying extraction once.`
      );
      clearPendingResponseWatchdog(tabId);
      extractAndSaveDataFromTab(tabId, resultListKey, page);
      return;
    }

    console.error(
      `[BG watchdog:T${tabId} P${page}] No response after retry. Treating as extraction failure.`
    );
    clearPendingResponseWatchdog(tabId);
    chrome.runtime
      .sendMessage({
        action: "extractionFailed",
        tabId,
        page,
        error: `No response from content script after ${timeoutMs}ms`,
      })
      .catch((err) =>
        console.warn(
          `[BG watchdog:T${tabId} P${page}] Failed to send synthetic extractionFailed:`,
          err?.message || err
        )
      );
  }, timeoutMs);

  pendingResponseWatchdogs[tabId] = {
    timerId,
    page,
    resultListKey,
    startedAt: Date.now(),
  };
}

function getLikelyCaptchaUrlReason(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (hostname.includes("google.") && pathname.startsWith("/sorry")) {
      return "Google sorry/CAPTCHA page";
    }
    if (
      hostname.endsWith("bing.com") &&
      (pathname.startsWith("/turing/captcha") ||
        pathname.includes("/captcha"))
    ) {
      return "Bing CAPTCHA challenge page";
    }
    return false;
  } catch (error) {
    return false;
  }
}

function isLikelyCaptchaUrl(url) {
  return Boolean(getLikelyCaptchaUrlReason(url));
}

function normalizeConfigHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function getConfigListValue(config, key) {
  const value = config?.[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

async function getSiteConfigForUrl(url) {
  if (typeof url !== "string" || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return null;
  }

  const hostname = normalizeConfigHostname(parsed.hostname);
  const baseDomain = hostname.split(".").slice(-2).join(".");
  const lowerHref = parsed.href.toLowerCase();
  const data = await getStorageData([
    STORAGE_KEYS.USER_SELECTORS,
    STORAGE_KEYS.DEFAULT_SELECTORS,
  ]);
  const allConfigs = {
    ...(data[STORAGE_KEYS.DEFAULT_SELECTORS] || {}),
    ...(data[STORAGE_KEYS.USER_SELECTORS] || {}),
  };

  if (allConfigs[hostname]) return allConfigs[hostname];
  if (allConfigs[baseDomain]) return allConfigs[baseDomain];

  return (
    Object.values(allConfigs).find((config) =>
      getConfigListValue(config, "matchPatterns").some((pattern) =>
        lowerHref.includes(pattern.toLowerCase())
      )
    ) || null
  );
}

async function getConfiguredCaptchaUrlReason(url) {
  if (typeof url !== "string" || !url) return false;
  const config = await getSiteConfigForUrl(url);
  const lowerHref = url.toLowerCase();
  const matchedPattern = getConfigListValue(config, "captchaUrlPatterns").find(
    (pattern) => lowerHref.includes(pattern.toLowerCase())
  );
  return matchedPattern
    ? `Configured CAPTCHA URL pattern matched: ${matchedPattern}`
    : false;
}

async function getCaptchaUrlReason(url) {
  return getLikelyCaptchaUrlReason(url) || (await getConfiguredCaptchaUrlReason(url));
}

function markCaptchaDetectedForTab(tabId, reason = "CAPTCHA detected") {
  console.log(`FastDork: CAPTCHA detected for tab ${tabId}. Reason: ${reason}`);
  clearPendingResponseWatchdog(tabId);
  setTabFaviconState(tabId, "red");

  if (!isTabPartOfAutoImport(tabId)) {
    console.log(
      `FastDork: CAPTCHA detected on tab ${tabId}, but it's not part of an active import. Ignoring.`
    );
    return;
  }

  const importInfo = pendingImports[tabId];
  if (importInfo.hasCaptcha) {
    console.log(`FastDork: Tab ${tabId} already marked as CAPTCHA-blocked.`);
    return;
  }

  importInfo.hasCaptcha = true;
  importInfo.captchaDetectedAt = Date.now();
  importInfo.captchaReason = reason;

  console.log(
    `FastDork: CAPTCHA detected on tab ${tabId}. Marking tab for automatic retry. Other tabs continue normally.`
  );

  refreshImportActionIcon();
  focusCaptchaTab(tabId);
  notifyCaptchaBlockedIfAllBlocked("markCaptchaDetectedForTab");
  chrome.scripting
    .executeScript({
      target: { tabId: tabId },
      func: showCaptchaBannerInPage,
    })
    .catch((err) =>
      console.warn(`Error injecting CAPTCHA banner into tab ${tabId}:`, err.message)
    );

  scheduleCaptchaCheck(tabId);
}

function normalizeUrlForNavigationCheck(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch (error) {
    return url;
  }
}

function getGoogleSearchStartOffset(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("google.") || parsed.pathname !== "/search") {
      return null;
    }
    const start = Number(parsed.searchParams.get("start") || "0");
    return Number.isFinite(start) ? start : null;
  } catch (error) {
    return null;
  }
}

function getPaginationPageIdentity(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if (parsed.hostname.includes("google.") && parsed.pathname === "/search") {
      const query = parsed.searchParams.get("q") || "";
      const start = parsed.searchParams.get("start") || "0";
      const filter = parsed.searchParams.get("filter") || "";
      return `google:${parsed.hostname}:${query}:start=${start}:filter=${filter}`;
    }

    return parsed.href;
  } catch (error) {
    return url;
  }
}

function waitForPaginatedTabReady(tabId, previousUrl, expectedUrl, logPrefix) {
  const normalizedPrevious = normalizeUrlForNavigationCheck(previousUrl);
  const normalizedExpected = normalizeUrlForNavigationCheck(expectedUrl);

  return new Promise((resolve) => {
    let settled = false;
    let lastUrl = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const isReadyUrl = (url, status) => {
      if (typeof url !== "string" || !url.startsWith("http")) return false;
      const normalizedUrl = normalizeUrlForNavigationCheck(url);
      const reachedExpected =
        normalizedExpected && normalizedUrl === normalizedExpected;
      const leftPrevious =
        normalizedPrevious && normalizedUrl && normalizedUrl !== normalizedPrevious;

      return status === "complete" && (reachedExpected || leftPrevious);
    };

    const checkTabState = (url, status, reason) => {
      if (settled) return;
      if (url) lastUrl = url;
      if (isReadyUrl(url, status)) {
        console.log(
          `${logPrefix} Pagination target ready via ${reason}. URL: ${url}`
        );
        finish({ success: true, url, reason });
      }
    };

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;
      const url = tab?.url || changeInfo?.url || lastUrl;
      const status = changeInfo?.status || tab?.status;
      checkTabState(url, status, "tabs.onUpdated");
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    const pollTimer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        checkTabState(tab.url, tab.status, "poll");
      } catch (error) {
        console.warn(
          `${logPrefix} Pagination wait failed while polling tab ${tabId}: ${
            error.message || error
          }`
        );
        finish({ success: false, url: lastUrl, reason: "tab unavailable" });
      }
    }, 250);

    const timeoutTimer = setTimeout(() => {
      console.warn(
        `${logPrefix} Pagination wait timed out after ${PAGINATION_NAVIGATION_TIMEOUT}ms. Previous: ${
          previousUrl || "(unknown)"
        }, expected: ${expectedUrl || "(unknown)"}, last: ${
          lastUrl || "(unknown)"
        }`
      );
      finish({ success: false, url: lastUrl, reason: "timeout" });
    }, PAGINATION_NAVIGATION_TIMEOUT);
  });
}

async function forceExpectedPaginationUrl(tabId, expectedUrl, logPrefix) {
  const safeExpectedUrl = normalizeSafeHttpUrl(expectedUrl);
  if (!safeExpectedUrl) {
    console.warn(`${logPrefix} Refusing to force unsafe pagination URL: ${expectedUrl || "(empty)"}`);
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = normalizeUrlForNavigationCheck(tab.url);
    const normalizedExpected = normalizeUrlForNavigationCheck(safeExpectedUrl);

    if (currentUrl === normalizedExpected) {
      console.log(`${logPrefix} Expected pagination URL is already loaded.`);
      return true;
    }

    console.warn(
      `${logPrefix} Pagination click did not finish in time. Forcing expected URL: ${safeExpectedUrl}`
    );
    await chrome.tabs.update(tabId, { url: safeExpectedUrl });
    return true;
  } catch (error) {
    console.warn(
      `${logPrefix} Could not force expected pagination URL: ${
        error.message || error
      }`
    );
    return false;
  }
}

function scheduleExtractionAfterPagination(
  tabId,
  resultListKey,
  nextPage,
  previousUrl,
  expectedUrl
) {
  const logPrefix = `[BG pagination:P${nextPage} T:${tabId}]`;
  const importInfo = pendingImports[tabId];
  if (importInfo) {
    importInfo.status = "navigating";
    importInfo.expectedPageUrl = expectedUrl || null;
    refreshImportActionIcon();
  }

  waitForPaginatedTabReady(tabId, previousUrl, expectedUrl, logPrefix).then(
    async (waitResult) => {
      if (
        !pendingImports.hasOwnProperty(tabId) ||
        pendingImports[tabId].hasCaptcha
      ) {
        console.log(
          `${logPrefix} Aborting scheduled extraction (CAPTCHA detected or tab removed).`
        );
        return;
      }

      if (!waitResult.success && expectedUrl) {
        const forced = await forceExpectedPaginationUrl(
          tabId,
          expectedUrl,
          logPrefix
        );
        if (forced) {
          waitResult = await waitForPaginatedTabReady(
            tabId,
            previousUrl,
            expectedUrl,
            `${logPrefix}:forced`
          );
        }
      }

      if (
        !pendingImports.hasOwnProperty(tabId) ||
        pendingImports[tabId].hasCaptcha
      ) {
        console.log(
          `${logPrefix} Aborting scheduled extraction after forced navigation (CAPTCHA detected or tab removed).`
        );
        return;
      }

      if (!waitResult.success) {
        console.warn(
          `${logPrefix} Proceeding after pagination wait ${waitResult.reason}. Extraction will validate the page.`
        );
      }

      const pageDelay = pendingImports[tabId]?.delayBetweenPages || 0;
      if (pageDelay > 0) {
        console.log(
          `${logPrefix} Waiting ${pageDelay}ms before extracting next page.`
        );
        pendingImports[tabId].status = "waiting";
        refreshImportActionIcon();
        await new Promise((resolve) => setTimeout(resolve, pageDelay));
      }

      if (
        !pendingImports.hasOwnProperty(tabId) ||
        pendingImports[tabId].hasCaptcha
      ) {
        console.log(
          `${logPrefix} Aborting delayed extraction (CAPTCHA detected or tab removed).`
        );
        return;
      }

      console.log(`${logPrefix} Triggering extraction.`);
      extractAndSaveDataFromTab(tabId, resultListKey, nextPage);
    }
  );
}

async function focusCaptchaTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (e) {
    console.warn(`[CAPTCHA Focus] Unable to focus tab ${tabId}:`, e.message);
  }
}

function showCaptchaBannerInPage() {
  const bannerId = "fastdork-captcha-banner";
  if (document.getElementById(bannerId)) return;

  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.textContent =
    "FastDork: CAPTCHA detected on this tab. Solve it here, then FastDork will resume import automatically.";
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "2147483647";
  banner.style.background = "#b30000";
  banner.style.color = "#fff";
  banner.style.padding = "10px 14px";
  banner.style.fontSize = "14px";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.textAlign = "center";
  banner.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
  document.documentElement.appendChild(banner);
}

function removeCaptchaBannerInPage() {
  const banner = document.getElementById("fastdork-captcha-banner");
  if (banner) banner.remove();
}

async function getImportCompletionState() {
  const [sessionData, localData] = await Promise.all([
    chrome.storage.session.get(IMPORT_COMPLETION_KEYS).catch((error) => {
      console.warn("Session completion state read failed:", error);
      return {};
    }),
    chrome.storage.local.get(IMPORT_COMPLETION_KEYS).catch((error) => {
      console.warn("Local completion state read failed:", error);
      return {};
    }),
  ]);

  return {
    [IMPORT_JUST_FINISHED_KEY]:
      sessionData[IMPORT_JUST_FINISHED_KEY] === true ||
      localData[IMPORT_JUST_FINISHED_KEY] === true,
    [LAST_AUTO_IMPORT_LIST_KEY]:
      sessionData[LAST_AUTO_IMPORT_LIST_KEY] ||
      localData[LAST_AUTO_IMPORT_LIST_KEY],
    [MANUAL_IMPORT_JUST_FINISHED_KEY]:
      sessionData[MANUAL_IMPORT_JUST_FINISHED_KEY] === true ||
      localData[MANUAL_IMPORT_JUST_FINISHED_KEY] === true,
    [LAST_MANUAL_IMPORT_LIST_KEY]:
      sessionData[LAST_MANUAL_IMPORT_LIST_KEY] ||
      localData[LAST_MANUAL_IMPORT_LIST_KEY],
  };
}

async function setImportCompletionState(resultListKey = null) {
  const completionState = { [IMPORT_JUST_FINISHED_KEY]: true };
  if (resultListKey) {
    completionState[LAST_AUTO_IMPORT_LIST_KEY] = resultListKey;
  }

  await Promise.all([
    chrome.storage.session.set(completionState),
    chrome.storage.local.set(completionState),
  ]);
}

function clearImportCompletionState() {
  return Promise.all([
    chrome.storage.session.remove(IMPORT_COMPLETION_KEYS),
    chrome.storage.local.remove(IMPORT_COMPLETION_KEYS),
  ]).catch((error) => {
    console.warn("Completion state clear failed:", error);
  });
}

async function recordImportActivity(
  listKey,
  { count = 0, duplicateCount = 0, foundCount = 0 } = {}
) {
  const numericCount = Number(count) || 0;
  const numericDuplicateCount = Number(duplicateCount) || 0;
  const numericFoundCount = Number(foundCount) || 0;
  if (!listKey || numericFoundCount <= 0) return;

  try {
    const data = await chrome.storage.session.get(LAST_IMPORT_ACTIVITY_KEY);
    const previous = data[LAST_IMPORT_ACTIVITY_KEY] || null;
    const sameList = previous?.listKey === listKey;
    const previousCount = sameList ? Number(previous.count) || 0 : 0;
    const previousDuplicateCount = sameList
      ? Number(previous.duplicateCount) || 0
      : 0;
    const previousFoundCount = sameList ? Number(previous.foundCount) || 0 : 0;
    const nextCount = previousCount + numericCount;
    const nextDuplicateCount = previousDuplicateCount + numericDuplicateCount;
    const nextFoundCount = previousFoundCount + numericFoundCount;
    if (nextCount <= 0 && nextDuplicateCount <= 0) return;

    await chrome.storage.session.set({
      [LAST_IMPORT_ACTIVITY_KEY]: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        listKey,
        count: nextCount,
        duplicateCount: nextDuplicateCount,
        foundCount: nextFoundCount,
        updatedAt: Date.now(),
      },
    });
  } catch (error) {
    console.warn("Failed to persist import activity:", error);
  }
}

// --- Function to reset ALL import-related state ---
function resetAllImportStates(resetIcon = true, clearCompletionFlags = true) {
  console.log("Resetting ALL import states. Reset icon:", resetIcon);
  clearAllPendingResponseWatchdogs();
  isAutoImporting = false;
  pendingImports = {};
  autoImportTabIds.clear();
  firstAutoImportTabId = null;
  expectedImportsCount = 0;
  currentImportState.isActive = false;
  currentImportState.isPaused = false;
  currentImportState.pausedTabId = null;
  currentImportState.pausedListKey = null;
  let clearCompletionFlagsPromise = Promise.resolve();
  if (clearCompletionFlags) {
    clearCompletionFlagsPromise = clearImportCompletionState();
  }

  // Only reset icon if explicitly requested (for error cases, not success)
  if (resetIcon) {
    setActionIcon("default", "resetAllImportStates");
  }

  return clearCompletionFlagsPromise;
}

// --- Function to schedule periodic CAPTCHA resolution checks for a specific tab ---
function scheduleCaptchaCheck(tabId) {
  if (!pendingImports.hasOwnProperty(tabId)) {
    console.log(`[CAPTCHA Check] Tab ${tabId} no longer pending, aborting check.`);
    return;
  }

  const importInfo = pendingImports[tabId];
  if (!importInfo.hasCaptcha) {
    console.log(`[CAPTCHA Check] Tab ${tabId} no longer has CAPTCHA flag, aborting check.`);
    return;
  }

  // Check if we've exceeded max wait time
  const waitTime = Date.now() - importInfo.captchaDetectedAt;
  if (waitTime > CAPTCHA_MAX_WAIT_TIME) {
    console.warn(
      `[CAPTCHA Check] Tab ${tabId} exceeded max wait time (${CAPTCHA_MAX_WAIT_TIME}ms). Giving up on this tab.`
    );
    handleCaptchaTimeout(tabId);
    return;
  }

  // Schedule the next check
  setTimeout(async () => {
    await checkIfCaptchaResolved(tabId);
  }, CAPTCHA_CHECK_INTERVAL);
}

// --- Function to check if CAPTCHA has been resolved on a specific tab ---
async function checkIfCaptchaResolved(tabId) {
  const logPrefix = `[CAPTCHA Resolve:T${tabId}]`;

  if (!pendingImports.hasOwnProperty(tabId)) {
    console.log(`${logPrefix} Tab no longer in pendingImports. Stopping checks.`);
    return;
  }

  const importInfo = pendingImports[tabId];
  if (!importInfo.hasCaptcha) {
    console.log(`${logPrefix} CAPTCHA flag cleared. Stopping checks.`);
    return;
  }

  console.log(`${logPrefix} Checking if CAPTCHA is resolved...`);

  try {
    // Try to extract data - if successful, CAPTCHA is resolved
    const tab = await chrome.tabs.get(tabId);
    console.log(`${logPrefix} Tab still exists. URL: ${tab.url}`);

    // Send a test extraction message to see if page is now accessible
    chrome.tabs
      .sendMessage(tabId, {
        action: "checkCaptchaStatus"
      })
      .then((response) => {
        if (response && response.captchaResolved) {
          console.log(`${logPrefix} CAPTCHA RESOLVED! Resuming extraction.`);
          handleCaptchaResolved(tabId);
        } else {
          console.log(`${logPrefix} CAPTCHA still present. Will check again.`);
          scheduleCaptchaCheck(tabId);
        }
      })
      .catch((err) => {
        console.log(`${logPrefix} Check failed (${err.message}). Retrying extraction directly.`);
        // Try extraction anyway - might work now
        attemptExtractionAfterCaptcha(tabId);
      });
  } catch (error) {
    console.error(`${logPrefix} Error during check:`, error.message);
    // Tab might be closed, remove from pending
    if (pendingImports.hasOwnProperty(tabId)) {
      handleCaptchaTimeout(tabId);
    }
  }
}

// --- Function called when CAPTCHA is resolved ---
function handleCaptchaResolved(tabId) {
  if (!pendingImports.hasOwnProperty(tabId)) return;

  const importInfo = pendingImports[tabId];
  importInfo.hasCaptcha = false;
  importInfo.awaitingCaptchaRecovery = true;
  importInfo.captchaRecoveryRetries = 0;
  delete importInfo.captchaDetectedAt;

  console.log(`[CAPTCHA Resolved] Tab ${tabId} CAPTCHA cleared. Resuming extraction.`);

  // Restore tab favicon to scraping (blue)
  setTabFaviconState(tabId, "blue");

  // Resume extraction from current page
  refreshImportActionIcon();
  chrome.scripting
    .executeScript({
      target: { tabId: tabId },
      func: removeCaptchaBannerInPage,
    })
    .catch((err) =>
      console.warn(`Error removing CAPTCHA banner on tab ${tabId}:`, err.message)
    );
  extractAndSaveDataFromTab(
    tabId,
    importInfo.resultListKey,
    importInfo.currentPage
  );
}

// --- Function to attempt extraction after potential CAPTCHA resolution ---
function attemptExtractionAfterCaptcha(tabId) {
  if (!pendingImports.hasOwnProperty(tabId)) return;

  const importInfo = pendingImports[tabId];
  console.log(`[CAPTCHA Attempt] Tab ${tabId} trying extraction at page ${importInfo.currentPage}`);

  // Try extraction - if it works, CAPTCHA was resolved
  extractAndSaveDataFromTab(
    tabId,
    importInfo.resultListKey,
    importInfo.currentPage
  );

  // Schedule next check in case this attempt fails
  setTimeout(() => {
    if (pendingImports.hasOwnProperty(tabId) && pendingImports[tabId].hasCaptcha) {
      scheduleCaptchaCheck(tabId);
    }
  }, CAPTCHA_CHECK_INTERVAL);
}

// --- Function called when CAPTCHA times out ---
function handleCaptchaTimeout(tabId) {
  if (!pendingImports.hasOwnProperty(tabId)) return;

  const resultListKey = pendingImports[tabId]?.resultListKey || null;
  console.warn(`[CAPTCHA Timeout] Tab ${tabId} failed to resolve CAPTCHA. Removing from pending.`);

  clearPendingResponseWatchdog(tabId);
  delete pendingImports[tabId];
  if (expectedImportsCount > 0) {
    expectedImportsCount--;
  }

  console.log(`[CAPTCHA Timeout] Expected remaining: ${expectedImportsCount}`);
  if (expectedImportsCount > 0) {
    refreshImportActionIcon();
  } else {
    setActionIcon("red", "handleCaptchaTimeout");
  }
  chrome.scripting
    .executeScript({
      target: { tabId: tabId },
      func: removeCaptchaBannerInPage,
    })
    .catch((err) =>
      console.warn(`Error removing CAPTCHA banner on timeout for tab ${tabId}:`, err.message)
    );

  // Check if all imports are done
  if (isAutoImporting && expectedImportsCount === 0) {
    console.warn(
      "LOG: Auto-import stopped because CAPTCHA was not resolved. Not marking as successful."
    );
    resetAllImportStates(false);
    chrome.runtime
      .sendMessage({
        action: "showImportError",
        listKey: resultListKey,
        error: "Google CAPTCHA was not resolved before timeout.",
      })
      .catch(ignoreExpectedRuntimeError);
    chrome.runtime
      .sendMessage({ action: "updateImportStatus", isImporting: false })
      .catch(ignoreExpectedRuntimeError);
  }
}

// --- Helper to finalize auto-import completion ---
async function finalizeAutoImport(resultListKey = null) {
  try {
    await setImportCompletionState(resultListKey);
  } catch (error) {
    console.warn("Failed to persist import completion state:", error);
  }

  for (const tabId of autoImportTabIds) {
    setTabFaviconState(tabId, "green");
  }
  await setActionIcon("green", "finalizeAutoImport");
  reinforceActionIcon("green", "finalizeAutoImport");

  const wasImporting = isAutoImporting;
  await resetAllImportStates(false, false); // Don't reset icon or completion flags.

  if (wasImporting) {
    chrome.runtime
      .sendMessage({
        action: "updateImportStatus",
        isImporting: false,
      })
      .catch(ignoreExpectedRuntimeError);
  }
}

async function completeAutoImportTab(tabId, listKey, logPrefix) {
  setTabFaviconState(tabId, "green");
  clearPendingResponseWatchdog(tabId);
  delete pendingImports[tabId];
  expectedImportsCount--;
  console.log(`${logPrefix} Expected remaining: ${expectedImportsCount}`);

  if (expectedImportsCount === 0) {
    console.log("LOG: All expected auto-imports complete. Finalizing.");
    await finalizeAutoImport(listKey);
    chrome.runtime
      .sendMessage({
        action: "showImportSuccess",
        listKey,
      })
      .catch(ignoreExpectedRuntimeError);
  } else if (notifyCaptchaBlockedIfAllBlocked("completeAutoImportTab")) {
    console.log(
      `${logPrefix} Remaining imports are waiting on CAPTCHA resolution.`
    );
  } else if (expectedImportsCount < 0) {
    console.warn(
      `Expected imports count is negative (${expectedImportsCount})! Resetting state.`
    );
    resetAllImportStates();
    chrome.runtime
      .sendMessage({ action: "updateImportStatus", isImporting: false })
      .catch(ignoreExpectedRuntimeError);
  }
}

function notifyImportError(listKey, errorMessage) {
  chrome.runtime
    .sendMessage({
      action: "showImportError",
      listKey,
      error: errorMessage,
    })
    .catch(ignoreExpectedRuntimeError);
}

function finishPendingImportFailure(tabId, logPrefix, errorMessage) {
  if (!pendingImports.hasOwnProperty(tabId)) {
    return;
  }

  const importInfo = pendingImports[tabId];
  const isAutoImportEntry = importInfo?.isAutoImport === true;
  const resultListKey = importInfo?.resultListKey;
  if (resultListKey && errorMessage) {
    notifyImportError(resultListKey, errorMessage);
  }

  clearPendingResponseWatchdog(tabId);
  delete pendingImports[tabId];
  setTabFaviconState(tabId, "red");

  if (!isAutoImporting || !isAutoImportEntry) {
    console.log(`${logPrefix} Manual import failed and was removed from pending imports.`);
    return;
  }

  if (expectedImportsCount > 0) {
    expectedImportsCount--;
  }

  console.log(
    `${logPrefix} Auto-import failed and was removed. Expected remaining: ${expectedImportsCount}`
  );

  if (expectedImportsCount === 0) {
    console.warn(
      `${logPrefix} All expected auto-imports accounted for after failure. Marking auto-import as failed.`
    );
    setActionIcon("red", "finishPendingImportFailure");
    resetAllImportStates(false);
    if (resultListKey && !errorMessage) {
      notifyImportError(
        resultListKey,
        "Auto-import stopped before all pages could be scraped."
      );
    }
    chrome.runtime
      .sendMessage({ action: "updateImportStatus", isImporting: false })
      .catch(ignoreExpectedRuntimeError);
  } else if (expectedImportsCount < 0) {
    console.warn(
      `${logPrefix} Expected imports count is negative (${expectedImportsCount}). Resetting state.`
    );
    resetAllImportStates();
    chrome.runtime
      .sendMessage({ action: "updateImportStatus", isImporting: false })
      .catch(ignoreExpectedRuntimeError);
  }
}

async function ensureContentScriptInjected(tabId, logPrefix) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "fastDorkPing",
    });
    if (response?.ready) {
      console.log(`${logPrefix} Content script already ready.`);
      return true;
    }
  } catch (pingError) {
    console.log(
      `${logPrefix} Content script ping failed; injecting now: ${pingError.message}`
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
    console.log(`${logPrefix} Content script injection successful.`);
    return true;
  } catch (firstError) {
    const firstMessage = firstError.message || "";
    const normalizedMessage = firstMessage.toLowerCase();
    const canRetry =
      normalizedMessage.includes("cannot access") ||
      normalizedMessage.includes("no tab with id");

    if (!canRetry) {
      if (normalizedMessage.includes("duplicate script")) {
        console.log(`${logPrefix} Content script was already injected.`);
        return true;
      }
      console.error(`${logPrefix} Content script injection failed: ${firstMessage}`);
      return false;
    }

    console.warn(
      `${logPrefix} Initial injection failed (${firstMessage}). Retrying after 200ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPT_FILES,
      });
      console.log(`${logPrefix} Content script injection successful on retry.`);
      return true;
    } catch (secondError) {
      console.error(
        `${logPrefix} Content script injection failed on retry: ${secondError.message}`
      );
      return false;
    }
  }
}

function isTrustedExtensionPageSender(sender = {}) {
  const extensionUrl = chrome.runtime.getURL("");
  return (
    (!sender?.id || sender.id === chrome.runtime.id) &&
    !sender?.tab &&
    typeof sender?.url === "string" &&
    sender.url.startsWith(extensionUrl)
  );
}

function isTrustedContentScriptSender(sender = {}) {
  const senderUrl = sender?.url || sender?.tab?.url || "";
  return (
    (!sender?.id || sender.id === chrome.runtime.id) &&
    typeof sender?.tab?.id === "number" &&
    /^https?:\/\//i.test(senderUrl)
  );
}

function rejectUntrustedMessage(action, sender, sendResponse, expectedSource) {
  const senderDescription =
    sender?.url || sender?.tab?.url || sender?.id || "unknown sender";
  console.warn(
    `[security] Rejected ${action || "unknown message"} from ${senderDescription}; expected ${expectedSource}.`
  );
  sendResponse({
    success: false,
    error: `Rejected untrusted ${action || "message"} sender.`,
  });
}

function requireExtensionPageSender(message, sender, sendResponse) {
  if (isTrustedExtensionPageSender(sender)) return true;
  rejectUntrustedMessage(
    message?.action || message?.type,
    sender,
    sendResponse,
    "FastDork extension page"
  );
  return false;
}

function requireContentScriptSenderForTab(message, sender, sendResponse) {
  if (!isTrustedContentScriptSender(sender)) {
    rejectUntrustedMessage(
      message?.action || message?.type,
      sender,
      sendResponse,
      "FastDork content script"
    );
    return false;
  }

  const messageTabId = Number(message?.tabId ?? sender.tab.id);
  if (!Number.isFinite(messageTabId) || messageTabId !== sender.tab.id) {
    console.warn(
      `[security] Rejected ${
        message?.action || message?.type
      }: message tabId=${message?.tabId} does not match sender tabId=${sender.tab.id}.`
    );
    sendResponse({
      success: false,
      error: "Rejected message with mismatched tab ID.",
    });
    return false;
  }

  return true;
}

// --- Main Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  console.log(
    "Background onMessage Listener received action/type:",
    message?.action || message?.type
  );
  if (message) {
    console.log("Background received message object:", message);
  } else {
    console.warn("Background received null/undefined message");
    sendResponse({ success: false, error: "Invalid message received" });
    return false;
  }

  if (message.action === "resetDefaultLists") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log("Background: Received request to reset defaults.");
    resetDefaults()
      .then((result) => {
        console.log("Background: Defaults reset successfully.");
        sendResponse(result);
      })
      .catch((error) => {
        console.error("Background: Reset failed:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error during reset.",
        });
    });
    return true;
  } else if (message.action === "executeDorksWithDelay") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log("Background: Received request to execute dorks with delay.");
    console.log("Background received message object:", message);
    if (isAutoImporting || currentImportState.isActive) {
      console.warn(
        "Background: Ignoring executeDorksWithDelay because an import is already active."
      );
      sendResponse({
        success: false,
        error: "An import is already running.",
      });
      return false;
    }
    executeDorksInBackground(message.options)
      .then((result) => {
        console.log(
          "Background: executeDorksInBackground completed successfully."
        );
        sendResponse({
          success: true,
          message:
            `Opened ${result.openedCount} tabs.` +
            (result.skippedCount > 0 ? ` Skipped ${result.skippedCount}.` : ""),
        });
      })
      .catch((error) => {
        console.error("Background: executeDorksInBackground failed:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown execution error",
        });
      });
    return true;
  } else if (
    message.type === "CAPTCHA_DETECTED" &&
    sender.tab &&
    sender.tab.id
  ) {
    if (!requireContentScriptSenderForTab(message, sender, sendResponse)) {
      return false;
    }
    const tabId = sender.tab.id;

    markCaptchaDetectedForTab(tabId, "content script CAPTCHA_DETECTED");
    return false;
  } else if (message.action === "extractedPageData") {
    if (!requireContentScriptSenderForTab(message, sender, sendResponse)) {
      return false;
    }
    (async () => {
    const receivedTabId = message.tabId;
    let { page, dataResult, paginationSuccess, pageUrl, terminalReason } = message;

    console.log(
      `[BG extractedPageData Handler] Received message for tabId: ${receivedTabId}, page: ${page}, reported success: ${paginationSuccess}${
        terminalReason ? `, terminal reason: ${terminalReason}` : ""
      }`
    );

    if (receivedTabId && pendingImports.hasOwnProperty(receivedTabId)) {
      clearPendingResponseWatchdog(receivedTabId);
      const importInfo = pendingImports[receivedTabId];

      // If this tab has CAPTCHA and data extraction succeeded, mark CAPTCHA as resolved
      if (importInfo.hasCaptcha && dataResult && (Array.isArray(dataResult) ? dataResult.length > 0 : dataResult.trim().length > 0)) {
          console.log(`[BG extractedPageData] Tab ${receivedTabId} successfully extracted data - CAPTCHA appears resolved!`);
          importInfo.hasCaptcha = false;
          importInfo.awaitingCaptchaRecovery = false;
          importInfo.captchaRecoveryRetries = 0;
          delete importInfo.captchaDetectedAt;
          refreshImportActionIcon();
          chrome.scripting
            .executeScript({
              target: { tabId: receivedTabId },
              func: removeCaptchaBannerInPage,
            })
            .catch((err) =>
              console.warn(
                `Error removing CAPTCHA banner on resolved tab ${receivedTabId}:`,
                err.message
              )
            );

          // Restore tab favicon to scraping (blue)
          setTabFaviconState(receivedTabId, "blue");
      }

      const currentListKey = importInfo.resultListKey;
      console.log(
        `[BG extractedPageData:P${page}] Processing data for Tab ID: ${receivedTabId}. Reported Success: ${paginationSuccess}. Is Auto: ${isAutoImporting}${
          terminalReason ? `. Terminal reason: ${terminalReason}` : ""
        }`
      );
      importInfo.awaitingCaptchaRecovery = false;
      importInfo.captchaRecoveryRetries = 0;
      importInfo.watchdogRetries = 0;
      refreshImportActionIcon();

      const foundItemCount = getUniqueImportedItemCount(dataResult);
      let savedItemCount = await saveImportedDataToList(
        currentListKey,
        dataResult
      );
      const alreadyImportedCount = Math.max(0, foundItemCount - savedItemCount);
      if (foundItemCount > 0) {
        await recordImportActivity(currentListKey, {
          count: savedItemCount,
          duplicateCount: alreadyImportedCount,
          foundCount: foundItemCount,
        });
        chrome.runtime
          .sendMessage({
            action: "importPageSaved",
            listKey: currentListKey,
            count: savedItemCount,
            duplicateCount: alreadyImportedCount,
            foundCount: foundItemCount,
          })
          .catch((err) => {
            /* ignore connection errors */
          });
      }

      if (isTabPartOfAutoImport(receivedTabId)) {
        let currentResultsSet = new Set();
        if (Array.isArray(dataResult)) {
          dataResult.forEach((item) =>
            currentResultsSet.add(String(item).trim())
          );
        } else if (typeof dataResult === "string") {
          dataResult.split("\n").forEach((item) => {
            const trimmed = item.trim();
            if (trimmed) currentResultsSet.add(trimmed);
          });
        }

        const previousResultsSet = importInfo.previousResultsSet;
        const previousPageUrl = importInfo.previousPageUrl;
        const currentPageIdentity = getPaginationPageIdentity(pageUrl);
        const visitedPageIdentities =
          importInfo.visitedPageIdentities instanceof Set
            ? importInfo.visitedPageIdentities
            : new Set();
        const currentGoogleStart = getGoogleSearchStartOffset(pageUrl);
        const previousGoogleStart =
          typeof importInfo.previousGoogleStartOffset === "number"
            ? importInfo.previousGoogleStartOffset
            : null;

        if (
          paginationSuccess &&
          currentPageIdentity &&
          visitedPageIdentities.has(currentPageIdentity)
        ) {
          console.warn(
            `[BG extractedPageData:P${page}] Pagination page identity was already visited. Stopping to avoid a loop. Identity: ${currentPageIdentity}`
          );
          paginationSuccess = false;
        }

        if (
          paginationSuccess &&
          page > 1 &&
          currentGoogleStart !== null &&
          previousGoogleStart !== null &&
          currentGoogleStart <= previousGoogleStart
        ) {
          console.warn(
            `[BG extractedPageData:P${page}] Google pagination did not advance (previous start=${previousGoogleStart}, current start=${currentGoogleStart}). Stopping this tab.`
          );
          paginationSuccess = false;
        }

        if (page > 1 && previousResultsSet && paginationSuccess) {
          if (currentResultsSet.size === previousResultsSet.size) {
            let allMatch = true;
            for (const item of currentResultsSet) {
              if (!previousResultsSet.has(item)) {
                allMatch = false;
                break;
              }
            }
            if (allMatch) {
              const samePageUrl =
                typeof pageUrl === "string" &&
                typeof previousPageUrl === "string" &&
                pageUrl === previousPageUrl;
              if (samePageUrl) {
                console.warn(
                  `[BG extractedPageData:P${page}] **Duplicate results on the same URL detected!** Stopping to avoid a pagination loop. URL: ${pageUrl}`
                );
                paginationSuccess = false;
              } else {
                console.warn(
                  `[BG extractedPageData:P${page}] Duplicate results detected, but page URL changed. Continuing pagination.`
                );
              }
            }
          }
        }
        if (paginationSuccess && page > 1 && savedItemCount === 0) {
          console.warn(
            `[BG extractedPageData:P${page}] No new unique items saved, but next page is available. Continuing pagination.`
          );
        }
        if (currentPageIdentity) {
          visitedPageIdentities.add(currentPageIdentity);
          importInfo.visitedPageIdentities = visitedPageIdentities;
        }
        if (currentGoogleStart !== null) {
          importInfo.previousGoogleStartOffset = currentGoogleStart;
        }
        importInfo.previousResultsSet = currentResultsSet;
        importInfo.previousPageUrl = typeof pageUrl === "string" ? pageUrl : null;
      }

      if (isTabPartOfAutoImport(receivedTabId) && paginationSuccess) {
        // Don't schedule next page if this tab has CAPTCHA
        if (importInfo.hasCaptcha) {
          console.log(
            `[BG extractedPageData:P${page}] Tab ${receivedTabId} has CAPTCHA. Not scheduling next page (will retry after CAPTCHA resolved).`
          );
        } else {
          const navigationResponse = await chrome.tabs
            .sendMessage(receivedTabId, { action: "navigateNext" })
            .catch((error) => ({
              success: false,
              error: error.message || "Could not trigger pagination.",
            }));

          if (!navigationResponse?.success) {
            console.warn(
              `[BG extractedPageData:P${page}] Next page was reported but navigation failed. Completing tab. Error: ${
                navigationResponse?.error || navigationResponse?.message || "Unknown"
              }`
            );
            await completeAutoImportTab(
              receivedTabId,
              currentListKey,
              `[BG extractedPageData:P${page}] Tab ${receivedTabId} complete after navigation failure.`
            );
            sendResponse({ success: true });
            return;
          }

          const currentGoogleStart = getGoogleSearchStartOffset(pageUrl);
          const nextGoogleStart = getGoogleSearchStartOffset(
            navigationResponse.nextUrl
          );
          if (
            currentGoogleStart !== null &&
            nextGoogleStart !== null &&
            nextGoogleStart <= currentGoogleStart
          ) {
            console.warn(
              `[BG extractedPageData:P${page}] Next Google URL does not move forward (current start=${currentGoogleStart}, next start=${nextGoogleStart}). Completing tab. Next URL: ${navigationResponse.nextUrl}`
            );
            await completeAutoImportTab(
              receivedTabId,
              currentListKey,
              `[BG extractedPageData:P${page}] Tab ${receivedTabId} complete after non-forward Google pagination.`
            );
            sendResponse({ success: true });
            return;
          }

          importInfo.currentPage++;
          const nextPage = importInfo.currentPage;
          console.log(
            `[BG extractedPageData:P${page}] Scheduling extract for page ${nextPage}`
          );
          scheduleExtractionAfterPagination(
            receivedTabId,
            currentListKey,
            nextPage,
            pageUrl,
            navigationResponse.nextUrl
          );
        }
      } else {
        const completionReason = !isTabPartOfAutoImport(receivedTabId)
          ? `Manual page import finished for page ${page}.`
          : `Auto-import complete (page ${page}, pagination failed or end detected).`;
        console.log(
          `[BG extractedPageData:P${page}] Import finished for Tab ${receivedTabId}. Reason: ${completionReason}`
        );

        if (isTabPartOfAutoImport(receivedTabId)) {
          await completeAutoImportTab(
            receivedTabId,
            currentListKey,
            `DEBUG extractedPageData: Tab ${receivedTabId} finished SUCCESS/END.`
          );
        } else if (pendingImports.hasOwnProperty(receivedTabId)) {
          if (paginationSuccess && !importInfo.hasCaptcha) {
            const navigationResponse = await chrome.tabs
              .sendMessage(receivedTabId, { action: "navigateNext" })
              .catch((error) => ({
                success: false,
                error: error.message || "Could not trigger manual pagination.",
              }));

            if (navigationResponse?.success) {
              console.log(
                `[BG extractedPageData:P${page} Manual] Moved tab ${receivedTabId} to next page after import. Next URL: ${
                  navigationResponse.nextUrl || "(unknown)"
                }`
              );
            } else {
              console.warn(
                `[BG extractedPageData:P${page} Manual] Next page was reported but manual navigation failed. Error: ${
                  navigationResponse?.error || navigationResponse?.message || "Unknown"
                }`
              );
            }
          }

          setTabFaviconState(receivedTabId, "green");
          clearPendingResponseWatchdog(receivedTabId);
          delete pendingImports[receivedTabId];
          console.log(
            `[BG extractedPageData (Manual)] Removed Tab ID: ${receivedTabId} from pending list.`
          );
          try {
            await chrome.storage.session.set({
              [MANUAL_IMPORT_JUST_FINISHED_KEY]: true,
              [LAST_MANUAL_IMPORT_LIST_KEY]: currentListKey,
            });
            chrome.runtime
              .sendMessage({
                action: "manualImportSaved",
                listKey: currentListKey,
                count: savedItemCount,
                duplicateCount: alreadyImportedCount,
                foundCount: foundItemCount,
              })
              .catch(ignoreExpectedRuntimeError);
          } catch (e) {
            console.warn(
              `[BG extractedPageData (Manual)] Failed to persist manual completion state for tab ${receivedTabId}:`,
              e
            );
          }
        }
      }
    } else {
      console.log(
        `[BG extractedPageData] Received data for unknown or already finished Tab ID: ${receivedTabId}. Ignoring.`
      );
    }
    sendResponse({ success: true });
    })().catch((error) => {
      console.error("[BG extractedPageData Handler] Unhandled error:", error);
      sendResponse({
        success: false,
        error: error.message || "Unknown extractedPageData error",
      });
    });
    return true;
  } else if (message.action === "extractionFailed") {
    if (!requireContentScriptSenderForTab(message, sender, sendResponse)) {
      return false;
    }
    const { tabId, page, error } = message;
    clearPendingResponseWatchdog(tabId);
    console.error(
      `[BG extractionFailed:P${page}] Content script reported error for Tab ID ${tabId}: ${error}`
    );

    // Always notify popup of the error
    if (pendingImports.hasOwnProperty(tabId)) {
      chrome.runtime
        .sendMessage({
          action: "showImportError",
          listKey: pendingImports[tabId].resultListKey,
          error: `Import failed on page ${page}: ${error}`,
        })
        .catch(ignoreExpectedRuntimeError);
    } else {
      /* Send generic error */
    }

    // Handle state update ONLY if it was part of the *active* auto-import process
    if (isTabPartOfAutoImport(tabId)) {
      // Don't remove tab if it has CAPTCHA - it will retry automatically
      const importInfo = pendingImports[tabId];
      if (importInfo && importInfo.hasCaptcha) {
        console.log(
          `[BG extractionFailed] Failure for tab ${tabId} but has CAPTCHA flag. Tab remains in pendingImports for automatic retry.`
        );
        scheduleCaptchaCheck(tabId);
      } else if (importInfo && importInfo.awaitingCaptchaRecovery) {
        importInfo.captchaRecoveryRetries =
          (importInfo.captchaRecoveryRetries || 0) + 1;

        if (importInfo.captchaRecoveryRetries <= CAPTCHA_RECOVERY_MAX_RETRIES) {
          const retryDelay = 1500 * importInfo.captchaRecoveryRetries;
          console.warn(
            `[BG extractionFailed] Tab ${tabId} failed right after CAPTCHA resolution. Retry ${importInfo.captchaRecoveryRetries}/${CAPTCHA_RECOVERY_MAX_RETRIES} in ${retryDelay}ms.`
          );
          setTimeout(() => {
            if (pendingImports.hasOwnProperty(tabId)) {
              const info = pendingImports[tabId];
              extractAndSaveDataFromTab(
                tabId,
                info.resultListKey,
                info.currentPage || page || 1
              );
            }
          }, retryDelay);
          sendResponse({ success: true, retryScheduled: true });
          return false;
        }

        console.warn(
          `[BG extractionFailed] Tab ${tabId} exceeded post-CAPTCHA retries. Marking as failed.`
        );
        importInfo.awaitingCaptchaRecovery = false;
        finishPendingImportFailure(
          tabId,
          `[BG extractionFailed:P${page} T:${tabId}]`,
          null
        );
      } else {
        finishPendingImportFailure(
          tabId,
          `[BG extractionFailed:P${page} T:${tabId}]`,
          null
        );
      }
    } else {
      console.log(
        `[BG extractionFailed] Failure for tab ${tabId} ignored for state counting (not part of active auto-import).`
      );
    }

    sendResponse({ success: true });
    return false;
  } else if (message.action === "stopAutoImport") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log("[BG stopAutoImport] Received stop request.");
    const previouslyImporting = isAutoImporting;
    resetAllImportStates();
    console.log("[BG stopAutoImport] State reset.");
    if (previouslyImporting) {
      console.log(
        "[BG stopAutoImport] Sending updateImportStatus(false) to popup."
      );
      chrome.runtime
        .sendMessage({ action: "updateImportStatus", isImporting: false })
        .catch((e) =>
          console.warn(
            "[BG SendMsg Error] Could not send updateImportStatus on stop:",
            e.message
          )
        );
    }
    sendResponse({ success: true, message: "Auto-import stopped." });
    return false;
  } else if (message.type === "RESUME_IMPORT") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log("[BG RESUME_IMPORT] Received resume request.");
    if (!isAutoImporting) {
      sendResponse({
        success: false,
        error: "No active auto-import to resume.",
      });
      return false;
    }

    const pausedEntries = Object.entries(pendingImports).filter(
      ([, importInfo]) => importInfo && importInfo.hasCaptcha
    );

    if (pausedEntries.length === 0) {
      console.log("[BG RESUME_IMPORT] No CAPTCHA-paused tabs found.");
      chrome.runtime
        .sendMessage({ action: "updateImportStatus", isImporting: isAutoImporting, isPaused: false })
        .catch(ignoreExpectedRuntimeError);
      sendResponse({ success: true, resumedTabs: 0 });
      return false;
    }

    for (const [tabIdStr, importInfo] of pausedEntries) {
      const tabId = Number(tabIdStr);
      importInfo.hasCaptcha = false;
      delete importInfo.captchaDetectedAt;
      extractAndSaveDataFromTab(tabId, importInfo.resultListKey, importInfo.currentPage || 1);
    }

    chrome.runtime
      .sendMessage({ type: "IMPORT_RESUMING" })
      .catch(ignoreExpectedRuntimeError);
    chrome.runtime
      .sendMessage({ action: "updateImportStatus", isImporting: true, isPaused: false })
      .catch(ignoreExpectedRuntimeError);
    sendResponse({ success: true, resumedTabs: pausedEntries.length });
    return false;
  } else if (message.action === "requestManualImport") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    (async () => {
      const requestedTabId = Number(message.tabId);
      const { resultListKey } = message;
      console.log(
        `[BG requestManualImport] Received request for Tab ID: ${message.tabId}, List: ${resultListKey}`
      );

      if (
        !Number.isInteger(requestedTabId) ||
        requestedTabId <= 0 ||
        !resultListKey ||
        resultListKey === "0"
      ) {
        console.error("[BG requestManualImport] Invalid options received.");
        sendResponse({
          success: false,
          error: "Missing tab ID or result list key.",
        });
        return;
      }

      const tab = await chrome.tabs.get(requestedTabId);
      if (!normalizeSafeHttpUrl(tab.url || "")) {
        sendResponse({
          success: false,
          error: "Manual import is only allowed on HTTP(S) pages.",
        });
        return;
      }

      if (pendingImports.hasOwnProperty(requestedTabId)) {
        console.warn(
          `[BG requestManualImport] Tab ID: ${requestedTabId} is already processing an import. Ignoring manual request.`
        );
        sendResponse({
          success: false,
          error: "Tab is already processing an import.",
        });
        return;
      }

      pendingImports[requestedTabId] = {
        resultListKey: resultListKey,
        currentPage: 1,
        previousResultsSet: null,
        isAutoImport: false,
      };
      console.log(
        `Registered Tab ID ${requestedTabId} for MANUAL import into ${resultListKey}.`
      );

      extractAndSaveDataFromTab(requestedTabId, resultListKey, 1);

      sendResponse({
        success: true,
        message: "Manual import process initiated.",
      });
    })().catch((error) => {
      console.error("[BG requestManualImport] Failed:", error);
      sendResponse({
        success: false,
        error: error.message || "Manual import failed.",
      });
    });
    return true;
  } else if (message.action === "configChanged") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log("Background received configChanged message.");
    sendResponse({ success: true });
    return false;
  } else if (message.action === "consumeLastImportActivity") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    (async () => {
      try {
        const data = await chrome.storage.session.get(LAST_IMPORT_ACTIVITY_KEY);
        const activity = data[LAST_IMPORT_ACTIVITY_KEY] || null;
        if (activity) {
          await chrome.storage.session.remove(LAST_IMPORT_ACTIVITY_KEY);
        }
        sendResponse({ success: true, activity });
      } catch (error) {
        console.warn("[BG consumeLastImportActivity] Failed:", error);
        sendResponse({
          success: false,
          error: error.message || "Could not consume import activity.",
        });
      }
    })();
    return true;
  } else if (message.action === "popupOpened") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    console.log(">>> Background: 'popupOpened' message received.");
    (async () => {
      try {
        if (isAutoImporting) {
          console.log(">>> Background [popupOpened]: Import active. Refreshing scrape icon state.");
          refreshImportActionIcon();
        } else {
          console.log(">>> Background [popupOpened]: Resetting icon to default (popup opened, no active import).");
          await clearImportCompletionState();
          await setActionIcon("default", "popupOpened");
        }

        const captchaInfo = isAutoImportBlockedByCaptcha()
          ? getPendingCaptchaInfo()
          : null;
        let statusPayload = {
          action: "updateImportStatus",
          isImporting: isAutoImporting,
          isPaused: Boolean(captchaInfo),
          pausedTabId: captchaInfo?.tabId || null,
          captchaReason: captchaInfo?.reason || null,
          activeListKey: captchaInfo?.listKey || null,
        };
        if (isAutoImporting) {
          console.log(">>> Background [popupOpened]: Auto-import is ACTIVE.");
          const sessionData = await chrome.storage.session.get(
            LAST_AUTO_IMPORT_LIST_KEY
          );
          statusPayload.activeListKey =
            statusPayload.activeListKey || sessionData[LAST_AUTO_IMPORT_LIST_KEY];
        } else {
          console.log(">>> Background [popupOpened]: Auto-import is INACTIVE.");
        }
        console.log(
          `>>> Background [popupOpened]: Sending state:`,
          statusPayload
        );
        chrome.runtime.sendMessage(statusPayload).catch((err) => {
          /* ignore */
        });
        sendResponse({ success: true });
      } catch (error) {
        console.error(
          ">>> Background [popupOpened]: Error processing popup open:",
          error
        );
        sendResponse({
          success: false,
          error: error.message || "Unknown popupOpened error",
        });
      }
    })();
    return true;
  } else if (message.action === "getImportState") {
    if (!requireExtensionPageSender(message, sender, sendResponse)) return false;
    (async () => {
    console.log("[BG getImportState] Received request.");
    let currentActiveListKey = null;
    const captchaInfo = isAutoImportBlockedByCaptcha()
      ? getPendingCaptchaInfo()
      : null;
    if (isAutoImporting) {
      try {
        const sessionData = await chrome.storage.session.get(
          LAST_AUTO_IMPORT_LIST_KEY
        );
        currentActiveListKey = sessionData[LAST_AUTO_IMPORT_LIST_KEY];
      } catch (e) {
        console.warn("Error getting session list key for getImportState", e);
      }
    }
    sendResponse({
      isImporting: isAutoImporting,
      isPaused: Boolean(captchaInfo),
      pausedTabId: captchaInfo?.tabId || null,
      captchaReason: captchaInfo?.reason || null,
      activeListKey: captchaInfo?.listKey || currentActiveListKey,
    });
    })().catch((error) => {
      console.error("[BG getImportState] Failed:", error);
      sendResponse({
        success: false,
        error: error.message || "Unknown getImportState error",
      });
    });
    return true;
  } else {
    console.warn(
      "Background: Received unknown message action/type:",
      message.action || message.type
    );
    sendResponse({
      success: false,
      error: `Unknown action/type: ${message.action || message.type}`,
    });
    return false;
  }
});

async function executeDorksInBackground(options) {
  console.log("Executing dorks in background with options:", options);
  const { target, listKey, mode, engineKey, delay, autoImport, resultListKey } =
    options;
  const effectiveDelay =
    typeof delay === "number" && delay >= 0 ? delay : DEFAULT_DELAY;
  let openedCount = 0,
    skippedCount = 0;
  const willAutoImport = autoImport && resultListKey && resultListKey !== "0";

  await resetAllImportStates(!willAutoImport);

  if (willAutoImport) {
    currentImportState.isActive = true;
    isAutoImporting = true;
    try {
      await chrome.storage.session.set({
        [LAST_AUTO_IMPORT_LIST_KEY]: resultListKey,
      });
      console.log(`LOG: Stored last auto-import list key: ${resultListKey}`);
    } catch (sessionSetError) {
      console.warn(
        "LOG: Failed to set last auto-import list key in session storage:",
        sessionSetError
      );
    }
    try {
      await setActionIcon("blue", "executeDorksInBackground");
      console.log("LOG: setIcon (BLUE) promise resolved.");
    } catch (iconError) {
      console.warn("Failed to set blue icon:", iconError);
    }
  }

  if (autoImport && (!resultListKey || resultListKey === "0")) {
    throw new Error("Auto-Import requires a valid Result List.");
  }

  try {
    const configData = await getStorageData([
      STORAGE_KEYS.USER_SELECTORS,
      STORAGE_KEYS.DEFAULT_SELECTORS,
    ]);
    const userConfigs = configData[STORAGE_KEYS.USER_SELECTORS] || {};
    const defaultConfigs = configData[STORAGE_KEYS.DEFAULT_SELECTORS] || {};
    const siteConfig = userConfigs[engineKey] || defaultConfigs[engineKey];

    if (!siteConfig || !siteConfig.baseUrl) {
      throw new Error(
        `Search engine configuration not found or invalid for key: ${engineKey}`
      );
    }
    const baseUrl = siteConfig.baseUrl;
    const defaultParams = siteConfig.defaultParams || "";

    const listData = await getStorageData(listKey);
    if (!listData || !Array.isArray(listData[listKey])) {
      throw new Error(`Dork list not found or invalid for key: ${listKey}`);
    }
    const items = listData[listKey].filter(Boolean);

    if (items.length === 0) {
      console.warn(`Dork list ${listKey} is empty.`);
      return { openedCount: 0, skippedCount: 0 };
    }

    let calculatedExpectedCount = 0;
    if (willAutoImport) {
      calculatedExpectedCount = items.filter((item) => {
        let finalQuery = "";
        const trimmedItem = item.trim();
        if (mode === 1) {
          if (target.includes("$target") || target.includes("$t")) return true;
          else return false;
        } else {
          if (trimmedItem.includes("$target") || trimmedItem.includes("$t"))
            return true;
          else return false;
        }
      }).length;
    }
    expectedImportsCount = calculatedExpectedCount;
    console.log(`Calculated expectedImportsCount: ${expectedImportsCount}`);

    console.log(
      `Processing ${items.length} items with delay ${effectiveDelay}ms.`
    );
    for (const item of items) {
      let finalQuery = "";
      const trimmedItem = item.trim();
      let shouldSkip = false;

      if (mode === 1) {
        if (target.includes("$target"))
          finalQuery = target.replace(/\$target/g, trimmedItem);
        else if (target.includes("$t"))
          finalQuery = target.replace(/\$t/g, trimmedItem);
        else {
          shouldSkip = true;
          console.warn(
            `Skipping item (Mode 1): Placeholder missing in target.`
          );
        }
      } else {
        if (trimmedItem.includes("$target"))
          finalQuery = trimmedItem.replace(/\$target/g, target);
        else if (trimmedItem.includes("$t"))
          finalQuery = trimmedItem.replace(/\$t/g, target);
        else {
          shouldSkip = true;
          console.warn(
            `Skipping item (Mode 0): Placeholder missing in list item.`
          );
        }
      }

      if (!finalQuery && !shouldSkip) {
        shouldSkip = true;
        console.warn(`Skipping item: Final query empty.`);
      }

      if (shouldSkip) {
        skippedCount++;
        if (willAutoImport && expectedImportsCount > 0) {
          expectedImportsCount--;
          console.log(
            `DEBUG executeDorks: Decremented expected count due to skip. New count: ${expectedImportsCount}`
          );
        }
        continue;
      }

      const fullUrl = buildSafeSearchUrl(baseUrl, finalQuery, defaultParams);
      if (!fullUrl) {
        console.warn(
          `Skipping item: generated URL was invalid or unsafe for engine ${engineKey}.`
        );
        skippedCount++;
        if (willAutoImport && expectedImportsCount > 0) {
          expectedImportsCount--;
        }
        continue;
      }

      try {
        if (willAutoImport && firstAutoImportTabId === null) {
          const tempTab = await chrome.tabs.create({
            url: fullUrl,
            active: false,
          });
          firstAutoImportTabId = tempTab.id;
          openedCount++;
          console.log(
            `Opened FIRST tab ${openedCount} [ID: ${tempTab.id}]: ${finalQuery}`
          );
          console.log(`Stored firstAutoImportTabId: ${firstAutoImportTabId}`);

          pendingImports[tempTab.id] = {
            resultListKey: resultListKey,
            currentPage: 1,
            previousResultsSet: null,
            isAutoImport: true,
            delayBetweenPages: effectiveDelay,
          };
          autoImportTabIds.add(tempTab.id);
          setTabFaviconState(tempTab.id, "default");
          refreshImportActionIcon();
          console.log(
            `Registered FIRST Tab ID ${tempTab.id} for auto-import into ${resultListKey}.`
          );
        } else if (willAutoImport) {
          if (openedCount > 0 && effectiveDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
          }
          const subsequentTab = await chrome.tabs.create({
            url: fullUrl,
            active: false,
          });
          openedCount++;
          console.log(
            `Opened tab ${openedCount} [ID: ${subsequentTab.id}]: ${finalQuery}`
          );

          pendingImports[subsequentTab.id] = {
            resultListKey: resultListKey,
            currentPage: 1,
            previousResultsSet: null,
            isAutoImport: true,
            delayBetweenPages: effectiveDelay,
          };
          autoImportTabIds.add(subsequentTab.id);
          setTabFaviconState(subsequentTab.id, "default");
          refreshImportActionIcon();
          console.log(
            `Registered Tab ID ${subsequentTab.id} for auto-import into ${resultListKey}.`
          );
        } else {
          if (openedCount > 0 && effectiveDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
          }
          const nonAutoTab = await chrome.tabs.create({
            url: fullUrl,
            active: false,
          });
          openedCount++;
          console.log(
            `Opened non-auto-import tab ${openedCount} [ID: ${nonAutoTab.id}]: ${finalQuery}`
          );
        }
      } catch (tabError) {
        console.error(`Error opening tab for URL ${fullUrl}:`, tabError);
        skippedCount++;
      }
    }

    console.log(
      `Finished LOOPING through items. Opened: ${openedCount}, Skipped: ${skippedCount}. Final expected count: ${expectedImportsCount}`
    );

    if (willAutoImport && openedCount === 0) {
      console.log(
        "LOG: No tabs were opened for auto-import. Resetting state and icon."
      );
      const wasImporting = isAutoImporting;
      isAutoImporting = false;
      firstAutoImportTabId = null;
      if (wasImporting) {
        chrome.runtime
          .sendMessage({ action: "updateImportStatus", isImporting: false })
          .catch((err) => {
            if (!err.message.includes("Receiving end does not exist")) {
              console.warn(
                "[BG SendMsg Error] Could not send updateImportStatus (no tabs):",
                err.message
              );
            }
          });
      }
      try {
        await setActionIcon("default", "executeDorksInBackground");
      } catch (iconError) {
        console.warn("Failed to reset icon (no tabs opened):", iconError);
      }
    }

    return { openedCount, skippedCount };
  } catch (error) {
    console.error("Error in executeDorksInBackground:", error);
    await resetAllImportStates();
    throw error;
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    pendingImports.hasOwnProperty(tabId) &&
    pendingImports[tabId].isAutoImport === true &&
    pendingImports[tabId].currentPage === 1
  ) {
    const importInfo = pendingImports[tabId];
    if (tab.url && tab.url.startsWith("http")) {
      if (importInfo.status === "processing" || importInfo.status === "extracting") {
        console.log(
          `Tab ${tabId} completed initial load again while extraction is already active. Ignoring duplicate onUpdated event.`
        );
        return;
      }
      importInfo.status = "processing";
      console.log(
        `Tab ${tabId} completed initial load (${tab.url}). Triggering FIRST auto-import into list ${importInfo.resultListKey}.`
      );
      extractAndSaveDataFromTab(tabId, importInfo.resultListKey, 1);
    } else if (tab.url && !tab.url.startsWith("http")) {
      console.log(
        `Tab ${tabId} completed but URL (${tab.url}) is not http/https. Removing from pending auto-import.`
      );
      clearPendingResponseWatchdog(tabId);
      delete pendingImports[tabId];
      if (isAutoImporting && expectedImportsCount > 0) {
        expectedImportsCount--;
        console.log(
          `[onUpdated] Decremented expectedImportsCount after non-http navigation. Remaining: ${expectedImportsCount}`
        );
        if (expectedImportsCount === 0) {
          console.log("[onUpdated] All imports accounted for after cleanup. Finalizing.");
          await finalizeAutoImport(importInfo.resultListKey);
        }
      }
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  autoImportTabIds.delete(tabId);
  actionIconTabStateCache.delete(tabId);
  if (!pendingImports.hasOwnProperty(tabId)) return;

  const importInfo = pendingImports[tabId];
  console.warn(`[tabs.onRemoved] Pending import tab ${tabId} was closed. Cleaning up state.`);
  clearPendingResponseWatchdog(tabId);
  delete pendingImports[tabId];

  if (isAutoImporting && importInfo?.isAutoImport === true && expectedImportsCount > 0) {
    expectedImportsCount--;
    console.log(
      `[tabs.onRemoved] Decremented expectedImportsCount. Remaining: ${expectedImportsCount}`
    );
    if (expectedImportsCount === 0) {
      console.log("[tabs.onRemoved] All imports accounted for after tab close. Finalizing.");
      finalizeAutoImport(importInfo.resultListKey).catch((error) =>
        console.error("[tabs.onRemoved] Failed to finalize auto-import:", error)
      );
    }
  }
});

if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    reapplyCurrentActionIcon(
      `tabs.onActivated:T${activeInfo.tabId}:W${activeInfo.windowId}`
    );
    setTimeout(
      () =>
        reapplyCurrentActionIcon(
          `tabs.onActivated:T${activeInfo.tabId}:reinforce`
        ),
      250
    );
  });
}

if (chrome.windows?.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    reapplyCurrentActionIcon(`windows.onFocusChanged:W${windowId}`);
    setTimeout(
      () => reapplyCurrentActionIcon(`windows.onFocusChanged:W${windowId}:reinforce`),
      250
    );
  });
}

async function extractAndSaveDataFromTab(tabId, resultListKey, currentPage) {
  const logPrefix = `[BG extract:P${currentPage} T:${tabId}]`;
  console.log(`${logPrefix} Attempting extraction. List: ${resultListKey}`);
  setTabFaviconState(tabId, "blue");
  if (pendingImports.hasOwnProperty(tabId)) {
    pendingImports[tabId].status = "extracting";
    refreshImportActionIcon();
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    console.log(`${logPrefix} Tab URL: ${tab.url}`);
    const captchaUrlReason = await getCaptchaUrlReason(tab.url);
    if (captchaUrlReason) {
      console.warn(
        `${logPrefix} ${captchaUrlReason} detected before extraction. Waiting for manual resolution.`
      );
      markCaptchaDetectedForTab(tabId, `${captchaUrlReason} before extraction`);
      return;
    }

    const injectionSuccess = await ensureContentScriptInjected(tabId, logPrefix);

    if (!injectionSuccess) {
      console.error(`${logPrefix} Final injection state: FAILED.`);
      finishPendingImportFailure(
        tabId,
        logPrefix,
        `Import failed: Cannot inject script into page ${tab.url}. Page: ${currentPage}`
      );
      return;
    }

    console.log(`${logPrefix} Sending extractData message to tab.`);
    try {
      const extractResponse = await chrome.tabs.sendMessage(tabId, {
        action: "extractData",
        currentPage: currentPage,
        originatingTabId: tabId,
      });
      if (extractResponse?.captchaDetected) {
        markCaptchaDetectedForTab(
          tabId,
          extractResponse.reason || "content script reported CAPTCHA"
        );
        return;
      }
    } catch (err) {
      console.error(
        `${logPrefix} Error sending message post-injection: ${err.message}`
      );
      finishPendingImportFailure(
        tabId,
        logPrefix,
        `Import failed: Could not message content script on page ${currentPage}: ${err.message}`
      );
      return;
    }
    console.log(`${logPrefix} Message sent. Waiting for response message...`);
    registerPendingResponseWatchdog(tabId, currentPage, resultListKey);
  } catch (error) {
    console.error(
      `${logPrefix} Outer error (e.g., tab closed before check):`,
      error
    );
    finishPendingImportFailure(
      tabId,
      logPrefix,
      `Import failed before extraction could start on page ${currentPage}: ${
        error.message || error
      }`
    );
  }
}

async function saveImportedDataToList(listKey, newData) {
  if (!listKey || listKey === "0") {
    console.warn("SaveImport: Invalid listKey provided.");
    return 0;
  }

  const newDataArray = getSanitizedImportedItems(newData);

  if (newDataArray.length === 0) {
    console.log(`SaveImport: No new valid data to add to ${listKey}.`);
    return 0;
  }

  const previousSave = importSaveQueues.get(listKey) || Promise.resolve();
  const saveTask = previousSave.catch(() => {}).then(async () => {
    let savedCount = 0;

    const storageData = await getStorageData(listKey);
    let existingList = [];
    if (storageData && Array.isArray(storageData[listKey])) {
      existingList = storageData[listKey]
        .map((item) => sanitizeImportedListItem(item == null ? "" : String(item)))
        .filter(Boolean);
    } else if (storageData && storageData[listKey]) {
      console.warn(
        `SaveImport: Existing data for key ${listKey} is not an array. Overwriting.`
      );
    }

    const originalSize = new Set(existingList).size;
    const combinedSet = new Set([...existingList, ...newDataArray]);
    const updatedList = Array.from(combinedSet);
    const newSize = updatedList.length;
    savedCount = newSize - originalSize;

    const updatedAtKey = getListUpdatedAtStorageKey(listKey);
    await setStorageData({
      [listKey]: updatedList,
      ...(savedCount > 0 && updatedAtKey
        ? { [updatedAtKey]: new Date().toISOString() }
        : {}),
    });
    console.log(
      `SaveImport: Successfully saved ${savedCount} new unique item(s) (total ${updatedList.length}) to list ${listKey}`
    );
    return savedCount;
  });

  const cleanupTask = saveTask.finally(() => {
    if (importSaveQueues.get(listKey) === cleanupTask) {
      importSaveQueues.delete(listKey);
    }
  });
  importSaveQueues.set(listKey, cleanupTask);

  try {
    return await saveTask;
  } catch (error) {
    console.error(`SaveImport: Error saving data to list ${listKey}:`, error);
    return 0;
  }
}

function mergeMissingSiteConfigFields(existingConfigs, sourceConfigs, fields) {
  let changed = false;
  const mergedConfigs = { ...(existingConfigs || {}) };

  Object.entries(sourceConfigs || {}).forEach(([domain, sourceConfig]) => {
    const existingConfig = mergedConfigs[domain];
    if (!existingConfig) return;

    let configChanged = false;
    const updatedConfig = { ...existingConfig };

    fields.forEach((field) => {
      const sourceValue = sourceConfig?.[field];
      if (
        typeof updatedConfig[field] === "undefined" &&
        Array.isArray(sourceValue) &&
        sourceValue.length > 0
      ) {
        updatedConfig[field] = [...sourceValue];
        configChanged = true;
      }
    });

    if (configChanged) {
      mergedConfigs[domain] = updatedConfig;
      changed = true;
    }
  });

  return { configs: mergedConfigs, changed };
}

async function migrateCaptchaConfigDefaults(
  defaultSiteSelectors,
  initialUserSiteSelectors
) {
  const data = await getStorageData([
    STORAGE_KEYS.DEFAULT_SELECTORS,
    STORAGE_KEYS.USER_SELECTORS,
    STORAGE_KEYS.SITE_CAPTCHA_DEFAULTS_MIGRATED,
  ]);

  if (data[STORAGE_KEYS.SITE_CAPTCHA_DEFAULTS_MIGRATED] === true) {
    console.log("Background: CAPTCHA config defaults migration already done.");
    return;
  }

  const defaultMerge = mergeMissingSiteConfigFields(
    data[STORAGE_KEYS.DEFAULT_SELECTORS] || {},
    defaultSiteSelectors,
    SITE_CAPTCHA_CONFIG_KEYS
  );
  const userMerge = mergeMissingSiteConfigFields(
    data[STORAGE_KEYS.USER_SELECTORS] || {},
    initialUserSiteSelectors,
    SITE_CAPTCHA_CONFIG_KEYS
  );

  const updates = {
    [STORAGE_KEYS.SITE_CAPTCHA_DEFAULTS_MIGRATED]: true,
  };
  if (defaultMerge.changed) {
    updates[STORAGE_KEYS.DEFAULT_SELECTORS] = defaultMerge.configs;
  }
  if (userMerge.changed) {
    updates[STORAGE_KEYS.USER_SELECTORS] = userMerge.configs;
  }

  await setStorageData(updates);
  console.log(
    `Background: CAPTCHA config defaults migration complete. Default changed: ${defaultMerge.changed}, user changed: ${userMerge.changed}.`
  );
}

async function setupDefaultData(forceReset = false) {
  return new Promise(async (resolve, reject) => {
    try {
      const initData = await getStorageData(STORAGE_KEYS.DEFAULTS_INITIALIZED);
      const defaultsAlreadyInitialized =
        !forceReset && initData[STORAGE_KEYS.DEFAULTS_INITIALIZED] === true;

      console.log(
        defaultsAlreadyInitialized
          ? "Background: Defaults already initialized, checking migrations."
          : `Background: Setting up default data (Force Reset: ${forceReset}).`
      );

      const defaultDorkLists = {
        "List-D-Default": [
          "site:$target inurl:installer-log.txt intext:DUPLICATOR INSTALL-LOG",
          "site:$target confidential | top secret | classified | undisclosed",
          'site:$target intitle:"Index of"',
          "site:$target filetype:xls",
          'site:$target "<?php"',
          "site:$target inurl:redirect",
          'inurl:$target site:http://s3.amazonaws.com confidential OR "top secret"',
          'site:"$target" ext:(doc | pdf | xls | txt | rtf | odt | ppt | xml)',
        ],
        "List-D-Recon": [
          "site:repl.it intext:$target",
          "site:zoom.us inurl:$target",
          "site:atlassian.net inurl:$target",
          "site:s3.amazonaws.com inurl:$target",
          "site:trello.com $target",
          "site:jsdelivr.net $target",
          "site:codeshare.io $target",
          "site:pastebin.com $target",
          "site:bitbucket.org $target",
          "site:*.atlassian.net $target",
          "site:gitlab $target",
          "site:scribd.com $target",
          "site:npmjs.com $target",
        ],
        "List-D-Github": [
          '"$target" db_password',
          '"$target" "Authorization: Bearer"',
          '"$target" filename:vim_settings.xml',
          '"$target" language:shell',
          '"$target" language:python',
          '"$target" fb_secret',
          '"$target" sendkeys',
          '"$target" pwd',
          '"$target" mailgun',
          '"$target" mailchimp',
          '"$target" dotfiles',
          '"$target" filename:.dockercfg auth',
          '"$target" apikey',
          '"$target" ssh language:yaml',
        ],
        "List-D-Domain": [
          "example.com",
          "subdomain.example.com",
          "dev.example.com",
          "test.example.com",
        ],
        "List-D-Exts": [
          "site:$target ext:php",
          "site:$target ext:jsp",
          "site:$target ext:axd",
          "site:$target ext:ashx",
          "site:$target ext:aspx",
          "site:$target ext:cfm",
        ],
      };
      const defaultResultLists = {
        "List-R-Exam": [],
      };

      const defaultSiteSelectors = {
        "google.com": {
          linkSelectors: [
            "div.v5yQqb a[jsname='UWckNb']",
            "div.MjjYud a[jsname='UWckNb']",
            "div.yuRUbf > a:first-child",
            "div.g a[href]:not([class])",
            "div.Gx5Zad a[href]",
          ],
          nextPageSelectors: [
            "a#pnnext[aria-disabled='false']",
            "a#pnnext:not([aria-disabled='true'])",
            'a[aria-label="Next page"]:not([aria-disabled="true"])',
            '.d6cvqb a[aria-label="Next page"]:not([aria-disabled="true"])',
            "td.d6cvqb a:last-child",
            ".GNJvt.ipz2Oe",
          ],
          baseUrl: "https://www.google.com/search?q=",
          defaultParams: "&filter=0",
          useInEngineSelect: true,
          matchPatterns: ["google.com/search"],
          captchaUrlPatterns: ["google.com/sorry"],
          captchaTextPatterns: [
            "our systems have detected unusual traffic",
            "unusual traffic from your computer network",
            "to continue, please type the characters",
          ],
          captchaSelectors: [
            'iframe[src*="recaptcha"]',
            "div.g-recaptcha",
          ],
          dataType: "href",
          checkVisibility: true,
        },
        "github.com": {
          linkSelectors: [".search-title a"],
          nextPageSelectors: [
            'a.next_page[rel="next"]:not(.disabled):not([aria-disabled="true"])',
            'a.next[rel="next"]:not(.disabled):not([aria-disabled="true"])',
            'a[rel="next"]:not(.disabled):not([aria-disabled="true"])',
          ],
          baseUrl: "https://github.com/search?q=",
          defaultParams: "&type=Code",
          useInEngineSelect: true,
          matchPatterns: ["github.com/search"],
          dataType: "href",
          checkVisibility: true,
        },
      };

      const initialUserSiteSelectors = {
        "hackerone.com": {
          linkSelectors: [".spec-asset-identifier strong"],
          dataType: "innerText",
          useInEngineSelect: false,
          matchPatterns: ["hackerone.com/", "/policy_scopes", "/reports/"],
        },
        "exploit-db.com": {
          linkSelectors: ["#exploits-table tbody td:nth-child(2) a"],
          dataType: "innerText",
          nextPageSelectors: [
            "#exploits-table_paginate li.next:not(.disabled) a",
            "#exploits-table_paginate .paginate_button.next:not(.disabled)",
          ],
          useInEngineSelect: false,
          matchPatterns: [
            "exploit-db.com/google-hacking-database",
            "exploit-db.com/search",
          ],
          checkVisibility: true,
        },
        "intigriti.com": {
          linkSelectors: [".domain"],
          dataType: "innerText",
          useInEngineSelect: false,
          matchPatterns: ["app.intigriti.com/programs/"],
        },
        "bugcrowd.com": {
          linkSelectors: [".cc-rewards-link-table__endpoint"],
          dataType: "innerText",
          useInEngineSelect: false,
          matchPatterns: ["bugcrowd.com/programs/"],
        },
        "bing.com": {
          linkSelectors: ["#b_results li.b_algo h2 a[href]", "li.b_algo h2 a"],
          nextPageSelectors: [
            "a.sb_pagN:not(.sb_pagD)",
            'a.sw_next[title="Next page"]:not([aria-disabled="true"])',
            'a.sw_next[title="Next page"]:not(.disabled)',
          ],
          baseUrl: "https://www.bing.com/search?q=",
          useInEngineSelect: true,
          matchPatterns: ["bing.com/search"],
          captchaUrlPatterns: [
            "bing.com/turing/captcha",
            "/turing/captcha",
            "/captcha",
          ],
          captchaTextPatterns: [
            "verify you are human",
            "verify that you are human",
            "make sure you are not a robot",
            "enter the characters you see",
            "human verification",
            "verification challenge",
            "solve this puzzle",
          ],
          captchaSelectors: [
            'iframe[src*="captcha"]',
            'iframe[src*="arkoselabs"]',
            'iframe[src*="funcaptcha"]',
            '[id*="captcha" i]',
            '[class*="captcha" i]',
            'form[action*="captcha" i]',
          ],
          dataType: "href",
          checkVisibility: true,
        },
        "duckduckgo.com": {
          linkSelectors: [
            'article[data-testid="result"] h2 a[data-testid="result-title-a"]',
          ],
          nextPageSelectors: [
            "#more-results",
            "input[type='submit'][value='More Results']",
            "input.result--more__btn",
            "a.result--more",
          ],
          baseUrl: "https://duckduckgo.com/?t=h_&q=",
          useInEngineSelect: true,
          matchPatterns: ["duckduckgo.com/"],
          dataType: "href",
          checkVisibility: true,
        },
      };

      if (defaultsAlreadyInitialized) {
        await migrateCaptchaConfigDefaults(
          defaultSiteSelectors,
          initialUserSiteSelectors
        );
        return resolve();
      }

      if (forceReset) {
        console.log("Background Reset: Clearing previous user data...");
        const allData = await getStorageData(null);
        const keysToRemove = Object.keys(allData).filter(
          (key) =>
            key.startsWith("List-") ||
            key.startsWith(LIST_UPDATED_AT_PREFIX) ||
            key === STORAGE_KEYS.USER_SELECTORS ||
            key.startsWith("tab2Save-") ||
            key === "saveOption" ||
            key === "list-save-tab1" ||
            key === "saveTargetCheckboxState" ||
            key === "sidePanelEnabled" ||
            key === STORAGE_KEYS.DEFAULTS_INITIALIZED ||
            key === STORAGE_KEYS.SITE_CAPTCHA_DEFAULTS_MIGRATED
        );

        const uniqueKeysToRemove = [...new Set(keysToRemove)];

        if (uniqueKeysToRemove.length > 0) {
          console.log("Background Reset: Keys to remove:", uniqueKeysToRemove);
          await removeStorageData(uniqueKeysToRemove);
          console.log("Background: Successfully removed keys during reset.");
        } else {
          console.log(
            "Background Reset: No specific user keys found to remove."
          );
        }
      }

      const checkAgain = await getStorageData(
        STORAGE_KEYS.DEFAULTS_INITIALIZED
      );
      if (forceReset || !checkAgain[STORAGE_KEYS.DEFAULTS_INITIALIZED]) {
        const dataToSave = {
          ...defaultDorkLists,
          ...defaultResultLists,
          [STORAGE_KEYS.DEFAULT_SELECTORS]: defaultSiteSelectors,
          [STORAGE_KEYS.USER_SELECTORS]: initialUserSiteSelectors,
          [STORAGE_KEYS.DEFAULTS_INITIALIZED]: true,
          [STORAGE_KEYS.SITE_CAPTCHA_DEFAULTS_MIGRATED]: true,
        };

        console.log("Background: Saving default data to storage:", dataToSave);
        await setStorageData(dataToSave);
        console.log("Background: Default data setup complete.");
      } else {
        console.log(
          "Background: Setup skipped as defaults were initialized between check and save."
        );
      }

      resolve();
    } catch (error) {
      console.error("Background: Error during setupDefaultData:", error);
      reject(error);
    }
  });
}

async function resetDefaults() {
  console.log("Resetting default data requested...");
  try {
    await setupDefaultData(true);
    console.log("Defaults reset successfully via resetDefaults.");
    return { success: true };
  } catch (error) {
    console.error("Error during default reset:", error);
    return { success: false, error: error.message || "Unknown reset error" };
  }
}

async function restoreCompletionIconIfNeeded(context = "restoreCompletionIconIfNeeded") {
  try {
    const completionState = await getImportCompletionState();
    if (completionState[IMPORT_JUST_FINISHED_KEY] !== true || isAutoImporting) {
      return;
    }

    console.log(
      `[${context}] Restoring finished import toolbar state for list ${
        completionState[LAST_AUTO_IMPORT_LIST_KEY] || "(unknown)"
      }.`
    );
    await setActionIcon("green", context);
    reinforceActionIcon("green", context, 3, 700);
  } catch (error) {
    console.warn(`[${context}] Failed to restore completion icon:`, error);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    console.log(`FastDork ${details.reason} detected.`);
    setupDefaultData().finally(() =>
      restoreCompletionIconIfNeeded("runtime.onInstalled")
    );
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Background: Browser startup detected.");
  setupDefaultData().finally(() =>
    restoreCompletionIconIfNeeded("runtime.onStartup")
  );
});

console.log("FastDork Background Script Loaded and Listener Attached.");
restoreCompletionIconIfNeeded("backgroundLoaded");
