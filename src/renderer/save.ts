import JSZip from "jszip";
import { cancelRenameBtn, confirmRenameBtn, renameInput, renameModal } from "./dom.ts";
import { state } from "./state.ts";
import { getFileExtension, getParentPath } from "./utils.ts";
import { writeBridgeFile } from "./bridge.ts";

// Local modal state — only used within this module
let renameResolve: ((name: string | null) => void) | null = null;

export function showRenameModal(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    renameInput.value = defaultName;
    renameModal.classList.remove("hidden");
    renameInput.focus();
    renameInput.select();
    renameResolve = resolve;
  });
}

export function closeRenameModal(name: string | null) {
  renameModal.classList.add("hidden");
  if (renameResolve) {
    renameResolve(name);
    renameResolve = null;
  }
}

export function setupRenameModalListeners() {
  cancelRenameBtn.addEventListener("click", () => closeRenameModal(null));
  confirmRenameBtn.addEventListener("click", () => closeRenameModal(renameInput.value));
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") closeRenameModal(renameInput.value);
    if (e.key === "Escape") closeRenameModal(null);
  });
}

export async function saveComic() {
  if (!state.pages.length) return;

  try {
    const zip = new JSZip();

    for (const page of state.pages) {
      if (!page.disabled) zip.file(page.filename, page.blob);
    }

    const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });

    let defaultSaveName = state.currentFileName;
    if (state.isFolderMode) {
      if (!defaultSaveName.toLowerCase().endsWith(".cbz")) {
        defaultSaveName += ".cbz";
      }
    } else {
      const ext = getFileExtension(state.currentFileName);
      const baseName = state.currentFileName.slice(0, state.currentFileName.lastIndexOf("."));
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
    if (state.currentFilePath && !state.isFolderMode) {
      defaultPath = getParentPath(state.currentFilePath) + defaultSaveName;
    }

    if (!state.rpc || !state.binaryConfig) {
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

    const result = await state.rpc.request.showSaveDialog({ defaultPath });

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
