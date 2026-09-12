/**
 * @file popup.js
 * @description Controller for the Live Tab Stasher extension popup.
 * Manages tab stashing, closing active tabs to free memory, item restoration, and persistent storage synchronization.
 */

'use strict';

/**
 * Storage key constant for stashed tabs.
 * @type {string}
 */
const STORAGE_KEY = 'stashedTabs';

/**
 * Restricted URL schemes that the browser prevents extensions from controlling or closing safely.
 * @type {string[]}
 */
const RESTRICTED_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'view-source:',
  'devtools://'
];

/**
 * DOM Elements Cache
 */
const elements = {
  stashBtn: document.getElementById('stashBtn'),
  stashedList: document.getElementById('stashedList'),
  tabCount: document.getElementById('tabCount'),
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage')
};

/**
 * Retrieves the latest list of stashed tabs directly from chrome.storage.local.
 * Guarantees fresh state synchronization prior to any mutation.
 * @returns {Promise<Array<{id: string, title: string, url: string, favIconUrl?: string, stashedAt: number}>>}
 */
async function getStoredTabs() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to retrieve stashed tabs:', chrome.runtime.lastError);
        resolve([]);
      } else {
        resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      }
    });
  });
}

/**
 * Persists an array of tabs to chrome.storage.local.
 * @param {Array<Object>} tabsList - The array of tab objects to save.
 * @returns {Promise<void>}
 */
async function saveTabs(tabsList) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: tabsList }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to write to storage:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Validates whether a URL is restricted by the browser security sandbox.
 * @param {string} [url] - The URL to test.
 * @returns {boolean} True if the URL cannot be stashed.
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const lowerUrl = url.trim().toLowerCase();
  return RESTRICTED_SCHEMES.some((scheme) => lowerUrl.startsWith(scheme));
}

/**
 * Displays a transient or persistent error notification banner in the UI.
 * @param {string} message - Alert message to display.
 */
function showAlert(message) {
  if (!elements.alertBanner || !elements.alertMessage) return;
  elements.alertMessage.textContent = message;
  elements.alertBanner.classList.add('visible');

  setTimeout(() => {
    if (elements.alertBanner) {
      elements.alertBanner.classList.remove('visible');
    }
  }, 3500);
}

/**
 * Extracts a clean hostname from a URL for secondary preview text.
 * @param {string} url - The URL string.
 * @returns {string} Clean hostname or fallback.
 */
function getHostname(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || '';
  }
}

/**
 * Handles the "Stash Current Tab" action.
 * Queries active tab, verifies restrictions, updates storage, closes tab, and updates view.
 * @returns {Promise<void>}
 */
async function handleStashCurrentTab() {
  try {
    const queryOptions = { active: true, currentWindow: true };
    const [activeTab] = await chrome.tabs.query(queryOptions);

    if (!activeTab || !activeTab.id) {
      showAlert('No active tab detected in current window.');
      return;
    }

    if (isRestrictedUrl(activeTab.url)) {
      showAlert('Restricted browser pages cannot be stashed.');
      return;
    }

    const newTabEntry = {
      id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: activeTab.title ? activeTab.title.trim() : '',
      url: activeTab.url,
      favIconUrl: activeTab.favIconUrl || '',
      stashedAt: Date.now()
    };

    // Always fetch latest array to prevent race conditions
    const currentTabs = await getStoredTabs();
    const updatedTabs = [newTabEntry, ...currentTabs];

    await saveTabs(updatedTabs);
    await renderStashedList();

    // Immediately close the active tab to reclaim RAM
    await chrome.tabs.remove(activeTab.id);
  } catch (error) {
    console.error('Error executing tab stash:', error);
    showAlert('Failed to stash current tab.');
  }
}

/**
 * Restores a stashed tab by opening it in a new browser tab and removing it from storage.
 * @param {string} id - Unique identifier of the stashed tab.
 * @param {string} url - Target URL to restore.
 * @returns {Promise<void>}
 */
async function handleRestoreTab(id, url) {
  try {
    // Open in a new tab
    await chrome.tabs.create({ url, active: true });

    // Remove from storage and re-render
    const currentTabs = await getStoredTabs();
    const filteredTabs = currentTabs.filter((tab) => tab.id !== id);

    await saveTabs(filteredTabs);
    await renderStashedList();
  } catch (error) {
    console.error('Error restoring tab:', error);
    showAlert('Failed to restore tab.');
  }
}

/**
 * Deletes a stashed tab item without opening it.
 * @param {string} id - Unique identifier of the tab to remove.
 * @returns {Promise<void>}
 */
async function handleDeleteTab(id) {
  try {
    const currentTabs = await getStoredTabs();
    const filteredTabs = currentTabs.filter((tab) => tab.id !== id);

    await saveTabs(filteredTabs);
    await renderStashedList();
  } catch (error) {
    console.error('Error deleting tab:', error);
    showAlert('Failed to remove tab from stash.');
  }
}

/**
 * Renders the list of stashed tabs in the popup UI.
 * Handles empty states, favicon fallbacks, title truncation, and event bindings.
 * @returns {Promise<void>}
 */
async function renderStashedList() {
  const tabs = await getStoredTabs();
  const { stashedList, tabCount } = elements;

  if (!stashedList) return;

  // Update badge counter
  if (tabCount) {
    tabCount.textContent = String(tabs.length);
  }

  // Clear previous DOM nodes
  stashedList.innerHTML = '';

  // Empty State Guard
  if (tabs.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
      </svg>
      <span>No stashed tabs</span>
    `;
    stashedList.appendChild(emptyState);
    return;
  }

  // Render list items
  tabs.forEach((tab) => {
    const listItem = document.createElement('li');
    listItem.className = 'stashed-item';
    listItem.setAttribute('role', 'button');
    listItem.setAttribute('tabindex', '0');
    listItem.title = `Click to restore: ${tab.title || tab.url}`;

    // Item Content Area (Favicon + Title + Domain)
    const contentDiv = document.createElement('div');
    contentDiv.className = 'item-content';

    // Favicon handling with safe SVG fallback
    if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
      const img = document.createElement('img');
      img.className = 'item-favicon';
      img.src = tab.favIconUrl;
      img.alt = '';
      img.onerror = () => {
        img.replaceWith(createFallbackIcon());
      };
      contentDiv.appendChild(img);
    } else {
      contentDiv.appendChild(createFallbackIcon());
    }

    // Detail Container
    const detailDiv = document.createElement('div');
    detailDiv.className = 'item-details';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title';
    titleEl.textContent = tab.title || tab.url;

    const domainEl = document.createElement('div');
    domainEl.className = 'item-domain';
    domainEl.textContent = getHostname(tab.url);

    detailDiv.appendChild(titleEl);
    detailDiv.appendChild(domainEl);
    contentDiv.appendChild(detailDiv);

    // Clicking content restores tab
    contentDiv.addEventListener('click', (event) => {
      event.stopPropagation();
      handleRestoreTab(tab.id, tab.url);
    });

    // Delete Button (Material Icon Button)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Remove without opening';
    deleteBtn.setAttribute('aria-label', `Delete ${tab.title || tab.url}`);
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    `;

    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleDeleteTab(tab.id);
    });

    // Keyboard navigation (Enter / Space restores)
    listItem.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleRestoreTab(tab.id, tab.url);
      }
    });

    listItem.appendChild(contentDiv);
    listItem.appendChild(deleteBtn);
    stashedList.appendChild(listItem);
  });
}

/**
 * Creates an inline fallback SVG element for web tabs without valid favicons.
 * @returns {SVGElement} Material web page icon SVG.
 */
function createFallbackIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'item-favicon-fallback');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>';
  return svg;
}

/**
 * Initialization lifecycle handler.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Bind primary action
  if (elements.stashBtn) {
    elements.stashBtn.addEventListener('click', handleStashCurrentTab);
  }

  // Initial render
  renderStashedList();
});
