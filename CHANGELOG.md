# Changelog

## [v1.1.4] - 2026-04-13

### Fixed
- **Viewer not updating when toggling pages**: When disabling a page with Delete key, the viewer now properly scrolls to show the newly selected page instead of showing a blank screen
- **HStrip/VStrip mode not refreshing images**: `loadHStripWindow` and `loadVStripWindow` now properly update all pages in the visible window, including disabled pages and already-loaded images
- **Arrow keys navigating in modal**: Keyboard navigation is now properly ignored when a modal dialog is open

## [1.1.3] - 2026-03-19

### Fixed
- **Clipboard copy failing with "operation is insecure"**: Fixed clipboard functionality for bridge URLs by adding proper CORS handling for http://localhost URLs
