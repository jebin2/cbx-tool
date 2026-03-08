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
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
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
            params: Record<string, never>;
            response: { canceled: boolean; filePaths: string[] };
          };
        };
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


async function openComicFile(file: File, filePath?: string) {
  try {
    currentFileName = file.name;
    currentFilePath = filePath || null;
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
      renderPageList();

      if (pages.length > 0) {
        selectPage(0);
      }
      loader.classList.add("hidden");

      // Load remaining pages in the background after UI is shown
      loadRest();
      return;
    } else if (ext === ".cbr") {
      alert("CBR support coming soon! Please use CBZ files for now.");
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

async function saveComic() {
  if (!pages.length) return;

  try {
    const zip = new JSZip();

    for (const page of pages) {
      if (!page.disabled) zip.file(page.filename, page.blob);
    }

    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const ext = currentFileName.toLowerCase().slice(currentFileName.lastIndexOf("."));
    const baseName = currentFileName.slice(0, currentFileName.lastIndexOf("."));

    let savePath: string;
    if (currentFilePath) {
      savePath = currentFilePath.slice(0, currentFilePath.lastIndexOf(".")) + `_modified${ext}`;
    } else {
      savePath = `${baseName}_modified${ext}`;
    }

    if (!rpc) {
      alert("RPC not initialized. Using browser download instead.");
      const blob = new Blob([new Uint8Array(arrayBuffer)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = savePath || "comic.cbz";
      a.click();
      URL.revokeObjectURL(url);
      alert(`Saved as ${savePath}`);
      return;
    }

    const result = await rpc.request.showSaveDialog({
      defaultPath: savePath || "comic.cbz"
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
      currentFilePath = result.filePath;
      currentFileName = result.filePath.split(/[\\/]/).pop() || currentFileName;
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
      const result = await rpc.request.showOpenDialog();
      if (result.canceled || result.filePaths.length === 0) return;

      const filePath = result.filePaths[0];

      // Show loader immediately after dialog closes
      loader.classList.remove("hidden");
      await new Promise(resolve => setTimeout(resolve, 10));

      // High performance read via Binary Bridge
      const readUrl = `http://localhost:${binaryConfig.port}/file?path=${encodeURIComponent(filePath)}&token=${binaryConfig.token}`;
      const response = await fetch(readUrl);
      const blob = await response.blob();

      const file = new File([blob], filePath.split(/[\\/]/).pop() || "comic.cbz", { type: "application/zip" });
      await openComicFile(file, filePath);
      return;
    } catch (error) {
      console.error("RPC open failed:", error);
      loader.classList.add("hidden");
      fileInput.click();
    }
  } else {
    fileInput.click();
  }
});

fileInput.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    openComicFile(file);
  }
});

saveBtn.addEventListener("click", saveComic);


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

  const file = e.dataTransfer.files[0];
  if (file) {
    openComicFile(file);
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
