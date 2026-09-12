/**
 * @file popup.js
 * @description Controller for the Live Tab Stasher extension popup.
 * Manages tab stashing, process closing for RAM relief, deterministic storage synchronization,
 * search filtering, Material 3 UI rendering, and snackbar undo states.
 */

'use strict';

/**
 * Storage key constant for stashed tabs.
 * @type {string}
 */
const STORAGE_KEY = 'stashedTabs';

/**
 * Average memory consumed per Chromium tab (used for UX RAM estimation).
 * @type {number}
 */
const AVG_RAM_PER_TAB_MB = 95;

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
 * Undo buffer holding last action state for the Material snackbar.
 * @type {{action: 'stash'|'delete', tab: Object, index: number}|null}
 */
let lastUndoAction = null;
let snackbarTimeout = null;

/**
 * DOM Elements Cache
 */
const elements = {
  stashBtn: document.getElementById('stashBtn'),
  stashedList: document.getElementById('stashedList'),
  tabCount: document.getElementById('tabCount'),
  ramSavedLabel: document.getElementById('ramSavedLabel'),
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage'),
  toolbarContainer: document.getElementById('toolbarContainer'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  restoreAllBtn: document.getElementById('restoreAllBtn'),
  snackbar: document.getElementById('snackbar'),
  snackbarText: document.getElementById('snackbarText'),
  snackbarUndoBtn: document.getElementById('snackbarUndoBtn')
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
 * Displays a transient error banner in the UI.
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
 * Displays the Material feedback snackbar with an optional Undo action.
 * @param {string} message - Feedback text.
 * @param {boolean} showUndo - Whether the undo button should be active.
 */
function showSnackbar(message, showUndo = true) {
  if (!elements.snackbar || !elements.snackbarText) return;

  if (snackbarTimeout) {
    clearTimeout(snackbarTimeout);
  }

  elements.snackbarText.textContent = message;
  if (elements.snackbarUndoBtn) {
    elements.snackbarUndoBtn.style.display = showUndo ? 'inline-block' : 'none';
  }

  elements.snackbar.classList.add('show');

  snackbarTimeout = setTimeout(() => {
    if (elements.snackbar) {
      elements.snackbar.classList.remove('show');
    }
    lastUndoAction = null;
  }, 4000);
}

/**
 * Formats a timestamp into a human-readable relative time string.
 * @param {number} timestamp - Unix epoch time in ms.
 * @returns {string} Formatted relative time.
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);

  if (secondsAgo < 45) return 'Just now';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  return `${Math.floor(secondsAgo / 86400)}d ago`;
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
      id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: activeTab.title ? activeTab.title.trim() : '',
      url: activeTab.url,
      favIconUrl: activeTab.favIconUrl || '',
      stashedAt: Date.now()
    };

    // Synchronize latest state to eliminate race conditions
    const currentTabs = await getStoredTabs();
    const updatedTabs = [newTabEntry, ...currentTabs];

    await saveTabs(updatedTabs);
    await renderStashedList();

    // Setup Undo record
    lastUndoAction = {
      action: 'stash',
      tab: newTabEntry,
      index: 0
    };
    showSnackbar('Tab stashed & closed to free RAM', true);

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
 * Restores all stashed tabs in batch and purges storage.
 * @returns {Promise<void>}
 */
async function handleRestoreAll() {
  try {
    const tabs = await getStoredTabs();
    if (tabs.length === 0) return;

    // Restore in reverse order so original order is preserved in browser
    for (const tab of [...tabs].reverse()) {
      if (tab.url) {
        await chrome.tabs.create({ url: tab.url, active: false });
      }
    }

    await saveTabs([]);
    await renderStashedList();
    showSnackbar(`Restored ${tabs.length} tabs`, false);
  } catch (error) {
    console.error('Error in batch restore:', error);
    showAlert('Failed to restore all tabs.');
  }
}

/**
 * Deletes a stashed tab item without opening it.
 * Supports Undo via snackbar.
 * @param {string} id - Unique identifier of the tab to remove.
 * @returns {Promise<void>}
 */
async function handleDeleteTab(id) {
  try {
    const currentTabs = await getStoredTabs();
    const itemIndex = currentTabs.findIndex((tab) => tab.id === id);
    if (itemIndex === -1) return;

    const [deletedItem] = currentTabs.splice(itemIndex, 1);

    await saveTabs(currentTabs);
    await renderStashedList();

    // Setup Undo record
    lastUndoAction = {
      action: 'delete',
      tab: deletedItem,
      index: itemIndex
    };
    showSnackbar('Tab removed from stash', true);
  } catch (error) {
    console.error('Error deleting tab:', error);
    showAlert('Failed to remove tab from stash.');
  }
}

/**
 * Reverses the last stashing or deletion action.
 * @returns {Promise<void>}
 */
async function handleUndo() {
  if (!lastUndoAction) return;

  try {
    const { action, tab, index } = lastUndoAction;
    const currentTabs = await getStoredTabs();

    if (action === 'delete') {
      // Restore back into storage at original index
      currentTabs.splice(index, 0, tab);
      await saveTabs(currentTabs);
      await renderStashedList();
      showSnackbar('Deletion undone', false);
    } else if (action === 'stash') {
      // Re-open tab in browser and remove from stashed list
      if (tab.url) {
        await chrome.tabs.create({ url: tab.url, active: true });
      }
      const filteredTabs = currentTabs.filter((t) => t.id !== tab.id);
      await saveTabs(filteredTabs);
      await renderStashedList();
      showSnackbar('Stash undone & tab reopened', false);
    }

    lastUndoAction = null;
    if (elements.snackbar) {
      elements.snackbar.classList.remove('show');
    }
  } catch (error) {
    console.error('Error executing undo:', error);
  }
}

/**
 * Copies a tab's URL to the clipboard.
 * @param {string} url - Target URL to copy.
 */
async function handleCopyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    showSnackbar('URL copied to clipboard', false);
  } catch (err) {
    console.error('Failed to copy URL:', err);
  }
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
 * Renders the list of stashed tabs in the popup UI with real-time query filtering.
 * @returns {Promise<void>}
 */
async function renderStashedList() {
  const tabs = await getStoredTabs();
  const { stashedList, tabCount, ramSavedLabel, toolbarContainer, searchInput } = elements;

  if (!stashedList) return;

  const totalCount = tabs.length;

  // Update Header Badges & Memory Estimator
  if (tabCount) {
    tabCount.textContent = String(totalCount);
  }
  if (ramSavedLabel) {
    const ramFreedMb = totalCount * AVG_RAM_PER_TAB_MB;
    ramSavedLabel.textContent = totalCount > 0 ? `~${ramFreedMb} MB RAM freed` : '0 MB RAM freed';
  }

  // Toggle Search/Batch Toolbar when items exist
  if (toolbarContainer) {
    if (totalCount >= 2) {
      toolbarContainer.classList.add('visible');
    } else {
      toolbarContainer.classList.remove('visible');
      if (searchInput) searchInput.value = '';
    }
  }

  // Filter tabs based on search term
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const filteredTabs = query
    ? tabs.filter((t) => (t.title && t.title.toLowerCase().includes(query)) || (t.url && t.url.toLowerCase().includes(query)))
    : tabs;

  // Clear previous DOM nodes
  stashedList.innerHTML = '';

  // Empty State Guard
  if (totalCount === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-illustration">
        <svg viewBox="0 0 24 24">
          <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>
      </div>
      <span class="empty-title">No stashed tabs</span>
      <span class="empty-subtitle">Click "Stash Current Tab" to immediately close idle tabs and reclaim memory.</span>
    `;
    stashedList.appendChild(emptyState);
    return;
  }

  // Search No Matches State
  if (filteredTabs.length === 0 && query) {
    const noMatch = document.createElement('div');
    noMatch.className = 'empty-state';
    noMatch.innerHTML = `
      <span class="empty-title">No matching tabs</span>
      <span class="empty-subtitle">No saved tabs match "${escapeHtml(query)}"</span>
    `;
    stashedList.appendChild(noMatch);
    return;
  }

  // Render individual list items
  filteredTabs.forEach((tab) => {
    const listItem = document.createElement('li');
    listItem.className = 'stashed-item';
    listItem.setAttribute('role', 'button');
    listItem.setAttribute('tabindex', '0');
    listItem.title = `Click to restore: ${tab.title || tab.url}`;

    // Item Main Body (Favicon + Text Details)
    const mainDiv = document.createElement('div');
    mainDiv.className = 'item-main';

    // Favicon container
    const iconWrap = document.createElement('div');
    iconWrap.className = 'favicon-wrap';

    if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
      const img = document.createElement('img');
      img.className = 'item-favicon';
      img.src = tab.favIconUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => {
        img.replaceWith(createFallbackIcon());
      };
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(createFallbackIcon());
    }
    mainDiv.appendChild(iconWrap);

    // Detail group
    const textGroup = document.createElement('div');
    textGroup.className = 'item-text-group';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title';
    titleEl.textContent = tab.title || tab.url;

    const metaEl = document.createElement('div');
    metaEl.className = 'item-meta';

    const domainSpan = document.createElement('span');
    domainSpan.textContent = getHostname(tab.url);

    const separator = document.createElement('span');
    separator.className = 'separator';
    separator.textContent = '•';

    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatRelativeTime(tab.stashedAt);

    metaEl.appendChild(domainSpan);
    metaEl.appendChild(separator);
    metaEl.appendChild(timeSpan);

    textGroup.appendChild(titleEl);
    textGroup.appendChild(metaEl);
    mainDiv.appendChild(textGroup);

    // Clicking main card restores tab
    mainDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRestoreTab(tab.id, tab.url);
    });

    // Action buttons (Copy + Delete)
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'item-actions';

    // Copy Link Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon';
    copyBtn.type = 'button';
    copyBtn.title = 'Copy URL';
    copyBtn.setAttribute('aria-label', 'Copy tab URL');
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
    `;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCopyUrl(tab.url);
    });

    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Remove from stash';
    deleteBtn.setAttribute('aria-label', `Delete ${tab.title || tab.url}`);
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteTab(tab.id);
    });

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(deleteBtn);

    // Keyboard support for restoration
    listItem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleRestoreTab(tab.id, tab.url);
      }
    });

    listItem.appendChild(mainDiv);
    listItem.appendChild(actionsDiv);
    stashedList.appendChild(listItem);
  });
}

/**
 * Escapes HTML characters for safe UI interpolation.
 * @param {string} str - Raw string.
 * @returns {string} Escaped string.
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Event Listeners & Lifecycle Setup
 */
document.addEventListener('DOMContentLoaded', () => {
  // Stash primary action
  if (elements.stashBtn) {
    elements.stashBtn.addEventListener('click', handleStashCurrentTab);
  }

  // Restore All batch action
  if (elements.restoreAllBtn) {
    elements.restoreAllBtn.addEventListener('click', handleRestoreAll);
  }

  // Undo button
  if (elements.snackbarUndoBtn) {
    elements.snackbarUndoBtn.addEventListener('click', handleUndo);
  }

  // Search input and clear action
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', () => {
      if (elements.clearSearchBtn) {
        if (elements.searchInput.value) {
          elements.clearSearchBtn.classList.add('visible');
        } else {
          elements.clearSearchBtn.classList.remove('visible');
        }
      }
      renderStashedList();
    });

    elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.searchInput.value = '';
        if (elements.clearSearchBtn) elements.clearSearchBtn.classList.remove('visible');
        renderStashedList();
      }
    });
  }

  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.addEventListener('click', () => {
      if (elements.searchInput) {
        elements.searchInput.value = '';
        elements.clearSearchBtn.classList.remove('visible');
        elements.searchInput.focus();
        renderStashedList();
      }
    });
  }

  // Initial render
  renderStashedList();
});
