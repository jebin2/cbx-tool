import type { OpenableFile } from "./types.ts";
import { state } from "./state.ts";
import {
  addPageBtn,
  autoScrollBtn,
  clearRecentBtn,
  copyBtn,
  currentImage,
  dropZone,
  extractBtn,
  fileInput,
  fitToggleBtn,
  spreadBtn,
  homeBtn,
  landingContainer,
  landingOpenBtn,
  landingOpenFolderBtn,
  openBtn,
  openFolderBtn,
  previewContainer,
  recentFilesContainer,
  recentFilesList,
  resetOrderBtn,
  saveBtn,
  viewerNode,
} from "./dom.ts";
import { SCROLL_FLAG_RESET_DELAY_MS } from "./constants.ts";
import { getFileExtension, getFileName, getFolderName, waitForUiTick } from "./utils.ts";
import { fetchBridgeFile, initRPC } from "./bridge.ts";
import { showMessageModal, setupModalListeners } from "./modal.ts";
import { disposePages, loadPagesFromBridgeFiles } from "./pages.ts";
import {
  applyOpenedPages,
  appendPageItems,
  renderPageList,
  selectPage,
  setLoaderVisible,
  setSaveButtonMode,
  setFitToggleToFitWidth,
  setFitToggleToFitHeight,
  showLandingPage,
  setupPageListEvents,
} from "./ui.ts";
import { openComicFile, startOpenRequest, isActiveOpenRequest, loadRecentFiles } from "./loader.ts";
import { copyCurrentPageToClipboard } from "./clipboard.ts";
import { saveComic } from "./save.ts";
import {
  startAutoScroll,
  stopAutoScroll,
  setupScrollHandler,
  setupKeyboardHandler,
} from "./nav.ts";

// ─── Initialization ───────────────────────────────────────────────────────────

initRPC(() => loadRecentFiles());
setupModalListeners();
setupScrollHandler();
setupKeyboardHandler();
setupPageListEvents();

// ─── Toolbar ──────────────────────────────────────────────────────────────────

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0] as OpenableFile | undefined;
  fileInput.value = "";
  if (!file) return;

  setLoaderVisible(true);
  landingContainer.classList.add("hidden");
  await waitForUiTick();
  await openComicFile(file, file.path);
});

async function openArchiveFromPicker() {
  if (state.rpc && state.binaryConfig) {
    try {
      const result = await state.rpc.request.showOpenDialog({ canChooseDirectory: false });
      if (result.canceled || result.filePaths.length === 0) return;

      const filePath = result.filePaths[0];
      const fileName = getFileName(filePath);

      setSaveButtonMode("save");
      setLoaderVisible(true);
      landingContainer.classList.add("hidden");
      await waitForUiTick();

      const file = await fetchBridgeFile(filePath, fileName, "application/zip");
      await openComicFile(file, filePath);
    } catch (error) {
      console.error("RPC open failed:", error);
      setLoaderVisible(false);
      fileInput.click();
    }
  } else {
    fileInput.click();
  }
}

async function openFolderFromPicker() {
  if (!state.rpc || !state.binaryConfig) {
    await showMessageModal({
      title: "Desktop Only",
      message: "Folder selection is only supported in the desktop app.",
    });
    return;
  }

  try {
    const result = await state.rpc.request.showOpenDialog({ canChooseDirectory: true });
    if (result.canceled || result.filePaths.length === 0) return;

    const requestId = startOpenRequest();
    const folderPath = result.filePaths[0];
    const folderName = getFolderName(folderPath);

    state.currentFileName = folderName;
    state.currentFilePath = folderPath;
    setSaveButtonMode("convert");

    setLoaderVisible(true);
    landingContainer.classList.add("hidden");
    await waitForUiTick();

    const response = await state.rpc.request.readFolder({ folderPath });

    if (response.success) {
      const nextPages = await loadPagesFromBridgeFiles(response.files);
      if (!isActiveOpenRequest(requestId)) return;

      if (nextPages.length > 0) {
        applyOpenedPages(nextPages, false);
        setLoaderVisible(false);
      } else {
        setLoaderVisible(false);
        await showMessageModal({
          title: "No Images Found",
          message: "No images found in the selected folder.",
        });
      }
    } else {
      setLoaderVisible(false);
      await showMessageModal({
        title: "Folder Read Failed",
        message: "Error reading folder: " + response.error,
      });
    }
  } catch (error) {
    console.error("Folder open failed:", error);
    setLoaderVisible(false);
  }
}

openBtn.addEventListener("click", openArchiveFromPicker);
landingOpenBtn.addEventListener("click", openArchiveFromPicker);
openFolderBtn.addEventListener("click", openFolderFromPicker);
landingOpenFolderBtn.addEventListener("click", openFolderFromPicker);
homeBtn.addEventListener("click", async () => {
  startOpenRequest();
  showLandingPage();
  await loadRecentFiles();
});

saveBtn.addEventListener("click", saveComic);
copyBtn.addEventListener("click", copyCurrentPageToClipboard);

extractBtn.addEventListener("click", async () => {
  if (!state.currentFilePath) {
    await showMessageModal({
      title: "Missing File Path",
      message: "File path not detected. Please open using the 'Open' button.",
    });
    return;
  }

  if (!state.rpc) {
    await showMessageModal({
      title: "RPC Unavailable",
      message: "RPC not available.",
    });
    return;
  }

  const ext = getFileExtension(state.currentFilePath);
  const type = ext === ".cbr" ? "cbr" : "cbz";
  const enabledFilenames = state.pages
    .filter((page) => !page.disabled)
    .map((page) => page.filename);

  if (enabledFilenames.length === 0) {
    await showMessageModal({
      title: "Nothing To Extract",
      message: "There are no enabled pages to extract.",
    });
    return;
  }

  let result;
  try {
    result = await state.rpc.request.showOpenDialog({ canChooseDirectory: true });
  } catch (rpcErr) {
    console.error("[Frontend] RPC showOpenDialog failed:", rpcErr);
    await showMessageModal({
      title: "Folder Picker Failed",
      message: "System error: Could not open folder picker. See console for details.",
    });
    return;
  }

  const { canceled, filePaths } = result;
  if (canceled || !filePaths || filePaths.length === 0) return;

  const destinationPath = filePaths[0];
  if (!destinationPath) return;

  setLoaderVisible(true);
  try {
    const response = await state.rpc.request.extractArchiveToFolder({
      sourcePath: state.currentFilePath,
      destinationPath,
      type,
      filenames: enabledFilenames,
    });

    setLoaderVisible(false);

    if (response.success) {
      await showMessageModal({
        title: "Extraction Complete",
        message: "Successfully extracted to: " + destinationPath,
      });
    } else {
      await showMessageModal({
        title: "Extraction Failed",
        message: "Extraction failed: " + response.error,
      });
    }
  } catch (err) {
    console.error("Extraction error:", err);
    setLoaderVisible(false);
    await showMessageModal({
      title: "Extraction Error",
      message: "Error during extraction: " + err,
    });
  }
});

addPageBtn.addEventListener("click", async () => {
  if (!state.rpc || !state.binaryConfig) return;

  try {
    const result = await state.rpc.request.showOpenDialog({
      canChooseDirectory: false,
      allowMultiple: true,
      allowedFileTypes: "*.jpg,*.jpeg,*.png,*.webp",
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setLoaderVisible(true);
    const startingIndex = state.pages.length;
    const nextPages = await loadPagesFromBridgeFiles(
      result.filePaths.map((filePath) => ({ name: getFileName(filePath), path: filePath })),
      startingIndex
    );

    state.pages = [...state.pages, ...nextPages];
    appendPageItems(nextPages, startingIndex);

    if (state.selectedPageIndex === -1 && state.pages.length > 0) {
      selectPage(0);
    }

    setLoaderVisible(false);
  } catch (error) {
    console.error("Error adding pages:", error);
    setLoaderVisible(false);
  }
});

resetOrderBtn.addEventListener("click", () => {
  if (state.pages.length === 0) return;

  const currentViewedPage = state.pages[state.selectedPageIndex];
  state.pages.sort((a, b) => a.originalOrder - b.originalOrder);

  if (currentViewedPage) {
    state.selectedPageIndex = state.pages.indexOf(currentViewedPage);
  } else {
    state.selectedPageIndex = 0;
  }

  renderPageList();
  selectPage(state.selectedPageIndex);
});

autoScrollBtn.addEventListener("click", () => {
  if (state.autoScrollInterval !== null) {
    stopAutoScroll();
  } else {
    startAutoScroll();
  }
});

fitToggleBtn.addEventListener("click", () => {
  state.isSpreadMode = false;
  spreadBtn.classList.remove("active");

  if (previewContainer.classList.contains("fit-width")) {
    previewContainer.classList.remove("fit-width");
    previewContainer.classList.add("fit-height");
    setFitToggleToFitWidth();
  } else {
    previewContainer.classList.remove("fit-height", "spread");
    previewContainer.classList.add("fit-width");
    setFitToggleToFitHeight();

    if (viewerNode) {
      state.isScrollingProgrammatically = true;
      requestAnimationFrame(() => {
        viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
        setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
  }

  if (state.selectedPageIndex !== -1) {
    selectPage(state.selectedPageIndex, true);
  }
});

spreadBtn.addEventListener("click", () => {
  state.isSpreadMode = true;
  stopAutoScroll();
  previewContainer.classList.remove("fit-width", "fit-height");
  previewContainer.classList.add("spread");
  spreadBtn.classList.add("active");

  if (state.selectedPageIndex !== -1) {
    selectPage(state.selectedPageIndex, true);
  }
});

clearRecentBtn?.addEventListener("click", async () => {
  if (!state.rpc) return;
  if (confirm("Are you sure you want to clear your recent files history?")) {
    const res = await state.rpc.request.clearRecentFiles({});
    if (res.success) {
      recentFilesContainer.classList.add("hidden");
      recentFilesList.innerHTML = "";
    }
  }
});

// ─── Drop zone ────────────────────────────────────────────────────────────────

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("click", () => {
  void openArchiveFromPicker();
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  landingContainer.classList.add("hidden");
  setLoaderVisible(true);

  const file = e.dataTransfer?.files[0] as OpenableFile | undefined;
  if (file) {
    openComicFile(file, file.path);
  } else {
    setLoaderVisible(false);
  }
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

window.addEventListener("beforeunload", () => {
  disposePages(state.pages);
});
