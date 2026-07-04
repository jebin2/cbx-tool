import { state } from "./state.ts";

const SAVE_DEBOUNCE_MS = 1000;

let saveTimer: number | null = null;
let lastSavedIndex = -1;

function saveNow() {
  if (!state.rpc || !state.currentFilePath) return;
  const pageIndex = state.selectedPageIndex;
  if (pageIndex < 0 || pageIndex === lastSavedIndex) return;
  lastSavedIndex = pageIndex;
  void state.rpc.request
    .saveReadingPosition({
      filePath: state.currentFilePath,
      pageIndex,
      totalPages: state.pages.length,
    })
    .catch((error) => console.error("Failed to save reading position:", error));
}

/** Debounced save of the current page — call whenever the selected page changes. */
export function scheduleReadingPositionSave() {
  if (!state.rpc || !state.currentFilePath) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

/** Save immediately if a debounced save is pending — call before leaving a file. */
export function flushReadingPositionSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }
}

/** Forget the last-saved marker — call when a different file is opened. */
export function resetReadingPositionSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  lastSavedIndex = -1;
}
