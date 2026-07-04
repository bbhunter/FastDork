// Public build: keep warnings/errors visible, silence development logs.
(() => {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
})();

/**
 * FastDork - Popup Logic (Manifest V3)
 * Handles UI interactions, loading/saving lists and settings from storage.
 * Sends execution requests to the background script.
 */

// --- Session Storage Keys ---
const IMPORT_JUST_FINISHED_KEY = "importJustFinished";
const LAST_AUTO_IMPORT_LIST_KEY = "lastAutoImportListKey";
const MANUAL_IMPORT_JUST_FINISHED_KEY = "manualImportJustFinished";
const LAST_MANUAL_IMPORT_LIST_KEY = "lastManualImportListKey";
const LAST_IMPORT_ACTIVITY_KEY = "lastImportActivity";

// --- Single Top-Level DOMContentLoaded Listener ---
document.addEventListener("DOMContentLoaded", async function () {
  console.log("--- FastDork.js: DOMContentLoaded START ---");

  // --- UI Element References (Defined early) ---
  const UI = {
    // General UI & Tab 1 ('FastDork')
    targetTab1: document.getElementById("target"),
    listTab1: document.getElementById("list-tab1"),
    selectModTab1: document.getElementById("select-mod"),
    searchengineSelect: document.getElementById("searchengine-select"),
    goButton: document.getElementById("go"),
    limitButton: document.getElementById("limit"),
    nbrCounter: document.getElementById("nbr"),
    runStatusDot: document.getElementById("run-status-dot"),
    runStatusState: document.getElementById("run-status-state"),
    runStatusDetail: document.getElementById("run-status-detail"),
    saveCheckbox: document.getElementById("tarsav"),
    // Tab 2 ('EditList')
    listTab2: document.getElementById("list-tab2"),
    nbrTab2: document.getElementById("nbr2"),
    payloadInput: document.getElementById("payload-input"),
    payloadEditorLabel: document.getElementById("payload-editor-label"),
    payloadLineLabel: document.getElementById("payload-line-label"),
    payloadLineNumbers: document.getElementById("payload-line-numbers"),
    payloadUpdatedSeparator: document.getElementById("payload-updated-separator"),
    payloadUpdatedAt: document.getElementById("payload-updated-at"),
    importBtn: document.getElementById("import"),
    expandPayloadIcon: document.getElementById("expand-payload-icon"),
    // Tab 3 ('Settings')
    initialSettingsView: document.getElementById("initialSettingsView"),
    settingsVersion: document.getElementById("settings-version"),
    settingsGithubLink: document.getElementById("settings-github-link"),
    settingsExploitDbLink: document.getElementById("settings-exploitdb-link"),
    btnAddSiteConfig: document.getElementById("btnAddSiteConfig"),
    settingsResetButton: document.getElementById("settings-reset-button"),
    btnGoToListSettings: document.getElementById("btnGoToListSettings"),
    btnGoToSiteSettings: document.getElementById("btnGoToSiteSettings"),
    sidePanelToggle: document.getElementById("sidePanelToggle"),
    listSettingsContainer: document.getElementById("listSettingsContainer"),
    siteSettingsContainer: document.getElementById("siteSettingsContainer"),
    listNameInput: document.getElementById("listname"),
    createListBtn: document.getElementById("createlist"),
    listDelDropdown: document.getElementById("listdel"),
    deleteListBtn: document.getElementById("deletelist"),
    isResultListCheckbox: document.getElementById("isResultList"),
    siteSettingsListContainer: document.getElementById("siteSettingsList"),
    siteConfigHeader: document.getElementById("siteConfigHeader"),
    allListDropdowns: document.querySelectorAll(".list"),
    settingsModal: document.getElementById("settingsModal"),
    modalMessage: document.getElementById("modalMessage"),
    dorkOptionsModal: document.getElementById("dorkOptionsModal"),
    delaySelect: document.getElementById("delaySelect"),
    autoImportCheckbox: document.getElementById("autoImportCheckbox"),
    autoImportResultList: document.getElementById("autoImportResultList"),
    dorkOptionsProceed: document.getElementById("dorkOptionsProceed"),
    dorkOptionsCancel: document.getElementById("dorkOptionsCancel"),
    autoImportListRow: document.getElementById("autoImportListRow"),
    resumeImportBtn: document.getElementById("resumeImportBtn"),
  };

  // --- Global State Variables ---
  let initializeHasRun = false;
  let isCurrentlyAutoImporting = false;
  let isImportPaused = false;
  let isStartingDorkExecution = false;
  let importButtonClickListener = null;
  let autoImportStopClickListener = null;

  const CONSTANTS = {
    TAB_LIMIT: 20,
    SITE_CONFIG_STORAGE_KEY: "userSiteSelectors",
    DEFAULT_SITE_CONFIG_STORAGE_KEY: "defaultSiteSelectors",
    STORAGE_KEYS: {
      USER_SELECTORS: "userSiteSelectors",
      DEFAULT_SELECTORS: "defaultSiteSelectors",
      SAVE_OPTION: "saveOption",
      LIST_SAVE_TAB1: "list-save-tab1",
      SAVE_CHECKBOX_STATE: "saveTargetCheckboxState",
      SIDE_PANEL_ENABLED: "sidePanelEnabled",
    },
    LIST_PREFIX_DORK: "List-D-",
    LIST_PREFIX_RESULT: "List-R-",
    LIST_PREFIX_GENERAL: "List-",
    LIST_UPDATED_AT_PREFIX: "listUpdatedAt-",
  };

  // --- Helper Function Definitions ---
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
          console.error(
            `Error removing storage keys: ${keys}`,
            chrome.runtime.lastError
          );
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function getListUpdatedAtStorageKey(listKey) {
    if (!listKey || listKey === "0") return null;
    return `${CONSTANTS.LIST_UPDATED_AT_PREFIX}${listKey}`;
  }

  function formatListUpdatedAt(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const formatted = new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(",", "");
    return `Updated ${formatted}`;
  }

  function setPayloadUpdatedAtText(text) {
    if (!UI.payloadUpdatedAt) return;
    const hasText = Boolean(text);
    UI.payloadUpdatedAt.textContent = text || "";
    UI.payloadUpdatedAt.hidden = !hasText;
    if (UI.payloadUpdatedSeparator) {
      UI.payloadUpdatedSeparator.hidden = !hasText;
    }
  }

  async function updatePayloadUpdatedAt(listKey = UI.listTab2?.value) {
    if (!UI.payloadUpdatedAt) return;
    const updatedAtKey = getListUpdatedAtStorageKey(listKey);
    if (!updatedAtKey) {
      setPayloadUpdatedAtText("");
      return;
    }

    try {
      const data = await getStorageData(updatedAtKey);
      setPayloadUpdatedAtText(formatListUpdatedAt(data[updatedAtKey]));
    } catch (error) {
      console.warn("Could not load list updated timestamp:", error);
      setPayloadUpdatedAtText("");
    }
  }

  function getEngineSortPriority(engineKey) {
    const normalizedKey = String(engineKey || "").toLowerCase();
    if (normalizedKey === "google.com" || normalizedKey.endsWith(".google.com")) {
      return 0;
    }
    if (normalizedKey === "github.com" || normalizedKey.endsWith(".github.com")) {
      return 1;
    }
    return 10;
  }

  function sortSearchEngines(a, b) {
    const priorityDiff =
      getEngineSortPriority(a?.key) - getEngineSortPriority(b?.key);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a?.key || "")
      .toLowerCase()
      .localeCompare(String(b?.key || "").toLowerCase());
  }

  function createFeedbackAnimationHTML(type = "success") {
    const normalizedType = type === "error" ? "error" : "success";
    const iconMarkup =
      normalizedType === "error"
        ? `<path class="feedback-svg-line feedback-svg-line-one" d="M25 25L47 47"></path>
                   <path class="feedback-svg-line feedback-svg-line-two" d="M47 25L25 47"></path>`
        : `<path class="feedback-svg-mark" d="M21 37.5L31.5 48L52 25.5"></path>`;

    return `<div class="success-checkmark feedback-${normalizedType}" hidden style="display: none;">
           <div class="check-icon" style="display: none;">
               <svg class="check-svg" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
                   <circle class="feedback-svg-circle" cx="36" cy="36" r="31"></circle>
                   ${iconMarkup}
               </svg>
           </div>
           <p id="msgsuccess"></p>
        </div>`;
  }
  function showFeedbackAnimation({
    text = "",
    type = "success",
    containerSelector = ".sucessCheck",
  } = {}) {
    const activeTabContent = document.querySelector(".tabcontent.tab-active");
    if (!activeTabContent) {
      console.warn("[showFeedbackAnimation] No active tab content found.");
      return;
    }

    let container = activeTabContent.querySelector(containerSelector);
    if (!container) {
      // Fallback to searching the whole body? Less ideal.
      // container = document.body.querySelector(containerSelector);
      // if (!container) {
      console.error(
        `[showFeedbackAnimation] Container ('${containerSelector}') not found within active tab.`
      );
      return;
      // }
    }
    container.innerHTML = createFeedbackAnimationHTML(type);
    container.style.display = "flex";
    const checkmark = container.querySelector(".success-checkmark");
    const icon = container.querySelector(".check-icon");
    const msg = container.querySelector("#msgsuccess");
    if (msg) msg.textContent = text;
    if (checkmark) checkmark.style.display = "flex";
    if (icon) icon.style.display = "none";
    setTimeout(() => {
      if (icon) icon.style.display = "flex";
    }, 50);
    setTimeout(() => {
      if (msg) msg.textContent = "";
    }, 1500);
    setTimeout(() => {
      container.style.display = "none";
      container.innerHTML = "";
    }, 1800);
  }
  function showSuccessAnimation(text = "", containerSelector = ".sucessCheck") {
    showFeedbackAnimation({ text, type: "success", containerSelector });
  }
  function showErrorAnimation(text = "", containerSelector = ".sucessCheck") {
    showFeedbackAnimation({ text, type: "error", containerSelector });
  }
  function hideModal(modalElement = UI.settingsModal) {
    if (modalElement) {
      modalElement.style.display = "none";
      const messageEl =
        modalElement.querySelector("#modalMessage") || UI.modalMessage;
      const buttonsEl = modalElement.querySelector(".modal-button-group");
      if (messageEl) {
        messageEl.textContent = "";
        messageEl.classList.remove("category-help-message");
      }
      if (buttonsEl) buttonsEl.replaceChildren();
    }
  }
  function showModal(
    message,
    buttons = [],
    modalElement = UI.settingsModal,
    messageElement = UI.modalMessage
  ) {
    console.log("[showModal] Function called.");
    if (!modalElement) {
      console.error(
        "[showModal] FATAL: modalElement passed to showModal is null or undefined!"
      );
      alert(message);
      return;
    }
    const msgEl = modalElement.querySelector("#modalMessage") || messageElement;
    console.log(
      "[showModal] Attempting to find '.modal-button-group' within modalElement (ID: " +
        modalElement.id +
        ")"
    );
    const buttonsContainer = modalElement.querySelector(".modal-button-group");
    if (!buttonsContainer) {
      console.error(
        "[showModal] FAILED to find '.modal-button-group' inside modalElement:",
        modalElement
      );
    } else {
      console.log(
        "[showModal] Successfully found buttonsContainer:",
        buttonsContainer
      );
    }
    if (!msgEl) console.error("[showModal] messageElement could not be found!");
    if (!modalElement || !msgEl || !buttonsContainer) {
      console.error(
        "Modal elements (modal, message, or button container) not found after query!"
      );
      alert(message);
      return;
    }
    msgEl.classList.remove("category-help-message");
    msgEl.textContent = message;
    console.log("[showModal] Set modal message:", message);
    buttonsContainer.replaceChildren();
    console.log("[showModal] Cleared buttonsContainer.");
    if (buttons.length === 0) {
      console.log("[showModal] No buttons provided, adding default OK button.");
      buttons.push({
        text: "OK",
        class: "standard",
        onClick: () => hideModal(modalElement),
      });
    }
    console.log(`[showModal] Processing ${buttons.length} button(s).`);
    buttons.forEach((btnInfo, index) => {
      console.log(
        `[showModal] Creating button ${index + 1}/${buttons.length}: Text='${
          btnInfo.text
        }', Class='${btnInfo.class || "standard"}'`
      );
      const button = document.createElement("button");
      button.textContent = btnInfo.text;
      button.className = `xs ${btnInfo.class || "standard"}`;
      button.addEventListener(
        "click",
        () => {
          if (btnInfo.onClick) {
            console.log(`[showModal] Button '${btnInfo.text}' clicked.`);
            btnInfo.onClick();
          }
        },
        { once: true }
      );
      try {
        buttonsContainer.appendChild(button);
        console.log(
          `[showModal] Appended button '${btnInfo.text}' to buttonsContainer.`
        );
      } catch (appendError) {
        console.error(
          `[showModal] Error appending button '${btnInfo.text}':`,
          appendError
        );
      }
    });
    console.log("[showModal] Buttons rendered:", buttonsContainer.children.length);
    console.log(
      "[showModal] Finished processing buttons. Setting modal display to flex."
    );
    modalElement.style.display = "flex";
  }
  function showListCategoryHelpModal() {
    const modalElement = UI.settingsModal;
    const msgEl = modalElement?.querySelector("#modalMessage") || UI.modalMessage;
    const buttonsContainer = modalElement?.querySelector(".modal-button-group");

    if (!modalElement || !msgEl || !buttonsContainer) {
      showModal(
        "Dork: dorks, search queries, or targets used in Tab 1.\nResult: imported or saved results.",
        [{ text: "Got it!", onClick: hideModal }]
      );
      return;
    }

    msgEl.replaceChildren();
    msgEl.classList.add("category-help-message");

    const title = document.createElement("span");
    title.className = "category-help-title";
    title.textContent = "List categories";
    msgEl.appendChild(title);

    [
      {
        label: "Dork",
        text: "Dorks, search queries, or targets used in Tab 1.",
      },
      {
        label: "Result",
        text: "Imported or saved results.",
      },
    ].forEach((item) => {
      const row = document.createElement("span");
      row.className = "category-help-row";

      const copy = document.createElement("span");
      copy.className = "category-help-copy";

      const label = document.createElement("span");
      label.className = "category-help-label";
      label.textContent = `${item.label}: `;

      const text = document.createElement("span");
      text.className = "category-help-text";
      text.textContent = item.text;

      copy.append(label, text);
      row.appendChild(copy);
      msgEl.appendChild(row);
    });

    buttonsContainer.replaceChildren();
    const button = document.createElement("button");
    button.textContent = "Got it!";
    button.className = "xs standard";
    button.addEventListener("click", () => hideModal(modalElement), {
      once: true,
    });
    buttonsContainer.appendChild(button);
    modalElement.style.display = "flex";
  }

  function showSaveOptionHelpModal() {
    showModal(
      "Save stores your current Tab 1 setup: mode, target, search engine, and dork list. FastDork will restore it next time you open the extension.",
      [{ text: "Got it!", class: "standard", onClick: hideModal }]
    );
  }
  function getFieldErrorSurface(element) {
    if (!element) return null;
    if (
      element === UI.targetTab1 ||
      element === UI.listTab1 ||
      element === UI.searchengineSelect ||
      element === UI.listTab2
    ) {
      return element.closest(".field-shell") || element;
    }
    return element;
  }

  function setFieldError(element, isInvalid) {
    const surface = getFieldErrorSurface(element);
    if (!surface) return;
    surface.classList.toggle("field-error", Boolean(isInvalid));
    if (surface !== element) {
      element.style.border = "";
      element.style.borderBottom = "";
      element.classList.remove("field-error");
    }
  }

  function showDorkOptionsModal() {
    if (UI.dorkOptionsModal) {
      if (UI.autoImportResultList) {
        setFieldError(UI.autoImportResultList, false);
      }
      validateDorkOptionsModal();
      UI.dorkOptionsModal.style.display = "flex";
    }
  }
  function hideDorkOptionsModal() {
    if (UI.dorkOptionsModal) {
      UI.dorkOptionsModal.style.display = "none";
    }
  }
  function updateAutoImportListVisibility() {
    if (
      UI.autoImportListRow &&
      UI.autoImportCheckbox &&
      UI.autoImportResultList
    ) {
      UI.autoImportListRow.style.display = "block";

      if (
        UI.autoImportCheckbox.checked &&
        UI.autoImportResultList.value === "0"
      ) {
        setFieldError(UI.autoImportResultList, true);
      } else {
        setFieldError(UI.autoImportResultList, false);
      }
      validateDorkOptionsModal();
    }
  }
  function syncActiveTabHeight() {
    const contentContainer = document.getElementById("icetab-content");
    if (!contentContainer) return;
    contentContainer.style.height = "";
  }
  function setupTabStructure() {
    const tabsContainer = document.getElementById("icetab-container");
    const contentContainer = document.getElementById("icetab-content");
    if (!tabsContainer || !contentContainer) return;
    const tabs = tabsContainer.children;
    const tabContents = contentContainer.children;
    if (
      !tabs ||
      !tabContents ||
      tabs.length === 0 ||
      tabs.length !== tabContents.length
    ) {
      console.error("Tab structure elements not found or mismatched.");
      return;
    }
    Array.from(tabs).forEach((tab, index) => {
      if (!tab) return;
      tab.dataset.index = index;
      tab.addEventListener("click", function () {
        const tabIndex = parseInt(this.dataset.index);
        Array.from(tabs).forEach((t) => t?.classList.remove("current-tab"));
        Array.from(tabContents).forEach((c) =>
          c?.classList.remove("tab-active")
        );
        this.classList.add("current-tab");
        if (tabContents[tabIndex]) {
          tabContents[tabIndex].classList.add("tab-active");
        }
        syncActiveTabHeight();
        if (tabIndex === 0 && UI.listTab1) {
          updateDorkCounter(UI.listTab1.value);
        } else if (tabIndex === 1) {
          initializeImportButtonLogic();
        } else if (tabIndex === 2) {
          resetSettingsTabView();
        }
      });
    });
    if (!tabsContainer.querySelector(".current-tab") && tabs.length > 0) {
      tabs[0]?.classList.add("current-tab");
      tabContents[0]?.classList.add("tab-active");
    }
    if (tabs[0]?.classList.contains("current-tab") && UI.listTab1) {
      updateDorkCounter(UI.listTab1.value);
    }
    syncActiveTabHeight();
  }
  function createDefaultOption(text = "Select...", value = "0") {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = true;
    option.disabled = true;
    return option;
  }
  function populateDropdownWithOptions(
    selectElement,
    defaultText,
    optionsArray
  ) {
    if (!selectElement) return;
    console.log(
      `[populateDropdownWithOptions] Populating ${selectElement.id}. Options received: ${optionsArray.length}`
    );
    console.log(
      `[populateDropdownWithOptions] BEFORE clear ${selectElement.id}, options: ${selectElement.options.length}`
    );
    selectElement.replaceChildren();
    selectElement.appendChild(createDefaultOption(defaultText));
    console.log(
      `[populateDropdownWithOptions] AFTER default ${selectElement.id}, options: ${selectElement.options.length}`
    );
    optionsArray.forEach((optData) => {
      const option = document.createElement("option");
      option.value = optData.value;
      option.textContent = optData.text;
      if (optData.title) option.title = optData.title;
      if (optData.className) option.className = optData.className;
      selectElement.appendChild(option);
    });
    console.log(
      `[populateDropdownWithOptions] AFTER adding ${optionsArray.length} options to ${selectElement.id}, total options: ${selectElement.options.length}`
    );
    selectElement.value = "0";
  }
  async function loadAndPopulateLists() {
    console.log(`[${Date.now()}] [loadAndPopulateLists] Fetching list keys...`); // Timestamp
    let listKeys = [];
    try {
      const data = await getStorageData(null);
      listKeys = Object.keys(data).filter(
        (key) =>
          key.startsWith(CONSTANTS.LIST_PREFIX_GENERAL) &&
          !key.startsWith("tab2Save-") &&
          Array.isArray(data[key])
      );
      listKeys.sort((a, b) => {
        const nameA = a
          .substring(a.indexOf("-", CONSTANTS.LIST_PREFIX_GENERAL.length) + 1)
          .toLowerCase();
        const nameB = b
          .substring(b.indexOf("-", CONSTANTS.LIST_PREFIX_GENERAL.length) + 1)
          .toLowerCase();
        return nameA.localeCompare(nameB);
      });
      console.log(
        `[loadAndPopulateLists] Found ${listKeys.length} valid list keys.`
      );
    } catch (error) {
      console.error("Error fetching list keys:", error);
      listKeys = [];
    }
    const tab1Options = [];
    const tab2AndDelOptions = [];
    const autoImportOptions = [];
    listKeys.forEach((listKey) => {
      const isPayload = listKey.startsWith(CONSTANTS.LIST_PREFIX_DORK);
      const isResult = listKey.startsWith(CONSTANTS.LIST_PREFIX_RESULT);
      const categoryLabel = isPayload ? "Dork" : isResult ? "Result" : "List";
      const secondHyphenIndex = listKey.indexOf(
        "-",
        CONSTANTS.LIST_PREFIX_GENERAL.length
      );
      const displayNameLower = (
        secondHyphenIndex !== -1
          ? listKey.substring(secondHyphenIndex + 1)
          : listKey
      ).toLowerCase();
      const truncatedName = truncateText(displayNameLower, 20);
      if (isPayload) {
        tab1Options.push({
          value: listKey,
          text: truncatedName,
          title: `${displayNameLower} [Dork List] Key: ${listKey}`,
          className: "addopt",
        });
      }
      tab2AndDelOptions.push({
        value: listKey,
        text: `${categoryLabel}: ${truncatedName}`,
        title: `Full Key: ${listKey}`,
        className: "addopt",
      });
      if (isResult) {
        autoImportOptions.push({
          value: listKey,
          text: truncatedName,
          title: `Full Key: ${listKey}`,
          className: "addopt",
        });
      }
    });
    populateDropdownWithOptions(UI.listTab1, "Dork List", tab1Options);
    console.log(
      `[${Date.now()}] [loadAndPopulateLists] Populating listTab2...`
    );
    populateDropdownWithOptions(UI.listTab2, "Select List", tab2AndDelOptions);
    console.log(
      `[${Date.now()}] [loadAndPopulateLists] FINISHED populating listTab2.`
    );
    populateDropdownWithOptions(
      UI.listDelDropdown,
      "Select list",
      tab2AndDelOptions
    );
    populateDropdownWithOptions(
      UI.autoImportResultList,
      "Select Result List",
      autoImportOptions
    );
    try {
      const savedListData = await getStorageData(
        CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1
      );
      const savedListKeyTab1 =
        savedListData[CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1];
      if (savedListKeyTab1) {
        if (!selectOptionByValue(UI.listTab1, savedListKeyTab1)) {
          console.log(
            `[loadAndPopulateLists] Saved Tab 1 list ${savedListKeyTab1} not found, removing preference.`
          );
          await removeStorageData(CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1);
        } else {
          console.log(
            `[loadAndPopulateLists] Restored Tab 1 selection: ${savedListKeyTab1}`
          );
        }
      }
    } catch (e) {
      console.error("Error restoring Tab 1 list selection", e);
    }
    console.log(
      `[${Date.now()}] [loadAndPopulateLists] Finished populating all list dropdowns.`
    );
  }
  async function loadAndPopulateEngines() {
    console.log("[loadAndPopulateEngines] Populating engines...");
    if (!UI.searchengineSelect) return;
    let engineOptions = [];
    try {
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.USER_SELECTORS,
        CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[CONSTANTS.STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs =
        data[CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS] || {};
      const allConfigs = { ...defaultConfigs, ...userConfigs };
      const validEngines = [];
      for (const key in allConfigs) {
        if (Object.prototype.hasOwnProperty.call(allConfigs, key)) {
          const config = allConfigs[key];
          if (config && config.useInEngineSelect === true && config.baseUrl) {
            validEngines.push({ key: key, config: config });
          }
        }
      }
      validEngines.sort(sortSearchEngines);
      engineOptions = validEngines.map((engineData) => {
        let displayName = engineData.key;
        const domainParts = engineData.key.split(".");
        if (domainParts.length >= 2)
          displayName = domainParts[domainParts.length - 2];
        displayName =
          displayName.charAt(0).toUpperCase() + displayName.slice(1);
        const truncatedDisplayName = truncateText(displayName, 15);
        return {
          value: engineData.key,
          text: truncatedDisplayName,
          title: engineData.key,
        };
      });
      UI.searchengineSelect.disabled = engineOptions.length === 0;
    } catch (error) {
      console.error("Error fetching search engines:", error);
      UI.searchengineSelect.disabled = true;
    }
    populateDropdownWithOptions(
      UI.searchengineSelect,
      "Search Engine",
      engineOptions
    );
    if (engineOptions.length === 0)
      console.warn("No search engines found eligible for dropdown.");
    console.log("[loadAndPopulateEngines] Finished populating engines.");
  }
  function selectOptionByValue(selectElement, valueToSelect) {
    if (
      !selectElement ||
      typeof valueToSelect === "undefined" ||
      valueToSelect === null
    )
      return false;
    for (let i = 0; i < selectElement.options.length; i++) {
      if (selectElement.options[i].value === valueToSelect) {
        selectElement.selectedIndex = i;
        return true;
      }
    }
    return false;
  }
  function getFirstAvailableImportListKey() {
    const options = Array.from(UI.listTab2?.options || []).filter(
      (option) => option && !option.disabled && option.value && option.value !== "0"
    );
    const resultListOption = options.find((option) =>
      option.value.startsWith(CONSTANTS.LIST_PREFIX_RESULT)
    );
    return resultListOption?.value || options[0]?.value || null;
  }
  async function getPreferredImportListKey(domainKey = null) {
    if (!UI.listTab2) return null;

    if (domainKey) {
      const storageLookupKey = `tab2Save-${domainKey}`;
      try {
        const data = await getStorageData(storageLookupKey);
        const savedListKey = data[storageLookupKey];
        if (
          savedListKey &&
          Array.from(UI.listTab2.options).some(
            (option) => option.value === savedListKey
          )
        ) {
          return savedListKey;
        }
      } catch (error) {
        console.warn(
          `[getPreferredImportListKey] Could not read saved list for ${domainKey}:`,
          error
        );
      }
    }

    if (UI.listTab2.value && UI.listTab2.value !== "0") {
      return UI.listTab2.value;
    }

    return getFirstAvailableImportListKey();
  }
  async function selectListAndRefreshTextarea(
    listKey,
    {
      switchToEditList = false,
      focusTextarea = false,
      scrollToBottom = false,
    } = {}
  ) {
    if (!listKey || !UI.listTab2) return false;
    if (!selectOptionByValue(UI.listTab2, listKey)) {
      console.warn(`[selectListAndRefreshTextarea] List not found: ${listKey}`);
      return false;
    }

    await loadSelectedDorkListContent();
    if (switchToEditList) {
      showDorkList({ focusTextarea });
    }
    if (scrollToBottom) {
      scrollPayloadToBottom();
    }
    return true;
  }
  function resetDorkListSelections() {
    UI.allListDropdowns.forEach((list) => {
      if (list) list.value = "0";
    });
    if (UI.autoImportResultList) UI.autoImportResultList.value = "0";
    clearPayloadInput();
    if (UI.nbrCounter) UI.nbrCounter.textContent = "0";
    UI.listTab1?.dispatchEvent(new Event("change"));
    UI.listTab2?.dispatchEvent(new Event("change"));
    UI.listDelDropdown?.dispatchEvent(new Event("change"));
  }
  async function handleGoButtonClick() {
    hideErrorTab1();
    if (!UI.goButton?.classList.contains("go-button-ready")) {
      const listCount = parseInt(UI.nbrCounter?.textContent || "0");
      let message = "Cannot start: ";
      if (!areTab1InputsValid(false)) {
        message += "Please fill Target, select Engine and Dork List.";
      } else if (listCount === 0) {
        message += "Selected Dork List is empty.";
      } else if (listCount > CONSTANTS.TAB_LIMIT) {
        message += `Too many tabs (${listCount}/${CONSTANTS.TAB_LIMIT} max).`;
      } else {
        message += "Inputs invalid or list empty.";
      }
      showModal(message);
      highlightInvalidTab1Inputs();
      return;
    }
    updateAutoImportListVisibility();
    showDorkOptionsModal();
  }
  function setDorkExecutionStarting(isStarting) {
    isStartingDorkExecution = isStarting;
    if (!UI.dorkOptionsProceed) return;

    if (isStarting) {
      UI.dorkOptionsProceed.disabled = true;
      UI.dorkOptionsProceed.textContent = "Starting...";
      return;
    }

    UI.dorkOptionsProceed.textContent = "Proceed";
    validateDorkOptionsModal();
  }

  async function handleProceedDorkOptions() {
    if (isStartingDorkExecution) {
      console.warn("[handleProceedDorkOptions] Start already in progress.");
      return;
    }

    if (UI.dorkOptionsProceed.disabled) {
      if (
        UI.autoImportCheckbox?.checked &&
        UI.autoImportResultList?.value === "0"
      ) {
        highlightInvalidTab1Inputs(UI.autoImportResultList);
      }
      return;
    }

    const targetValue = UI.targetTab1?.value.trim();
    const listKey = UI.listTab1?.value;
    const mode = parseInt(UI.selectModTab1?.value || "0");
    const engineKey = UI.searchengineSelect?.value;
    const delay = parseInt(UI.delaySelect?.value || "0");
    const autoImport = UI.autoImportCheckbox?.checked || false;
    const resultListKey = UI.autoImportResultList?.value; // Still need the value

    // Basic Tab 1 validation still needed here
    if (!areTab1InputsValid(true)) {
      // This function already shows a modal and highlights
      return;
    }

    if (
      mode === 1 &&
      !targetValue.includes("$target") &&
      !targetValue.includes("$t")
    ) {
      showModal(
        "One Dork mode requires $target or $t in the Target/Dork input.",
        [],
        UI.dorkOptionsModal // Show error in the correct modal
      );
      highlightInvalidTab1Inputs(UI.targetTab1);
      return;
    }

    const listCount = parseInt(UI.nbrCounter?.textContent || "0");
    if (listCount <= 0) {
      showModal(
        "Cannot start: Selected Dork List is empty.",
        [],
        UI.dorkOptionsModal // Show error in the correct modal
      );
      highlightInvalidTab1Inputs(UI.listTab1);
      return;
    }
    if (listCount > CONSTANTS.TAB_LIMIT) {
      showModal(
        `Cannot start: Too many tabs requested (${listCount}/${CONSTANTS.TAB_LIMIT} max).`,
        [],
        UI.dorkOptionsModal // Show error in the correct modal
      );
      highlightInvalidTab1Inputs(UI.listTab1);
      return;
    }

    // The specific check for autoImport && resultListKey === "0" is implicitly handled
    // because the button would be disabled in that state.

    const executionOptions = {
      target: targetValue,
      listKey: listKey,
      mode: mode,
      engineKey: engineKey,
      delay: delay,
      autoImport: autoImport,
      // Send null only if autoImport is false OR if somehow listKey is "0" (though button should prevent this)
      resultListKey: autoImport && resultListKey !== "0" ? resultListKey : null,
    };

    try {
      setDorkExecutionStarting(true);
      console.log(
        "Sending executeDorksWithDelay to background:",
        executionOptions
      );
      chrome.runtime.sendMessage(
        { action: "executeDorksWithDelay", options: executionOptions },
        (response) => {
          setDorkExecutionStarting(false);
          if (chrome.runtime.lastError) {
            console.error(
              "Error sending message to background:",
              chrome.runtime.lastError.message
            );
            showModal(
              `Error starting execution: ${chrome.runtime.lastError.message}`,
              [],
              UI.dorkOptionsModal // Show error in the correct modal
            );
          } else if (response && !response.success) {
            console.error("Background script reported error:", response.error);
            showModal(
              `Execution Error: ${
                response.error || "Unknown error from background script"
              }`,
              [],
              UI.dorkOptionsModal // Show error in the correct modal
            );
          } else if (response && response.success) {
            hideDorkOptionsModal(); // Close modal on success
            showSuccessAnimation("Started!"); // Show success in main tab
            console.log(
              "Message sent, background acknowledged:",
              response.message
            );
          } else {
            console.warn(
              "Received unexpected response from background script:",
              response
            );
            showModal(
              "Received unexpected response from background process.",
              [],
              UI.dorkOptionsModal // Show error in the correct modal
            );
          }
        }
      );
    } catch (error) {
      setDorkExecutionStarting(false);
      console.error("Exception sending message:", error);
      showModal(`Error: ${error.message}`, [], UI.dorkOptionsModal); // Show error in the correct modal
    }
  }
  function areTab1InputsValid(highlight = true) {
    let isValid = true;
    const elementsToHighlight = [];
    const targetValue = UI.targetTab1?.value.trim();
    const engineValue = UI.searchengineSelect?.value;
    const listValue = UI.listTab1?.value;
    if (!targetValue) {
      isValid = false;
      if (UI.targetTab1) elementsToHighlight.push(UI.targetTab1);
    }
    if (engineValue === "0") {
      isValid = false;
      if (UI.searchengineSelect)
        elementsToHighlight.push(UI.searchengineSelect);
    }
    if (listValue === "0") {
      isValid = false;
      if (UI.listTab1) elementsToHighlight.push(UI.listTab1);
    }
    if (!isValid && highlight) {
      showModal("Please fill Target, select Engine and Dork List.");
      highlightInvalidTab1Inputs(elementsToHighlight);
    } else if (highlight) {
      hideErrorTab1();
    }
    return isValid;
  }

  function getSelectedOptionLabel(selectElement) {
    if (!selectElement || selectElement.value === "0") return "";
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    return selectedOption?.textContent?.trim() || "";
  }

  function formatMissingItems(items) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function updateRunStatus({ count = 0, inputsValid = false, limitExceeded = false } = {}) {
    if (!UI.runStatusDot || !UI.runStatusState || !UI.runStatusDetail) return;

    const targetValue = UI.targetTab1?.value.trim();
    const engineValue = UI.searchengineSelect?.value;
    const listValue = UI.listTab1?.value;
    const missing = [];

    if (!targetValue) missing.push("target");
    if (engineValue === "0") missing.push("engine");
    if (listValue === "0") missing.push("dork list");

    const isReady = inputsValid && count > 0 && !limitExceeded;
    UI.runStatusDot.classList.toggle("status-dot-ready", isReady);
    UI.runStatusDot.classList.toggle("status-dot-missing", !isReady);

    if (isReady) {
      const queryLabel = count === 1 ? "query" : "queries";
      const engineLabel = getSelectedOptionLabel(UI.searchengineSelect) || "Engine";
      UI.runStatusState.textContent = "Ready";
      UI.runStatusDetail.textContent = `${count} ${queryLabel} · ${engineLabel}`;
      return;
    }

    UI.runStatusState.textContent = "Missing";

    if (missing.length > 0) {
      UI.runStatusDetail.textContent = `Choose ${formatMissingItems(missing)}`;
    } else if (limitExceeded) {
      UI.runStatusDetail.textContent = `${count}/${CONSTANTS.TAB_LIMIT} queries max`;
    } else if (count === 0) {
      UI.runStatusDetail.textContent = "Dork list is empty";
    } else {
      UI.runStatusDetail.textContent = "Check target, engine, and dork list";
    }
  }

  function highlightInvalidTab1Inputs(elements = null) {
    const elementsToCheck = Array.isArray(elements)
      ? elements
      : elements
      ? [elements]
      : [UI.targetTab1, UI.listTab1, UI.searchengineSelect];
    hideErrorTab1(elementsToCheck);
    elementsToCheck.forEach((el) => {
      if (el) {
        let isProblematic = false;
        if (el === UI.targetTab1 && !el.value.trim()) isProblematic = true;
        else if (
          (el === UI.listTab1 || el === UI.searchengineSelect) &&
          el.value === "0"
        )
          isProblematic = true;
        else if (
          el === UI.targetTab1 &&
          UI.selectModTab1?.value === "1" &&
          !el.value.includes("$target") &&
          !el.value.includes("$t")
        )
          isProblematic = true;
        else if (
          el === UI.listTab1 &&
          parseInt(UI.nbrCounter?.textContent || "0") <= 0
        )
          isProblematic = true;
        else if (
          el === UI.listTab1 &&
          parseInt(UI.nbrCounter?.textContent || "0") > CONSTANTS.TAB_LIMIT
        )
          isProblematic = true;
        if (isProblematic) {
          setFieldError(el, true);
          const clearBorder = () => hideErrorTab1(el);
          el.addEventListener("input", clearBorder, { once: true });
          el.addEventListener("change", clearBorder, { once: true });
          el.addEventListener("focus", clearBorder, { once: true });
        }
      }
    });
  }
  function hideErrorTab1(element = null) {
    const elementsToReset = element
      ? Array.isArray(element)
        ? element
        : [element]
      : [UI.targetTab1, UI.listTab1, UI.searchengineSelect];
    elementsToReset.forEach((el) => {
      if (el) {
        setFieldError(el, false);
      }
    });
    if (UI.autoImportResultList) setFieldError(UI.autoImportResultList, false);
  }
  async function createDorkList() {
    const listNameInputEl = UI.listNameInput;
    const isResultCheckboxEl = UI.isResultListCheckbox;
    if (!listNameInputEl || !isResultCheckboxEl) {
      console.error("Missing UI elements for list creation.");
      showModal("UI Error: Cannot create list.");
      return;
    }
    const listNameValue = listNameInputEl.value.trim();
    if (!validateListName(listNameValue)) {
      showModal(
        "Invalid list name (A-Z, a-z, 0-9, -, max 15 chars, avoid reserved prefixes)."
      );
      return;
    }
    const isResult = isResultCheckboxEl.checked;
    const prefix = isResult
      ? CONSTANTS.LIST_PREFIX_RESULT
      : CONSTANTS.LIST_PREFIX_DORK;
    const categoryType = isResult ? "Result" : "Dork";
    const listStorageKey = `${prefix}${listNameValue}`;
    try {
      const data = await getStorageData(listStorageKey);
      if (typeof data[listStorageKey] !== "undefined") {
        showModal(
          `Error: List "${listNameValue}" already exists as a ${categoryType} list.`
        );
        return;
      }
      const updatedAtKey = getListUpdatedAtStorageKey(listStorageKey);
      await setStorageData({
        [listStorageKey]: [],
        ...(updatedAtKey ? { [updatedAtKey]: new Date().toISOString() } : {}),
      });
      showSuccessAnimation("List created!");
      await loadAndPopulateLists();
      listNameInputEl.value = "";
      isResultCheckboxEl.checked = false;
      selectOptionByValue(UI.listTab2, listStorageKey);
      selectOptionByValue(UI.listDelDropdown, listStorageKey);
      if (!isResult && UI.listTab1) {
        selectOptionByValue(UI.listTab1, listStorageKey);
        UI.listTab1.dispatchEvent(new Event("change"));
      }
      if (UI.listTab2.value === listStorageKey) {
        UI.listTab2.dispatchEvent(new Event("change"));
      }
    } catch (error) {
      console.error("Error creating dork list:", error);
      showModal(`Error saving list: ${error.message}`);
    }
  }
  function validateListName(name) {
    const listName = name?.trim();
    if (!listName || !/^[a-zA-Z0-9-]{1,15}$/.test(listName)) return false;
    const reservedPrefixes = [
      "List-D-",
      "List-R-",
      "tab2Save-",
      "saveOption",
      "userSite",
      "defaultSite",
      "DATA_RESULT",
    ];
    return !reservedPrefixes.some((prefix) => listName.startsWith(prefix));
  }
  async function deleteDorkList() {
    if (!UI.listDelDropdown) {
      console.error("Delete list dropdown UI element not found.");
      showModal("UI Error: Cannot access list dropdown.");
      return;
    }
    const selectedOption =
      UI.listDelDropdown.options[UI.listDelDropdown.selectedIndex];
    const listStorageKey = selectedOption.value;
    const displayNameWithCategory = selectedOption.text;
    if (listStorageKey === "0") {
      showModal("Please choose a list to delete.");
      UI.listDelDropdown.addEventListener("change", () => hideModal(), {
        once: true,
      });
      return;
    }
    const messageText = `Are you sure you want to delete the list "${displayNameWithCategory}"? This cannot be undone.`;
    setupConfirmationModal(
      messageText,
      async () => {
        hideModal();
        try {
          await removeStorageData(
            [listStorageKey, getListUpdatedAtStorageKey(listStorageKey)].filter(Boolean)
          );
          const allData = await getStorageData(null);
          const keysToRemovePrefs = Object.keys(allData).filter(
            (key) =>
              (key.startsWith("tab2Save-") &&
                allData[key] === listStorageKey) ||
              (key === CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1 &&
                allData[key] === listStorageKey)
          );
          if (keysToRemovePrefs.length > 0) {
            await removeStorageData(keysToRemovePrefs);
          }
          await loadAndPopulateLists();
          resetDorkListSelections();
          await updatePayloadUpdatedAt("0");
          showModal("List deleted successfully.");
        } catch (error) {
          console.error(`Error deleting list ${listStorageKey}:`, error);
          showModal(`Failed to delete list: ${error.message}`);
        }
      },
      () => {
        console.log("Deletion cancelled by user.");
        hideModal();
      }
    );
  }
  function setupConfirmationModal(
    message,
    onConfirm,
    onCancel = () => hideModal()
  ) {
    showModal(message, [
      { text: "YES", class: "confirm", onClick: onConfirm },
      { text: "NO", class: "standard", onClick: onCancel },
    ]);
  }
  async function loadSelectedDorkListContent() {
    console.log(`[loadSelectedDorkListContent] Called.`);
    if (!UI.listTab2 || !UI.payloadInput) {
      console.warn(
        "[loadSelectedDorkListContent] Missing UI elements (listTab2 or payloadInput)."
      );
      return;
    }
    const effectiveListKey = UI.listTab2.value;
    console.log(
      `[loadSelectedDorkListContent] Effective list key: ${effectiveListKey}`
    );
    if (effectiveListKey === "0") {
      console.log(
        "[loadSelectedDorkListContent] Effective key is '0', clearing input."
      );
      clearPayloadInput();
      await updatePayloadUpdatedAt(effectiveListKey);
      return;
    }
    let displayNameForError = effectiveListKey;
    const matchingOption = Array.from(UI.listTab2.options).find(
      (opt) => opt.value === effectiveListKey
    );
    if (matchingOption) {
      displayNameForError = matchingOption.textContent;
    }
    try {
      const data = await getStorageData(effectiveListKey);
      if (data && Array.isArray(data[effectiveListKey])) {
        const content = data[effectiveListKey].filter(Boolean).join("\n");
        UI.payloadInput.value = content;
        console.log(
          `[loadSelectedDorkListContent] Loaded content for ${effectiveListKey}.`
        );
      } else {
        UI.payloadInput.value = "";
        console.warn(
          `[loadSelectedDorkListContent] List data for key ${effectiveListKey} is missing or not an array.`
        );
      }
      updatePayloadLineCount();
      await updatePayloadUpdatedAt(effectiveListKey);
    } catch (error) {
      console.error(
        `[loadSelectedDorkListContent] Error loading dork list ${effectiveListKey}:`,
        error
      );
      UI.payloadInput.value = `// Error loading list: ${displayNameForError}`;
      updatePayloadLineCount();
      await updatePayloadUpdatedAt(effectiveListKey);
      showModal(`Error loading list content: ${error.message}`);
    }
  }
  function updatePayloadLineCount() {
    if (!UI.payloadInput || !UI.nbrTab2 || !UI.payloadLineLabel) return;
    const lineCount = UI.payloadInput.value
      ? UI.payloadInput.value.split("\n").filter((line) => line.trim() !== "")
          .length
      : 0;
    UI.nbrTab2.textContent = lineCount;
    UI.payloadLineLabel.textContent = lineCount === 1 ? "Line" : "Lines";
    updatePayloadEditorLabel();
    updatePayloadLineNumbers();
  }

  function updatePayloadLineNumbers() {
    if (!UI.payloadInput || !UI.payloadLineNumbers) return;

    const physicalLineCount = UI.payloadInput.value
      ? UI.payloadInput.value.split("\n").length
      : 1;
    const lineCount = Math.max(7, physicalLineCount);

    if (UI.payloadLineNumbers.dataset.lineCount !== String(lineCount)) {
      UI.payloadLineNumbers.textContent = Array.from(
        { length: lineCount },
        (_, index) => index + 1
      ).join("\n");
      UI.payloadLineNumbers.dataset.lineCount = String(lineCount);
    }

    syncPayloadLineNumbersScroll();
  }

  function syncPayloadLineNumbersScroll() {
    if (!UI.payloadInput || !UI.payloadLineNumbers) return;
    UI.payloadLineNumbers.style.transform = `translateY(-${UI.payloadInput.scrollTop}px)`;
  }

  function scrollPayloadToBottom() {
    if (!UI.payloadInput) return;
    requestAnimationFrame(() => {
      UI.payloadInput.scrollTop = UI.payloadInput.scrollHeight;
      syncPayloadLineNumbersScroll();
    });
  }

  function updatePayloadEditorLabel() {
    if (!UI.payloadEditorLabel || !UI.listTab2) return;

    const selectedOption = UI.listTab2.options[UI.listTab2.selectedIndex];
    const selectedText = selectedOption?.textContent?.trim().toUpperCase() || "";
    const selectedValue = UI.listTab2.value || "";

    if (
      selectedValue.startsWith(CONSTANTS.LIST_PREFIX_RESULT) ||
      selectedText.startsWith("RESULT:") ||
      selectedText.startsWith("R :")
    ) {
      UI.payloadEditorLabel.textContent = "Result";
      return;
    }

    if (
      selectedValue.startsWith(CONSTANTS.LIST_PREFIX_DORK) ||
      selectedText.startsWith("DORK:") ||
      selectedText.startsWith("D :")
    ) {
      UI.payloadEditorLabel.textContent = "Dork list / Payload";
      return;
    }

    UI.payloadEditorLabel.textContent = "Payload";
  }
  function clearPayloadInput() {
    if (UI.payloadInput) UI.payloadInput.value = "";
    updatePayloadLineCount();
  }
  function removeEmptyPayloadLines() {
    if (!UI.payloadInput || typeof UI.payloadInput.value !== "string") return;
    UI.payloadInput.value = UI.payloadInput.value
      .split("\n")
      .filter((line) => line.trim() !== "")
      .join("\n");
    updatePayloadLineCount();
  }
  function removeDuplicatePayloads() {
    if (!UI.payloadInput || typeof UI.payloadInput.value !== "string") return;
    const lines = UI.payloadInput.value.split("\n");
    const uniqueLines = [
      ...new Set(lines.filter((line) => line.trim() !== "")),
    ];
    UI.payloadInput.value = uniqueLines.join("\n");
    updatePayloadLineCount();
  }
  async function saveDorkListContent() {
    if (!UI.listTab2 || !UI.payloadInput) return false;
    const selectedOption = UI.listTab2.options[UI.listTab2.selectedIndex];
    const listStorageKey = selectedOption.value;
    if (listStorageKey === "0") {
      showErrorAnimation("No list selected");
      if (UI.listTab2) setFieldError(UI.listTab2, true);
      return false;
    }
    removeDuplicatePayloads();
    removeEmptyPayloadLines();
    const linesToSave = UI.payloadInput.value.split("\n");
    let wasUpdated = false;
    const updatedLines = linesToSave.map((line) => {
      if (line.includes("*replace*")) {
        wasUpdated = true;
        return line.replace(/\*replace\*/g, "$target");
      }
      return line;
    });
    if (wasUpdated) {
      UI.payloadInput.value = updatedLines.join("\n");
      updatePayloadLineCount();
      showModal(
        "Note: Deprecated '*replace*' placeholder was updated to '$target'. Your list content reflects this change. Click 'Save' again if needed or proceed.",
        [],
        UI.settingsModal
      );
    }
    try {
      const updatedAtKey = getListUpdatedAtStorageKey(listStorageKey);
      const updatedAt = new Date().toISOString();
      await setStorageData({
        [listStorageKey]: updatedLines,
        ...(updatedAtKey ? { [updatedAtKey]: updatedAt } : {}),
      });
      setPayloadUpdatedAtText(formatListUpdatedAt(updatedAt));
      showSuccessAnimation("List saved!");
      if (UI.listTab2) setFieldError(UI.listTab2, false);
      if (UI.listTab1?.value === listStorageKey) {
        await updateDorkCounter(listStorageKey);
      }
      return true;
    } catch (error) {
      console.error(`Error saving dork list ${listStorageKey}:`, error);
      showErrorAnimation("Could not save list");
      showModal(`Error saving list: ${error.message}`);
      return false;
    }
  }
  async function pasteFromClipboard() {
    if (!UI.payloadInput) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const currentContent = UI.payloadInput.value;
        const separator = currentContent.trim().length > 0 ? "\n" : "";
        UI.payloadInput.value += separator + text;
        updatePayloadLineCount();
        removeEmptyPayloadLines();
        removeDuplicatePayloads();
      } else {
        showErrorAnimation("Clipboard is empty");
      }
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
      showErrorAnimation("Could not paste");
      showModal("Could not paste from clipboard. Permission might be needed.");
    }
  }
  async function copyToClipBoard() {
    if (!UI.payloadInput) return;
    const text = UI.payloadInput.value;
    if (!text.trim()) {
      showErrorAnimation("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showSuccessAnimation("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy: ", err);
      showErrorAnimation("Could not copy");
      showModal("Could not copy to clipboard.");
    }
  }
  async function handleExtractJsEndpoints() {
    if (!UI.payloadInput || !UI.nbrTab2) return;
    const currentContent = UI.payloadInput.value;
    UI.payloadInput.value =
      currentContent +
      (currentContent.trim() ? "\n" : "") +
      "// Checking page JS...";
    updatePayloadLineCount();
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!activeTab || !activeTab.id || !activeTab.url?.startsWith("http")) {
        throw new Error("No active HTTP(S) tab found.");
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ["Script/content.js"],
        });
      } catch (e) {
        if (
          !e.message.includes("Duplicate script") &&
          !e.message.includes("Could not establish connection") &&
          !e.message.includes("Cannot access a chrome:") &&
          !e.message.includes("Cannot access contents of the page")
        ) {
          console.warn("Content script injection warning:", e.message);
        } else if (e.message.includes("Cannot access contents of the page")) {
          throw new Error(
            "Cannot access page content (e.g., Chrome Web Store, protected pages)."
          );
        }
      }
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        action: "searchPatterns",
      });
      UI.payloadInput.value = UI.payloadInput.value
        .replace(/\/\/ Checking page JS...\s*$/, "")
        .trim();
      if (response?.success && Array.isArray(response.patternsFound)) {
        const foundData = response.patternsFound.join("\n").trim();
        if (foundData) {
          const existingContent = UI.payloadInput.value.trim();
          const separator = existingContent ? "\n" : "";
          UI.payloadInput.value = existingContent + separator + foundData;
          removeDuplicatePayloads();
          removeEmptyPayloadLines();
          showSuccessAnimation("JS Paths Added!");
        } else {
          showSuccessAnimation("No JS paths found");
          updatePayloadLineCount();
        }
      } else {
        throw new Error(
          `JS Scan Failed: ${response?.error || "Unknown error or no data"}`
        );
      }
    } catch (error) {
      console.error("Error getting JS patterns:", error);
      UI.payloadInput.value = UI.payloadInput.value
        .replace(/\/\/ Checking page JS...\s*$/, "")
        .trim();
      updatePayloadLineCount();
      showModal(`JS Scan Error: ${error.message}`);
    }
  }
  async function updateDorkCounter(listStorageKeyValue) {
    if (!UI.nbrCounter || !UI.goButton || !UI.limitButton) {
      console.error("Counter or Go/Limit button UI elements missing.");
      return;
    }
    let count = 0;
    let inputsValid = areTab1InputsValid(false);
    if (listStorageKeyValue && listStorageKeyValue !== "0") {
      try {
        const data = await getStorageData(listStorageKeyValue);
        if (data && Array.isArray(data[listStorageKeyValue])) {
          count = data[listStorageKeyValue].filter(Boolean).length;
        } else {
          count = 0;
        }
      } catch (error) {
        console.error(
          `Error getting list count for ${listStorageKeyValue}:`,
          error
        );
        count = 0;
      }
    } else {
      count = 0;
    }
    UI.nbrCounter.textContent = count;
    const limitExceeded = count > CONSTANTS.TAB_LIMIT;
    const isReady = inputsValid && count > 0 && !limitExceeded;
    updateRunStatus({ count, inputsValid, limitExceeded });
    if (limitExceeded) {
      UI.goButton.style.display = "none";
      UI.limitButton.style.display = "inline-block";
      UI.limitButton.textContent = `TOO MANY TABS (${count}/${CONSTANTS.TAB_LIMIT} max)`;
      UI.goButton.classList.remove("go-button-ready");
      UI.goButton.classList.add("go-button-inactive");
    } else {
      UI.goButton.style.display = "inline-flex";
      UI.limitButton.style.display = "none";
      if (isReady) {
        UI.goButton.classList.add("go-button-ready");
        UI.goButton.classList.remove("go-button-inactive");
      } else {
        UI.goButton.classList.remove("go-button-ready");
        UI.goButton.classList.add("go-button-inactive");
      }
    }
  }
  async function saveCurrentOptions() {
    if (
      !UI.targetTab1 ||
      !UI.listTab1 ||
      !UI.selectModTab1 ||
      !UI.searchengineSelect
    )
      return;
    const listKeyValueToSave = UI.listTab1.value;
    const options = {
      Target: UI.targetTab1.value,
      ModeV: UI.selectModTab1.value,
      SearchEngine: UI.searchengineSelect.value,
    };
    try {
      const itemsToSave = { [CONSTANTS.STORAGE_KEYS.SAVE_OPTION]: options };
      if (listKeyValueToSave !== "0") {
        itemsToSave[CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1] = listKeyValueToSave;
        await setStorageData(itemsToSave);
      } else {
        await setStorageData({ [CONSTANTS.STORAGE_KEYS.SAVE_OPTION]: options });
        await removeStorageData(CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1);
      }
    } catch (error) {
      console.error("Error saving options:", error);
      showModal(`Error saving settings: ${error.message}`);
    }
  }
  async function loadSavedOptions() {
    try {
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.SAVE_OPTION,
        CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1,
      ]);
      let optionsRestored = false;
      if (data[CONSTANTS.STORAGE_KEYS.SAVE_OPTION]) {
        const savedOpts = data[CONSTANTS.STORAGE_KEYS.SAVE_OPTION];
        optionsRestored = true;
        if (UI.targetTab1 && typeof savedOpts.Target !== "undefined") {
          UI.targetTab1.value = savedOpts.Target;
        }
        if (UI.selectModTab1 && typeof savedOpts.ModeV !== "undefined") {
          selectOptionByValue(UI.selectModTab1, savedOpts.ModeV);
        }
        if (UI.searchengineSelect && savedOpts.SearchEngine) {
          const exists = [...UI.searchengineSelect.options].some(
            (opt) => opt.value === savedOpts.SearchEngine
          );
          if (exists) {
            selectOptionByValue(UI.searchengineSelect, savedOpts.SearchEngine);
          } else {
            console.warn(
              `Saved engine "${savedOpts.SearchEngine}" not found, defaulting.`
            );
            if (UI.searchengineSelect.value !== "0")
              UI.searchengineSelect.value = "0";
          }
        } else if (
          UI.searchengineSelect &&
          UI.searchengineSelect.value !== "0"
        ) {
          UI.searchengineSelect.value = "0";
        }
      }
      const savedListKeyTab1 = data[CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1];
      if (UI.listTab1 && savedListKeyTab1) {
        selectOptionByValue(UI.listTab1, savedListKeyTab1);
      }
      if (!optionsRestored) {
        console.log("No saved options found, resetting Tab 1 fields.");
        if (UI.targetTab1) UI.targetTab1.value = "";
        if (UI.selectModTab1) UI.selectModTab1.value = "0";
        if (UI.searchengineSelect) UI.searchengineSelect.value = "0";
        if (UI.listTab1) UI.listTab1.value = "0";
        UI.selectModTab1?.dispatchEvent(new Event("change"));
        UI.listTab1?.dispatchEvent(new Event("change"));
      }
    } catch (error) {
      console.error("Error loading saved options:", error);
      showModal(`Error loading saved settings: ${error.message}`);
      if (UI.targetTab1) UI.targetTab1.value = "";
      if (UI.selectModTab1) UI.selectModTab1.value = "0";
      UI.selectModTab1.dispatchEvent(new Event("change"));
      if (UI.searchengineSelect) UI.searchengineSelect.value = "0";
      if (UI.listTab1) UI.listTab1.value = "0";
      UI.listTab1.dispatchEvent(new Event("change"));
    }
  }
  async function initializeSaveOptionCheckbox() {
    const saveCheckboxKey = CONSTANTS.STORAGE_KEYS.SAVE_CHECKBOX_STATE;
    if (!UI.saveCheckbox) return;
    try {
      const data = await getStorageData(saveCheckboxKey);
      const isChecked = data[saveCheckboxKey] === true;
      UI.saveCheckbox.checked = isChecked;
      await loadSavedOptions();
      UI.saveCheckbox.addEventListener("change", async function () {
        const isNowChecked = this.checked;
        try {
          await setStorageData({ [saveCheckboxKey]: isNowChecked });
          if (isNowChecked) {
            await saveCurrentOptions();
          } else {
            await removeStorageData([
              CONSTANTS.STORAGE_KEYS.SAVE_OPTION,
              CONSTANTS.STORAGE_KEYS.LIST_SAVE_TAB1,
            ]);
          }
        } catch (error) {
          console.error("Error handling save checkbox change:", error);
          showModal(`Error saving checkbox state: ${error.message}`);
        }
      });
    } catch (error) {
      console.error(`Error initializing save checkbox:`, error);
      UI.saveCheckbox.checked = false;
      await loadSavedOptions();
    }
  }
  async function populateSearchEngineDropdown() {
    console.log("[populateSearchEngineDropdown] Populating engines...");
    if (!UI.searchengineSelect) return;
    console.log(
      `[populateSearchEngineDropdown] BEFORE clear engine select, options: ${UI.searchengineSelect.options.length}`
    );
    UI.searchengineSelect.replaceChildren();
    UI.searchengineSelect.appendChild(createDefaultOption("Search Engine"));
    console.log(
      `[populateSearchEngineDropdown] AFTER default engine select, options: ${UI.searchengineSelect.options.length}`
    );
    UI.searchengineSelect.value = "0";
    let engineCount = 0;
    try {
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.USER_SELECTORS,
        CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[CONSTANTS.STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs =
        data[CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS] || {};
      const allConfigs = { ...defaultConfigs, ...userConfigs };
      const validEngines = [];
      for (const key in allConfigs) {
        if (Object.prototype.hasOwnProperty.call(allConfigs, key)) {
          const config = allConfigs[key];
          if (config && config.useInEngineSelect === true && config.baseUrl) {
            validEngines.push({ key: key, config: config });
          }
        }
      }
      validEngines.sort(sortSearchEngines);
      if (validEngines.length === 0) {
        console.warn("No search engines found eligible for dropdown.");
      } else {
        validEngines.forEach((engineData) => {
          let displayName = engineData.key;
          const domainParts = engineData.key.split(".");
          if (domainParts.length >= 2)
            displayName = domainParts[domainParts.length - 2];
          displayName =
            displayName.charAt(0).toUpperCase() + displayName.slice(1);
          const truncatedDisplayName = truncateText(displayName, 15);
          const option = document.createElement("option");
          option.value = engineData.key;
          option.textContent = truncatedDisplayName;
          option.title = engineData.key;
          UI.searchengineSelect.appendChild(option);
          engineCount++;
        });
      }
      UI.searchengineSelect.disabled = engineCount === 0;
      await loadSavedOptions();
    } catch (error) {
      console.error("Error populating search engine dropdown:", error);
      UI.searchengineSelect.replaceChildren();
      UI.searchengineSelect.appendChild(createDefaultOption("Error Loading"));
      UI.searchengineSelect.disabled = true;
    }
    console.log("[populateSearchEngineDropdown] Finished populating engines.");
  }
  function truncateText(text, limit) {
    if (text && text.length > limit) {
      return text.substring(0, limit) + "...";
    }
    return text || "";
  }
  function resetSettingsTabView() {
    if (UI.listSettingsContainer)
      UI.listSettingsContainer.style.display = "none";
    if (UI.siteSettingsContainer)
      UI.siteSettingsContainer.style.display = "none";
    if (UI.initialSettingsView) UI.initialSettingsView.style.display = "flex";
    hideModal();
    syncActiveTabHeight();
  }

  function setSidePanelToggleState(enabled) {
    if (!UI.sidePanelToggle) return;
    UI.sidePanelToggle.checked = Boolean(enabled);
    UI.sidePanelToggle.setAttribute("aria-checked", String(Boolean(enabled)));
  }

  async function setSidePanelActionBehavior(enabled) {
    if (!chrome.sidePanel?.setPanelBehavior) return;
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: Boolean(enabled),
      });
    } catch (error) {
      console.warn("Could not update side panel action behavior:", error);
    }
  }

  async function openFastDorkSidePanel() {
    if (!chrome.sidePanel?.open) {
      throw new Error("Chrome side panel is not available in this browser.");
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (typeof activeTab?.windowId === "number") {
      await chrome.sidePanel.open({ windowId: activeTab.windowId });
      return;
    }

    if (typeof activeTab?.id === "number") {
      await chrome.sidePanel.open({ tabId: activeTab.id });
      return;
    }

    throw new Error("Could not find the current Chrome window.");
  }

  async function loadSidePanelPreference() {
    if (!UI.sidePanelToggle) return;
    try {
      const data = await getStorageData(CONSTANTS.STORAGE_KEYS.SIDE_PANEL_ENABLED);
      const enabled = Boolean(data[CONSTANTS.STORAGE_KEYS.SIDE_PANEL_ENABLED]);
      setSidePanelToggleState(enabled);
      await setSidePanelActionBehavior(enabled);
    } catch (error) {
      console.warn("Could not load side panel preference:", error);
      setSidePanelToggleState(false);
    }
  }

  async function handleSidePanelToggleChange() {
    if (!UI.sidePanelToggle) return;
    const enabled = UI.sidePanelToggle.checked;
    setSidePanelToggleState(enabled);

    try {
      await setStorageData({
        [CONSTANTS.STORAGE_KEYS.SIDE_PANEL_ENABLED]: enabled,
      });
      await setSidePanelActionBehavior(enabled);

      if (enabled) {
        await openFastDorkSidePanel();
        showSuccessAnimation("Side panel enabled");
      } else {
        showSuccessAnimation("Side panel disabled");
      }
    } catch (error) {
      console.error("Could not update side panel setting:", error);
      await setStorageData({
        [CONSTANTS.STORAGE_KEYS.SIDE_PANEL_ENABLED]: false,
      }).catch(() => {});
      await setSidePanelActionBehavior(false);
      setSidePanelToggleState(false);
      showModal(error.message || "Could not open the side panel.");
    }
  }

  async function handleResetAllData() {
    const messageText = `Are you sure you want to reset ALL data (lists, settings, custom site configs) to defaults? This cannot be undone.`;
    setupConfirmationModal(
      messageText,
      async () => {
        hideModal();
        try {
          console.log("Starting data reset...");
          const response = await chrome.runtime.sendMessage({
            action: "resetDefaultLists",
          });
          if (response?.success) {
            console.log("Background script confirmed successful reset.");
          } else {
            throw new Error(
              response?.error || "Background script failed to reset data."
            );
          }
          console.log("Reset successful, refreshing UI...");
          await loadAndPopulateLists();
          resetDorkListSelections();
          await removeStorageData(CONSTANTS.STORAGE_KEYS.SIDE_PANEL_ENABLED);
          await setSidePanelActionBehavior(false);
          setSidePanelToggleState(false);
          if (UI.targetTab1) UI.targetTab1.value = "";
          if (UI.selectModTab1) UI.selectModTab1.value = "0";
          await populateSearchEngineDropdown();
          if (UI.siteSettingsContainer?.style.display === "block") {
            await loadAndDisplayUserSiteSelectors();
          }
          showModal("Reset complete! Default lists and settings restored.");
          console.log("UI refreshed after reset.");
        } catch (error) {
          console.error("Error during reset:", error);
          showModal(`Error performing reset: ${error.message}`);
        }
      },
      () => {
        console.log("Reset cancelled by user.");
        hideModal();
      }
    );
  }
  async function loadSiteConfigs() {
    try {
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.USER_SELECTORS,
        CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[CONSTANTS.STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs =
        data[CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS] || {};
      return { ...defaultConfigs, ...userConfigs };
    } catch (error) {
      console.error("Error loading site configs:", error);
      showModal(`Error loading site configurations: ${error.message}`);
      return {};
    }
  }

  function removeImportButtonClickListener() {
    if (importButtonClickListener && UI.importBtn) {
      UI.importBtn.removeEventListener("click", importButtonClickListener);
      importButtonClickListener = null;
    }
  }

  function removeAutoImportStopClickListener() {
    if (autoImportStopClickListener && UI.importBtn) {
      UI.importBtn.removeEventListener("click", autoImportStopClickListener);
      autoImportStopClickListener = null;
    }
  }

  function sendStopAutoImportRequest() {
    console.log("[Auto Import Stop] Sending stop request.");
    showSuccessAnimation("Stopping Import...", ".sucessCheck");
    chrome.runtime.sendMessage({ action: "stopAutoImport" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Auto Import Stop] Error sending stopAutoImport:",
          chrome.runtime.lastError.message
        );
        return;
      }
      console.log("[Auto Import Stop] stopAutoImport response:", response);
    });
  }

  function ensureAutoImportStopClickListener() {
    if (!UI.importBtn) return;
    removeImportButtonClickListener();
    removeAutoImportStopClickListener();
    autoImportStopClickListener = sendStopAutoImportRequest;
    UI.importBtn.addEventListener("click", autoImportStopClickListener);
  }

  async function initializeImportButtonLogic(
    allowListSelectionChange = true,
    { switchToEditList = false } = {}
  ) {
    if (!UI.importBtn) return false;
    if (!isCurrentlyAutoImporting && !isImportPaused) {
      UI.importBtn.style.display = "none";
    }
    let activeTab;
    try {
      [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
    } catch (e) {
      console.error("Error querying active tab:", e);
      return false;
    }
    if (!activeTab || !activeTab.id || !activeTab.url?.startsWith("http")) {
      if (isCurrentlyAutoImporting || isImportPaused) {
        setManualImportButtonState(isCurrentlyAutoImporting, isImportPaused);
      }
      return false;
    }
    const currentUrl = activeTab.url;
    try {
      const allConfigs = await loadSiteConfigs();
      let matchingConfig = null;
      let matchingDomainKey = null;
      for (const domainKey in allConfigs) {
        if (Object.prototype.hasOwnProperty.call(allConfigs, domainKey)) {
          const config = allConfigs[domainKey];
          let isMatch = false;
          if (
            config.matchPatterns &&
            Array.isArray(config.matchPatterns) &&
            config.matchPatterns.length > 0
          ) {
            isMatch = config.matchPatterns.some(
              (pattern) => pattern && currentUrl.includes(pattern)
            );
          }
          if (isMatch) {
            matchingConfig = config;
            matchingDomainKey = domainKey;
            console.log(
              `Import Logic: Matched URL "${currentUrl}" with config "${domainKey}" (allowChange=${allowListSelectionChange})`
            );
            break;
          }
        }
      }
      if (matchingConfig && matchingDomainKey) {
        console.log(
          `[initializeImportButtonLogic] Calling setupImportButton for ${matchingDomainKey}`
        );
        await setupImportButton(
          matchingDomainKey,
          matchingConfig,
          allowListSelectionChange
        );
        if (switchToEditList) {
          showDorkList({ focusTextarea: false });
        }
        return true; // Match found
      } else {
        console.log(
          "[initializeImportButtonLogic] No matching config found for URL."
        );
        if (isCurrentlyAutoImporting || isImportPaused) {
          setManualImportButtonState(isCurrentlyAutoImporting, isImportPaused);
        } else {
          if (UI.importBtn) UI.importBtn.style.display = "none";
          removeImportButtonClickListener();
          removeAutoImportStopClickListener();
          console.log(
            "[initializeImportButtonLogic] Removed stale import listeners (no match)."
          );
        }
        return false;
      }
    } catch (error) {
      console.error("Error in initializeImportButtonLogic matching:", error);
      UI.importBtn.style.display = "none";
      return false;
    }
  }
  async function setupImportButton(
    domainKey,
    config,
    allowListSelectionChange = true
  ) {
    if (!UI.importBtn || !UI.listTab2) return false;
    console.log(
      `[setupImportButton] Setting up button for ${domainKey}. allowChange=${allowListSelectionChange}`
    );

    if (importButtonClickListener || autoImportStopClickListener) {
      console.log(
        "[setupImportButton] Removing previous import button listeners."
      );
      removeImportButtonClickListener();
      removeAutoImportStopClickListener();
    }

    let simpleName = domainKey;
    const domainParts = domainKey.split(".");
    if (domainParts.length >= 2)
      simpleName = domainParts[domainParts.length - 2];
    simpleName = simpleName.charAt(0).toUpperCase() + simpleName.slice(1);
    const buttonText = `Import from ${simpleName}`;
    const truncatedText = truncateText(buttonText, 34);

    UI.importBtn.textContent = truncatedText;
    UI.importBtn.title = `Import data using "${domainKey}" configuration`;
    UI.importBtn.dataset.contextKey = domainKey;

    if (allowListSelectionChange) {
      const preferredListKey = await getPreferredImportListKey(domainKey);
      if (preferredListKey) {
        const selected = await selectListAndRefreshTextarea(preferredListKey);
        if (selected) {
          console.log(
            `Selected import list for ${domainKey}: ${preferredListKey}`
          );
        }
      } else {
        clearPayloadInput();
        updatePayloadLineCount();
      }
    } else {
      console.log(
        `[setupImportButton] Keeping current list selection for ${domainKey}.`
      );
    }

    console.log(
      `[setupImportButton] Setting button display to inline-block for ${domainKey}`
    );
    UI.importBtn.style.display = "inline-block";
    console.log(
      `[setupImportButton] Button display is now: ${UI.importBtn.style.display}`
    );
    setManualImportButtonState(isCurrentlyAutoImporting, isImportPaused);
    if (isCurrentlyAutoImporting || isImportPaused) {
      return true;
    }

    importButtonClickListener = async () => {
      if (isCurrentlyAutoImporting) {
        sendStopAutoImportRequest();
        return;
      }

      const selectedListKey = UI.listTab2.value;
      if (selectedListKey === "0") {
        showModal(
          "Please select a list in Tab 2 (Edit List) to import the data into.",
          [{ text: "OK", onClick: hideModal }]
        );
        if (UI.listTab2) setFieldError(UI.listTab2, true);
        return;
      }
      if (UI.listTab2) setFieldError(UI.listTab2, false);

      await saveImportListPreference();

      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || !activeTab.id) {
          throw new Error("No active tab found for import.");
        }

        console.log(
          `Popup: Sending requestManualImport for tab ${activeTab.id} to list ${selectedListKey}`
        );

        chrome.runtime.sendMessage(
          {
            action: "requestManualImport",
            tabId: activeTab.id,
            resultListKey: selectedListKey,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error during manual import request:",
                chrome.runtime.lastError.message
              );
              showModal(
                `Import initiation failed: ${chrome.runtime.lastError.message}`
              );
            } else if (response && response.error) {
              console.error("Manual import error:", response.error);
              showModal(`Import failed: ${response.error}`);
            } else if (response && response.success) {
              console.log("Manual import request successful:", response);
            } else {
              console.warn(
                "Received unexpected response from manual import:",
                response
              );
              showModal("Import request sent, but status unknown.");
            }
          }
        );
      } catch (error) {
        console.error("Error setting up manual import:", error);
        showModal(`Error: ${error.message}`);
      }
    };

    UI.importBtn.addEventListener("click", importButtonClickListener);
    console.log("[setupImportButton] New click listener added.");

    return true;
  }
  function showDorkList({ focusTextarea = true } = {}) {
    console.log(`[FastDork.js] showDorkList() called.`);

    const tabs = document.querySelectorAll("#icetab-container > .icetab");
    const tabContents = document.querySelectorAll(
      "#icetab-content > .tabcontent"
    );
    const targetIndex = 1;
    if (
      !tabs ||
      !tabContents ||
      tabs.length <= targetIndex ||
      tabContents.length <= targetIndex
    ) {
      return;
    }

    console.log(`[showDorkList] Switching UI to Tab ${targetIndex + 1}.`);
    tabs.forEach((tab) => tab.classList.remove("current-tab"));
    tabContents.forEach((content) => content.classList.remove("tab-active"));
    tabs[targetIndex]?.classList.add("current-tab");
    tabContents[targetIndex]?.classList.add("tab-active");
    syncActiveTabHeight();
    if (focusTextarea) {
      setTimeout(() => {
        UI.payloadInput?.focus();
      }, 50);
    }
  }
  async function loadAndDisplayUserSiteSelectors() {
    if (!UI.siteSettingsListContainer) {
      console.error("Site settings list container not found.");
      return;
    }
    setSiteSettingsListMessage("Loading...");
    try {
      const allConfigs = await loadSiteConfigs();
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.USER_SELECTORS,
        CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[CONSTANTS.STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs =
        data[CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS] || {};
      const allKeys = Object.keys(allConfigs);
      allKeys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      UI.siteSettingsListContainer.replaceChildren();
      if (allKeys.length === 0) {
        setSiteSettingsListMessage(
          'No default or custom configurations found. Click "Add New".'
        );
        return;
      }
      allKeys.forEach((domain) => {
        if (!allConfigs[domain]) return;
        const isUser = userConfigs.hasOwnProperty(domain);
        const isDefault = defaultConfigs.hasOwnProperty(domain);
        const config = allConfigs[domain];
        let statusText = "";
        if (isUser && !isDefault) statusText = " (Custom)";
        else if (isUser && isDefault) statusText = " (Overridden)";
        else if (!isUser && isDefault) statusText = " (Default)";
        const listItem = document.createElement("li");
        listItem.className = "site-config-item";
        const nameSpan = document.createElement("span");
        nameSpan.className = "site-config-name";
        if (isUser) nameSpan.classList.add("is-user-config");
        if (!isUser && isDefault) nameSpan.classList.add("is-default-config");
        const truncatedDisplayDomain = truncateText(domain, 18);
        nameSpan.textContent = `${truncatedDisplayDomain}${statusText}`;
        nameSpan.title = `Domain: ${domain}\nStatus: ${
          statusText.trim().replace(/[()]/g, "") || "Default"
        }\nType: ${
          config.useInEngineSelect ? "Search Engine" : "Importer/Other"
        }`;
        const buttonDiv = document.createElement("div");
        buttonDiv.className = "site-config-buttons";
        const editButton = document.createElement("button");
        editButton.textContent = "Edit";
        editButton.className = "xs";
        editButton.title = `Edit configuration for ${domain}`;
        editButton.addEventListener("click", (e) => {
          e.stopPropagation();
          const configPageUrl = chrome.runtime.getURL(
            `siteconfig.html?edit=${encodeURIComponent(domain)}`
          );
          chrome.tabs.create({ url: configPageUrl, active: true });
        });
        buttonDiv.appendChild(editButton);
        if (isUser) {
          const deleteButton = document.createElement("button");
          deleteButton.textContent = isDefault ? "Reset" : "Delete";
          deleteButton.className = "xs danger-button";
          deleteButton.title = isDefault
            ? `Reset ${domain} to default settings`
            : `Delete custom ${domain} configuration`;
          deleteButton.addEventListener("click", (e) => {
            e.stopPropagation();
            handleDeleteSiteSelector(domain);
          });
          buttonDiv.appendChild(deleteButton);
        }
        listItem.appendChild(nameSpan);
        listItem.appendChild(buttonDiv);
        UI.siteSettingsListContainer.appendChild(listItem);
      });
    } catch (error) {
      console.error("Error loading site selectors:", error);
      setSiteSettingsListMessage("Error loading configurations.");
      showModal("Could not load site configurations.");
    }
  }

  function setSiteSettingsListMessage(message) {
    if (!UI.siteSettingsListContainer) return;
    const listItem = document.createElement("li");
    listItem.textContent = message;
    UI.siteSettingsListContainer.replaceChildren(listItem);
  }
  async function handleDeleteSiteSelector(domainToDelete) {
    hideModal();
    try {
      const data = await getStorageData([
        CONSTANTS.STORAGE_KEYS.USER_SELECTORS,
        CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS,
      ]);
      const userConfigs = data[CONSTANTS.STORAGE_KEYS.USER_SELECTORS] || {};
      const defaultConfigs =
        data[CONSTANTS.STORAGE_KEYS.DEFAULT_SELECTORS] || {};
      const isUser = userConfigs.hasOwnProperty(domainToDelete);
      const isDefault = defaultConfigs.hasOwnProperty(domainToDelete);
      if (!isUser) {
        showModal(
          `Cannot delete/reset "${domainToDelete}" as it's not a custom or overridden configuration.`
        );
        return;
      }
      let confirmMessage = "";
      let action = isDefault ? "reset" : "delete";
      confirmMessage =
        action === "reset"
          ? `Are you sure you want to remove your custom settings for "${domainToDelete}" and reset it to the default configuration?`
          : `Are you sure you want to permanently delete the custom configuration for "${domainToDelete}"? This cannot be undone.`;
      setupConfirmationModal(
        confirmMessage,
        async () => {
          hideModal();
          try {
            delete userConfigs[domainToDelete];
            await setStorageData({
              [CONSTANTS.STORAGE_KEYS.USER_SELECTORS]: userConfigs,
            });
            showSuccessAnimation(
              action === "reset" ? "Config Reset!" : "Config Deleted!"
            );
            await loadAndDisplayUserSiteSelectors();
            await populateSearchEngineDropdown();
            initializeImportButtonLogic();
          } catch (error) {
            console.error(
              `Error ${action}ting config ${domainToDelete}:`,
              error
            );
            showModal(
              `Failed to ${action}: ${error.message || "Unknown error"}`
            );
          }
        },
        () => {
          console.log(`${action} cancelled for ${domainToDelete}.`);
          hideModal();
        }
      );
    } catch (error) {
      console.error(
        `Error preparing delete/reset for ${domainToDelete}:`,
        error
      );
      showModal(`Could not prepare delete/reset action: ${error.message}`);
    }
  }

  async function applyImportStatus(message, source = "updateImportStatus") {
    console.log(
      `[applyImportStatus:${source}] isImporting=${message.isImporting}, isPaused=${message.isPaused}, activeListKey=${message.activeListKey}`
    );
    const previouslyImporting = isCurrentlyAutoImporting;
    const previouslyPaused = isImportPaused;
    isCurrentlyAutoImporting = message.isImporting ?? false;
    isImportPaused = message.isPaused ?? false;
    if (!isCurrentlyAutoImporting) {
      isImportPaused = false;
    }

    setManualImportButtonState(isCurrentlyAutoImporting, isImportPaused);

    const isTab2Active = document
      .querySelector("#icetab-content > .tabcontent:nth-child(2)")
      ?.classList.contains("tab-active");

    if (
      (isCurrentlyAutoImporting || isImportPaused) &&
      message.activeListKey &&
      !isTab2Active
    ) {
      const selected = await selectListAndRefreshTextarea(message.activeListKey, {
        switchToEditList: true,
      });
      if (!selected) {
        console.warn(
          `[applyImportStatus:${source}] Active list not found: ${message.activeListKey}`
        );
      } else {
        console.log(
          `[applyImportStatus:${source}] Selected active list ${message.activeListKey} and switched to Tab 2.`
        );
      }
    }

    if (isImportPaused) {
      const captchaDetail = message.pausedTabId
        ? ` on tab ${message.pausedTabId}`
        : "";
      const reason = message.captchaReason
        ? `\nReason: ${message.captchaReason}`
        : "";
      showModal(
        `All remaining imports are waiting on CAPTCHA${captchaDetail}. Solve it in the highlighted tab, then FastDork will continue automatically.${reason}`,
        [],
        UI.settingsModal
      );
    }

    if (!isCurrentlyAutoImporting && previouslyImporting && !previouslyPaused) {
      console.log(
        `[applyImportStatus:${source}] Import inactive, refreshing manual import context.`
      );
      try {
        await initializeImportButtonLogic(true);
      } catch (e) {
        console.warn(
          `[applyImportStatus:${source}] Import button refresh failed:`,
          e
        );
      }
    }
  }

  async function refreshImportStateFromBackground(source = "popup") {
    try {
      const state = await chrome.runtime.sendMessage({
        action: "getImportState",
      });
      if (!state || state.error) {
        console.warn(
          `[refreshImportStateFromBackground:${source}] Invalid response:`,
          state
        );
        return;
      }
      await applyImportStatus(
        {
          action: "updateImportStatus",
          isImporting: state.isImporting,
          isPaused: state.isPaused,
          pausedTabId: state.pausedTabId,
          captchaReason: state.captchaReason,
          activeListKey: state.activeListKey,
        },
        source
      );
    } catch (error) {
      console.warn(
        `[refreshImportStateFromBackground:${source}] Failed:`,
        error?.message || error
      );
    }
  }

  function formatImportActivityMessage(count, duplicateCount, prefix = "") {
    const importedCount = Number(count) || 0;
    const alreadyImportedCount = Number(duplicateCount) || 0;
    const detail =
      importedCount > 0
        ? `+${importedCount} imported`
        : alreadyImportedCount > 0
        ? "0 imported - already in the list"
        : "0 imported";
    return prefix ? `${prefix} · ${detail}` : detail;
  }

  async function consumeLastImportActivity(
    source = "popup",
    { prefix = "" } = {}
  ) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "consumeLastImportActivity",
      });
      if (!response?.success) {
        console.warn(
          `[consumeLastImportActivity:${source}] Invalid response:`,
          response
        );
        return false;
      }
      const activity = response.activity;
      const count = Number(activity?.count) || 0;
      const duplicateCount = Number(activity?.duplicateCount) || 0;
      const listKey = activity?.listKey;
      if (!activity || (count <= 0 && duplicateCount <= 0) || !listKey) {
        return false;
      }

      console.log(
        `[consumeLastImportActivity:${source}] Replaying import activity for ${listKey}: +${count}, duplicate=${duplicateCount}.`
      );
      const selected = await selectListAndRefreshTextarea(listKey, {
        switchToEditList: true,
        scrollToBottom: true,
      });
      if (!selected) {
        showDorkList({ focusTextarea: false });
      }
      showSuccessAnimation(
        formatImportActivityMessage(count, duplicateCount, prefix),
        ".sucessCheck"
      );
      return true;
    } catch (error) {
      console.warn(
        `[consumeLastImportActivity:${source}] Failed:`,
        error?.message || error
      );
      return false;
    }
  }

  function setupExtensionMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log(`[${Date.now()}] Popup received message:`, message);
      let isAsync = false;

      if (message.action === "updateImportStatus") {
        applyImportStatus(message, "message").catch((error) => {
          console.warn("[Msg Listener updateImportStatus] Failed:", error);
        });
        return false;
      }
      else if (message.type === "IMPORT_PAUSED") {
        console.log(
          `[Msg Listener IMPORT_PAUSED] Received for tab ${message.tabId}.`
        );
        isImportPaused = true;
        isCurrentlyAutoImporting = true;
        setManualImportButtonState(true, true);
        const reason = message.reason ? `\nReason: ${message.reason}` : "";
        showModal(
          `All remaining imports are waiting on CAPTCHA on tab ${message.tabId}. Solve it in the focused tab, then FastDork will continue automatically.${reason}`,
          [],
          UI.settingsModal
        );
        return false;
      }
      else if (message.type === "IMPORT_RESUMING") {
        console.log("[Msg Listener IMPORT_RESUMING] Received.");
        isImportPaused = false;
        isCurrentlyAutoImporting = true;
        setManualImportButtonState(true, false);
        hideModal(UI.settingsModal);
        showSuccessAnimation("Resuming Import...", ".sucessCheck");
        return false;
      }
      else if (message.type === "IMPORT_STOPPED") {
        console.log(`[Msg Listener IMPORT_STOPPED] Received.`);
        isImportPaused = false;
        isCurrentlyAutoImporting = false;
        setManualImportButtonState(false, false);
        hideModal(UI.settingsModal);
        (async () => {
          await initializeImportButtonLogic(true);
        })();
        isAsync = true;
        return isAsync;
      }
      else if (message.action === "extractionFailed") {
        console.warn(
          `[Msg Listener extractionFailed] Received error for tab ${message.tabId}, page ${message.page}: ${message.error}`
        );
        return false;
      }
      else if (message.action === "showImportError") {
        console.error(
          `[Msg Listener showImportError] Received: ${message.error} (List: ${message.listKey})`
        );
        showModal(`Import Error: ${message.error}`, [], UI.settingsModal);
        return false;
      }
      else if (message.action === "manualImportSaved") {
        const listKey = message.listKey;
        const count = Number(message.count) || 0;
        const duplicateCount = Number(message.duplicateCount) || 0;
        (async () => {
          if (listKey) {
            await selectListAndRefreshTextarea(listKey, {
              switchToEditList: true,
              scrollToBottom: true,
            });
          }
          if (count > 0 || duplicateCount > 0) {
            showSuccessAnimation(
              formatImportActivityMessage(
                count,
                duplicateCount,
                "Manual import complete"
              ),
              ".sucessCheck"
            );
            await chrome.storage.session.remove(LAST_IMPORT_ACTIVITY_KEY);
          } else {
            const replayedImportActivity = await consumeLastImportActivity(
              "manual-import-saved",
              { prefix: "Manual import complete" }
            );
            if (!replayedImportActivity) {
              showSuccessAnimation(
                "Manual import complete · 0 imported",
                ".sucessCheck"
              );
            }
          }
          await chrome.storage.session.remove([
            MANUAL_IMPORT_JUST_FINISHED_KEY,
            LAST_MANUAL_IMPORT_LIST_KEY,
          ]);
        })();
        return false;
      } else if (message.action === "importPageSaved") {
        const listKey = message.listKey;
        const count = Number(message.count) || 0;
        const duplicateCount = Number(message.duplicateCount) || 0;
        (async () => {
          if (listKey) {
            await selectListAndRefreshTextarea(listKey, {
              switchToEditList: true,
              scrollToBottom: true,
            });
          }
          if (count > 0 || duplicateCount > 0) {
            showSuccessAnimation(
              count > 0
                ? `+${count} imported`
                : "0 imported - already in the list",
              ".sucessCheck"
            );
            await chrome.storage.session.remove(LAST_IMPORT_ACTIVITY_KEY);
          }
        })();
        return false;
      } else if (message.action === "showImportSuccess") {
        const listKey = message.listKey;
        isImportPaused = false;
        isCurrentlyAutoImporting = false;
        setManualImportButtonState(false, false);
        hideModal(UI.settingsModal);
        (async () => {
          if (listKey) {
            await selectListAndRefreshTextarea(listKey, {
              switchToEditList: true,
              scrollToBottom: true,
            });
          } else {
            showDorkList();
          }
          const replayedImportActivity = await consumeLastImportActivity(
            "show-import-success"
          );
          if (!replayedImportActivity) {
            showSuccessAnimation("Auto-import complete", ".sucessCheck");
          }
          await initializeImportButtonLogic(true);
          await chrome.storage.session.remove([
            IMPORT_JUST_FINISHED_KEY,
            LAST_AUTO_IMPORT_LIST_KEY,
          ]);
        })();
        return false;
      } else if (message.action === "configChanged") {
        (async () => {
          await loadAndPopulateLists();
          await populateSearchEngineDropdown();
          await loadAndDisplayUserSiteSelectors();
          await initializeImportButtonLogic(true);
        })();
        return false;
      }
      else if (message.action === "extractedPageData") {
        return false;
      }
      else {
        console.warn(
          "Popup received unhandled message action/type:",
          message.action || message.type
        );
        return false;
      }
    });
    console.log("Extension message listener added.");
  }
  function updateDisplayedVersion() {
    if (!UI.settingsVersion) return;
    try {
      UI.settingsVersion.textContent =
        chrome.runtime.getManifest?.()?.version || UI.settingsVersion.textContent;
    } catch (error) {
      console.warn("Could not read extension manifest version:", error);
    }
  }
  async function initialize() {
    if (initializeHasRun) {
      return;
    }
    initializeHasRun = true;
    console.log("--- FastDork Initializing START ---");
    updateDisplayedVersion();
    setupTabStructure();
    await loadSidePanelPreference();
    await loadAndPopulateLists();
    await loadAndPopulateEngines();
    await initializeSaveOptionCheckbox();
    setupEventListeners(); // Setup listeners FIRST
    setupExtensionMessageListener();
    console.log("[Initialize] Core UI loaded and listeners set.");
    let initialSwitchDone = false;
    let processedFinishedState = false;
    isCurrentlyAutoImporting = false; // Reset flags on popup open initially
    isImportPaused = false;

    // --- 1. Check Auto-Import Finished State ---
    console.log("[Initialize] Checking AUTO-IMPORT FINISHED state...");
    try {
      const sessionData = await chrome.storage.session.get([
        IMPORT_JUST_FINISHED_KEY,
        LAST_AUTO_IMPORT_LIST_KEY,
      ]);
      const importJustFinished = sessionData[IMPORT_JUST_FINISHED_KEY] === true;
      const lastAutoImportListKey = sessionData[LAST_AUTO_IMPORT_LIST_KEY];
      if (importJustFinished) {
        processedFinishedState = true;
        initialSwitchDone = true;
        setManualImportButtonState(false, false);
          if (
            lastAutoImportListKey &&
            UI.listTab2 &&
            selectOptionByValue(UI.listTab2, lastAutoImportListKey)
          ) {
            await loadSelectedDorkListContent();
            scrollPayloadToBottom();
          }
        showDorkList();
        const replayedImportActivity = await consumeLastImportActivity(
          "auto-complete"
        );
        if (!replayedImportActivity) {
          showSuccessAnimation("Auto-import complete", ".sucessCheck");
        }
        await chrome.storage.session.remove([
          IMPORT_JUST_FINISHED_KEY,
          LAST_AUTO_IMPORT_LIST_KEY,
        ]);
      }
    } catch (e) {
      console.warn("[Initialize] Could not process auto-import finished state:", e);
    }

    // --- 2. Check Manual Import Finished State ---
    if (!initialSwitchDone && !processedFinishedState) {
      console.log("[Initialize] Checking MANUAL IMPORT FINISHED state...");
      try {
        const sessionDataManual = await chrome.storage.session.get([
          MANUAL_IMPORT_JUST_FINISHED_KEY,
          LAST_MANUAL_IMPORT_LIST_KEY,
        ]);
        const manualImportJustFinished =
          sessionDataManual[MANUAL_IMPORT_JUST_FINISHED_KEY] === true;
        const lastManualImportListKey =
          sessionDataManual[LAST_MANUAL_IMPORT_LIST_KEY];
        if (manualImportJustFinished) {
          processedFinishedState = true;
          initialSwitchDone = true;
          setManualImportButtonState(false, false);
          if (
            lastManualImportListKey &&
            UI.listTab2 &&
            selectOptionByValue(UI.listTab2, lastManualImportListKey)
          ) {
            await loadSelectedDorkListContent();
            scrollPayloadToBottom();
          }
          showDorkList();
          const replayedImportActivity = await consumeLastImportActivity(
            "manual-complete",
            { prefix: "Manual import complete" }
          );
          if (!replayedImportActivity) {
            showSuccessAnimation(
              "Manual import complete · 0 imported",
              ".sucessCheck"
            );
          }
          await chrome.storage.session.remove([
            MANUAL_IMPORT_JUST_FINISHED_KEY,
            LAST_MANUAL_IMPORT_LIST_KEY,
          ]);
        }
      } catch (e) {
        console.warn("[Initialize] Could not process manual import finished state:", e);
      }
    }

    // --- 3. Check Manual Import CONTEXT ---
    if (!initialSwitchDone && !processedFinishedState) {
      console.log("[Initialize] Checking MANUAL import CONTEXT state...");
      try {
        initialSwitchDone = await initializeImportButtonLogic(true, {
          switchToEditList: true,
        });
      } catch (e) {
        console.warn("[Initialize] Could not initialize manual import context:", e);
      }
    }

    // --- 4. Set initial button state & Update Tab 1 Counter ---
    if (!initialSwitchDone) {
      // Apply initial state if no switch happened (will be updated by popupOpened message later)
      setManualImportButtonState(false, false); // Assume inactive initially
      await updateDorkCounter(UI.listTab1?.value);
    } else {
      // State was set by finished handlers or will be set by popupOpened message
      await updateDorkCounter(UI.listTab1?.value);
    }

    console.log("[Initialize] Sending final popupOpened message.");
    try {
      await chrome.runtime.sendMessage({
        action: "popupOpened",
        preserveCompletionIcon: processedFinishedState,
      });
      await refreshImportStateFromBackground("popup-open");
      if (!processedFinishedState) {
        await consumeLastImportActivity("popup-open");
      }
    } catch (e) {
      console.warn("[Initialize] Failed to send popupOpened:", e);
      await refreshImportStateFromBackground("popup-open-fallback");
      if (!processedFinishedState) {
        await consumeLastImportActivity("popup-open-fallback");
      }
    }

    console.log("--- FastDork Initializing END ---");
  }

  function setupEventListeners() {
    console.log("[setupEventListeners] Setting up standard UI listeners...");
    UI.goButton?.addEventListener("click", handleGoButtonClick);
    UI.selectModTab1?.addEventListener("change", async () => {
      hideErrorTab1();
      await updateDorkCounter(UI.listTab1?.value);
      if (UI.targetTab1) {
        UI.targetTab1.placeholder =
          UI.selectModTab1.value === "1"
            ? "Dork with $target or $t placeholder"
            : "Target (e.g., example.com)";
      }
      if (UI.saveCheckbox?.checked) await saveCurrentOptions();
    });
    UI.searchengineSelect?.addEventListener("change", async () => {
      hideErrorTab1();
      await updateDorkCounter(UI.listTab1?.value);
      if (UI.saveCheckbox?.checked) await saveCurrentOptions();
    });
    UI.listTab1?.addEventListener("change", async function () {
      hideErrorTab1();
      await updateDorkCounter(this.value);
      if (UI.saveCheckbox?.checked) await saveCurrentOptions();
    });
    UI.targetTab1?.addEventListener("input", async () => {
      hideErrorTab1(UI.targetTab1);
      await updateDorkCounter(UI.listTab1?.value);
    });
    UI.targetTab1?.addEventListener("blur", async () => {
      if (UI.saveCheckbox?.checked) await saveCurrentOptions();
    });
    document
      .getElementById("save")
      ?.addEventListener("click", saveDorkListContent);
    document
      .getElementById("clear")
      ?.addEventListener("click", clearPayloadInput);
    document
      .getElementById("paste")
      ?.addEventListener("click", pasteFromClipboard);
    document
      .getElementById("clipboard")
      ?.addEventListener("click", copyToClipBoard);
    document
      .getElementById("links")
      ?.addEventListener("click", handleExtractJsEndpoints);
    UI.listTab2?.addEventListener("change", () => {
      console.log("[listTab2 change listener] Fired.");
      hideErrorTab1();
      hideModal();
      loadSelectedDorkListContent();
    });
    UI.payloadInput?.addEventListener("input", updatePayloadLineCount);
    UI.payloadInput?.addEventListener("scroll", syncPayloadLineNumbersScroll);
    UI.payloadInput?.addEventListener("focusout", removeEmptyPayloadLines);
    updatePayloadLineCount();
    updatePayloadUpdatedAt();
    UI.expandPayloadIcon?.addEventListener("click", () => {
      const textarea = UI.payloadInput;
      if (textarea) {
        textarea.classList.toggle("expanded");
        UI.expandPayloadIcon.textContent = textarea.classList.contains(
          "expanded"
        )
          ? "Collapse"
          : "Expand";
        UI.expandPayloadIcon.title = textarea.classList.contains("expanded")
          ? "Collapse Textarea"
          : "Expand Textarea";
      }
    });
    UI.settingsGithubLink?.addEventListener("click", () =>
      chrome.tabs.create({ url: "https://github.com/SKVNDR/FastDork" })
    );
    UI.settingsExploitDbLink?.addEventListener("click", () =>
      chrome.tabs.create({
        url: "https://www.exploit-db.com/google-hacking-database",
      })
    );
    UI.settingsResetButton?.addEventListener("click", handleResetAllData);
    UI.sidePanelToggle?.addEventListener("change", handleSidePanelToggleChange);
    UI.btnGoToListSettings?.addEventListener("click", () => {
      if (UI.initialSettingsView) UI.initialSettingsView.style.display = "none";
      if (UI.siteSettingsContainer)
        UI.siteSettingsContainer.style.display = "none";
      if (UI.listSettingsContainer)
        UI.listSettingsContainer.style.display = "block";
      hideModal();
      syncActiveTabHeight();
    });
    UI.btnGoToSiteSettings?.addEventListener("click", async () => {
      if (UI.initialSettingsView) UI.initialSettingsView.style.display = "none";
      if (UI.listSettingsContainer)
        UI.listSettingsContainer.style.display = "none";
      if (UI.siteSettingsContainer)
        UI.siteSettingsContainer.style.display = "block";
      hideModal();
      await loadAndDisplayUserSiteSelectors();
      syncActiveTabHeight();
    });
    UI.createListBtn?.addEventListener("click", createDorkList);
    UI.deleteListBtn?.addEventListener("click", deleteDorkList);
    UI.listNameInput?.addEventListener("input", () => hideModal());
    UI.listDelDropdown?.addEventListener("change", () => hideModal());
    document
      .getElementById("category-info-icon")
      ?.addEventListener("click", showListCategoryHelpModal);
    document.getElementById("save-info-icon")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSaveOptionHelpModal();
    });
    UI.btnAddSiteConfig?.addEventListener("click", () => {
      const configPageUrl = chrome.runtime.getURL("siteconfig.html");
      chrome.tabs.create({ url: configPageUrl, active: true });
    });
    UI.dorkOptionsProceed?.addEventListener("click", handleProceedDorkOptions);
    UI.dorkOptionsCancel?.addEventListener("click", hideDorkOptionsModal);
    UI.autoImportCheckbox?.addEventListener(
      "change",
      validateDorkOptionsModal
    );
    UI.autoImportResultList?.addEventListener(
      "change",
      validateDorkOptionsModal
    );
    console.log("[setupEventListeners] Standard UI listeners setup complete.");

    UI.resumeImportBtn?.addEventListener("click", () => {
      if (isImportPaused) {
        console.log(
          "Resume Import button clicked. Sending message to background."
        );
        hideModal(UI.settingsModal);

        chrome.runtime.sendMessage({ type: "RESUME_IMPORT" }, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error("Error sending RESUME_IMPORT:", errorMsg);
            if (
              errorMsg.includes("Could not establish connection") ||
              errorMsg.includes("Receiving end does not exist")
            ) {
              console.warn(
                "Could not send resume message (background likely closed or reloaded). State might be inconsistent."
              );
              isImportPaused = false;
              isCurrentlyAutoImporting = false;
              setManualImportButtonState(false, false);
            } else {
              showModal(`Error resuming: ${errorMsg}`);
              setManualImportButtonState(
                isCurrentlyAutoImporting,
                isImportPaused
              );
            }
          }
          else {
            console.log("RESUME_IMPORT message sent.");
          }
        });
      } else {
        console.warn("Resume button clicked, but not in a paused state.");
      }
    });
  }

  function setManualImportButtonState(isImportActive, isPaused = false) {
    if (!UI.importBtn || !UI.resumeImportBtn) return;

    console.log(
      `[setManualImportButtonState] Setting state: Active=${isImportActive}, Paused=${isPaused}`
    );

    if (isPaused) {
      removeImportButtonClickListener();
      removeAutoImportStopClickListener();
      UI.importBtn.style.display = "none";
      UI.resumeImportBtn.style.display = "inline-block";
      UI.resumeImportBtn.textContent = "Resume Import";
      UI.resumeImportBtn.disabled = false;
      UI.resumeImportBtn.title =
        "CAPTCHA detected. Solve it in the relevant tab, then click here to resume.";
      isCurrentlyAutoImporting = true;
      isImportPaused = true;
    } else if (isImportActive) {
      UI.importBtn.style.display = "inline-block";
      UI.resumeImportBtn.style.display = "none";
      UI.importBtn.textContent = "Stop Auto Import";
      UI.importBtn.classList.add("import-button-disabled");
      UI.importBtn.title = "Auto-import is running. Click to stop.";
      ensureAutoImportStopClickListener();
      isCurrentlyAutoImporting = true;
      isImportPaused = false;
    } else {
      removeAutoImportStopClickListener();
      UI.resumeImportBtn.style.display = "none";
      isCurrentlyAutoImporting = false;
      isImportPaused = false;
      const contextKey = UI.importBtn.dataset.contextKey;
      if (contextKey) {
        let originalText = "Import";
        let originalTitle = "Import data from current page";
        let simpleName = contextKey;
        const domainParts = contextKey.split(".");
        if (domainParts.length >= 2)
          simpleName = domainParts[domainParts.length - 2];
        simpleName = simpleName.charAt(0).toUpperCase() + simpleName.slice(1);
        originalText = `Import from ${simpleName}`;
        originalTitle = `Import data using "${contextKey}" configuration`;

        UI.importBtn.textContent = truncateText(originalText, 34);
        UI.importBtn.title = originalTitle;
        UI.importBtn.style.display = "inline-block";
        UI.importBtn.classList.remove("import-button-disabled");
      } else {
        UI.importBtn.style.display = "none";
        UI.importBtn.textContent = "Import";
        UI.importBtn.title = "";
        UI.importBtn.classList.remove("import-button-disabled");
      }
    }
  }
  await initialize();
  console.log("--- FastDork.js: DOMContentLoaded END ---");

  async function saveImportListPreference() {
    if (!UI.importBtn || !UI.listTab2) return;

    const domainKey = UI.importBtn.dataset.contextKey;
    const selectedListKey = UI.listTab2.value;

    if (!domainKey) {
      console.warn(
        "[saveImportListPreference] Could not find domainKey on button."
      );
      return;
    }

    if (selectedListKey && selectedListKey !== "0") {
      const storageLookupKey = `tab2Save-${domainKey}`;
      try {
        await setStorageData({ [storageLookupKey]: selectedListKey });
        console.log(
          `[saveImportListPreference] Saved list preference for ${domainKey}: ${selectedListKey}`
        );
      } catch (error) {
        console.error(
          `[saveImportListPreference] Error saving list preference for ${domainKey}:`,
          error
        );
      }
    } else {
      console.log(
        `[saveImportListPreference] No valid list selected, preference not saved for ${domainKey}.`
      );
    }
  }

  function validateDorkOptionsModal() {
    if (
      !UI.autoImportCheckbox ||
      !UI.autoImportResultList ||
      !UI.dorkOptionsProceed
    ) {
      return;
    }

    const isAutoImportChecked = UI.autoImportCheckbox.checked;
    const isListSelected = UI.autoImportResultList.value !== "0";
    let proceedEnabled = true;
    let listInvalid = false;

    if (isAutoImportChecked && !isListSelected) {
      proceedEnabled = false;
      listInvalid = true;
    }

    UI.dorkOptionsProceed.disabled = !proceedEnabled;
    setFieldError(UI.autoImportResultList, listInvalid);

    if (proceedEnabled) {
      UI.dorkOptionsProceed.classList.remove("disabled-button");
    } else {
      UI.dorkOptionsProceed.classList.add("disabled-button");
    }
  }
}); // --- End Single Top-Level DOMContentLoaded Listener ---
