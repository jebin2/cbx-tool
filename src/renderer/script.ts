import JSZip from "jszip";

let currentFile: ArrayBuffer | null = null;
let currentFileName = "";
let currentFilePath: string | null = null;
let pages: { filename: string; url: string; blob: Blob }[] = [];
let selectedPageIndex = -1;

let rpc: any = null;
let binaryConfig: { port: number; token: string } | null = null;

const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const openBtn = document.getElementById("openBtn") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const pageList = document.getElementById("pageList") as HTMLDivElement;
const pageCount = document.getElementById("pageCount") as HTMLSpanElement;
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const previewImage = document.getElementById("previewImage") as HTMLImageElement;
const loader = document.getElementById("loader") as HTMLDivElement;

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

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function openComicFile(file: File, filePath?: string) {
  try {
    currentFileName = file.name;
    currentFilePath = filePath || null;
    const arrayBuffer = await file.arrayBuffer();
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (ext === ".cbz") {
      await loadCbz(arrayBuffer);
    } else if (ext === ".cbr") {
      alert("CBR support coming soon! Please use CBZ files for now.");
      loader.classList.add("hidden");
      return;
    } else {
      alert("Please select a .cbz or .cbr file");
      loader.classList.add("hidden");
      return;
    }

    currentFile = arrayBuffer;
    dropZone.classList.add("hidden");
    previewImage.classList.remove("hidden");
    saveBtn.disabled = false;
    renderPageList();
    
    if (pages.length > 0) {
      selectPage(0);
    }
    loader.classList.add("hidden");
  } catch (error) {
    console.error("Error opening file:", error);
    alert("Error opening file: " + (error as Error).message);
    loader.classList.add("hidden");
  }
}

async function loadCbz(arrayBuffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageFiles: string[] = [];

  for (const [filename, file] of Object.entries(zip.files)) {
    if (!file.dir && isImageFile(filename)) {
      imageFiles.push(filename);
    }
  }

  imageFiles.sort(naturalSort);

  pages = [];
  for (const filename of imageFiles) {
    const file = zip.files[filename];
    const blob = await file.async("blob");
    const url = URL.createObjectURL(blob);
    pages.push({
      filename,
      url,
      blob,
    });
  }

  pageCount.textContent = `${pages.length} pages`;
}

function renderPageList() {
  pageList.innerHTML = "";
  
  pages.forEach((page, index) => {
    const item = document.createElement("div");
    item.className = "page-item" + (index === selectedPageIndex ? " selected" : "");
    item.innerHTML = `
      <img src="${page.url}" alt="Page ${index + 1}">
      <div class="page-info">
        <div class="page-name">${page.filename}</div>
      </div>
      <button class="remove-btn" data-index="${index}">Remove</button>
    `;
    
    item.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).classList.contains("remove-btn")) {
        selectPage(index);
      }
    });
    
    item.querySelector(".remove-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removePage(index);
    });
    
    pageList.appendChild(item);
  });
}

function selectPage(index: number) {
  selectedPageIndex = index;
  if (pages[index]) {
    previewImage.src = pages[index].url;
  }
  
  document.querySelectorAll(".page-item").forEach((item, i) => {
    item.classList.toggle("selected", i === index);
  });
}

function removePage(index: number) {
  if (index < 0 || index >= pages.length) return;
  
  const page = pages[index];
  URL.revokeObjectURL(page.url);
  pages.splice(index, 1);
  
  if (selectedPageIndex >= pages.length) {
    selectedPageIndex = pages.length - 1;
  }
  
  renderPageList();
  
  if (pages.length > 0) {
    selectPage(selectedPageIndex);
  } else {
    previewImage.src = "";
    previewImage.classList.add("hidden");
    dropZone.classList.remove("hidden");
    pageCount.textContent = "0 pages";
  }
}

async function saveComic() {
  if (!pages.length) return;
  
  try {
    const zip = new JSZip();
    
    for (const page of pages) {
      zip.file(page.filename, page.blob);
    }
    
    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
    
    let savePath = currentFilePath;
    
    if (!savePath) {
      const ext = currentFileName.toLowerCase().slice(currentFileName.lastIndexOf("."));
      const baseName = currentFileName.slice(0, currentFileName.lastIndexOf("."));
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
