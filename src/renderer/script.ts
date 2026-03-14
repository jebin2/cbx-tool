import JSZip from "jszip";

type ComicPage = {
  filename: string;
  url: string;
  blob: Blob;
  disabled: boolean;
  originalOrder: number;
};

type BinaryConfig = {
  port: number;
  token: string;
};

type FileEntry = {
  name: string;
  path: string;
};

type OpenableFile = File & {
  path?: string;
};

type RPCType = {
  bun: {
    requests: {
      getBinaryConfig: {
        params: Record<string, never>;
        response: BinaryConfig;
      };
      showSaveDialog: {
        params: { defaultPath: string };
        response: { canceled: boolean; filePath?: string };
      };
      showOpenDialog: {
        params: { canChooseDirectory?: boolean; allowMultiple?: boolean; allowedFileTypes?: string };
        response: { canceled: boolean; filePaths: string[] };
      };
      getRecentFiles: {
        params: Record<string, never>;
        response: FileEntry[];
      };
      addRecentFile: {
        params: { name: string; filePath: string };
        response: { success: boolean };
      };
      clearRecentFiles: {
        params: Record<string, never>;
        response: { success: boolean };
      };
      extractCBR: {
        params: { filePath: string };
        response: { success: boolean; error?: string; files: FileEntry[] };
      };
      readFolder: {
        params: { folderPath: string };
        response: { success: boolean; error?: string; files: FileEntry[] };
      };
      extractArchiveToFolder: {
        params: { sourcePath: string; destinationPath: string; type: "cbz" | "cbr" };
        response: { success: boolean; error?: string };
      };
    };
    messages: {};
    push: {};
  };
  webview: {
    requests: {};
    messages: {};
    push: {};
  };
};

let currentFileName = "";
let currentFilePath: string | null = null;
let pages: ComicPage[] = [];
let selectedPageIndex = -1;
let openRequestId = 0;

type RPC = {
  request: {
    [K in keyof RPCType["bun"]["requests"]]: (
      params: RPCType["bun"]["requests"][K]["params"]
    ) => Promise<RPCType["bun"]["requests"][K]["response"]>;
  };
};

let rpc: RPC | null = null;
let binaryConfig: BinaryConfig | null = null;

const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const openBtn = document.getElementById("openBtn") as HTMLButtonElement;
const openFolderBtn = document.getElementById("openFolderBtn") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const extractBtn = document.getElementById("extractBtn") as HTMLButtonElement;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement;
const copyBtnLabel = document.getElementById("copyBtnLabel") as HTMLSpanElement;
let isFolderMode = false;
const pageList = document.getElementById("pageList") as HTMLDivElement;
const pageCount = document.getElementById("pageCount") as HTMLSpanElement;
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const landingContainer = document.getElementById("landingContainer") as HTMLDivElement;
const recentFilesContainer = document.getElementById("recentFilesContainer") as HTMLDivElement;
const recentFilesList = document.getElementById("recentFilesList") as HTMLDivElement;
const progressBarContainer = document.getElementById("progressBarContainer") as HTMLDivElement;
const progressBar = document.getElementById("progressBar") as HTMLDivElement;
const previewContainer = document.getElementById("previewContainer") as HTMLDivElement;
const prevImage = document.getElementById("prevImage") as HTMLImageElement;
const currentImage = document.getElementById("currentImage") as HTMLImageElement;
const nextImage = document.getElementById("nextImage") as HTMLImageElement;
const loader = document.getElementById("loader") as HTMLDivElement;
const autoScrollBtn = document.getElementById("autoScrollBtn") as HTMLButtonElement;
const autoScrollSpeedInput = document.getElementById("autoScrollSpeed") as HTMLInputElement;
const addPageBtn = document.getElementById("addPageBtn") as HTMLButtonElement;
const resetOrderBtn = document.getElementById("resetOrderBtn") as HTMLButtonElement;
const fitWidthBtn = document.getElementById("fitWidthBtn") as HTMLButtonElement;
const fitHeightBtn = document.getElementById("fitHeightBtn") as HTMLButtonElement;
const clearRecentBtn = document.getElementById("clearRecentBtn") as HTMLButtonElement | null;
const sidebar = document.querySelector(".sidebar") as HTMLElement | null;
const toolbar = document.querySelector(".toolbar") as HTMLElement | null;
const viewerNode = document.querySelector(".viewer") as HTMLElement | null;
const autoScrollGroup = document.querySelector(".auto-scroll-group") as HTMLElement | null;

let isScrollingProgrammatically = false;
let autoScrollInterval: number | null = null;
let draggedItemIndex: number | null = null;
let dragScrollRequest: number | null = null;
let lastDragClientY = 0;
let copyFeedbackTimeout: number | null = null;

// --- UI constants ---
const copyBtnDefaultLabel = "Copy";
const copyBtnDefaultTitle = "Copy current page image to clipboard";
const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

// Threshold (px) from the edge of the page list that triggers auto-scroll during drag
const DRAG_SCROLL_THRESHOLD = 60;
// Maximum pixels scrolled per animation frame during drag
const DRAG_SCROLL_MAX_SPEED = 15;
// How long (ms) the copy-button success/error feedback stays visible
const COPY_FEEDBACK_DURATION_MS = 1600;
// How far (px) into the next/prev image the viewer must scroll before switching pages
const PAGE_SWITCH_SCROLL_THRESHOLD = 200;
// Delay (ms) before clearing the programmatic-scroll guard flag after a scroll call
const SCROLL_FLAG_RESET_DELAY_MS = 50;

function setLoaderVisible(isVisible: boolean) {
  loader.classList.toggle("hidden", !isVisible);
}

function setSaveButtonMode(mode: "save" | "convert") {
  isFolderMode = mode === "convert";
  saveBtn.innerHTML = mode === "convert"
    ? `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l2 3h9a2 2 0 0 1 2 2z" />
          <polyline points="12 11 12 17M9 14l3 3 3-3" />
        </svg>
        Convert to CBZ
      `
    : `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save
      `;
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.toLowerCase().slice(lastDot);
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "";
}

function getFolderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).pop() || "Images";
}

function getParentPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return lastSlash === -1 ? "" : filePath.slice(0, lastSlash + 1);
}

function createBridgeUrl(pathname: string, params: Record<string, string> = {}) {
  if (!binaryConfig) {
    throw new Error("Binary bridge is not available.");
  }

  const url = new URL(`http://localhost:${binaryConfig.port}${pathname}`);
  url.searchParams.set("token", binaryConfig.token);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function createPage(filename: string, blob: Blob, originalOrder: number): ComicPage {
  return {
    filename,
    url: URL.createObjectURL(blob),
    blob,
    disabled: false,
    originalOrder,
  };
}

function disposePages(pageList: ComicPage[]) {
  pageList.forEach((page) => URL.revokeObjectURL(page.url));
}

function replacePages(nextPages: ComicPage[]) {
  disposePages(pages);
  pages = nextPages;
}

function resetPageSelection() {
  selectedPageIndex = -1;
  updateCopyButtonState();
  updateProgressBar();
}

function startOpenRequest() {
  openRequestId += 1;
  stopAutoScroll();
  return openRequestId;
}

function isActiveOpenRequest(requestId: number) {
  return requestId === openRequestId;
}

function showViewer(canExtract: boolean) {
  landingContainer.classList.add("hidden");
  recentFilesContainer.classList.add("hidden");
  dropZone.classList.add("hidden");
  progressBarContainer.classList.remove("hidden");
  previewContainer.classList.remove("hidden");
  previewContainer.classList.remove("fit-width");
  previewContainer.classList.add("fit-height");
  fitWidthBtn.classList.remove("active");
  fitHeightBtn.classList.add("active");
  viewerNode?.classList.add("has-content");
  sidebar?.classList.remove("hidden");
  toolbar?.classList.remove("hidden");
  saveBtn.disabled = false;
  extractBtn.disabled = !canExtract;
}

function applyOpenedPages(nextPages: ComicPage[], canExtract: boolean) {
  selectedPageIndex = -1;
  replacePages(nextPages);
  showViewer(canExtract);
  renderPageList();

  if (pages.length > 0) {
    selectPage(0);
  } else {
    resetPageSelection();
  }
}

async function waitForUiTick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function fetchBridgeBlob(filePath: string): Promise<Blob> {
  const response = await fetch(createBridgeUrl("/file", { path: filePath }));
  if (!response.ok) {
    throw new Error(response.statusText || "File fetch failed.");
  }
  return response.blob();
}

async function fetchBridgeFile(filePath: string, fileName: string, type = "application/octet-stream") {
  const blob = await fetchBridgeBlob(filePath);
  return new File([blob], fileName, { type });
}

async function writeBridgeFile(filePath: string, content: ArrayBuffer) {
  const response = await fetch(createBridgeUrl("/file", { path: filePath }), {
    method: "POST",
    body: content,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      // Ignore JSON parse failures and keep the response status text.
    }
    throw new Error(message || "File save failed.");
  }
}

async function loadPagesFromBridgeFiles(files: FileEntry[], startingOrder = 0): Promise<ComicPage[]> {
  return Promise.all(files.map(async (file, index) => {
    const blob = await fetchBridgeBlob(file.path);
    return createPage(file.name, blob, startingOrder + index);
  }));
}

async function initRPC() {
  try {
    const { Electroview } = await import("electrobun/view");

    const electroview = new Electroview({
      rpc: Electroview.defineRPC<RPCType>({
        maxRequestTime: Infinity,
        handlers: {
          requests: {},
        },
      }),
    });

    rpc = electroview.rpc;
    console.log("RPC initialized successfully");
    binaryConfig = await rpc.request.getBinaryConfig();

    // Load recent files on startup
    loadRecentFiles();
  } catch (error) {
    console.error("Failed to initialize RPC:", error);
  }
}

async function loadRecentFiles() {
  if (!rpc) return;
  try {
    const recentFiles = await rpc.request.getRecentFiles();

    if (!recentFiles || recentFiles.length === 0) {
      recentFilesContainer.classList.add("hidden");
      return;
    }

    recentFilesContainer.classList.remove("hidden");
    recentFilesList.innerHTML = "";

    recentFiles.forEach((file: FileEntry) => {
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

async function openKnownFile(filePath: string, fileName: string) {
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

initRPC();

function isImageFile(filename: string): boolean {
  return imageExtensions.includes(getFileExtension(filename));
}

async function openComicFile(file: OpenableFile, filePath?: string) {
  const requestId = startOpenRequest();

  try {
    currentFileName = file.name;
    currentFilePath = filePath || file.path || null;
    setSaveButtonMode("save");

    if (currentFilePath && rpc) {
      rpc.request.addRecentFile({ name: currentFileName, filePath: currentFilePath }).then(() => {
        loadRecentFiles();
      });
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

        pages = [...pages, ...remainingPages];
        renderPageList();
        if (selectedPageIndex !== -1) {
          selectPage(selectedPageIndex, true);
        }
      }).catch((error) => {
        console.error("Error loading remaining archive pages:", error);
      });
      return;
    }

    if (ext === ".cbr") {
      if (!currentFilePath || !rpc) {
        throw new Error("Cannot open this CBR from drag and drop. Use the Open button instead.");
      }

      const response = await rpc.request.extractCBR({ filePath: currentFilePath });
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

async function loadCbz(arrayBuffer: ArrayBuffer): Promise<{
  initialPages: ComicPage[];
  loadRemainingPages: () => Promise<ComicPage[]>;
}> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageFiles: string[] = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (!file.dir && isImageFile(filename)) {
      imageFiles.push(filename);
    }
  }

  if (imageFiles.length === 0) {
    return {
      initialPages: [],
      loadRemainingPages: async () => [],
    };
  }

  const firstBlob = await zip.files[imageFiles[0]].async("blob");
  const initialPages = [createPage(imageFiles[0], firstBlob, 0)];

  return {
    initialPages,
    loadRemainingPages: async () => {
      if (imageFiles.length <= 1) {
        return [];
      }

      const restBlobs = await Promise.all(
        imageFiles.slice(1).map((filename) => zip.files[filename].async("blob"))
      );

      return imageFiles.slice(1).map((filename, index) =>
        createPage(filename, restBlobs[index], index + 1)
      );
    },
  };
}

function handleDragScroll() {
  if (draggedItemIndex === null) {
    dragScrollRequest = null;
    return;
  }

  const rect = pageList.getBoundingClientRect();

  if (lastDragClientY < rect.top + DRAG_SCROLL_THRESHOLD) {
    const intensity = Math.min(1, (rect.top + DRAG_SCROLL_THRESHOLD - lastDragClientY) / DRAG_SCROLL_THRESHOLD);
    pageList.scrollTop -= intensity * DRAG_SCROLL_MAX_SPEED;
  } else if (lastDragClientY > rect.bottom - DRAG_SCROLL_THRESHOLD) {
    const intensity = Math.min(1, (lastDragClientY - (rect.bottom - DRAG_SCROLL_THRESHOLD)) / DRAG_SCROLL_THRESHOLD);
    pageList.scrollTop += intensity * DRAG_SCROLL_MAX_SPEED;
  }

  dragScrollRequest = requestAnimationFrame(handleDragScroll);
}

// Ensure the sidebar container also updates the drag position
pageList.addEventListener("dragover", (e) => {
  lastDragClientY = e.clientY;
});

function renderPageList() {
  pageList.innerHTML = "";
  const activeCount = pages.filter((p) => !p.disabled).length;
  pageCount.textContent = `${activeCount}/${pages.length} pages`;

  pages.forEach((page, index) => {
    const item = document.createElement("div");
    item.className = "page-item" +
      (index === selectedPageIndex ? " selected" : "") +
      (page.disabled ? " page-disabled" : "");
    item.draggable = true;
    item.innerHTML = `
      <img src="${page.url}" alt="Page ${index + 1}" loading="lazy">
      <div class="page-info">
        <div class="page-num">${index + 1}</div>
        <div class="page-name" title="${page.filename}">${page.filename}</div>
      </div>
      <button class="remove-btn" data-index="${index}" title="${page.disabled ? "Restore" : "Remove"}">${page.disabled ? "+" : "×"}</button>
    `;

    item.addEventListener("dragstart", (e) => {
      draggedItemIndex = index;
      item.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index.toString());
      }

      if (!dragScrollRequest) {
        dragScrollRequest = requestAnimationFrame(handleDragScroll);
      }
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedItemIndex === null || draggedItemIndex === index) return;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      item.classList.remove("drop-target-above", "drop-target-below");
      if (e.clientY < midpoint) {
        item.classList.add("drop-target-above");
      } else {
        item.classList.add("drop-target-below");
      }

      lastDragClientY = e.clientY;
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-target-above", "drop-target-below");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drop-target-above", "drop-target-below");

      if (draggedItemIndex === null || draggedItemIndex === index) return;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      let dropIndex = index;

      if (e.clientY >= midpoint) {
        dropIndex++;
      }

      // Adjust drop index if we're moving from before to after
      if (draggedItemIndex < dropIndex) {
        dropIndex--;
      }

      if (draggedItemIndex !== dropIndex) {
        const [movedPage] = pages.splice(draggedItemIndex, 1);
        pages.splice(dropIndex, 0, movedPage);

        // Update selectedPageIndex
        if (selectedPageIndex === draggedItemIndex) {
          selectedPageIndex = dropIndex;
        } else if (draggedItemIndex < selectedPageIndex && dropIndex >= selectedPageIndex) {
          selectedPageIndex--;
        } else if (draggedItemIndex > selectedPageIndex && dropIndex <= selectedPageIndex) {
          selectedPageIndex++;
        }

        renderPageList();
        selectPage(selectedPageIndex, true);
      }
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedItemIndex = null;
      if (dragScrollRequest) {
        cancelAnimationFrame(dragScrollRequest);
        dragScrollRequest = null;
      }
      document.querySelectorAll(".page-item").forEach(i =>
        i.classList.remove("drop-target-above", "drop-target-below")
      );
    });

    item.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).classList.contains("remove-btn")) {
        selectPage(index);
      }
    });

    item.querySelector(".remove-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePage(index);
    });

    pageList.appendChild(item);
  });

  updateProgressBar();
  updateCopyButtonState();
}

function updateProgressBar() {
  if (!progressBar) return;

  if (pages.length === 0 || selectedPageIndex < 0) {
    progressBar.style.width = "0%";
    return;
  }

  const progress = ((selectedPageIndex + 1) / pages.length) * 100;
  progressBar.style.width = `${progress}%`;
}

function selectPage(index: number, skipScrollBehavior = false) {
  if (index < 0 || index >= pages.length) return;
  selectedPageIndex = index;

  // Clear images first to prevent flashing old content
  prevImage.removeAttribute('src');
  currentImage.removeAttribute('src');
  nextImage.removeAttribute('src');

  // Set sources for the three image elements
  if (pages[index - 1]) prevImage.src = pages[index - 1].url;
  if (pages[index]) currentImage.src = pages[index].url;
  if (pages[index + 1]) nextImage.src = pages[index + 1].url;

  if (viewerNode && !skipScrollBehavior) {
    // When manually selecting a page, scroll to the top of the current image
    isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
    });
  }

  // Update selected class in the page list and scroll it into view
  document.querySelectorAll(".page-item").forEach((item, i) => {
    item.classList.toggle("selected", i === index);
    if (i === index) {
      (item as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  });

  updateProgressBar();
  updateCopyButtonState();
}

function clearCopyButtonFeedback() {
  if (copyFeedbackTimeout !== null) {
    clearTimeout(copyFeedbackTimeout);
    copyFeedbackTimeout = null;
  }

  copyBtn.classList.remove("success", "error");
  copyBtnLabel.textContent = copyBtnDefaultLabel;
  copyBtn.title = copyBtnDefaultTitle;
}

function updateCopyButtonState() {
  const hasSelectedPage = selectedPageIndex >= 0 && selectedPageIndex < pages.length;
  copyBtn.disabled = !hasSelectedPage;

  if (!hasSelectedPage) {
    clearCopyButtonFeedback();
  }
}

function setCopyButtonFeedback(type: "success" | "error", label: string, title: string) {
  clearCopyButtonFeedback();
  copyBtn.classList.add(type);
  copyBtnLabel.textContent = label;
  copyBtn.title = title;
  copyFeedbackTimeout = window.setTimeout(() => {
    copyFeedbackTimeout = null;
    clearCopyButtonFeedback();
  }, COPY_FEEDBACK_DURATION_MS);
}

function loadImageForClipboard(src: string): Promise<HTMLImageElement> {
  if (currentImage.src === src && currentImage.complete && currentImage.naturalWidth > 0) {
    return Promise.resolve(currentImage);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the page image for clipboard copy."));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not prepare the image for clipboard copy."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

async function createClipboardImageBlob(pageUrl: string): Promise<Blob> {
  const image = await loadImageForClipboard(pageUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error("The selected page is not ready to copy yet.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available for clipboard copy.");
  }

  ctx.drawImage(image, 0, 0, width, height);
  return canvasToBlob(canvas, "image/png");
}

async function copyImageViaBinaryBridge(blob: Blob) {
  if (!binaryConfig) {
    throw new Error("Binary bridge is not available.");
  }

  const response = await fetch(createBridgeUrl("/clipboard-image"), {
    method: "POST",
    headers: {
      "Content-Type": blob.type,
    },
    body: await blob.arrayBuffer(),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      // Ignore JSON parse errors and use status text.
    }
    throw new Error(message || "Clipboard write failed.");
  }
}

async function copyImageViaWebClipboard(blob: Blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy is not supported in this app runtime.");
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ]);
}

async function copyCurrentPageToClipboard() {
  const selectedPage = pages[selectedPageIndex];
  if (!selectedPage) return;

  clearCopyButtonFeedback();
  copyBtn.disabled = true;
  copyBtnLabel.textContent = "Copying...";

  try {
    const blob = await createClipboardImageBlob(selectedPage.url);
    if (binaryConfig) {
      await copyImageViaBinaryBridge(blob);
    } else {
      await copyImageViaWebClipboard(blob);
    }

    setCopyButtonFeedback("success", "Copied", "Current page copied to clipboard");
  } catch (error) {
    console.error("Error copying page to clipboard:", error);
    setCopyButtonFeedback("error", "Retry", "Copy failed");
    alert("Could not copy the current page to the clipboard: " + (error as Error).message);
  } finally {
    updateCopyButtonState();
  }
}

function togglePage(index: number) {
  if (index < 0 || index >= pages.length) return;
  pages[index].disabled = !pages[index].disabled;
  renderPageList();
  selectPage(selectedPageIndex);
}

let renameResolve: ((name: string | null) => void) | null = null;
const renameModal = document.getElementById("renameModal") as HTMLDivElement;
const renameInput = document.getElementById("renameInput") as HTMLInputElement;
const cancelRenameBtn = document.getElementById("cancelRenameBtn") as HTMLButtonElement;
const confirmRenameBtn = document.getElementById("confirmRenameBtn") as HTMLButtonElement;

function showRenameModal(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    renameInput.value = defaultName;
    renameModal.classList.remove("hidden");
    renameInput.focus();
    renameInput.select();

    renameResolve = resolve;
  });
}

function closeRenameModal(name: string | null) {
  renameModal.classList.add("hidden");
  if (renameResolve) {
    renameResolve(name);
    renameResolve = null;
  }
}

function stopAutoScroll() {
  if (autoScrollInterval !== null) {
    cancelAnimationFrame(autoScrollInterval);
    autoScrollInterval = null;
    autoScrollBtn.classList.remove("active");
    autoScrollGroup?.classList.remove("active");
  }
}

function startAutoScroll() {
  if (!pages.length) return;

  // Force fit to width
  if (!fitWidthBtn.classList.contains("active")) {
    fitWidthBtn.click();
  }

  autoScrollBtn.classList.add("active");
  autoScrollGroup?.classList.add("active");

  function scrollStep() {
    if (viewerNode) {
      // Speed multiplier (min 1 = 0.5px, max 10 = 5px per frame)
      const speedSliderValue = parseInt(autoScrollSpeedInput.value || "2", 10);
      const speed = speedSliderValue * 0.5;

      viewerNode.scrollBy({ top: speed, behavior: "instant" });
    }
    autoScrollInterval = requestAnimationFrame(scrollStep);
  }

  autoScrollInterval = requestAnimationFrame(scrollStep);
}

autoScrollBtn.addEventListener("click", () => {
  if (autoScrollInterval !== null) {
    stopAutoScroll();
  } else {
    startAutoScroll();
  }
});

cancelRenameBtn.addEventListener("click", () => closeRenameModal(null));
confirmRenameBtn.addEventListener("click", () => closeRenameModal(renameInput.value));
renameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") closeRenameModal(renameInput.value);
  if (e.key === "Escape") closeRenameModal(null);
});

async function saveComic() {
  if (!pages.length) return;

  try {
    const zip = new JSZip();

    for (const page of pages) {
      if (!page.disabled) zip.file(page.filename, page.blob);
    }

    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });

    let defaultSaveName = currentFileName;
    if (isFolderMode) {
      if (!defaultSaveName.toLowerCase().endsWith(".cbz")) {
        defaultSaveName += ".cbz";
      }
    } else {
      const ext = getFileExtension(currentFileName);
      const baseName = currentFileName.slice(0, currentFileName.lastIndexOf("."));
      if (ext === ".cbr") {
        defaultSaveName = baseName + ".cbz";
      } else {
        defaultSaveName = baseName + "_modified.cbz";
      }
    }

    const newName = await showRenameModal(defaultSaveName);
    if (!newName) return;

    defaultSaveName = newName;
    if (!defaultSaveName.toLowerCase().endsWith(".cbz")) {
      defaultSaveName += ".cbz";
    }

    let defaultPath = defaultSaveName;
    if (currentFilePath && !isFolderMode) {
      defaultPath = getParentPath(currentFilePath) + defaultSaveName;
    }

    if (!rpc || !binaryConfig) {
      alert("RPC not initialized. Using browser download instead.");
      const blob = new Blob([new Uint8Array(arrayBuffer)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultSaveName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const result = await rpc.request.showSaveDialog({
      defaultPath: defaultPath
    });

    if (result.canceled || !result.filePath) {
      return;
    }

    await writeBridgeFile(result.filePath, arrayBuffer);
    alert(`Saved to ${result.filePath}`);
  } catch (error) {
    console.error("Error saving file:", error);
    alert("Error saving file: " + (error as Error).message);
  }
}

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
  if (rpc && binaryConfig) {
    try {
      const result = await rpc.request.showOpenDialog({ canChooseDirectory: false });
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

window.addEventListener("beforeunload", () => {
  disposePages(pages);
});

addPageBtn.addEventListener("click", async () => {
  if (rpc && binaryConfig) {
    try {
      const result = await rpc.request.showOpenDialog({
        canChooseDirectory: false,
        allowMultiple: true,
        allowedFileTypes: "*.jpg,*.jpeg,*.png,*.webp"
      });
      if (result.canceled || result.filePaths.length === 0) return;

      setLoaderVisible(true);
      const nextPages = await loadPagesFromBridgeFiles(
        result.filePaths.map((filePath) => ({ name: getFileName(filePath), path: filePath })),
        pages.length
      );

      pages = [...pages, ...nextPages];

      renderPageList();
      if (selectedPageIndex === -1 && pages.length > 0) {
        selectPage(0);
      }

      setLoaderVisible(false);
    } catch (error) {
      console.error("Error adding pages:", error);
      setLoaderVisible(false);
    }
  }
});

resetOrderBtn.addEventListener("click", () => {
  try {
    if (pages.length === 0) return;

    console.log("[Frontend] Resetting page order...");

    // Store current page to keep it selected after sort
    const currentViewedPage = pages[selectedPageIndex];

    // Naturally sort pages by original order
    pages.sort((a, b) => a.originalOrder - b.originalOrder);

    // Find where the page moved to
    if (currentViewedPage) {
      selectedPageIndex = pages.indexOf(currentViewedPage);
    } else {
      selectedPageIndex = 0;
    }

    renderPageList();
    selectPage(selectedPageIndex);

    console.log("[Frontend] Order reset complete.");
  } catch (err) {
    console.error("[Frontend] Error during order reset:", err);
  }
});

openFolderBtn.addEventListener("click", async () => {
  if (rpc && binaryConfig) {
    try {
      const result = await rpc.request.showOpenDialog({ canChooseDirectory: true });
      if (result.canceled || result.filePaths.length === 0) return;
      const requestId = startOpenRequest();

      const folderPath = result.filePaths[0];
      const folderName = getFolderName(folderPath);

      currentFileName = folderName;
      currentFilePath = folderPath;
      setSaveButtonMode("convert");

      setLoaderVisible(true);
      landingContainer.classList.add("hidden");
      await waitForUiTick();

      const response = await rpc.request.readFolder({ folderPath });

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
  } else {
    alert("Folder selection is only supported in the desktop app.");
  }
});

saveBtn.addEventListener("click", saveComic);
copyBtn.addEventListener("click", copyCurrentPageToClipboard);

extractBtn.addEventListener("click", async () => {
  if (!currentFilePath) {
    alert("File path not detected. Please open using the 'Open' button.");
    return;
  }

  const ext = getFileExtension(currentFilePath);
  const type = ext === ".cbr" ? "cbr" : "cbz";

  let result;
  try {
    console.log(`[Frontend] Requesting folder picker for extraction...`);
    result = await rpc.request.showOpenDialog({
      canChooseDirectory: true
    });
  } catch (rpcErr) {
    console.error(`[Frontend] RPC showOpenDialog failed:`, rpcErr);
    alert("System error: Could not open folder picker. See console for details.");
    return;
  }

  const { canceled, filePaths } = result;
  if (canceled || !filePaths || filePaths.length === 0) {
    console.log(`[Frontend] Extraction target selection canceled.`);
    return;
  }

  const destinationPath = filePaths[0];
  if (!destinationPath) {
    console.error(`[Frontend] Selected folder path is empty.`);
    return;
  }

  setLoaderVisible(true);
  try {
    const response = await rpc.request.extractArchiveToFolder({
      sourcePath: currentFilePath,
      destinationPath,
      type
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

// Handle infinite scrolling up/down logic
if (viewerNode) {
  viewerNode.addEventListener("scroll", () => {
    if (!previewContainer.classList.contains("fit-width") || isScrollingProgrammatically) return;

    const st = viewerNode.scrollTop;
    const currentTop = currentImage.offsetTop;
    const currentBottom = currentTop + currentImage.offsetHeight;

    // If we scroll deep into the next image
    if (st > currentBottom - PAGE_SWITCH_SCROLL_THRESHOLD && selectedPageIndex < pages.length - 1) {
      isScrollingProgrammatically = true;
      const offset = st - currentBottom;
      selectPage(selectedPageIndex + 1, true);

      // The new currentImage was just prevImage or newly loaded, we want to maintain the offset 
      // relative to its new top position.
      requestAnimationFrame(() => {
        viewerNode.scrollTo({ top: currentImage.offsetTop + offset, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
    // If we scroll high into the previous image
    else if (st < currentTop - PAGE_SWITCH_SCROLL_THRESHOLD && selectedPageIndex > 0) {
      isScrollingProgrammatically = true;
      const offset = currentTop - st;
      selectPage(selectedPageIndex - 1, true);

      // When scrolling up, we want to end up near the *bottom* of the new currentImage 
      // (which is the previous page) minus how far we scrolled past the threshold.
      requestAnimationFrame(() => {
        const targetScrollTop = (currentImage.offsetTop + currentImage.offsetHeight) - offset;
        viewerNode.scrollTo({ top: targetScrollTop, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (!pages.length) return;
  const isFitWidth = previewContainer.classList.contains("fit-width");

  if (e.key === "ArrowRight") {
    if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
  } else if (e.key === "ArrowLeft") {
    if (selectedPageIndex > 0) selectPage(selectedPageIndex - 1);
  } else if (e.key === "ArrowDown") {
    if (isFitWidth && viewerNode) {
      e.preventDefault();
      viewerNode.scrollBy({ top: 100, behavior: "smooth" });
    } else {
      if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
    }
  } else if (e.key === "ArrowUp") {
    if (isFitWidth && viewerNode) {
      e.preventDefault();
      viewerNode.scrollBy({ top: -100, behavior: "smooth" });
    } else {
      if (selectedPageIndex > 0) selectPage(selectedPageIndex - 1);
    }
  } else if (e.key === "Delete" || e.key === "x") {
    togglePage(selectedPageIndex);
  } else if (e.key === " " || e.key === "Spacebar") {
    // Spacebar toggles auto-scroll or handles general scroll
    if (isFitWidth) {
      e.preventDefault();
      if (autoScrollInterval !== null) {
        stopAutoScroll();
      } else {
        startAutoScroll();
      }
    }
  }
});

fitWidthBtn.addEventListener("click", () => {
  previewContainer.classList.remove("fit-height");
  previewContainer.classList.add("fit-width");
  fitHeightBtn.classList.remove("active");
  fitWidthBtn.classList.add("active");

  if (viewerNode) {
    isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
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
  if (rpc) {
    if (confirm("Are you sure you want to clear your recent files history?")) {
      const res = await rpc.request.clearRecentFiles();
      if (res.success) {
        recentFilesContainer.classList.add("hidden");
        recentFilesList.innerHTML = "";
      }
    }
  }
});
