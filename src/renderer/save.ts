import JSZip from "jszip";
import type { ComicPage } from "./types.ts";
import { showMessageModal, showPromptModal } from "./modal.ts";
import { state } from "./state.ts";
import { getFileExtension, getParentPath } from "./utils.ts";
import { writeBridgeFile } from "./bridge.ts";
import { setLoaderVisible } from "./ui.ts";

export const PAGE_FETCH_CONCURRENCY = 8;

/**
 * Fetch the blobs for `pages` in parallel batches, invoking `onProgress`
 * after each batch. Pages that already hold a blob skip the fetch.
 */
export async function fetchPageBlobs(
  pages: ComicPage[],
  onProgress?: (done: number, total: number) => void
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (let i = 0; i < pages.length; i += PAGE_FETCH_CONCURRENCY) {
    const batch = pages.slice(i, i + PAGE_FETCH_CONCURRENCY);
    const batchBlobs = await Promise.all(
      batch.map((page) =>
        page.blob ?? fetch(page.url).then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load ${page.filename}`);
          }
          return response.blob();
        })
      )
    );
    blobs.push(...batchBlobs);
    onProgress?.(blobs.length, pages.length);
  }
  return blobs;
}

export async function saveComic() {
  const enabledPages = state.pages.filter((page) => !page.disabled);
  if (!enabledPages.length) {
    await showMessageModal({
      title: "Nothing To Save",
      message: "There are no enabled pages to save.",
    });
    return;
  }

  try {
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

    // Resolve the destination before doing any heavy work, so the user
    // isn't kept waiting on page fetching just to see a dialog.
    let savePath: string | null = null;
    if (state.rpc && state.binaryConfig) {
      const result = await state.rpc.request.showSaveDialog({ defaultPath });
      if (result.canceled || !result.filePath) return;
      savePath = result.filePath;
    }

    setLoaderVisible(true, "Saving…");
    try {
      const zip = new JSZip();
      const blobs = await fetchPageBlobs(enabledPages, (done, total) =>
        setLoaderVisible(true, `Saving… ${done}/${total} pages`)
      );
      enabledPages.forEach((page, i) => zip.file(page.filename, blobs[i]));

      setLoaderVisible(true, "Saving… writing archive");
      const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });

      if (savePath) {
        await writeBridgeFile(savePath, arrayBuffer);
      } else {
        const blob = new Blob([new Uint8Array(arrayBuffer)], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultSaveName;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    } finally {
      setLoaderVisible(false);
    }

    await showMessageModal({
      title: "Saved",
      message: `Saved to ${savePath}`,
    });
  } catch (error) {
    console.error("Error saving file:", error);
    setLoaderVisible(false);
    await showMessageModal({
      title: "Save Failed",
      message: "Error saving file: " + (error as Error).message,
    });
  }
}
