# Changelog

## [v1.2.3] - 2026-07-04

### Added
- **Reading position persistence**: Automatically save and resume reading position for each file across sessions
- **View preferences persistence**: Remember fit mode, view mode (vstrip/hstrip/spread), and auto-scroll speed

### Improved
- **On-demand CBZ streaming**: Pages decompressed and served on-demand via HTTP bridge instead of full extraction, reducing startup time and memory usage
- **Lazy sidebar thumbnails**: Downscaled thumbnails (128px) generated only when tiles scroll into view, preventing OOM on large books
- **Parallel page fetching**: Save and PDF export now fetch pages in parallel batches of 8, with progress reporting
- **Resize handling**: Strip layouts automatically reinitialize when viewer dimensions change, fixing startup race conditions
- **Frame-rate independence**: Auto-scroll now uses elapsed time instead of fixed pixels-per-frame for consistent speed on any display

### Fixed
- **Auto-scroll speed consistency**: Independent of display refresh rate
- **Scrollend fallback**: Falls back to debounced scroll listener on browsers without scrollend support
- **Page ordering**: Natural sort applied to both CBZ (drag-and-drop) and CBR extraction paths

## [v1.1.4] - 2026-04-13

### Fixed
- **Viewer not updating when toggling pages**: When disabling a page with Delete key, the viewer now properly scrolls to show the newly selected page instead of showing a blank screen
- **HStrip/VStrip mode not refreshing images**: `loadHStripWindow` and `loadVStripWindow` now properly update all pages in the visible window, including disabled pages and already-loaded images
- **Arrow keys navigating in modal**: Keyboard navigation is now properly ignored when a modal dialog is open

## [1.1.3] - 2026-03-19

### Fixed
- **Clipboard copy failing with "operation is insecure"**: Fixed clipboard functionality for bridge URLs by adding proper CORS handling for http://localhost URLs
