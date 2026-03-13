# CBX Tool 📚

**CBX Tool** is a desktop comic reader and lightweight editor for `.cbz`, `.cbr`, and image-folder workflows. It is built for fast loading, clean navigation, and quick archive editing without leaving the app.

## Features ✨

### Main Features

-   **Archive and folder support**: Open `.cbz`, `.cbr`, and raw image folders directly.
-   **Fast vertical reading**: Read comics in a smooth stacked-image viewer optimized for quick scrolling.
-   **Flexible viewing modes**: Switch between **Fit to Height** and **Fit to Width**, with optional auto-scroll and adjustable speed in width mode.
-   **Page management tools**: Reorder pages with drag and drop, remove or restore pages, reset to the original order, and add multiple new image pages from the sidebar.
-   **Save and export workflows**: Save changes back to the archive, use **Save File As** to rename output before writing, extract archive contents to a folder, or convert an image folder into a `.cbz`.

### Other Features

-   **Progress-aware navigation**: A page progress bar and synced page list make it easier to track position in long chapters.
-   **Recent files**: Reopen recently used comics from the landing screen, and clear the recent history when needed.
-   **Keyboard and drag-and-drop support**: Use keyboard shortcuts for navigation and quick actions, or open files by dropping them onto the landing screen.
-   **Lightweight desktop stack**: Built with [Electrobun](https://electrobun.sh/) and Bun for fast startup and low overhead.

## Installation 🚀

Download the latest build for your platform from the [Releases](https://github.com/jebin2/cbx-tool/releases) page.

-   **Linux**: Download `CBX-Tool-Linux.sh`, make it executable with `chmod +x`, then run it.
-   **macOS**: Download `CBX-Tool-macOS.dmg` and drag the app into `Applications`.
-   **Windows**: Download `CBX-Tool-Windows.exe` and run the installer.

## Development 🛠️

To run the project locally:

1.  Install dependencies:
    ```bash
    bun install
    ```
2.  Start the development app:
    ```bash
    bun start
    ```
3.  Build a local production bundle:
    ```bash
    bun run build
    ```
4.  Build the stable release artifacts:
    ```bash
    bun run build:stable
    ```

---
Built for comic reading and quick archive editing.
