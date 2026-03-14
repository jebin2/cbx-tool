import type { OpenableFile } from "./types.ts";
import { state } from "./state.ts";
import {
  dropZone,
  landingContainer,
  recentFilesContainer,
  recentFilesList,
} from "./dom.ts";
import { getFileExtension, getFileName, waitForUiTick } from "./utils.ts";
import { fetchBridgeFile } from "./bridge.ts";
import { loadCbz, loadPagesFromBridgeFiles } from "./pages.ts";
import {
  applyOpenedPages,
  appendPageItems,
  selectPage,
  setLoaderVisible,
  setSaveButtonMode,
} from "./ui.ts";
import { stopAutoScroll } from "./nav.ts";

export function startOpenRequest(): number {
  state.openRequestId += 1;
  stopAutoScroll();
  return state.openRequestId;
}

export function isActiveOpenRequest(requestId: number): boolean {
  return requestId === state.openRequestId;
}

export async function openComicFile(file: OpenableFile, filePath?: string) {
  const requestId = startOpenRequest();

  try {
    state.currentFileName = file.name;
    state.currentFilePath = filePath || file.path || null;
    setSaveButtonMode("save");

    if (state.currentFilePath && state.rpc) {
      state.rpc
        .request.addRecentFile({ name: state.currentFileName, filePath: state.currentFilePath })
        .then(() => loadRecentFiles());
    }

    const arrayBuffer = await file.arrayBuffer();
    const ext = getFileExtension(file.name);

    if (ext === ".cbz") {
      const { initialPages, loadRemainingPages } = await loadCbz(arrayBuffer);
      if (!initialPages.length) {
        throw new Error("No images found in the archive.");
      }

      if (!isActiveOpenRequest(requestId)) return;

      applyOpenedPages(initialPages, true);
      setLoaderVisible(false);

      void loadRemainingPages().then((remainingPages) => {
        if (!isActiveOpenRequest(requestId) || remainingPages.length === 0) {
          return;
        }

        const startingIndex = state.pages.length;
        state.pages = [...state.pages, ...remainingPages];
        appendPageItems(remainingPages, startingIndex);
        if (state.selectedPageIndex !== -1) {
          selectPage(state.selectedPageIndex, true);
        }
      }).catch((error) => {
        console.error("Error loading remaining archive pages:", error);
      });
      return;
    }

    if (ext === ".cbr") {
      if (!state.currentFilePath || !state.rpc) {
        throw new Error("Cannot open this CBR from drag and drop. Use the Open button instead.");
      }

      const response = await state.rpc.request.extractCBR({ filePath: state.currentFilePath });
      if (!response.success) {
        throw new Error(response.error || "CBR extraction failed.");
      }

      const nextPages = await loadPagesFromBridgeFiles(response.files);
      if (!isActiveOpenRequest(requestId)) return;

      applyOpenedPages(nextPages, true);
      setLoaderVisible(false);
      return;
    }

    throw new Error("Please select a .cbz or .cbr file");
  } catch (error) {
    console.error("Error opening file:", error);
    alert("Error opening file: " + (error as Error).message);
    setLoaderVisible(false);
  }
}

export async function openKnownFile(filePath: string, fileName: string) {
  setSaveButtonMode("save");
  recentFilesContainer.classList.add("hidden");
  dropZone.classList.add("hidden");
  setLoaderVisible(true);
  await waitForUiTick();

  try {
    const file = await fetchBridgeFile(filePath, fileName, "application/zip");
    await openComicFile(file, filePath);
  } catch (error) {
    console.error("Failed to open recent file:", error);
    alert("Could not open file.");
    setLoaderVisible(false);
  }
}

export async function loadRecentFiles() {
  if (!state.rpc) return;
  try {
    const recentFiles = await state.rpc.request.getRecentFiles({});

    if (!recentFiles || recentFiles.length === 0) {
      recentFilesContainer.classList.add("hidden");
      return;
    }

    recentFilesContainer.classList.remove("hidden");
    recentFilesList.innerHTML = "";

    recentFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "recent-file-item";
      item.innerHTML = `
        <svg class="recent-file-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <div class="recent-file-info">
          <span class="recent-file-name" title="${file.name}">${file.name}</span>
          <span class="recent-file-path" title="${file.path}">${file.path}</span>
        </div>
      `;

      item.addEventListener("click", () => openKnownFile(file.path, file.name));
      recentFilesList.appendChild(item);
    });
  } catch (error) {
    console.error("Failed to load recent files:", error);
  }
}

