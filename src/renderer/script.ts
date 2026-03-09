import JSZip from "jszip";

let currentFile: ArrayBuffer | null = null;
let currentFileName = "";
let currentFilePath: string | null = null;
let pages: { filename: string; url: string; blob: Blob; disabled: boolean }[] = [];
let selectedPageIndex = -1;

let rpc: any = null;
let binaryConfig: { port: number; token: string } | null = null;

const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const openBtn = document.getElementById("openBtn") as HTMLButtonElement;
const openFolderBtn = document.getElementById("openFolderBtn") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const extractBtn = document.getElementById("extractBtn") as HTMLButtonElement;
let isFolderMode = false;
const pageList = document.getElementById("pageList") as HTMLDivElement;
const pageCount = document.getElementById("pageCount") as HTMLSpanElement;
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const previewContainer = document.getElementById("previewContainer") as HTMLDivElement;
const prevImage = document.getElementById("prevImage") as HTMLImageElement;
const currentImage = document.getElementById("currentImage") as HTMLImageElement;
const nextImage = document.getElementById("nextImage") as HTMLImageElement;
const loader = document.getElementById("loader") as HTMLDivElement;

let isScrollingProgrammatically = false;

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
            params: { canChooseDirectory?: boolean };
            response: { canceled: boolean; filePaths: string[] };
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
  } catch (error) {
    console.error("Failed to initialize RPC:", error);
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
    currentFileName = file.name;
    currentFilePath = filePath || file.path || null;
    console.log(`[Frontend] openComicFile: ${currentFileName}, path: ${currentFilePath}`);
    const arrayBuffer = await file.arrayBuffer();
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (ext === ".cbz") {
      const loadRest = await loadCbz(arrayBuffer);

      currentFile = arrayBuffer;
      dropZone.classList.add("hidden");
      previewContainer.classList.remove("hidden");

      const sidebar = document.querySelector(".sidebar");
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
            return { filename: file.name, url: URL.createObjectURL(blob), blob, disabled: false };
          } catch (err) {
            console.error(`[Frontend] Failed to fetch image ${file.name}:`, err);
            throw err;
          }
        });

        pages = await Promise.all(fetchPromises);
        console.log(`[Frontend] All ${pages.length} images fetched and converted to URLs`);

        currentFile = arrayBuffer;
        dropZone.classList.add("hidden");
        previewContainer.classList.remove("hidden");

        const sidebar = document.querySelector(".sidebar");
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

  pages = [];

  if (imageFiles.length === 0) return async () => { };

  // Load first page immediately so UI can show instantly
  const firstBlob = await zip.files[imageFiles[0]].async("blob");
  pages.push({ filename: imageFiles[0], url: URL.createObjectURL(firstBlob), blob: firstBlob, disabled: false });

  // Return a function to load the remaining pages in the background
  return async () => {
    if (imageFiles.length <= 1) return;
    const restBlobs = await Promise.all(
      imageFiles.slice(1).map((filename) => zip.files[filename].async("blob"))
    );
    imageFiles.slice(1).forEach((filename, i) => {
      pages.push({ filename, url: URL.createObjectURL(restBlobs[i]), blob: restBlobs[i], disabled: false });
    });
    renderPageList();
    if (selectedPageIndex !== -1) {
      selectPage(selectedPageIndex, true);
    }
  };
}

function renderPageList() {
  pageList.innerHTML = "";
  const activeCount = pages.filter((p) => !p.disabled).length;
  pageCount.textContent = `${activeCount}/${pages.length} pages`;

  pages.forEach((page, index) => {
    const item = document.createElement("div");
    item.className = "page-item" +
      (index === selectedPageIndex ? " selected" : "") +
      (page.disabled ? " page-disabled" : "");
    item.innerHTML = `
      <img src="${page.url}" alt="Page ${index + 1}" loading="lazy">
      <div class="page-info">
        <div class="page-num">${index + 1}</div>
        <div class="page-name">${page.filename}</div>
      </div>
      <button class="remove-btn" data-index="${index}" title="${page.disabled ? "Restore" : "Remove"}">${page.disabled ? "+" : "×"}</button>
    `;

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
  const isZoomed = previewContainer.classList.contains("zoomed");

  if (viewer && isZoomed && !skipScrollBehavior) {
    // When manually selecting a page while zoomed, scroll to the top of the current image
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

openFolderBtn.addEventListener("click", async () => {
  if (rpc && binaryConfig) {
    try {
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
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await rpc.request.readFolder({ folderPath });

      if (response.success) {
        // Fetch images in parallel
        const fetchPromises = response.files.map(async (file: any) => {
          const readUrl = `http://localhost:${binaryConfig!.port}/file?path=${encodeURIComponent(file.path)}&token=${binaryConfig!.token}`;
          const res = await fetch(readUrl);
          const blob = await res.blob();
          return { filename: file.name, url: URL.createObjectURL(blob), blob, disabled: false };
        });

        pages = await Promise.all(fetchPromises);

        if (pages.length > 0) {
          selectedPageIndex = 0;
          dropZone.classList.add("hidden");
          previewContainer.classList.remove("hidden");
          document.querySelector(".sidebar")?.classList.remove("hidden");
          document.querySelector(".toolbar")?.classList.remove("hidden");
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
  dropZone.classList.remove("dragover");

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
    if (!previewContainer.classList.contains("zoomed") || isScrollingProgrammatically) return;

    const st = viewerNode.scrollTop;
    const currentTop = currentImage.offsetTop;
    const currentBottom = currentTop + currentImage.offsetHeight;

    // If we scroll deep into the next image
    if (st > currentBottom - 200 && selectedPageIndex < pages.length - 1) {
      isScrollingProgrammatically = true;
      const offset = st - currentBottom;
      selectPage(selectedPageIndex + 1, true);
      // Adjust scroll to make it seamless
      requestAnimationFrame(() => {
        viewerNode.scrollTo({ top: currentImage.offsetTop + offset, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, 50);
      });
    }
    // If we scroll high into the previous image
    else if (st < currentTop - 200 && selectedPageIndex > 0) {
      isScrollingProgrammatically = true;
      selectPage(selectedPageIndex - 1, true);
      // Adjust scroll to make it seamless
      requestAnimationFrame(() => {
        // The new currentImage is the old prevImage, so scroll down by its height to maintain position relative to the top of the old currentImage
        viewerNode.scrollTo({ top: viewerNode.scrollTop + currentImage.offsetHeight, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, 50);
      });
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (!pages.length) return;
  const viewer = document.querySelector(".viewer");
  const isZoomed = previewContainer.classList.contains("zoomed");

  if (e.key === "ArrowRight") {
    if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
  } else if (e.key === "ArrowLeft") {
    if (selectedPageIndex > 0) selectPage(selectedPageIndex - 1);
  } else if (e.key === "ArrowDown") {
    if (isZoomed && viewer) {
      e.preventDefault();
      viewer.scrollBy({ top: 100, behavior: "smooth" });
    } else {
      if (selectedPageIndex < pages.length - 1) selectPage(selectedPageIndex + 1);
    }
  } else if (e.key === "ArrowUp") {
    if (isZoomed && viewer) {
      e.preventDefault();
      viewer.scrollBy({ top: -100, behavior: "smooth" });
    } else {
      if (selectedPageIndex > 0) selectPage(selectedPageIndex - 1);
    }
  } else if (e.key === "Delete" || e.key === "x") {
    togglePage(selectedPageIndex);
  }
});

previewContainer.addEventListener("dblclick", () => {
  previewContainer.classList.toggle("zoomed");
  const viewer = document.querySelector(".viewer");
  if (viewer) {
    viewer.classList.toggle("zoomed");
    if (!previewContainer.classList.contains("zoomed")) {
      viewer.scrollTo({ top: 0 }); // reset scroll
    } else {
      // if entering zoom mode, focus the current image
      isScrollingProgrammatically = true;
      requestAnimationFrame(() => {
        viewer.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
        setTimeout(() => { isScrollingProgrammatically = false; }, 50);
      });
    }
  }
});
