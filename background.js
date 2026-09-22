/**
 * @file background.js
 * @description Service worker for Live Tab Stasher.
 * Manages global keyboard commands, default settings initialization,
 * and badge notifications.
 */

'use strict';

const STORAGE_KEY = 'stashedTabs';
const SETTINGS_KEY = 'userSettings';

const DEFAULT_SETTINGS = {
  groupByDate: true,
  ignorePinnedTabs: true,
  sortBy: 'date-desc',
  closeOnStash: true
};

const RESTRICTED_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'view-source:',
  'devtools://'
];

/**
 * Checks if URL is restricted by browser sandbox.
 * @param {string} [url]
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const lowerUrl = url.trim().toLowerCase();
  return RESTRICTED_SCHEMES.some((scheme) => lowerUrl.startsWith(scheme));
}

/**
 * Retrieves current stored tabs.
 * @returns {Promise<Array<Object>>}
 */
async function getStoredTabs() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

/**
 * Retrieves user settings with defaults.
 * @returns {Promise<Object>}
 */
async function getSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

/**
 * Briefly displays a badge on the action icon to confirm command execution.
 * @param {string} text
 * @param {string} color
 */
async function flashBadge(text, color = '#6366f1') {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(async () => {
      await chrome.action.setBadgeText({ text: '' });
    }, 1500);
  } catch (err) {
    console.debug('Badge update suppressed:', err);
  }
}

/**
 * Stashes the active tab in the currently focused window.
 */
async function stashActiveTab() {
  const currentWindow = await chrome.windows.getLastFocused({ populate: true });
  if (!currentWindow || !currentWindow.tabs) return;

  const activeTab = currentWindow.tabs.find((t) => t.active);
  if (!activeTab || !activeTab.id || isRestrictedUrl(activeTab.url)) {
    await flashBadge('ERR', '#ef4444');
    return;
  }

  const newEntry = {
    id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    title: activeTab.title ? activeTab.title.trim() : '',
    url: activeTab.url,
    favIconUrl: activeTab.favIconUrl || '',
    stashedAt: Date.now(),
    pinned: false
  };

  const tabs = await getStoredTabs();
  await chrome.storage.local.set({ [STORAGE_KEY]: [newEntry, ...tabs] });

  const settings = await getSettings();
  if (settings.closeOnStash) {
    await chrome.tabs.remove(activeTab.id);
  }

  await flashBadge('+1', '#10b981');
}

/**
 * Stashes all eligible tabs in the focused window.
 */
async function stashAllWindows() {
  const currentWindow = await chrome.windows.getLastFocused({ populate: true });
  if (!currentWindow || !currentWindow.tabs) return;

  const settings = await getSettings();
  const eligibleTabs = currentWindow.tabs.filter((tab) => {
    if (!tab.url || isRestrictedUrl(tab.url)) return false;
    if (settings.ignorePinnedTabs && tab.pinned) return false;
    return true;
  });

  if (eligibleTabs.length === 0) {
    await flashBadge('0', '#f59e0b');
    return;
  }

  const now = Date.now();
  const newEntries = eligibleTabs.map((tab, idx) => ({
    id: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `tab_${now}_${idx}`,
    title: tab.title ? tab.title.trim() : '',
    url: tab.url,
    favIconUrl: tab.favIconUrl || '',
    stashedAt: now - idx * 10,
    pinned: false
  }));

  const tabs = await getStoredTabs();
  await chrome.storage.local.set({ [STORAGE_KEY]: [...newEntries, ...tabs] });

  if (settings.closeOnStash) {
    const tabIdsToRemove = eligibleTabs.map((t) => t.id).filter(Boolean);
    await chrome.tabs.remove(tabIdsToRemove);
  }

  await flashBadge(`+${eligibleTabs.length}`, '#10b981');
}

// Lifecycle listeners
chrome.runtime.onInstalled.addListener(async (details) => {
  const currentSettings = await chrome.storage.local.get([SETTINGS_KEY]);
  if (!currentSettings[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
});

// Global keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'stash-current-tab') {
    await stashActiveTab();
  } else if (command === 'stash-all-tabs') {
    await stashAllWindows();
  }
});
