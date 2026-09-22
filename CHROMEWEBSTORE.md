# Chrome Web Store Listing — Live Tab Stasher

> Last Updated: 2026-09-22

## Store Listing

**Extension Name**
Live Tab Stasher

**Short Description**
Stashes active and background tabs to free RAM immediately, organized in date folders with search, side panel, and instant restore.

**Detailed Description**
Live Tab Stasher is a high-performance session manager and RAM optimizer built with Chromium Manifest V3. It helps power users instantly free hundreds of megabytes of browser memory by stashing inactive tabs to local storage and terminating their processes immediately.

Key features:
• Date-based folder organization (Today, Yesterday, Previous 7 Days, Older)
• Star & Pin priority tabs to anchor them to the top
• Side panel support for persistent tab management alongside browsing
• One-click "Stash Current Tab" and "Stash Window Tabs"
• Multi-mode sorting (Newest, Oldest, Domain, Alphabetical)
• Domain filter chips and instant real-time search
• Data portability with JSON and Markdown bookmark exports
• Reversible actions with instant Undo snackbar buffer
• Keyboard shortcuts (Alt+Shift+S to stash active tab, Alt+Shift+A to stash window)
• Zero external tracking, zero dependencies, and 100% local on-device storage

How to use:
1. Click the Live Tab Stasher icon in your browser toolbar or press Alt+Shift+S.
2. The active tab is closed instantly to reclaim RAM and saved into your chronological stash.
3. Click any stashed tab to restore it in a new browser tab.
4. Click the Side Panel icon in the header to dock your stash beside your web pages.
5. Use Settings to customize tab grouping, toggle pinned-tab protection, or export backups.

Privacy & Data Use:
Live Tab Stasher operates entirely offline. All data is saved exclusively inside your browser's local storage (chrome.storage.local). No data ever leaves your computer.

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Small Icon | 16×16 PNG | ✅ Ready | `icons/icon16.png` |
| Medium Icon | 32×32 PNG | ✅ Ready | `icons/icon32.png` |
| Large Icon | 48×48 PNG | ✅ Ready | `icons/icon48.png` |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Required to read the active tab URL and title when stashing, and to close stashed tabs to reclaim RAM. |
| `storage` | permissions | Required to persist stashed tab metadata and user organization settings locally in `chrome.storage.local`. |
| `sidePanel` | permissions | Required to allow users to open and pin the stasher interface in the browser side panel. |

## Privacy & Data Use

**Does the extension collect user data?**
No.

- No analytics, telemetry, or remote tracking scripts.
- No network requests made off-device.
- All tab data and settings remain on the local machine in Chromium's sandbox.

## Version History

- **v1.2.0** (2026-09-22): Added chronological date folders, star/pin prioritization, side panel integration, bulk window stashing, domain filter chips, dedicated settings & backup screen, and global keyboard shortcuts.
- **v1.1.0**: Initial release with single-tab stashing, instant search, and Material 3 design tokens.
