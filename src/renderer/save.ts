import JSZip from "jszip";
import { showMessageModal, showPromptModal } from "./modal.ts";
import { state } from "./state.ts";
import { getFileExtension, getParentPath } from "./utils.ts";
import { writeBridgeFile } from "./bridge.ts";

export async function saveComic() {
  if (!state.pages.length) return;

  try {
    const zip = new JSZip();

    for (const page of state.pages) {
      if (!page.disabled) {
        const blob = page.blob ?? await fetch(page.url).then((r) => r.blob());
        zip.file(page.filename, blob);
      }
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

    const newName = await showPromptModal({
      title: "Save File As",
      defaultValue: defaultSaveName,
      confirmLabel: "Save",
    });
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
      await showMessageModal({
        title: "Browser Download",
        message: "RPC not initialized. Using browser download instead.",
      });
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
    await showMessageModal({
      title: "Saved",
      message: `Saved to ${result.filePath}`,
    });
  } catch (error) {
    console.error("Error saving file:", error);
    await showMessageModal({
      title: "Save Failed",
      message: "Error saving file: " + (error as Error).message,
    });
  }
}
