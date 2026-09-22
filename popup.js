/**
 * @file popup.js
 * @description Master controller for Live Tab Stasher.
 * Manages chronological date grouping, smooth accordion states, custom sort popover,
 * domain filter ribbon, batch window stashing, star pinning, persistent settings,
 * JSON/Markdown data export/import, and responsive Side Panel docking.
 */

'use strict';

/**
 * Storage Keys
 */
const STORAGE_KEY = 'stashedTabs';
const SETTINGS_KEY = 'userSettings';

/**
 * Memory Estimator Constant (MB per Chromium tab)
 */
const AVG_RAM_PER_TAB_MB = 95;

/**
 * Default User Settings
 */
const DEFAULT_SETTINGS = {
  groupByDate: true,
  ignorePinnedTabs: true,
  sortBy: 'date-desc',
  closeOnStash: true
};

/**
 * Schemes blocked by browser security sandbox
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
 * Friendly labels for sort options
 */
const SORT_LABELS = {
  'date-desc': 'Newest First',
  'date-asc': 'Oldest First',
  'domain-asc': 'By Domain',
  'title-asc': 'By Title (A-Z)'
};

/**
 * Active in-memory state
 */
let cachedTabs = [];
let cachedSettings = { ...DEFAULT_SETTINGS };
let activeDomainFilter = 'ALL';
let lastUndoAction = null;
let snackbarTimeout = null;
const collapsedFolders = new Set();

/**
 * Cached DOM references
 */
const elements = {
  // Views
  mainView: document.getElementById('mainView'),
  settingsView: document.getElementById('settingsView'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  sidePanelBtn: document.getElementById('sidePanelBtn'),

  // Header status
  tabCount: document.getElementById('tabCount'),
  ramSavedLabel: document.getElementById('ramSavedLabel'),

  // Primary Actions & Popover
  stashBtn: document.getElementById('stashBtn'),
  stashOptionsTrigger: document.getElementById('stashOptionsTrigger'),
  stashOptionsPopover: document.getElementById('stashOptionsPopover'),
  stashAllWindowBtn: document.getElementById('stashAllWindowBtn'),
  stashOtherTabsBtn: document.getElementById('stashOtherTabsBtn'),

  // Alert Banner
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage'),

  // Search & Navigation
  searchNavBar: document.getElementById('searchNavBar'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  viewGroupedBtn: document.getElementById('viewGroupedBtn'),
  viewFlatBtn: document.getElementById('viewFlatBtn'),

  // Sort Popover
  sortTriggerBtn: document.getElementById('sortTriggerBtn'),
  sortLabelText: document.getElementById('sortLabelText'),
  sortPopover: document.getElementById('sortPopover'),

  // Domain Filter Ribbon & Scroll Area
  domainRibbon: document.getElementById('domainRibbon'),
  listScrollArea: document.getElementById('listScrollArea'),
  stashedListContent: document.getElementById('stashedListContent'),

  // Settings view inputs
  settingGroupByDate: document.getElementById('settingGroupByDate'),
  settingIgnorePinned: document.getElementById('settingIgnorePinned'),
  settingCloseOnStash: document.getElementById('settingCloseOnStash'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  exportMarkdownBtn: document.getElementById('exportMarkdownBtn'),
  importJsonBtn: document.getElementById('importJsonBtn'),
  importFileInput: document.getElementById('importFileInput'),
  clearAllDataBtn: document.getElementById('clearAllDataBtn'),

  // Scrim Modal
  clearConfirmModal: document.getElementById('clearConfirmModal'),
  cancelClearBtn: document.getElementById('cancelClearBtn'),
  confirmClearBtn: document.getElementById('confirmClearBtn'),

  // Snackbar
  snackbar: document.getElementById('snackbar'),
  snackbarText: document.getElementById('snackbarText'),
  snackbarUndoBtn: document.getElementById('snackbarUndoBtn')
};

/**
 * Storage helpers
 */
async function loadStoredData() {
  const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY]);
  cachedTabs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  cachedSettings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  return { tabs: cachedTabs, settings: cachedSettings };
}

async function persistTabs(tabs) {
  cachedTabs = tabs;
  await chrome.storage.local.set({ [STORAGE_KEY]: tabs });
}

async function persistSettings(settings) {
  cachedSettings = { ...cachedSettings, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: cachedSettings });
}

/**
 * Checks if URL is restricted by the Chromium sandbox
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.trim().toLowerCase();
  return RESTRICTED_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/**
 * Extracts a clean hostname
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
 * Transient alert banner
 */
function showAlert(message) {
  if (!elements.alertBanner || !elements.alertMessage) return;
  elements.alertMessage.textContent = message;
  elements.alertBanner.classList.add('visible');

  setTimeout(() => {
    if (elements.alertBanner) elements.alertBanner.classList.remove('visible');
  }, 3500);
}

/**
 * Feedback snackbar with optional undo
 */
function showSnackbar(message, showUndo = true) {
  if (!elements.snackbar || !elements.snackbarText) return;
  if (snackbarTimeout) clearTimeout(snackbarTimeout);

  elements.snackbarText.textContent = message;
  elements.snackbarUndoBtn.style.display = showUndo ? 'inline-block' : 'none';
  elements.snackbar.classList.add('show');

  snackbarTimeout = setTimeout(() => {
    if (elements.snackbar) elements.snackbar.classList.remove('show');
    lastUndoAction = null;
  }, 4500);
}

/**
 * Human-readable relative time
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);
  if (secondsAgo < 45) return 'Just now';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Fallback globe SVG icon
 */
function createFallbackIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tab-favicon-fallback');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>';
  return svg;
}

/**
 * Sorts array of tabs
 */
function sortTabsList(tabs, sortKey) {
  const copy = [...tabs];
  switch (sortKey) {
    case 'date-asc':
      return copy.sort((a, b) => (a.stashedAt || 0) - (b.stashedAt || 0));
    case 'domain-asc':
      return copy.sort((a, b) => getHostname(a.url).localeCompare(getHostname(b.url)));
    case 'title-asc':
      return copy.sort((a, b) => (a.title || a.url || '').localeCompare(b.title || b.url || ''));
    case 'date-desc':
    default:
      return copy.sort((a, b) => (b.stashedAt || 0) - (a.stashedAt || 0));
  }
}

/**
 * Partition tabs into chronological folders
 */
function groupTabsChronologically(tabs) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfPastWeek = startOfToday - 7 * 86400000;

  const groups = {
    pinned: [],
    today: [],
    yesterday: [],
    pastWeek: [],
    older: []
  };

  for (const tab of tabs) {
    if (tab.pinned) {
      groups.pinned.push(tab);
      continue;
    }
    const t = tab.stashedAt || 0;
    if (t >= startOfToday) {
      groups.today.push(tab);
    } else if (t >= startOfYesterday) {
      groups.yesterday.push(tab);
    } else if (t >= startOfPastWeek) {
      groups.pastWeek.push(tab);
    } else {
      groups.older.push(tab);
    }
  }

  return groups;
}

/**
 * Stash Single Active Tab
 */
async function handleStashCurrentTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      showAlert('No active tab detected in current window.');
      return;
    }
    if (isRestrictedUrl(activeTab.url)) {
      showAlert('Restricted browser page cannot be stashed.');
      return;
    }

    const newTabEntry = {
      id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: activeTab.title ? activeTab.title.trim() : '',
      url: activeTab.url,
      favIconUrl: activeTab.favIconUrl || '',
      stashedAt: Date.now(),
      pinned: false
    };

    const updatedTabs = [newTabEntry, ...cachedTabs];
    await persistTabs(updatedTabs);
    await renderUI();

    lastUndoAction = {
      action: 'stash',
      tab: newTabEntry
    };
    showSnackbar('Tab stashed & closed to free RAM', true);

    if (cachedSettings.closeOnStash) {
      await chrome.tabs.remove(activeTab.id);
    }
  } catch (error) {
    console.error('Error in handleStashCurrentTab:', error);
    showAlert('Failed to stash current tab.');
  }
}

/**
 * Stash All Tabs in Current Window
 */
async function handleStashAllWindows() {
  try {
    closeAllPopovers();
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    if (!currentWindow || !currentWindow.tabs) return;

    const eligible = currentWindow.tabs.filter((t) => {
      if (!t.url || isRestrictedUrl(t.url)) return false;
      if (cachedSettings.ignorePinnedTabs && t.pinned) return false;
      return true;
    });

    if (eligible.length === 0) {
      showAlert('No eligible tabs found in this window.');
      return;
    }

    const now = Date.now();
    const newEntries = eligible.map((tab, idx) => ({
      id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${now}_${idx}`,
      title: tab.title ? tab.title.trim() : '',
      url: tab.url,
      favIconUrl: tab.favIconUrl || '',
      stashedAt: now - idx * 10,
      pinned: false
    }));

    await persistTabs([...newEntries, ...cachedTabs]);
    await renderUI();

    lastUndoAction = {
      action: 'stash-batch',
      tabs: newEntries
    };
    showSnackbar(`Stashed ${newEntries.length} tabs into memory`, true);

    if (cachedSettings.closeOnStash) {
      const ids = eligible.map((t) => t.id).filter(Boolean);
      await chrome.tabs.remove(ids);
    }
  } catch (err) {
    console.error('Failed to stash window tabs:', err);
    showAlert('Failed to stash window tabs.');
  }
}

/**
 * Stash Other Tabs (keep active tab open)
 */
async function handleStashOtherTabs() {
  try {
    closeAllPopovers();
    const currentWindow = await chrome.windows.getCurrent({ populate: true });
    if (!currentWindow || !currentWindow.tabs) return;

    const activeTab = currentWindow.tabs.find((t) => t.active);
    const eligible = currentWindow.tabs.filter((t) => {
      if (activeTab && t.id === activeTab.id) return false;
      if (!t.url || isRestrictedUrl(t.url)) return false;
      if (cachedSettings.ignorePinnedTabs && t.pinned) return false;
      return true;
    });

    if (eligible.length === 0) {
      showAlert('No other tabs eligible for stashing.');
      return;
    }

    const now = Date.now();
    const newEntries = eligible.map((tab, idx) => ({
      id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${now}_${idx}`,
      title: tab.title ? tab.title.trim() : '',
      url: tab.url,
      favIconUrl: tab.favIconUrl || '',
      stashedAt: now - idx * 10,
      pinned: false
    }));

    await persistTabs([...newEntries, ...cachedTabs]);
    await renderUI();

    lastUndoAction = {
      action: 'stash-batch',
      tabs: newEntries
    };
    showSnackbar(`Stashed ${newEntries.length} background tabs`, true);

    if (cachedSettings.closeOnStash) {
      const ids = eligible.map((t) => t.id).filter(Boolean);
      await chrome.tabs.remove(ids);
    }
  } catch (err) {
    console.error('Failed to stash other tabs:', err);
    showAlert('Failed to stash other tabs.');
  }
}

/**
 * Restore Single Tab
 */
async function handleRestoreTab(id, url) {
  try {
    await chrome.tabs.create({ url, active: true });
    const tabIndex = cachedTabs.findIndex((t) => t.id === id);
    if (tabIndex !== -1) {
      const removedTab = cachedTabs[tabIndex];
      const updatedTabs = cachedTabs.filter((t) => t.id !== id);
      await persistTabs(updatedTabs);
      await renderUI();

      lastUndoAction = {
        action: 'restore-single',
        tab: removedTab,
        index: tabIndex
      };
      showSnackbar('Tab restored', true);
    }
  } catch (error) {
    console.error('Error restoring tab:', error);
    showAlert('Failed to restore tab.');
  }
}

/**
 * Restore an Entire Folder Group
 */
async function handleRestoreGroup(groupTabs, groupTitle) {
  if (!groupTabs || groupTabs.length === 0) return;

  try {
    for (const tab of [...groupTabs].reverse()) {
      if (tab.url) {
        await chrome.tabs.create({ url: tab.url, active: false });
      }
    }

    const groupIds = new Set(groupTabs.map((t) => t.id));
    const remainingTabs = cachedTabs.filter((t) => !groupIds.has(t.id));
    await persistTabs(remainingTabs);
    await renderUI();

    lastUndoAction = {
      action: 'restore-group',
      tabs: groupTabs
    };
    showSnackbar(`Restored ${groupTabs.length} tabs from ${groupTitle}`, true);
  } catch (err) {
    console.error('Error in handleRestoreGroup:', err);
    showAlert('Failed to restore group.');
  }
}

/**
 * Delete Single Tab
 */
async function handleDeleteTab(id) {
  try {
    const itemIndex = cachedTabs.findIndex((tab) => tab.id === id);
    if (itemIndex === -1) return;

    const [deletedItem] = cachedTabs.splice(itemIndex, 1);
    await persistTabs(cachedTabs);
    await renderUI();

    lastUndoAction = {
      action: 'delete',
      tab: deletedItem,
      index: itemIndex
    };
    showSnackbar('Tab removed from stash', true);
  } catch (error) {
    console.error('Error deleting tab:', error);
    showAlert('Failed to remove tab.');
  }
}

/**
 * Toggle Star / Pin
 */
async function handleTogglePin(id) {
  const target = cachedTabs.find((t) => t.id === id);
  if (!target) return;

  target.pinned = !target.pinned;
  await persistTabs(cachedTabs);
  await renderUI();
  showSnackbar(target.pinned ? 'Tab pinned to top' : 'Tab unpinned', false);
}

/**
 * Copy Tab URL to clipboard
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
 * Reversal / Undo Action
 */
async function handleUndo() {
  if (!lastUndoAction) return;

  try {
    const { action, tab, tabs, index } = lastUndoAction;

    if (action === 'delete') {
      cachedTabs.splice(index, 0, tab);
      await persistTabs(cachedTabs);
      await renderUI();
      showSnackbar('Deletion undone', false);
    } else if (action === 'stash') {
      if (tab.url) {
        await chrome.tabs.create({ url: tab.url, active: true });
      }
      const filtered = cachedTabs.filter((t) => t.id !== tab.id);
      await persistTabs(filtered);
      await renderUI();
      showSnackbar('Stash undone & tab reopened', false);
    } else if (action === 'stash-batch') {
      for (const t of tabs) {
        if (t.url) await chrome.tabs.create({ url: t.url, active: false });
      }
      const ids = new Set(tabs.map((t) => t.id));
      const filtered = cachedTabs.filter((t) => !ids.has(t.id));
      await persistTabs(filtered);
      await renderUI();
      showSnackbar('Batch stash undone', false);
    } else if (action === 'restore-single') {
      cachedTabs.splice(index, 0, tab);
      await persistTabs(cachedTabs);
      await renderUI();
      showSnackbar('Re-stashed tab', false);
    } else if (action === 'restore-group') {
      await persistTabs([...tabs, ...cachedTabs]);
      await renderUI();
      showSnackbar('Re-stashed group tabs', false);
    } else if (action === 'clear-all') {
      await persistTabs(tabs);
      await renderUI();
      showSnackbar('Restored all cleared tabs', false);
    }

    lastUndoAction = null;
    elements.snackbar.classList.remove('show');
  } catch (error) {
    console.error('Error executing undo:', error);
  }
}

/**
 * Builds Individual Tab Card
 */
function createTabElement(tab) {
  const card = document.createElement('div');
  card.className = `tab-card ${tab.pinned ? 'is-starred' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.title = `Click to restore: ${tab.title || tab.url}`;

  // Main Column
  const mainCol = document.createElement('div');
  mainCol.className = 'tab-main-col';

  // Favicon Box
  const favBox = document.createElement('div');
  favBox.className = 'tab-favicon-box';

  if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.src = tab.favIconUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => {
      img.replaceWith(createFallbackIcon());
    };
    favBox.appendChild(img);
  } else {
    favBox.appendChild(createFallbackIcon());
  }
  mainCol.appendChild(favBox);

  // Text Group
  const infoGroup = document.createElement('div');
  infoGroup.className = 'tab-info-group';

  const titleEl = document.createElement('div');
  titleEl.className = 'tab-title-text';
  titleEl.textContent = tab.title || tab.url;

  const metaRow = document.createElement('div');
  metaRow.className = 'tab-meta-row';

  const domainSpan = document.createElement('span');
  domainSpan.className = 'domain-name';
  domainSpan.textContent = getHostname(tab.url);

  const dot = document.createElement('span');
  dot.className = 'tab-meta-dot';
  dot.textContent = '•';

  const timeSpan = document.createElement('span');
  timeSpan.textContent = formatRelativeTime(tab.stashedAt);

  metaRow.appendChild(domainSpan);
  metaRow.appendChild(dot);
  metaRow.appendChild(timeSpan);

  infoGroup.appendChild(titleEl);
  infoGroup.appendChild(metaRow);
  mainCol.appendChild(infoGroup);

  // Click card to restore
  mainCol.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRestoreTab(tab.id, tab.url);
  });

  // Actions
  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'tab-actions-group';

  // Star / Pin Button
  const starBtn = document.createElement('button');
  starBtn.className = `action-icon-btn ${tab.pinned ? 'starred' : ''}`;
  starBtn.type = 'button';
  starBtn.title = tab.pinned ? 'Unpin tab' : 'Pin to top';
  starBtn.setAttribute('aria-label', tab.pinned ? 'Unpin tab' : 'Pin tab');
  starBtn.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="${tab.pinned ? 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' : 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'}"/>
    </svg>
  `;
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTogglePin(tab.id);
  });

  // Copy URL Button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'action-icon-btn';
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
  deleteBtn.className = 'action-icon-btn delete';
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

  actionsGroup.appendChild(starBtn);
  actionsGroup.appendChild(copyBtn);
  actionsGroup.appendChild(deleteBtn);

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRestoreTab(tab.id, tab.url);
    }
  });

  card.appendChild(mainCol);
  card.appendChild(actionsGroup);
  return card;
}

/**
 * Builds Accordion Section Group
 */
function createFolderElement(groupId, title, groupTabs, isPinned = false) {
  const section = document.createElement('div');
  const isCollapsed = collapsedFolders.has(groupId);
  section.className = `date-section ${isCollapsed ? 'collapsed' : ''}`;

  const header = document.createElement('header');
  header.className = 'section-header';

  // Left Title
  const titleWrap = document.createElement('div');
  titleWrap.className = 'section-title-wrap';

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'section-chevron');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.innerHTML = '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>';

  const titleEl = document.createElement('span');
  titleEl.className = 'section-title';
  titleEl.textContent = title;

  const countBadge = document.createElement('span');
  countBadge.className = 'section-badge';
  countBadge.textContent = `${groupTabs.length}`;

  titleWrap.appendChild(chevron);
  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(countBadge);

  // Right Restore Button
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn-section-restore';
  restoreBtn.type = 'button';
  restoreBtn.title = `Restore all tabs in ${title}`;
  restoreBtn.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
    </svg>
    <span>Restore</span>
  `;
  restoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRestoreGroup(groupTabs, title);
  });

  header.appendChild(titleWrap);
  header.appendChild(restoreBtn);

  // Accordion toggle
  header.addEventListener('click', () => {
    if (collapsedFolders.has(groupId)) {
      collapsedFolders.delete(groupId);
      section.classList.remove('collapsed');
    } else {
      collapsedFolders.add(groupId);
      section.classList.add('collapsed');
    }
  });

  // Body container
  const content = document.createElement('div');
  content.className = 'section-content';

  groupTabs.forEach((tab) => {
    content.appendChild(createTabElement(tab));
  });

  section.appendChild(header);
  section.appendChild(content);

  return section;
}

/**
 * Builds Domain Filter Ribbon
 */
function renderDomainRibbon(tabs) {
  const container = elements.domainRibbon;
  if (!container) return;

  if (tabs.length < 3) {
    container.classList.remove('visible');
    container.innerHTML = '';
    return;
  }

  const counts = {};
  for (const t of tabs) {
    const domain = getHostname(t.url);
    if (domain) counts[domain] = (counts[domain] || 0) + 1;
  }

  const sortedDomains = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (sortedDomains.length <= 1) {
    container.classList.remove('visible');
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  container.classList.add('visible');

  // "All" chip
  const allChip = document.createElement('button');
  allChip.className = `domain-chip ${activeDomainFilter === 'ALL' ? 'active' : ''}`;
  allChip.textContent = `All (${tabs.length})`;
  allChip.type = 'button';
  allChip.addEventListener('click', () => {
    activeDomainFilter = 'ALL';
    renderUI();
  });
  container.appendChild(allChip);

  // Top domain chips
  for (const [domain, count] of sortedDomains) {
    const chip = document.createElement('button');
    chip.className = `domain-chip ${activeDomainFilter === domain ? 'active' : ''}`;
    chip.textContent = `${domain} (${count})`;
    chip.type = 'button';
    chip.addEventListener('click', () => {
      activeDomainFilter = activeDomainFilter === domain ? 'ALL' : domain;
      renderUI();
    });
    container.appendChild(chip);
  }
}

/**
 * Close any active popovers
 */
function closeAllPopovers() {
  if (elements.stashOptionsPopover) {
    elements.stashOptionsPopover.classList.remove('visible');
  }
  if (elements.stashOptionsTrigger) {
    elements.stashOptionsTrigger.classList.remove('active');
    elements.stashOptionsTrigger.setAttribute('aria-expanded', 'false');
  }
  if (elements.sortPopover) {
    elements.sortPopover.classList.remove('visible');
  }
  if (elements.sortTriggerBtn) {
    elements.sortTriggerBtn.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Master UI Render Engine
 */
async function renderUI() {
  const { stashedListContent, tabCount, ramSavedLabel, searchInput } = elements;
  if (!stashedListContent) return;

  const totalCount = cachedTabs.length;

  // Header status counters
  if (tabCount) tabCount.textContent = `${totalCount} tab${totalCount !== 1 ? 's' : ''}`;
  if (ramSavedLabel) {
    const ramMb = totalCount * AVG_RAM_PER_TAB_MB;
    if (ramMb >= 1000) {
      ramSavedLabel.textContent = `~${(ramMb / 1024).toFixed(1)} GB freed`;
    } else {
      ramSavedLabel.textContent = `~${ramMb} MB freed`;
    }
  }

  // Update sort label text
  if (elements.sortLabelText) {
    elements.sortLabelText.textContent = SORT_LABELS[cachedSettings.sortBy] || 'Newest First';
  }

  // Query & Domain filtering
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  let filtered = [...cachedTabs];

  if (activeDomainFilter !== 'ALL') {
    filtered = filtered.filter((t) => getHostname(t.url) === activeDomainFilter);
  }

  if (query) {
    filtered = filtered.filter((t) => (t.title && t.title.toLowerCase().includes(query)) || (t.url && t.url.toLowerCase().includes(query)));
  }

  // Domain Filter Ribbon
  renderDomainRibbon(cachedTabs);

  // Apply sorting
  filtered = sortTabsList(filtered, cachedSettings.sortBy);

  // Clear previous list
  stashedListContent.innerHTML = '';

  // Empty state guard
  if (totalCount === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state-view';
    emptyState.innerHTML = `
      <div class="empty-icon-wrap">
        <svg viewBox="0 0 24 24">
          <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>
      </div>
      <span class="empty-heading">No Stashed Tabs</span>
      <span class="empty-detail">Stash open tabs to clear browser clutter and instantly free system RAM.</span>
    `;
    stashedListContent.appendChild(emptyState);
    return;
  }

  // Search no match
  if (filtered.length === 0) {
    const noMatch = document.createElement('div');
    noMatch.className = 'empty-state-view';
    noMatch.innerHTML = `
      <span class="empty-heading">No Matching Tabs</span>
      <span class="empty-detail">No tabs match your active query or domain filter.</span>
    `;
    stashedListContent.appendChild(noMatch);
    return;
  }

  // Render Folders vs Flat View
  if (cachedSettings.groupByDate && !query) {
    const groups = groupTabsChronologically(filtered);

    if (groups.pinned.length > 0) {
      stashedListContent.appendChild(
        createFolderElement('group_pinned', 'Pinned Tabs ⭐', groups.pinned, true)
      );
    }
    if (groups.today.length > 0) {
      stashedListContent.appendChild(
        createFolderElement('group_today', 'Today', groups.today)
      );
    }
    if (groups.yesterday.length > 0) {
      stashedListContent.appendChild(
        createFolderElement('group_yesterday', 'Yesterday', groups.yesterday)
      );
    }
    if (groups.pastWeek.length > 0) {
      stashedListContent.appendChild(
        createFolderElement('group_week', 'Previous 7 Days', groups.pastWeek)
      );
    }
    if (groups.older.length > 0) {
      stashedListContent.appendChild(
        createFolderElement('group_older', 'Older Tabs', groups.older)
      );
    }
  } else {
    // Flat List View
    const flatList = document.createElement('div');
    flatList.className = 'flat-list-group';
    filtered.forEach((tab) => {
      flatList.appendChild(createTabElement(tab));
    });
    stashedListContent.appendChild(flatList);
  }
}

/**
 * Export JSON backup
 */
function handleExportJSON() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cachedTabs, null, 2));
  const downloadAnchor = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `live-tab-stasher-backup-${dateStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showSnackbar('Exported JSON backup', false);
}

/**
 * Export Markdown bookmarks
 */
function handleExportMarkdown() {
  const lines = ['# Live Tab Stasher Bookmarks\n'];
  for (const t of cachedTabs) {
    const title = t.title || t.url;
    const date = new Date(t.stashedAt || Date.now()).toLocaleDateString();
    lines.push(`- [${title.replace(/[[\]]/g, '')}](${t.url}) - *Stashed: ${date}*`);
  }
  const dataStr = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  const downloadAnchor = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `live-tab-stasher-bookmarks-${dateStr}.md`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showSnackbar('Exported Markdown bookmarks', false);
}

/**
 * Import JSON backup
 */
async function handleImportFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) {
      showAlert('Invalid JSON format: Expected array of tabs.');
      return;
    }

    const existingUrls = new Set(cachedTabs.map((t) => t.url));
    const newItems = [];

    for (const item of imported) {
      if (item && item.url && !existingUrls.has(item.url)) {
        newItems.push({
          id: item.id || `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          title: item.title || item.url,
          url: item.url,
          favIconUrl: item.favIconUrl || '',
          stashedAt: item.stashedAt || Date.now(),
          pinned: Boolean(item.pinned)
        });
        existingUrls.add(item.url);
      }
    }

    const merged = [...newItems, ...cachedTabs];
    await persistTabs(merged);
    await renderUI();
    showSnackbar(`Imported ${newItems.length} new tabs`, false);
  } catch (err) {
    console.error('Import parse error:', err);
    showAlert('Failed to parse backup JSON file.');
  }
}

/**
 * Chrome Side Panel Docking
 */
async function handleOpenSidePanel() {
  try {
    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
      const currentWin = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWin.id });
      window.close();
    } else {
      showAlert('Side panel is not supported in this Chromium version.');
    }
  } catch (err) {
    console.error('Side panel open failed:', err);
    showAlert('Could not open side panel.');
  }
}

/**
 * Event Listeners & Bootstrapping
 */
document.addEventListener('DOMContentLoaded', async () => {
  await loadStoredData();

  // Primary Stash Active Tab
  if (elements.stashBtn) {
    elements.stashBtn.addEventListener('click', handleStashCurrentTab);
  }

  // Stash Options Trigger
  if (elements.stashOptionsTrigger) {
    elements.stashOptionsTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = elements.stashOptionsPopover.classList.contains('visible');
      closeAllPopovers();
      if (!isVisible) {
        elements.stashOptionsPopover.classList.add('visible');
        elements.stashOptionsTrigger.classList.add('active');
        elements.stashOptionsTrigger.setAttribute('aria-expanded', 'true');
      }
    });
  }

  if (elements.stashAllWindowBtn) {
    elements.stashAllWindowBtn.addEventListener('click', handleStashAllWindows);
  }

  if (elements.stashOtherTabsBtn) {
    elements.stashOtherTabsBtn.addEventListener('click', handleStashOtherTabs);
  }

  // Sort Popover Trigger
  if (elements.sortTriggerBtn) {
    elements.sortTriggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = elements.sortPopover.classList.contains('visible');
      closeAllPopovers();
      if (!isVisible) {
        elements.sortPopover.classList.add('visible');
        elements.sortTriggerBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  if (elements.sortPopover) {
    elements.sortPopover.querySelectorAll('.popover-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        const sortKey = e.currentTarget.getAttribute('data-sort');
        if (sortKey) {
          await persistSettings({ sortBy: sortKey });
          closeAllPopovers();
          renderUI();
        }
      });
    });
  }

  // Global dismiss popovers on click outside
  document.addEventListener('click', (e) => {
    if (elements.stashOptionsPopover && !elements.stashOptionsPopover.contains(e.target) && e.target !== elements.stashOptionsTrigger) {
      elements.stashOptionsPopover.classList.remove('visible');
      if (elements.stashOptionsTrigger) {
        elements.stashOptionsTrigger.classList.remove('active');
        elements.stashOptionsTrigger.setAttribute('aria-expanded', 'false');
      }
    }
    if (elements.sortPopover && !elements.sortPopover.contains(e.target) && e.target !== elements.sortTriggerBtn) {
      elements.sortPopover.classList.remove('visible');
      if (elements.sortTriggerBtn) {
        elements.sortTriggerBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Side Panel Trigger
  if (elements.sidePanelBtn) {
    elements.sidePanelBtn.addEventListener('click', handleOpenSidePanel);
  }

  // Settings View Navigation
  if (elements.openSettingsBtn) {
    elements.openSettingsBtn.addEventListener('click', () => {
      closeAllPopovers();
      elements.mainView.classList.add('hidden');
      elements.settingsView.classList.remove('hidden');
      elements.settingGroupByDate.checked = cachedSettings.groupByDate;
      elements.settingIgnorePinned.checked = cachedSettings.ignorePinnedTabs;
      elements.settingCloseOnStash.checked = cachedSettings.closeOnStash;
    });
  }

  if (elements.closeSettingsBtn) {
    elements.closeSettingsBtn.addEventListener('click', () => {
      elements.settingsView.classList.add('hidden');
      elements.mainView.classList.remove('hidden');
      renderUI();
    });
  }

  // View Mode: Folders vs Flat
  if (elements.viewGroupedBtn && elements.viewFlatBtn) {
    elements.viewGroupedBtn.addEventListener('click', async () => {
      elements.viewGroupedBtn.classList.add('active');
      elements.viewFlatBtn.classList.remove('active');
      await persistSettings({ groupByDate: true });
      renderUI();
    });

    elements.viewFlatBtn.addEventListener('click', async () => {
      elements.viewFlatBtn.classList.add('active');
      elements.viewGroupedBtn.classList.remove('active');
      await persistSettings({ groupByDate: false });
      renderUI();
    });

    if (cachedSettings.groupByDate) {
      elements.viewGroupedBtn.classList.add('active');
      elements.viewFlatBtn.classList.remove('active');
    } else {
      elements.viewFlatBtn.classList.add('active');
      elements.viewGroupedBtn.classList.remove('active');
    }
  }

  // Search Input & Shortcuts
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', () => {
      if (elements.searchInput.value) {
        elements.clearSearchBtn.classList.add('visible');
      } else {
        elements.clearSearchBtn.classList.remove('visible');
      }
      renderUI();
    });

    elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        elements.searchInput.value = '';
        elements.clearSearchBtn.classList.remove('visible');
        elements.searchInput.blur();
        renderUI();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== elements.searchInput) {
        e.preventDefault();
        elements.searchInput.focus();
      }
    });
  }

  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      elements.clearSearchBtn.classList.remove('visible');
      elements.searchInput.focus();
      renderUI();
    });
  }

  // Settings Toggles
  if (elements.settingGroupByDate) {
    elements.settingGroupByDate.addEventListener('change', async (e) => {
      await persistSettings({ groupByDate: e.target.checked });
      if (elements.viewGroupedBtn && elements.viewFlatBtn) {
        if (e.target.checked) {
          elements.viewGroupedBtn.classList.add('active');
          elements.viewFlatBtn.classList.remove('active');
        } else {
          elements.viewFlatBtn.classList.add('active');
          elements.viewGroupedBtn.classList.remove('active');
        }
      }
    });
  }

  if (elements.settingIgnorePinned) {
    elements.settingIgnorePinned.addEventListener('change', async (e) => {
      await persistSettings({ ignorePinnedTabs: e.target.checked });
    });
  }

  if (elements.settingCloseOnStash) {
    elements.settingCloseOnStash.addEventListener('change', async (e) => {
      await persistSettings({ closeOnStash: e.target.checked });
    });
  }

  // Export / Import
  if (elements.exportJsonBtn) {
    elements.exportJsonBtn.addEventListener('click', handleExportJSON);
  }

  if (elements.exportMarkdownBtn) {
    elements.exportMarkdownBtn.addEventListener('click', handleExportMarkdown);
  }

  if (elements.importJsonBtn && elements.importFileInput) {
    elements.importJsonBtn.addEventListener('click', () => {
      elements.importFileInput.click();
    });

    elements.importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImportFile(file);
      elements.importFileInput.value = '';
    });
  }

  // Purge Modal
  if (elements.clearAllDataBtn) {
    elements.clearAllDataBtn.addEventListener('click', () => {
      elements.clearConfirmModal.classList.add('visible');
    });
  }

  if (elements.cancelClearBtn) {
    elements.cancelClearBtn.addEventListener('click', () => {
      elements.clearConfirmModal.classList.remove('visible');
    });
  }

  if (elements.confirmClearBtn) {
    elements.confirmClearBtn.addEventListener('click', async () => {
      const previousTabs = [...cachedTabs];
      elements.clearConfirmModal.classList.remove('visible');
      await persistTabs([]);
      await renderUI();
      lastUndoAction = {
        action: 'clear-all',
        tabs: previousTabs
      };
      showSnackbar('All stashed tabs deleted', true);
    });
  }

  // Undo button
  if (elements.snackbarUndoBtn) {
    elements.snackbarUndoBtn.addEventListener('click', handleUndo);
  }

  // Initial render
  await renderUI();
});
