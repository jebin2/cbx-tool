import JSZip from "jszip";

let currentFile: ArrayBuffer | null = null;
let currentFileName = "";
let currentFilePath: string | null = null;
let pages: { filename: string; url: string; blob: Blob; disabled: boolean; originalOrder: number }[] = [];
let selectedPageIndex = -1;

let rpc: any = null;
let binaryConfig: { port: number; token: string } | null = null;

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
const previewContainer = document.getElementById("previewContainer") as HTMLDivElement;
const prevImage = document.getElementById("prevImage") as HTMLImageElement;
const currentImage = document.getElementById("currentImage") as HTMLImageElement;
const nextImage = document.getElementById("nextImage") as HTMLImageElement;
const loader = document.getElementById("loader") as HTMLDivElement;
const autoScrollBtn = document.getElementById("autoScrollBtn") as HTMLButtonElement;
const autoScrollSpeedInput = document.getElementById("autoScrollSpeed") as HTMLInputElement;
const addPageBtn = document.getElementById("addPageBtn") as HTMLButtonElement;
const resetOrderBtn = document.getElementById("resetOrderBtn") as HTMLButtonElement;

let isScrollingProgrammatically = false;
let autoScrollInterval: number | null = null;
let draggedItemIndex: number | null = null;
let dragScrollRequest: number | null = null;
let lastDragClientY = 0;
let copyFeedbackTimeout: number | null = null;

const copyBtnDefaultLabel = "Copy";
const copyBtnDefaultTitle = "Copy current page image to clipboard";

async function initRPC() {
  try {
    const { Electroview } = await import("electrobun/view");

    type RPCType = {
      bun: {
        requests: {
          getBinaryConfig: {
            params: Record<string, never>;
            response: { port: number; token: string };
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
            response: { name: string; path: string }[];
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
            response: { success: boolean; error?: string; files: { name: string; path: string }[] };
          };
          readFolder: {
            params: { folderPath: string };
            response: { success: boolean; error?: string; files: { name: string; path: string }[] };
          };
          extractArchiveToFolder: {
            params: { sourcePath: string; destinationPath: string; type: 'cbz' | 'cbr' };
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
    const container = document.getElementById("recentFilesContainer") as HTMLDivElement;
    const list = document.getElementById("recentFilesList") as HTMLDivElement;

    if (!recentFiles || recentFiles.length === 0) {
      container.classList.add("hidden");
      return;
    }

    container.classList.remove("hidden");
    list.innerHTML = "";

    recentFiles.forEach((file: { name: string, path: string }) => {
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
      list.appendChild(item);
    });
  } catch (error) {
    console.error("Failed to load recent files:", error);
  }
}

async function openKnownFile(filePath: string, fileName: string) {
  isFolderMode = false;
  saveBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  `;

  document.getElementById("recentFilesContainer")?.classList.add("hidden");
  dropZone.classList.add("hidden");
  loader.classList.remove("hidden");
  await new Promise(resolve => setTimeout(resolve, 10));

  try {
    const readUrl = `http://localhost:${binaryConfig!.port}/file?path=${encodeURIComponent(filePath)}&token=${binaryConfig!.token}`;
    const response = await fetch(readUrl);

    if (!response.ok) throw new Error("File not found");

    const blob = await response.blob();
    const file = new File([blob], fileName, { type: "application/zip" });
    await openComicFile(file, filePath);
  } catch (error) {
    console.error("Failed to open recent file:", error);
    alert("Could not open file.");
    loader.classList.add("hidden");
  }
}

initRPC();

const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return imageExtensions.includes(ext);
}


async function openComicFile(file: any, filePath?: string) {
  try {
    selectedPageIndex = -1;
    updateCopyButtonState();
    currentFileName = file.name;
    currentFilePath = filePath || file.path || null;
    console.log(`[Frontend] openComicFile: ${currentFileName}, path: ${currentFilePath}`);

    if (currentFilePath && rpc) {
      rpc.request.addRecentFile({ name: currentFileName, filePath: currentFilePath }).then(() => {
        loadRecentFiles();
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (ext === ".cbz") {
      const loadRest = await loadCbz(arrayBuffer);

      currentFile = arrayBuffer;
      document.getElementById("landingContainer")?.classList.add("hidden");
      document.getElementById("progressBarContainer")?.classList.remove("hidden");
      previewContainer.classList.remove("hidden");
      previewContainer.classList.add("fit-height"); // Default viewing mode

      const sidebar = document.querySelector(".sidebar");
      const viewer = document.querySelector(".viewer");
      if (viewer) viewer.classList.add("has-content");
      if (sidebar) sidebar.classList.remove("hidden");

      const toolbar = document.querySelector(".toolbar");
      if (toolbar) toolbar.classList.remove("hidden");

      saveBtn.disabled = false;
      extractBtn.disabled = false;
      renderPageList();

      if (pages.length > 0) {
        selectPage(0);
      }
      loader.classList.add("hidden");

      // Load remaining pages in the background after UI is shown
      loadRest();
      return;
    } else if (ext === ".cbr") {
      if (!currentFilePath) {
        console.error(`[Frontend] currentFilePath is missing for CBR. Drop might not provide path.`);
        alert("Cannot open CBR file from drop natively in this environment. Please click 'Open' and select it instead.");
        loader.classList.add("hidden");
        return;
      }

      console.log(`[Frontend] Extraction starting for: ${currentFilePath}`);
      const response = await rpc.request.extractCBR({ filePath: currentFilePath });
      console.log(`[Frontend] Extraction response success: ${response.success}`);

      if (!response.success) {
        console.error(`[Frontend] Extraction error:`, response.error);
        alert("Error extracting CBR: " + response.error);
        loader.classList.add("hidden");
        return;
      }

      pages = [];
      const extractedFiles = response.files;
      console.log(`[Frontend] Received ${extractedFiles.length} file paths from backend`);

      if (extractedFiles.length > 0) {
        // Fetch all images in parallel for better performance
        const fetchPromises = extractedFiles.map(async (file: { name: string, path: string }, index: number) => {
          try {
            const readUrl = `http://localhost:${binaryConfig!.port}/file?path=${encodeURIComponent(file.path)}&token=${binaryConfig!.token}`;
            const res = await fetch(readUrl);
            if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
            const blob = await res.blob();
            if (index === 0) console.log(`[Frontend] Successfully fetched first image: ${file.name}`);
            return {
              filename: file.name,
              url: URL.createObjectURL(blob),
              blob,
              disabled: false,
              originalOrder: index
            };
          } catch (err) {
            console.error(`[Frontend] Failed to fetch image ${file.name}:`, err);
            throw err;
          }
        });

        pages = await Promise.all(fetchPromises);
        console.log(`[Frontend] All ${pages.length} images fetched and converted to URLs`);

        currentFile = arrayBuffer;
        document.getElementById("landingContainer")?.classList.add("hidden");
        document.getElementById("progressBarContainer")?.classList.remove("hidden");
        previewContainer.classList.remove("hidden");
        previewContainer.classList.add("fit-height");

        const sidebar = document.querySelector(".sidebar");
        const viewer = document.querySelector(".viewer");
        if (viewer) viewer.classList.add("has-content");
        if (sidebar) sidebar.classList.remove("hidden");

        const toolbar = document.querySelector(".toolbar");
        if (toolbar) toolbar.classList.remove("hidden");

        saveBtn.disabled = false;
        extractBtn.disabled = false;
        renderPageList();

        if (pages.length > 0) {
          selectPage(0);
        }
      }

      loader.classList.add("hidden");
      return;
    } else {
      alert("Please select a .cbz or .cbr file");
      loader.classList.add("hidden");
      return;
    }

  } catch (error) {
    console.error("Error opening file:", error);
    alert("Error opening file: " + (error as Error).message);
    loader.classList.add("hidden");
  }
}

async function loadCbz(arrayBuffer: ArrayBuffer): Promise<() => Promise<void>> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageFiles: string[] = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (!file.dir && isImageFile(filename)) {
      imageFiles.push(filename);
    }
  }

  // No default sorting to respect archive entry order

  pages = [];

  if (imageFiles.length === 0) return async () => { };

  // Load first page immediately so UI can show instantly
  const firstBlob = await zip.files[imageFiles[0]].async("blob");
  pages.push({
    filename: imageFiles[0],
    url: URL.createObjectURL(firstBlob),
    blob: firstBlob,
    disabled: false,
    originalOrder: 0
  });

  // Return a function to load the remaining pages in the background
  return async () => {
    if (imageFiles.length <= 1) return;
    const restBlobs = await Promise.all(
      imageFiles.slice(1).map((filename) => zip.files[filename].async("blob"))
    );
    imageFiles.slice(1).forEach((filename, i) => {
      pages.push({
        filename,
        url: URL.createObjectURL(restBlobs[i]),
        blob: restBlobs[i],
        disabled: false,
        originalOrder: i + 1
      });
    });
    renderPageList();
    if (selectedPageIndex !== -1) {
      selectPage(selectedPageIndex, true);
    }
  };
}

function handleDragScroll() {
  if (draggedItemIndex === null) {
    dragScrollRequest = null;
    return;
  }

  const rect = pageList.getBoundingClientRect();
  const threshold = 60; // distance from top/bottom to start scrolling
  const maxSpeed = 15;

  if (lastDragClientY < rect.top + threshold) {
    const intensity = Math.min(1, (rect.top + threshold - lastDragClientY) / threshold);
    pageList.scrollTop -= intensity * maxSpeed;
  } else if (lastDragClientY > rect.bottom - threshold) {
    const intensity = Math.min(1, (lastDragClientY - (rect.bottom - threshold)) / threshold);
    pageList.scrollTop += intensity * maxSpeed;
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
  if (pages.length === 0) return;
  const progress = ((selectedPageIndex + 1) / pages.length) * 100;
  const progressBar = document.getElementById("progressBar");
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }
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

  const viewer = document.querySelector(".viewer");
  const isZoomed = false; // Zoom logic removed, handled continuously by CSS layout

  if (viewer && !skipScrollBehavior) {
    // When manually selecting a page, scroll to the top of the current image
    isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewer.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { isScrollingProgrammatically = false; }, 50);
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
  }, 1600);
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

  const response = await fetch(`http://localhost:${binaryConfig.port}/clipboard-image?token=${binaryConfig.token}`, {
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
    document.querySelector(".auto-scroll-group")?.classList.remove("active");
  }
}

function startAutoScroll() {
  if (!pages.length) return;

  // Force fit to width
  const fitWidthBtn = document.getElementById("fitWidthBtn") as HTMLButtonElement;
  if (!fitWidthBtn.classList.contains("active")) {
    fitWidthBtn.click();
  }

  autoScrollBtn.classList.add("active");
  document.querySelector(".auto-scroll-group")?.classList.add("active");

  function scrollStep() {
    const viewer = document.querySelector(".viewer");
    if (viewer) {
      // Speed multiplier (min 1 = 0.5px, max 10 = 5px per frame)
      const speedSliderValue = parseInt(autoScrollSpeedInput.value || "2", 10);
      const speed = speedSliderValue * 0.5;

      viewer.scrollBy({ top: speed, behavior: "instant" });
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
      const ext = currentFileName.toLowerCase().slice(currentFileName.lastIndexOf("."));
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
      const lastSlash = Math.max(currentFilePath.lastIndexOf('\\'), currentFilePath.lastIndexOf('/'));
      const dir = currentFilePath.slice(0, lastSlash + 1);
      defaultPath = dir + defaultSaveName;
    }

    if (!rpc) {
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

    // High performance save via Binary Bridge
    const saveUrl = `http://localhost:${binaryConfig!.port}/save?path=${encodeURIComponent(result.filePath)}&token=${binaryConfig!.token}`;
    const response = await fetch(saveUrl, {
      method: 'POST',
      body: arrayBuffer
    });

    if (response.ok) {
      alert(`Saved to ${result.filePath}`);
    } else {
      const errorData = await response.json();
      alert("Error saving file: " + (errorData.error || response.statusText));
    }
  } catch (error) {
    console.error("Error saving file:", error);
    alert("Error saving file: " + (error as Error).message);
  }
}

openBtn.addEventListener("click", async () => {
  if (rpc && binaryConfig) {
    try {
      const result = await rpc.request.showOpenDialog({ canChooseDirectory: false });
      if (result.canceled || result.filePaths.length === 0) return;

      const filePath = result.filePaths[0];
      const fileName = filePath.split(/[\\/]/).pop() || "";

      isFolderMode = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save
      `;

      loader.classList.remove("hidden");
      document.getElementById("landingContainer")?.classList.add("hidden");
      await new Promise(resolve => setTimeout(resolve, 10));

      const readUrl = `http://localhost:${binaryConfig.port}/file?path=${encodeURIComponent(filePath)}&token=${binaryConfig.token}`;
      const response = await fetch(readUrl);
      const blob = await response.blob();

      const file = new File([blob], fileName, { type: "application/zip" });
      await openComicFile(file, filePath);
    } catch (error) {
      console.error("RPC open failed:", error);
      loader.classList.add("hidden");
      fileInput.click();
    }
  } else {
    fileInput.click();
  }
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

      loader.classList.remove("hidden");

      for (const filePath of result.filePaths) {
        const fileName = filePath.split(/[\\/]/).pop() || "";
        const readUrl = `http://localhost:${binaryConfig.port}/file?path=${encodeURIComponent(filePath)}&token=${binaryConfig.token}`;
        const response = await fetch(readUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        pages.push({
          filename: fileName,
          url: url,
          blob: blob,
          disabled: false,
          originalOrder: pages.length
        });
      }

      renderPageList();
      if (selectedPageIndex === -1 && pages.length > 0) {
        selectPage(0);
      }

      loader.classList.add("hidden");
    } catch (error) {
      console.error("Error adding pages:", error);
      loader.classList.add("hidden");
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
      selectedPageIndex = -1;
      updateCopyButtonState();
      const result = await rpc.request.showOpenDialog({ canChooseDirectory: true });
      if (result.canceled || result.filePaths.length === 0) return;

      const folderPath = result.filePaths[0];
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || "Images";

      currentFileName = folderName;
      currentFilePath = folderPath;
      isFolderMode = true;

      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l2 3h9a2 2 0 0 1 2 2z" />
          <polyline points="12 11 12 17M9 14l3 3 3-3" />
        </svg>
        Convert to CBZ
      `;

      loader.classList.remove("hidden");
      document.getElementById("landingContainer")?.classList.add("hidden");
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await rpc.request.readFolder({ folderPath });

      if (response.success) {
        // Fetch images in parallel
        const fetchPromises = response.files.map(async (file: any, index: number) => {
          const readUrl = `http://localhost:${binaryConfig!.port}/file?path=${encodeURIComponent(file.path)}&token=${binaryConfig!.token}`;
          const res = await fetch(readUrl);
          const blob = await res.blob();
          return {
            filename: file.name,
            url: URL.createObjectURL(blob),
            blob,
            disabled: false,
            originalOrder: index
          };
        });

        pages = await Promise.all(fetchPromises);

        if (pages.length > 0) {
          selectedPageIndex = 0;
          document.getElementById("landingContainer")?.classList.add("hidden");
          document.getElementById("progressBarContainer")?.classList.remove("hidden");
          previewContainer.classList.remove("hidden");
          previewContainer.classList.add("fit-height");
          document.querySelector(".sidebar")?.classList.remove("hidden");
          document.querySelector(".toolbar")?.classList.remove("hidden");
          document.querySelector(".viewer")?.classList.add("has-content");
          saveBtn.disabled = false;
          extractBtn.disabled = true;
          renderPageList();
          selectPage(0);
        } else {
          alert("No images found in the selected folder.");
        }
      } else {
        alert("Error reading folder: " + response.error);
      }
      loader.classList.add("hidden");
    } catch (error) {
      console.error("Folder open failed:", error);
      loader.classList.add("hidden");
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

  const ext = currentFilePath.toLowerCase().slice(currentFilePath.lastIndexOf("."));
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

  loader.classList.remove("hidden");
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
    loader.classList.add("hidden");
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
  document.getElementById("landingContainer")?.classList.add("hidden");

  const file = e.dataTransfer?.files[0];
  if (file) {
    const filePath = (file as any).path;
    openComicFile(file, filePath);
  }
});

// Handle infinite scrolling up/down logic
const viewerNode = document.querySelector(".viewer");
if (viewerNode) {
  viewerNode.addEventListener("scroll", () => {
    if (!previewContainer.classList.contains("fit-width") || isScrollingProgrammatically) return;

    const st = viewerNode.scrollTop;
    const currentTop = currentImage.offsetTop;
    const currentBottom = currentTop + currentImage.offsetHeight;

    // If we scroll deep into the next image
    if (st > currentBottom - 200 && selectedPageIndex < pages.length - 1) {
      isScrollingProgrammatically = true;
      const offset = st - currentBottom;
      selectPage(selectedPageIndex + 1, true);

      // The new currentImage was just prevImage or newly loaded, we want to maintain the offset 
      // relative to its new top position.
      requestAnimationFrame(() => {
        viewerNode.scrollTo({ top: currentImage.offsetTop + offset, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, 50);
      });
    }
    // If we scroll high into the previous image
    else if (st < currentTop - 200 && selectedPageIndex > 0) {
      isScrollingProgrammatically = true;
      const offset = currentTop - st;
      selectPage(selectedPageIndex - 1, true);

      // When scrolling up, we want to end up near the *bottom* of the new currentImage 
      // (which is the previous page) minus how far we scrolled past the threshold.
      requestAnimationFrame(() => {
        const targetScrollTop = (currentImage.offsetTop + currentImage.offsetHeight) - offset;
        viewerNode.scrollTo({ top: targetScrollTop, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, 50);
      });
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (!pages.length) return;
  const viewer = document.querySelector(".viewer");
  const isFitWidth = previewContainer.classList.contains("fit-width");

  if (e.key === "ArrowRight") {
    if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
  } else if (e.key === "ArrowLeft") {
    if (selectedPageIndex > 0) selectPage(selectedPageIndex - 1);
  } else if (e.key === "ArrowDown") {
    if (isFitWidth && viewer) {
      e.preventDefault();
      viewer.scrollBy({ top: 100, behavior: "smooth" });
    } else {
      if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
    }
  } else if (e.key === "ArrowUp") {
    if (isFitWidth && viewer) {
      e.preventDefault();
      viewer.scrollBy({ top: -100, behavior: "smooth" });
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

const fitWidthBtn = document.getElementById("fitWidthBtn") as HTMLButtonElement;
const fitHeightBtn = document.getElementById("fitHeightBtn") as HTMLButtonElement;

fitWidthBtn.addEventListener("click", () => {
  previewContainer.classList.remove("fit-height");
  previewContainer.classList.add("fit-width");
  fitHeightBtn.classList.remove("active");
  fitWidthBtn.classList.add("active");

  if (viewerNode) {
    isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { isScrollingProgrammatically = false; }, 50);
    });
  }
});

fitHeightBtn.addEventListener("click", () => {
  previewContainer.classList.remove("fit-width");
  previewContainer.classList.add("fit-height");
  fitWidthBtn.classList.remove("active");
  fitHeightBtn.classList.add("active");
});

document.getElementById("clearRecentBtn")?.addEventListener("click", async () => {
  if (rpc) {
    if (confirm("Are you sure you want to clear your recent files history?")) {
      const res = await rpc.request.clearRecentFiles();
      if (res.success) {
        document.getElementById("recentFilesContainer")?.classList.add("hidden");
        const list = document.getElementById("recentFilesList");
        if (list) list.innerHTML = "";
      }
    }
  }
});
