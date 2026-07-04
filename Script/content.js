// Public build: keep warnings/errors visible, silence development logs.
(() => {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
})();

(function initFastDorkContentScript() {
if (globalThis.__fastDorkContentScriptLoaded) {
  console.log("FastDork Content Script already initialized.");
  return;
}
globalThis.__fastDorkContentScriptLoaded = true;

// Handles extracting data from pages, navigating, and pattern searching

// --- Global Variables ---
let currentSiteSelectors = null; // Holds selectors fetched from storage
let isLoadingSelectors = false;
let selectorPromise = null;
let captchaAlreadyReported = false;
let captchaConfigLookupStarted = false;

// --- Storage Keys ---
const STORAGE_KEYS = {
  DEFAULT_SELECTORS: "defaultSiteSelectors",
  USER_SELECTORS: "userSiteSelectors",
};
const SAFE_NAVIGATION_PROTOCOLS = new Set(["http:", "https:"]);

function sanitizeExtractedItem(value) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return cleaned || null;
}

function normalizeSafeHttpUrl(value, baseUrl = window.location.href) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, baseUrl);
    if (!SAFE_NAVIGATION_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch (error) {
    console.warn("[CS normalizeSafeHttpUrl] Rejected invalid URL:", trimmed);
    return null;
  }
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );

  try {
    const binary = atob(padded);
    if (typeof TextDecoder === "function") {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return binary;
  } catch (error) {
    console.warn("[CS decodeBase64Url] Could not decode Bing redirect:", error);
    return null;
  }
}

function decodeBingRedirectUrl(value, baseUrl = window.location.href) {
  const safeUrl = normalizeSafeHttpUrl(value, baseUrl);
  if (!safeUrl) return null;

  try {
    const parsed = new URL(safeUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith("bing.com") || !parsed.pathname.startsWith("/ck/")) {
      return safeUrl;
    }

    const encodedTarget = parsed.searchParams.get("u");
    if (!encodedTarget) return safeUrl;

    const targetPayload = encodedTarget.startsWith("a1")
      ? encodedTarget.slice(2)
      : encodedTarget;
    const decodedTarget = decodeBase64Url(targetPayload);
    return normalizeSafeHttpUrl(decodedTarget, safeUrl) || safeUrl;
  } catch (error) {
    return safeUrl;
  }
}

function isHostnameSuffix(url, suffix) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  } catch (error) {
    return false;
  }
}

function isSameOriginHttpUrl(candidateUrl, baseUrl = window.location.href) {
  try {
    const candidate = new URL(candidateUrl, baseUrl);
    const current = new URL(baseUrl);
    return (
      SAFE_NAVIGATION_PROTOCOLS.has(candidate.protocol) &&
      candidate.origin === current.origin
    );
  } catch (error) {
    return false;
  }
}

/**
 * Gets the appropriate selectors (user-defined or default) for the given URL from storage.
 * Caches the result globally for the current page load.
 * @param {string} pageUrl - The URL of the current page.
 * @returns {Promise<object|null>} - A promise that resolves with the selector object or null.
 */
async function getSelectorsForUrl(pageUrl) {
  if (!pageUrl) return null;

  const url = new URL(pageUrl);
  const hostname = url.hostname.startsWith("www.")
    ? url.hostname.substring(4)
    : url.hostname;

  console.log(`FastDork: Getting selectors for hostname: ${hostname}`);

  if (isLoadingSelectors && selectorPromise) {
    console.log(
      "FastDork: Already loading selectors, returning existing promise."
    );
    return selectorPromise;
  }
  isLoadingSelectors = true;

  selectorPromise = new Promise(async (resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.USER_SELECTORS, STORAGE_KEYS.DEFAULT_SELECTORS],
      (data) => {
        isLoadingSelectors = false;
        if (chrome.runtime.lastError) {
          console.error(
            "Error getting selectors from storage:",
            chrome.runtime.lastError
          );
          resolve(null);
          return;
        }

        const userSelectors = data[STORAGE_KEYS.USER_SELECTORS] || {};
        const defaultSelectors = data[STORAGE_KEYS.DEFAULT_SELECTORS] || {};
        let foundSelectors = null;

        if (userSelectors[hostname]) {
          console.log(`FastDork: Found USER selectors for ${hostname}`);
          foundSelectors = userSelectors[hostname];
        } else if (defaultSelectors[hostname]) {
          console.log(`FastDork: Found DEFAULT selectors for ${hostname}`);
          foundSelectors = defaultSelectors[hostname];
        } else {
          // Try matching base domain for defaults (e.g., app.intigriti.com -> intigriti.com)
          const baseDomain = hostname.split(".").slice(-2).join(".");
          if (hostname !== baseDomain && defaultSelectors[baseDomain]) {
            console.log(
              `FastDork: Found DEFAULT selectors by base domain ${baseDomain}`
            );
            foundSelectors = defaultSelectors[baseDomain];
          } else {
            console.log(
              `FastDork: No specific selectors found for ${hostname} or base domain.`
            );
          }
        }

        currentSiteSelectors = foundSelectors; // Cache globally
        resolve(foundSelectors);
      }
    );
  });
  return selectorPromise;
}

/**
 * Checks if primary result elements are visible on the page using loaded selectors.
 * @returns {boolean} True if result elements are found, false otherwise.
 */
function areResultsVisible() {
  if (!currentSiteSelectors) {
    console.log("FastDork: Cannot check visibility, selectors not loaded.");
    return false;
  }

  // Determine which selectors indicate the presence of results content
  const resultContainerSelectors =
    currentSiteSelectors.resultsContainer ||
    (Array.isArray(currentSiteSelectors.linkSelectors)
      ? currentSiteSelectors.linkSelectors
      : []) ||
    (currentSiteSelectors.articleSelector
      ? [currentSiteSelectors.articleSelector]
      : []) ||
    [];

  if (resultContainerSelectors.length === 0) {
    console.log(
      "FastDork: No result container selectors defined for visibility check."
    );
    return true; // Assume visible if no check is defined
  }

  for (const selector of resultContainerSelectors) {
    try {
      if (document.querySelector(selector)) {
        console.log(
          "FastDork: Results container found with selector:",
          selector
        );
        return true;
      }
    } catch (e) {
      console.warn(
        `Selector "${selector}" failed during visibility check: ${e}`
      );
    }
  }

  console.log(
    "FastDork: No result containers found yet based on current selectors."
  );
  return false;
}

function isGoogleSearchPage() {
  try {
    const currentUrl = new URL(window.location.href);
    return (
      currentUrl.hostname.toLowerCase().includes("google.") &&
      currentUrl.pathname === "/search"
    );
  } catch (error) {
    return false;
  }
}

function getNormalizedBodyText() {
  const bodyClone = document.body?.cloneNode(true);
  bodyClone?.querySelector?.("#fastdork-captcha-banner")?.remove();
  return ((bodyClone?.innerText || bodyClone?.textContent) || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizePatternText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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

function getConfiguredCaptchaUrlPatterns() {
  return getConfigListValue(currentSiteSelectors, "captchaUrlPatterns");
}

function getConfiguredCaptchaTextPatterns() {
  return getConfigListValue(currentSiteSelectors, "captchaTextPatterns");
}

function getConfiguredCaptchaSelectors() {
  return getConfigListValue(currentSiteSelectors, "captchaSelectors");
}

function ensureCaptchaConfigLookupStarted() {
  if (captchaConfigLookupStarted || currentSiteSelectors || isLoadingSelectors) {
    return;
  }
  captchaConfigLookupStarted = true;
  getSelectorsForUrl(window.location.href)
    .then(() => {
      if (!captchaAlreadyReported) {
        detectCaptcha();
      }
    })
    .catch((error) => {
      console.warn("FastDork: Could not load CAPTCHA config:", error);
    });
}

function isGoogleNoResultsPage() {
  if (!isGoogleSearchPage()) return false;

  const pageText = getNormalizedBodyText();
  return (
    pageText.includes("aucun document ne correspond aux termes de recherche") ||
    pageText.includes("did not match any documents") ||
    pageText.includes("no results found for") ||
    pageText.includes("na donne aucun resultat")
  );
}

/**
 * Extracts data (links or text) from the current page based on provided selectors.
 * Handles different selector structures (Google, Bing, DDG, simple).
 * @param {object} selectors - The selector object for the current site.
 * @returns {string} Newline-separated string of extracted data, or an empty string if none found.
 */
function extractDataFromPage(selectors) {
  if (!selectors) {
    console.log("FastDork: No selectors provided for extraction.");
    return "";
  }
  const url = window.location.href;

  console.log(
    "FastDork: Extracting data using dynamically loaded selectors for URL:",
    url
  );
  let data = [];

  const dataType = selectors.dataType || "href";
  const mainSelector = selectors.selector;
  const linkSelectors =
    selectors.linkSelectors || (mainSelector ? [mainSelector] : []);
  const hrefFallbacks = selectors.hrefFallbacks || [];
  const containerSelector = selectors.resultsContainer;
  const itemSelector = selectors.resultItemSelector;
  const linkSelectorWithinItem = selectors.linkSelector;
  const articleSelector = selectors.articleSelector;
  const titleLinkSelector = selectors.titleLinkSelector;
  const urlLinkSelector = selectors.urlLinkSelector;
  const conditionSelector = selectors.conditionSelector; // For sites requiring a specific element to be present

  if (conditionSelector && !document.querySelector(conditionSelector)) {
    console.log("FastDork: Condition selector not met, skipping extraction.");
    return "";
  }

  try {
    let elements = [];

    // A. Google-style (Multiple primary selectors + fallbacks)
    if (linkSelectors.length > 0) {
      console.log("Trying primary link selectors:", linkSelectors);
      for (const selector of linkSelectors) {
        elements = [...document.querySelectorAll(selector)];

        if (elements.length > 0) {
          console.log(`Found ${elements.length} with: ${selector}`);
          break;
        }
      }
      if (
        elements.length === 0 &&
        hrefFallbacks.length > 0 &&
        dataType === "href"
      ) {
        console.log("Trying href fallbacks:", hrefFallbacks);
        for (const selector of hrefFallbacks) {
          elements = [...document.querySelectorAll(selector)];

          if (elements.length > 0) {
            console.log(`Found ${elements.length} with fallback: ${selector}`);
            break;
          }
        }
      }
    }
    // B. Bing-style (Container -> Item -> Link)
    else if (containerSelector && itemSelector && linkSelectorWithinItem) {
      console.log("Trying Bing-style selectors");
      elements = [
        ...document.querySelectorAll(
          `${containerSelector} ${itemSelector} ${linkSelectorWithinItem}`
        ),
      ];

      console.log(`Found ${elements.length} with Bing-style.`);
    }
    // C. DuckDuckGo-style (Article -> Title/URL Link)
    else if (articleSelector && (titleLinkSelector || urlLinkSelector)) {
      console.log("Trying DuckDuckGo-style selectors");
      const articles = document.querySelectorAll(articleSelector);

      console.log(`Found ${articles.length} DDG articles.`);
      articles.forEach((article) => {
        const titleLink = titleLinkSelector
          ? article.querySelector(titleLinkSelector)
          : null;
        const urlLink = urlLinkSelector
          ? article.querySelector(urlLinkSelector)
          : null;
        const linkElement = titleLink || urlLink;
        if (linkElement) elements.push(linkElement);
      });

      console.log(`Found ${elements.length} potential links in DDG articles.`);
    }
    // D. Simple single selector (HackerOne, ExploitDB, Intigriti, Bugcrowd etc.)
    else if (mainSelector) {
      console.log("Trying simple selector:", mainSelector);
      elements = [...document.querySelectorAll(mainSelector)];

      console.log(`Found ${elements.length} with simple selector.`);
    }

    if (dataType === "innerText") {
      data = elements
        .map((n) => sanitizeExtractedItem(n.innerText))
        .filter(Boolean);
    } else {
      // Default to 'href'
      data = elements
        .map((n) =>
          decodeBingRedirectUrl(n.href || n.getAttribute?.("href"), url)
        )
        .filter(Boolean)
        // Filter out self-referential links on search engines
        .filter(
          (href) =>
            !(
              url.includes("google.com/search") &&
              (href.includes("google.com/") ||
                href.includes("/webcache.googleusercontent.com/"))
            )
        )
        .filter(
          (href) =>
            !(
              url.includes("bing.com/search") &&
              isHostnameSuffix(href, "bing.com")
            )
        );
    }

    data = [...new Set(data)]; // Make unique

    console.log(
      `FastDork: Extracted ${data.length} unique items (Type: ${dataType}).`
    );
  } catch (error) {
    console.error("FastDork: Error during data extraction:", error);
  }

  return data.join("\n");
}

function getNavigationUrl(element) {
  const href =
    typeof element?.href === "string" && element.href
      ? element.href
      : element?.getAttribute?.("href");
  if (!href) return null;

  return normalizeSafeHttpUrl(href);
}

function getGoogleSearchStart(url) {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.includes("google.") || parsedUrl.pathname !== "/search") {
      return null;
    }
    const start = Number(parsedUrl.searchParams.get("start") || "0");
    return Number.isFinite(start) ? start : null;
  } catch (error) {
    return null;
  }
}

function isForwardGooglePaginationUrl(candidateUrl) {
  const currentStart = getGoogleSearchStart(window.location.href);
  if (currentStart === null) return true;
  if (!candidateUrl) return false;

  const candidateStart = getGoogleSearchStart(candidateUrl);
  if (candidateStart === null) return false;
  return candidateStart > currentStart;
}

/**
 * Attempts to navigate to the next page using the loaded selectors.
 * Handles both links (<a> tags) and elements requiring a click.
 * @returns {{success: boolean, currentUrl: string, nextUrl: string | null, message: string}}
 */
function findNextPageElement() {
  if (!currentSiteSelectors || !currentSiteSelectors.nextPageSelectors) {
    console.log("[CS findNextPageElement] No next page selectors defined.");
    return null;
  }
  const nextPageSelectors = Array.isArray(
    currentSiteSelectors.nextPageSelectors
  )
    ? [...currentSiteSelectors.nextPageSelectors]
    : [currentSiteSelectors.nextPageSelectors];
  if (
    currentSiteSelectors.fallbackNextPageSelector &&
    !nextPageSelectors.includes(currentSiteSelectors.fallbackNextPageSelector)
  ) {
    nextPageSelectors.push(currentSiteSelectors.fallbackNextPageSelector);
  }
  console.log(
    "[CS findNextPageElement] Attempting to find element with selectors:",
    nextPageSelectors
  );
  let nextPageLink = null;
  for (const selector of nextPageSelectors) {
    try {
      nextPageLink = document.querySelector(selector);
      if (nextPageLink) {
        const navigationUrl = getNavigationUrl(nextPageLink);
        if (
          nextPageLink.closest(".disabled") ||
          nextPageLink.getAttribute("aria-disabled") === "true"
        ) {
          console.log(
            `[CS findNextPageElement] Found element with selector "${selector}", but it appears disabled.`
          );
          nextPageLink = null;
        } else if (
          nextPageLink.tagName === "A" &&
          (!navigationUrl || !isSameOriginHttpUrl(navigationUrl))
        ) {
          console.warn(
            `[CS findNextPageElement] Found selector "${selector}", but rejected unsafe pagination URL: ${navigationUrl || "(empty)"}`
          );
          nextPageLink = null;
        } else if (
          getGoogleSearchStart(window.location.href) !== null &&
          !isForwardGooglePaginationUrl(navigationUrl)
        ) {
          console.log(
            `[CS findNextPageElement] Found selector "${selector}", but it does not move Google pagination forward.`
          );
          nextPageLink = null;
        } else {
          console.log(
            "[CS findNextPageElement] Found clickable element with selector:",
            selector
          );
          break;
        }
      }
    } catch (e) {
      console.warn(
        `[CS findNextPageElement] Error querying selector "${selector}": ${e}`
      );
    }
  }

  if (!nextPageLink) {
    console.log(
      "[CS findNextPageElement] Could not find a clickable next page element using selectors:",
      nextPageSelectors
    );
  }
  return nextPageLink;
}

function hasNextPage() {
  return !!findNextPageElement();
}

function goToNextPage() {
  const nextPageLink = findNextPageElement();
  if (nextPageLink) {
    const currentUrl = window.location.href;
    const nextUrl = getNavigationUrl(nextPageLink);
    console.log(
      `[CS goToNextPage] Triggering next page navigation. Next URL: ${
        nextUrl || "(unknown; click-based navigation)"
      }`
    );
    if (nextPageLink.tagName === "A") {
      if (!nextUrl || !isSameOriginHttpUrl(nextUrl)) {
        return {
          success: false,
          currentUrl,
          nextUrl,
          message: "Unsafe pagination URL blocked.",
        };
      }
      window.location.href = nextUrl;
    } else {
      nextPageLink.click();
    }
    return {
      success: true,
      currentUrl,
      nextUrl,
      message: "Pagination triggered.",
    };
  }

  return {
    success: false,
    currentUrl: window.location.href,
    nextUrl: null,
    message: "No next page element found.",
  };
}

function reportCaptchaDetected(reason) {
  console.log("FastDork: CAPTCHA detected on page:", reason);
  if (!captchaAlreadyReported) {
    captchaAlreadyReported = true;
    chrome.runtime.sendMessage({ type: "CAPTCHA_DETECTED", reason });
  }
  clearInterval(captchaCheckInterval);
}

function isKnownCaptchaPage() {
  try {
    const currentUrl = new URL(window.location.href);
    const hostname = currentUrl.hostname.toLowerCase();
    const pathname = currentUrl.pathname.toLowerCase();
    const lowerHref = currentUrl.href.toLowerCase();
    if (
      hostname.includes("google.") &&
      pathname.startsWith("/sorry")
    ) {
      return true;
    }
    if (
      hostname.endsWith("bing.com") &&
      (pathname.startsWith("/turing/captcha") ||
        pathname.includes("/captcha"))
    ) {
      return true;
    }
    const configuredUrlPatterns = getConfiguredCaptchaUrlPatterns();
    if (
      configuredUrlPatterns.some((pattern) =>
        lowerHref.includes(pattern.toLowerCase())
      )
    ) {
      return true;
    }
  } catch (error) {
    // Ignore invalid URL parsing and fall back to page text checks.
  }

  const pageText = getNormalizedBodyText();
  const configuredTextPatterns = getConfiguredCaptchaTextPatterns().map(
    normalizePatternText
  );
  return (
    pageText.includes("verify you are human") ||
    pageText.includes("verify that you are human") ||
    pageText.includes("completing the security check") ||
    pageText.includes("one more step before you continue") ||
    pageText.includes("unusual traffic from your computer network") ||
    pageText.includes("our systems have detected unusual traffic") ||
    pageText.includes("to continue, please type the characters") ||
    pageText.includes("make sure you are not a robot") ||
    pageText.includes("prove you are not a robot") ||
    pageText.includes("verify that you are not a robot") ||
    pageText.includes("enter the characters you see") ||
    pageText.includes("human verification") ||
    pageText.includes("verification challenge") ||
    pageText.includes("solve this puzzle") ||
    pageText.includes("trafic inhabituel") ||
    pageText.includes("pour continuer, veuillez saisir") ||
    pageText.includes("verifier que vous n etes pas un robot") ||
    pageText.includes("entrez les caracteres que vous voyez") ||
    pageText.includes("resolution du puzzle") ||
    configuredTextPatterns.some((pattern) => pattern && pageText.includes(pattern))
  );
}

function isOwnCaptchaBannerElement(element) {
  return Boolean(element?.closest?.("#fastdork-captcha-banner"));
}

function isVisibleCaptchaCandidate(element) {
  if (!element || isOwnCaptchaBannerElement(element)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Function to detect CAPTCHA elements
function detectCaptcha() {
  ensureCaptchaConfigLookupStarted();

  if (isKnownCaptchaPage()) {
    reportCaptchaDetected("known CAPTCHA page signature");
    return true;
  }

  // Common selectors for CAPTCHA challenges (e.g., reCAPTCHA)
  // This list might need to be expanded based on the types of CAPTCHAs encountered.
  const captchaSelectors = [
    'iframe[src*="recaptcha"]', // Google reCAPTCHA iframe
    'iframe[title*="captcha"]', // General CAPTCHA iframe title
    'iframe[src*="captcha"]',
    'iframe[src*="arkoselabs"]',
    'iframe[src*="funcaptcha"]',
    "div.g-recaptcha", // Google reCAPTCHA div
    "div.h-captcha", // hCaptcha div
    '[id*="captcha" i]',
    '[class*="captcha" i]',
    'input[name*="captcha" i]',
    'form[action*="captcha" i]',
    // Add more selectors as needed for other CAPTCHA providers
    '[id*="cf-challenge"]', // Cloudflare challenge elements
    "body.no-js:-webkit-any(form#challenge-form)", // Another Cloudflare pattern
    'iframe[src*="turnstile"]', // Cloudflare Turnstile
    ...getConfiguredCaptchaSelectors(),
  ];

  for (const selector of captchaSelectors) {
    let elements = [];
    try {
      elements = [...document.querySelectorAll(selector)];
    } catch (error) {
      console.warn(`FastDork: CAPTCHA selector failed: ${selector}`, error);
      continue;
    }

    if (elements.some(isVisibleCaptchaCandidate)) {
      reportCaptchaDetected(`selector ${selector}`);
      return true; // Indicate CAPTCHA found
    }
  }

  return false; // No CAPTCHA found
}

// Periodically check for CAPTCHAs
// Check more frequently initially, then maybe slow down if needed.
// Avoid checking too often to minimize performance impact.
const captchaCheckInterval = setInterval(detectCaptcha, 2000); // Check every 2 seconds

// Optional: Clear interval when the page unloads
window.addEventListener("unload", () => {
  clearInterval(captchaCheckInterval);
});

// --- End of Added CAPTCHA Detection ---

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content Script Received message:", message);

  if (message.action === "fastDorkPing") {
    sendResponse({ ready: true });
    return false;
  } else if (message.action === "checkCaptchaStatus") {
    // Check if CAPTCHA is still present on this page
    const hasCaptcha = detectCaptcha();
    console.log(`[CS checkCaptchaStatus] CAPTCHA present: ${hasCaptcha}`);
    sendResponse({ captchaResolved: !hasCaptcha });
    return false; // Sync response
  } else if (message.action === "extractData") {
    const currentPageForLog = message.currentPage || 1;
    const originatingTabId = message.originatingTabId;
    console.log(
      `[CS extractData:P${currentPageForLog}] Received request for URL: ${window.location.href} (Originating Tab ID: ${originatingTabId})`
    );
    const currentUrl = window.location.href;
    if (detectCaptcha()) {
      console.warn(
        `[CS extractData:P${currentPageForLog}] CAPTCHA detected before extraction. Waiting for resolution.`
      );
      sendResponse({
        captchaDetected: true,
        reason: "CAPTCHA detected before extraction",
      });
      return false;
    }

    (async () => {
      try {
        const selectors = await getSelectorsForUrl(currentUrl);
        console.log(
          `[CS extractData:P${currentPageForLog}] Loaded selectors: ${
            selectors ? "Yes" : "No"
          }`
        );
        if (!selectors) {
          console.error(
            `[CS extractData:P${currentPageForLog}] Could not load selectors.`
          );
          chrome.runtime.sendMessage({
            action: "extractionFailed",
            error: "Selectors not loaded",
            tabId: originatingTabId,
            page: currentPageForLog,
          });
          return;
        }

        const requiresWaitCheck =
          selectors.checkVisibility ||
          currentUrl.includes("google.com/search") ||
          currentUrl.includes("duckduckgo.com/");
        let data = "";
        let paginationSuccess = false;

        const performExtractionAndPagination = async (options = {}) => {
          const terminalReason = options.terminalReason || null;
          console.log(
            `[CS extractData:P${currentPageForLog}] Extracting data...`
          );
          data = extractDataFromPage(currentSiteSelectors);
          console.log(
            `[CS extractData:P${currentPageForLog}] Extracted data (length: ${
              typeof data === "string" ? data.length : "N/A"
            }).`
          );

          console.log(
            `[CS extractData:P${currentPageForLog}] Checking for next page...`
          );
          paginationSuccess = terminalReason ? false : hasNextPage();
          console.log(
            `[CS extractData:P${currentPageForLog}] Next page available: ${paginationSuccess}${
              terminalReason ? ` (terminal reason: ${terminalReason})` : ""
            }`
          );

          console.log(
            `[CS extractData:P${currentPageForLog}] Sending extractedPageData message. Tab ID: ${originatingTabId}, Pagination Success: ${paginationSuccess}`
          );
          chrome.runtime.sendMessage(
            {
              action: "extractedPageData",
              tabId: originatingTabId,
              page: currentPageForLog,
              pageUrl: window.location.href,
              dataResult: data || "",
              paginationSuccess: paginationSuccess,
              terminalReason,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  `[CS extractData:P${currentPageForLog}] Error sending extractedPageData message: ${chrome.runtime.lastError.message}`
                );
              } else {
                console.log(
                  `[CS extractData:P${currentPageForLog}] Background ACKed extractedPageData.`
                );
              }
            }
          );
        };

        if (requiresWaitCheck) {
          let attempts = 0;
          const maxAttempts = 25;
          const intervalTime = 200;
          console.log(
            `[CS extractData:P${currentPageForLog}] Waiting for results to be visible...`
          );
          const checkInterval = setInterval(async () => {
            attempts++;
            if (detectCaptcha()) {
              clearInterval(checkInterval);
              console.warn(
                `[CS extractData:P${currentPageForLog}] CAPTCHA detected while waiting for results.`
              );
              return;
            }
            if (isGoogleNoResultsPage()) {
              clearInterval(checkInterval);
              console.log(
                `[CS extractData:P${currentPageForLog}] Google no-results page detected. Treating as normal pagination end.`
              );
              await performExtractionAndPagination({
                terminalReason: "google_no_results",
              });
            } else if (areResultsVisible()) {
              clearInterval(checkInterval);
              console.log(
                `[CS extractData:P${currentPageForLog}] Wait complete.`
              );
              await performExtractionAndPagination();
            } else if (attempts >= maxAttempts) {
              clearInterval(checkInterval);
              console.error(
                `[CS extractData:P${currentPageForLog}] Timed out waiting for results.`
              );
              chrome.runtime.sendMessage({
                action: "extractionFailed",
                error: "Timeout waiting for results",
                tabId: originatingTabId,
                page: currentPageForLog,
              });
            }
          }, intervalTime);
        } else {
          console.log(
            `[CS extractData:P${currentPageForLog}] No wait required.`
          );
          await performExtractionAndPagination();
        }
      } catch (error) {
        console.error(
          `[CS extractData:P${currentPageForLog}] Error during extraction process:`,
          error
        );
        chrome.runtime.sendMessage({
          action: "extractionFailed",
          error: error.message || "Unknown extraction error",
          tabId: originatingTabId,
          page: currentPageForLog,
        });
      }
    })();

    return false; // Not using sendResponse
  } else if (message.action === "searchPatterns") {
    // Extracts potential paths/endpoints from scripts and page source

    console.log("FastDork Content Script: Running custom searchPatterns...");
    try {
      // Regex to find strings resembling paths within quotes
      const regex = /(?<=("|\'|\`))\/[a-zA-Z0-9_?&=\/\-\#.]*(?=("|\'|\`))/g;
      const links = new Set();
      let fetchPromises = [];
      const scripts = document.getElementsByTagName("script");

      // Process external scripts (same-origin only by default)
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (src && src.startsWith(window.location.origin)) {
          let promise = fetch(src)
            .then((response) => (response.ok ? response.text() : null))
            .then((content) => {
              if (!content) return;
              try {
                const matches = content.matchAll(regex);
                for (const match of matches) links.add(match[0]);
              } catch (e) {
                console.warn(`Regex error in script ${src}:`, e);
              }
            })
            .catch((err) => {
              console.log(
                "FastDork: Error fetching/processing script:",
                src,
                err
              );
            });
          fetchPromises.push(promise);
        }
        // Process inline scripts
        if (scripts[i].innerHTML) {
          try {
            const inlineMatches = scripts[i].innerHTML.matchAll(regex);
            for (const match of inlineMatches) links.add(match[0]);
          } catch (e) {
            console.warn("Regex error in inline script:", e);
          }
        }
      }
      // Process page HTML source
      try {
        const pageHTML = document.documentElement.outerHTML;
        const htmlMatches = pageHTML.matchAll(regex);
        for (const match of htmlMatches) links.add(match[0]);
      } catch (e) {
        console.warn("Regex error matching page HTML:", e);
      }

      // Wait for all fetches to complete and send results
      Promise.allSettled(fetchPromises).then(() => {
        console.log("Custom search finished. Found links:", links.size);
        sendResponse({ success: true, patternsFound: Array.from(links) });
      });
      return true; // Indicate async response
    } catch (error) {
      console.error("Error during custom searchPatterns:", error);
      sendResponse({ success: false, error: error.toString() });
      return false;
    }
  }

  // Handle legacy 'navigateNext' message if needed
  else if (message.action === "navigateNext") {
    console.log("FastDork: Received 'navigateNext' command.");
    getSelectorsForUrl(window.location.href).then(() => {
      const navigation = goToNextPage();
      sendResponse({
        success: navigation.success,
        currentUrl: navigation.currentUrl,
        nextUrl: navigation.nextUrl,
        message: navigation.message,
      });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error.message || "Pagination failed.",
      });
    });
    return true;
  }

  // Handle unknown messages
  else {
    console.warn(
      "FastDork Content Script: Received unknown message action:",
      message.action
    );
    return false; // No async action
  }
});

// Pre-fetch selectors when the script is injected
getSelectorsForUrl(window.location.href);

console.log("FastDork Content Script Loaded and Listener Attached.");
})();
