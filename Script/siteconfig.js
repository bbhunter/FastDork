// Public build: keep warnings/errors visible, silence development logs.
(() => {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
})();

// Script/site_config.js

document.addEventListener("DOMContentLoaded", async () => {
  // --- Constants ---
  const STORAGE_KEYS = {
    USER_SELECTORS: "userSiteSelectors",
    DEFAULT_SELECTORS: "defaultSiteSelectors",
  };

  // --- UI Element References ---
  const form = document.getElementById("siteConfigForm");
  const hiddenDomainInput = document.getElementById("siteConfigHiddenDomain");
  const domainInput = document.getElementById("siteDomainInput");
  const useInSearchEngineCheckbox = document.getElementById(
    "siteUseInSearchEngine"
  );
  const searchEngineFieldsDiv = document.getElementById("searchEngineFields");
  const baseUrlInput = document.getElementById("siteBaseUrlInput");
  const defaultParamsInput = document.getElementById("siteDefaultParamsInput");
  const linkSelectorInput = document.getElementById("siteLinkSelectorInput");
  const nextPageSelectorInput = document.getElementById(
    "siteNextPageSelectorInput"
  );
  const dataTypeInput = document.getElementById("siteDataTypeInput");
  const matchPatternsInput = document.getElementById("siteMatchPatterns");
  const matchPatternsFieldsDiv = document.getElementById("matchPatternsFields");
  const captchaUrlPatternsInput = document.getElementById(
    "siteCaptchaUrlPatterns"
  );
  const captchaTextPatternsInput = document.getElementById(
    "siteCaptchaTextPatterns"
  );
  const captchaSelectorsInput = document.getElementById("siteCaptchaSelectors");
  const modalTitle = document.getElementById("modalTitle");
  const saveButton = document.getElementById("btnSaveSiteConfig");
  const closeButton = document.getElementById("btnCloseConfigTab");
  const deleteButton = document.getElementById("btnDeleteSiteConfigModal");
  const errorElement = document.querySelector(".modal-error");

  // --- Initial Setup ---
  const urlParams = new URLSearchParams(window.location.search);
  const domainToEdit = urlParams.get("edit");
  const isEditing = !!domainToEdit;

  // --- Helper Functions ---

  function showConfigError(message) {
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = "block";
      window.scrollTo(0, 0); // Scroll to top to make error visible
    } else {
      alert(`Error: ${message}`); // Fallback
    }
  }

  function hideConfigError() {
    if (errorElement) {
      errorElement.style.display = "none";
      errorElement.textContent = "";
    }
  }

  function isValidSelector(selector) {
    if (!selector || typeof selector !== "string") return false;
    try {
      // Test the first part if it's a comma-separated list
      document
        .createDocumentFragment()
        .querySelector(selector.split(",")[0].trim());
      return true;
    } catch (e) {
      return false;
    }
  }

  function parseLineList(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatLineList(value) {
    return Array.isArray(value) ? value.filter(Boolean).join("\n") : "";
  }

  function getListWithDefault(config, defaultConfig, key) {
    if (Array.isArray(config?.[key]) && config[key].length > 0) {
      return config[key];
    }
    if (
      Array.isArray(defaultConfig?.[key]) &&
      defaultConfig[key].length > 0
    ) {
      return defaultConfig[key];
    }
    return [];
  }

  function getStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });
  }

  function setStorageData(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function removeStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  /** Updates visibility of conditional fields based on 'Use as Search Engine' checkbox */
  function updateFieldVisibility(isChecked) {
    if (searchEngineFieldsDiv) {
      searchEngineFieldsDiv.style.display = isChecked ? "block" : "none";
    }
    if (matchPatternsFieldsDiv) {
      matchPatternsFieldsDiv.style.display = isChecked ? "none" : "block";
    }
    if (baseUrlInput) {
      if (isChecked) {
        baseUrlInput.setAttribute("required", "");
      } else {
        baseUrlInput.removeAttribute("required");
      }
    }
  }

  // --- Load Data For Editing ---
  async function loadConfigForEditing() {
    if (!isEditing || !domainToEdit) {
      return;
    }
    modalTitle.textContent = `Edit Configuration: ${domainToEdit}`;
    domainInput.value = domainToEdit;
    domainInput.disabled = true; // Prevent changing domain during edit
    hiddenDomainInput.value = domainToEdit; // Store original domain
    deleteButton.style.display = "inline-block"; // Show delete/reset button

    try {
      const data = await getStorageData([
        STORAGE_KEYS.USER_SELECTORS,
        STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);

      const userConfigs = data[STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs = data[STORAGE_KEYS.DEFAULT_SELECTORS] || {};

      let config = null;
      let configSource = "None";
      let defaultConfigData = defaultConfigs.hasOwnProperty(domainToEdit)
        ? defaultConfigs[domainToEdit]
        : null;

      // Prioritize user config over default
      if (userConfigs.hasOwnProperty(domainToEdit)) {
        config = userConfigs[domainToEdit];
        configSource = "User";
      } else if (defaultConfigData) {
        config = defaultConfigData;
        configSource = "Default";
      }

      let isUser = userConfigs.hasOwnProperty(domainToEdit);
      let isDefault = defaultConfigs.hasOwnProperty(domainToEdit);
      let isPurelyCustom = isUser && !isDefault;
      let isUserOverride = isUser && isDefault;

      if (config) {
        // Populate form fields
        baseUrlInput.value = config.baseUrl || "";
        linkSelectorInput.value = Array.isArray(config.linkSelectors)
          ? config.linkSelectors.join(", ")
          : config.linkSelector || "";
        const nextPageValue = Array.isArray(config.nextPageSelectors)
          ? config.nextPageSelectors.join(", ")
          : config.nextPageSelector || "";
        nextPageSelectorInput.value = nextPageValue;
        dataTypeInput.value = config.dataType || "href";
        defaultParamsInput.value = config.defaultParams || "";
        if (captchaUrlPatternsInput) {
          captchaUrlPatternsInput.value = formatLineList(
            getListWithDefault(config, defaultConfigData, "captchaUrlPatterns")
          );
        }
        if (captchaTextPatternsInput) {
          captchaTextPatternsInput.value = formatLineList(
            getListWithDefault(config, defaultConfigData, "captchaTextPatterns")
          );
        }
        if (captchaSelectorsInput) {
          captchaSelectorsInput.value = formatLineList(
            getListWithDefault(config, defaultConfigData, "captchaSelectors")
          );
        }

        if (matchPatternsInput) {
          let patternsToDisplay = [];
          // Use config patterns if available, fallback to default if not
          if (
            config.matchPatterns &&
            Array.isArray(config.matchPatterns) &&
            config.matchPatterns.length > 0
          ) {
            patternsToDisplay = config.matchPatterns;
          } else if (
            defaultConfigData &&
            Array.isArray(defaultConfigData.matchPatterns) &&
            defaultConfigData.matchPatterns.length > 0
          ) {
            patternsToDisplay = defaultConfigData.matchPatterns;
          }

          if (patternsToDisplay.length > 0) {
            matchPatternsInput.value = patternsToDisplay.join("\n");
          } else {
            matchPatternsInput.value = "";
          }
        }

        useInSearchEngineCheckbox.checked = config.useInEngineSelect === true;
        updateFieldVisibility(useInSearchEngineCheckbox.checked);

        // Configure Delete/Reset button text and title based on config source
        if (isPurelyCustom) {
          deleteButton.textContent = "Delete Custom";
          deleteButton.title = `Delete the custom configuration for ${domainToEdit}.`;
        } else if (isUserOverride) {
          deleteButton.textContent = "Reset to Default";
          deleteButton.title = `Remove custom overrides for ${domainToEdit} and revert to default settings.`;
        } else if (isDefault && !isUser) {
          // This case means we loaded default data because no user data exists
          deleteButton.textContent = "Reset to Default";
          deleteButton.title = `Reset fields to default values for ${domainToEdit}.`;
        }
      } else {
        showConfigError(`Configuration data not found for: ${domainToEdit}`);
        saveButton.disabled = true;
        deleteButton.style.display = "none";
      }
    } catch (e) {
      showConfigError(`Error loading configuration: ${e.message}`);
      saveButton.disabled = true;
      deleteButton.style.display = "none";
    }
  }

  // --- Save Configuration ---
  async function saveConfiguration() {
    hideConfigError();
    let isValid = true;
    const domain = domainInput.value
      .trim()
      .toLowerCase()
      .replace(/^www\./, ""); // Normalize domain
    const originalDomain = hiddenDomainInput.value
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    const baseUrl = baseUrlInput.value.trim();
    const linkSelectorsRaw = linkSelectorInput.value.trim();
    const nextPageSelectorsRaw = nextPageSelectorInput.value.trim();
    const dataType = dataTypeInput.value || "href";
    const defaultParams = defaultParamsInput.value.trim();
    const useInEngineSelect = useInSearchEngineCheckbox.checked;
    const matchPatternsRaw = matchPatternsInput.value.trim();
    const captchaUrlPatternsRaw = captchaUrlPatternsInput?.value.trim() || "";
    const captchaTextPatternsRaw = captchaTextPatternsInput?.value.trim() || "";
    const captchaSelectorsRaw = captchaSelectorsInput?.value.trim() || "";

    // --- Input Validations ---
    if (!domain) {
      isValid = false;
      showConfigError("Domain cannot be empty.");
    } else if (
      !/^[a-zA-Z0-9.-]+(\.[a-zA-Z]{2,})$/.test(domain) ||
      domain.startsWith(".") ||
      domain.endsWith(".")
    ) {
      isValid = false;
      showConfigError("Invalid domain format (e.g., example.com).");
    }
    if (baseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
      isValid = false;
      showConfigError(
        "Invalid Base URL format (must start with http:// or https://)."
      );
    }
    if (useInEngineSelect && !baseUrl) {
      isValid = false;
      showConfigError(
        "Base URL is required if 'Use as Search Engine' is checked."
      );
    }
    if (!linkSelectorsRaw) {
      isValid = false;
      showConfigError("Link Selector(s) cannot be empty.");
    }

    const linkSelectorsArray = linkSelectorsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (linkSelectorsArray.some((s) => !isValidSelector(s))) {
      isValid = false;
      showConfigError("One or more Link Selectors are invalid CSS.");
    }

    const nextPageSelectorsArray = nextPageSelectorsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (nextPageSelectorsArray.some((s) => !isValidSelector(s))) {
      isValid = false;
      showConfigError("One or more Next Page Selectors are invalid CSS.");
    }

    const captchaUrlPatternsArray = parseLineList(captchaUrlPatternsRaw);
    const captchaTextPatternsArray = parseLineList(captchaTextPatternsRaw);
    const captchaSelectorsArray = parseLineList(captchaSelectorsRaw);
    if (captchaSelectorsArray.some((s) => !isValidSelector(s))) {
      isValid = false;
      showConfigError("One or more CAPTCHA Selectors are invalid CSS.");
    }

    let matchPatternsArray = matchPatternsRaw
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    // Automatically derive a match pattern from Base URL if possible and not already present
    if (useInEngineSelect && baseUrl) {
      try {
        const urlObject = new URL(baseUrl);
        let path = urlObject.pathname;
        if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
        const derivedPattern = urlObject.origin + path;
        const lowerCaseDerived = derivedPattern.toLowerCase();
        const alreadyExists = matchPatternsArray.some(
          (existing) => existing && existing.toLowerCase() === lowerCaseDerived
        );
        if (!alreadyExists && derivedPattern) {
          matchPatternsArray.push(derivedPattern);
        }
      } catch (e) {
        /* Ignore parsing errors for derivation */
      }
    }

    if (!isValid) {
      return; // Stop if validation failed
    }

    if (isEditing && domain !== originalDomain) {
      // Should not happen due to disabled input, but double-check
      showConfigError(
        `Cannot change domain name during edit. Original: ${originalDomain}`
      );
      return;
    }

    // --- Prepare Config Object ---
    // Use undefined for optional fields if empty to avoid storing empty strings/arrays
    const newConfig = {
      linkSelectors:
        linkSelectorsArray.length > 0 ? linkSelectorsArray : undefined,
      dataType: dataType,
      baseUrl: useInEngineSelect ? baseUrl || undefined : undefined,
      useInEngineSelect: useInEngineSelect,
      defaultParams: useInEngineSelect ? defaultParams || undefined : undefined,
      matchPatterns:
        matchPatternsArray.length > 0 ? matchPatternsArray : undefined,
      nextPageSelectors:
        nextPageSelectorsArray.length > 0 ? nextPageSelectorsArray : undefined,
      captchaUrlPatterns:
        captchaUrlPatternsArray.length > 0 ? captchaUrlPatternsArray : undefined,
      captchaTextPatterns:
        captchaTextPatternsArray.length > 0
          ? captchaTextPatternsArray
          : undefined,
      captchaSelectors:
        captchaSelectorsArray.length > 0 ? captchaSelectorsArray : undefined,
    };

    // --- Save to Storage ---
    try {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      const data = await getStorageData(STORAGE_KEYS.USER_SELECTORS);
      const userConfigs = data[STORAGE_KEYS.USER_SELECTORS] || {};
      userConfigs[domain] = newConfig; // Add or overwrite the config

      await setStorageData({ [STORAGE_KEYS.USER_SELECTORS]: userConfigs });

      // Notify other parts of the extension about the change
      chrome.runtime.sendMessage({ action: "configChanged" }, (response) => {
        if (chrome.runtime.lastError) {
          /* Handle potential error sending message */
        }
        alert("Configuration Saved!");
        window.close(); // Close the config tab
      });
    } catch (error) {
      showConfigError(`Failed to save configuration: ${error.message}`);
      saveButton.disabled = false;
      saveButton.textContent = "Save Configuration";
    }
  }

  // --- Delete/Reset Configuration ---
  async function deleteOrResetConfiguration() {
    const domainToDelete = hiddenDomainInput.value
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");

    if (!domainToDelete) {
      showConfigError("Cannot delete/reset: No domain specified.");
      return;
    }

    try {
      const data = await getStorageData([
        STORAGE_KEYS.USER_SELECTORS,
        STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs = data[STORAGE_KEYS.DEFAULT_SELECTORS] || {};

      let confirmMessage = "";
      let action = "none"; // 'delete', 'reset', or 'reset_form'

      // Determine action based on whether user/default configs exist
      if (userConfigs.hasOwnProperty(domainToDelete)) {
        action = defaultConfigs.hasOwnProperty(domainToDelete)
          ? "reset" // User override exists, action is to reset to default
          : "delete"; // Purely custom config, action is to delete
        confirmMessage =
          action === "reset"
            ? `Are you sure you want to remove your custom settings for "${domainToDelete}" and reset it to the default configuration?`
            : `Are you sure you want to permanently delete the custom configuration for "${domainToDelete}"? This cannot be undone.`;
      } else if (defaultConfigs.hasOwnProperty(domainToDelete)) {
        // Only default exists, action is just to reload the defaults into the form
        action = "reset_form";
        confirmMessage = `Are you sure you want to discard any unsaved changes and reload the default settings for "${domainToDelete}" into the form?`;
      } else {
        // Neither exists, should not happen if button is configured correctly
        showConfigError(
          `Cannot reset "${domainToDelete}" as no default settings exist.`
        );
        return;
      }

      if (!confirm(confirmMessage)) {
        return; // User cancelled
      }

      deleteButton.disabled = true;
      deleteButton.textContent = "Processing...";

      // Perform the action
      if (action === "delete" || action === "reset") {
        // Remove the user config from storage
        delete userConfigs[domainToDelete];
        await setStorageData({ [STORAGE_KEYS.USER_SELECTORS]: userConfigs });

        if (action === "reset") {
          // If resetting, reload the default data into the form fields
          await loadConfigForEditing(); // This will now load the default as user config is gone
          deleteButton.disabled = false;
          // Button text/title should be updated by loadConfigForEditing
          showConfigError(
            "User settings removed. Form now shows default values. Save to apply defaults or modify further."
          );
          return; // Don't close tab yet
        } else {
          // If deleting (purely custom), notify and close
          chrome.runtime.sendMessage(
            { action: "configChanged" },
            (response) => {
              if (chrome.runtime.lastError) {
                /* Handle error */
              }
              alert("Custom configuration deleted!");
              window.close();
            }
          );
        }
      } else if (action === "reset_form") {
        // Just reload the default config into the form
        await loadConfigForEditing();
        deleteButton.disabled = false;
        // Button text/title should be updated by loadConfigForEditing
        showConfigError("Form reset to default values.");
      }
    } catch (error) {
      showConfigError(`Failed to update configuration: ${error.message}`);
      // Attempt to restore button state reasonably on error
      deleteButton.disabled = false;
      try {
        // Check again if default exists to set button text correctly
        const freshData = await getStorageData(STORAGE_KEYS.DEFAULT_SELECTORS);
        const freshDefaults = freshData[STORAGE_KEYS.DEFAULT_SELECTORS] || {};
        deleteButton.textContent = freshDefaults.hasOwnProperty(domainToDelete)
          ? "Reset to Default"
          : "Delete Custom"; // Should ideally be Delete if no default
      } catch {
        deleteButton.textContent = "Delete/Reset"; // Generic fallback
      }
    }
  }

  // --- Event Listeners ---
  saveButton?.addEventListener("click", saveConfiguration);
  closeButton?.addEventListener("click", () => window.close());
  deleteButton?.addEventListener("click", deleteOrResetConfiguration);

  if (useInSearchEngineCheckbox) {
    useInSearchEngineCheckbox.addEventListener("change", (event) => {
      updateFieldVisibility(event.target.checked);
      // Hide error related to Base URL requirement if checkbox is unchecked
      if (
        !event.target.checked &&
        errorElement?.textContent.includes("Base URL is required")
      ) {
        hideConfigError();
      }
    });
  }

  // Add focus listeners to inputs to hide errors on interaction
  [
    domainInput,
    baseUrlInput,
    linkSelectorInput,
    nextPageSelectorInput,
    matchPatternsInput,
    captchaUrlPatternsInput,
    captchaTextPatternsInput,
    captchaSelectorsInput,
    defaultParamsInput,
  ].forEach((input) => {
    input?.addEventListener("focus", hideConfigError);
  });

  // --- Initialization Logic ---
  if (isEditing) {
    await loadConfigForEditing(); // Load existing data if editing
  } else {
    // Setup for adding a new configuration
    modalTitle.textContent = "Add New Site Configuration";
    domainInput.disabled = false;
    deleteButton.style.display = "none"; // No delete/reset for new configs
    dataTypeInput.value = "href"; // Default data type
    if (useInSearchEngineCheckbox) useInSearchEngineCheckbox.checked = false;
    updateFieldVisibility(false); // Start with importer fields shown
  }
}); // End DOMContentLoaded
