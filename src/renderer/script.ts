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
  fitHeightBtn,
  fitWidthBtn,
  landingContainer,
  openBtn,
  openFolderBtn,
  pageList,
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
import { disposePages, loadPagesFromBridgeFiles } from "./pages.ts";
import {
  applyOpenedPages,
  renderPageList,
  selectPage,
  setLoaderVisible,
  setSaveButtonMode,
} from "./ui.ts";
import { openComicFile, startOpenRequest, isActiveOpenRequest, loadRecentFiles } from "./loader.ts";
import { copyCurrentPageToClipboard } from "./clipboard.ts";
import { saveComic, setupRenameModalListeners } from "./save.ts";
import {
  startAutoScroll,
  stopAutoScroll,
  setupScrollHandler,
  setupKeyboardHandler,
} from "./nav.ts";

// --- Initialization ---

initRPC(() => loadRecentFiles());
setupRenameModalListeners();
setupScrollHandler();
setupKeyboardHandler();

// Keep drag position updated at the container level
pageList.addEventListener("dragover", (e) => {
  state.lastDragClientY = e.clientY;
});

// --- Toolbar ---

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0] as OpenableFile | undefined;
  fileInput.value = "";
  if (!file) return;

  setLoaderVisible(true);
  landingContainer.classList.add("hidden");
  await waitForUiTick();
  await openComicFile(file, file.path);
});

openBtn.addEventListener("click", async () => {
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
});

openFolderBtn.addEventListener("click", async () => {
  if (!state.rpc || !state.binaryConfig) {
    alert("Folder selection is only supported in the desktop app.");
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
      } else {
        alert("No images found in the selected folder.");
      }
    } else {
      alert("Error reading folder: " + response.error);
    }
    setLoaderVisible(false);
  } catch (error) {
    console.error("Folder open failed:", error);
    setLoaderVisible(false);
  }
});

saveBtn.addEventListener("click", saveComic);
copyBtn.addEventListener("click", copyCurrentPageToClipboard);

extractBtn.addEventListener("click", async () => {
  if (!state.currentFilePath) {
    alert("File path not detected. Please open using the 'Open' button.");
    return;
  }

  const ext = getFileExtension(state.currentFilePath);
  const type = ext === ".cbr" ? "cbr" : "cbz";

  let result;
  try {
    result = await state.rpc!.request.showOpenDialog({ canChooseDirectory: true });
  } catch (rpcErr) {
    console.error("[Frontend] RPC showOpenDialog failed:", rpcErr);
    alert("System error: Could not open folder picker. See console for details.");
    return;
  }

  const { canceled, filePaths } = result;
  if (canceled || !filePaths || filePaths.length === 0) return;

  const destinationPath = filePaths[0];
  if (!destinationPath) return;

  setLoaderVisible(true);
  try {
    const response = await state.rpc!.request.extractArchiveToFolder({
      sourcePath: state.currentFilePath,
      destinationPath,
      type,
    });

    if (response.success) {
      alert("Successfully extracted to: " + destinationPath);
    } else {
      alert("Extraction failed: " + response.error);
    }
  } catch (err) {
    console.error("Extraction error:", err);
    alert("Error during extraction: " + err);
  } finally {
    setLoaderVisible(false);
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
    const nextPages = await loadPagesFromBridgeFiles(
      result.filePaths.map((filePath) => ({ name: getFileName(filePath), path: filePath })),
      state.pages.length
    );

    state.pages = [...state.pages, ...nextPages];
    renderPageList();

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

fitWidthBtn.addEventListener("click", () => {
  previewContainer.classList.remove("fit-height");
  previewContainer.classList.add("fit-width");
  fitHeightBtn.classList.remove("active");
  fitWidthBtn.classList.add("active");

  if (viewerNode) {
    state.isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
    });
  }
});

fitHeightBtn.addEventListener("click", () => {
  previewContainer.classList.remove("fit-width");
  previewContainer.classList.add("fit-height");
  fitWidthBtn.classList.remove("active");
  fitHeightBtn.classList.add("active");
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

// --- Drop zone ---

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("click", () => {
  openBtn.click();
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

// --- Cleanup ---

window.addEventListener("beforeunload", () => {
  disposePages(state.pages);
});
