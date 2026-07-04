import JSZip from "jszip";
import type { ComicPage, FileEntry, ZipEntryInfo } from "./types.ts";
import { state } from "./state.ts";
import { isImageFile } from "./utils.ts";
import { createBridgeUrl } from "./bridge.ts";

export function createPage(filename: string, blob: Blob, originalOrder: number): ComicPage {
  return {
    filename,
    url: URL.createObjectURL(blob),
    blob,
    disabled: false,
    originalOrder,
  };
}

function createBridgePage(filename: string, filePath: string, originalOrder: number): ComicPage {
  return {
    filename,
    url: createBridgeUrl("/file", { path: filePath }),
    blob: null,
    disabled: false,
    originalOrder,
  };
}

export function disposePages(pageList: ComicPage[]) {
  pageList.forEach((page) => {
    if (page.url.startsWith("blob:")) URL.revokeObjectURL(page.url);
    if (page.thumbUrl?.startsWith("blob:")) URL.revokeObjectURL(page.thumbUrl);
  });
}

export function replacePages(nextPages: ComicPage[]) {
  disposePages(state.pages);
  state.pages = nextPages;
}

export function loadPagesFromBridgeFiles(files: FileEntry[], startingOrder = 0): ComicPage[] {
  return files.map((file, index) => createBridgePage(file.name, file.path, startingOrder + index));
}

export function loadPagesFromZipEntries(archivePath: string, entries: ZipEntryInfo[]): ComicPage[] {
  return entries.map((e, index) => ({
    filename: e.name,
    url: createBridgeUrl("/zip-entry", { path: archivePath, entry: e.entry }),
    blob: null,
    disabled: false,
    originalOrder: index,
  }));
}

export async function loadCbz(arrayBuffer: ArrayBuffer): Promise<{
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

  // Zip entry order is insertion order, not page order.
  imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

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

      const remaining = imageFiles.slice(1);
      const pages: ComicPage[] = [];
      const BATCH_SIZE = 20;

      for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        const batch = remaining.slice(i, i + BATCH_SIZE);
        const blobs = await Promise.all(batch.map((filename) => zip.files[filename].async("blob")));
        for (let j = 0; j < batch.length; j++) {
          pages.push(createPage(batch[j], blobs[j], i + j + 1));
        }
      }

      return pages;
    },
  };
}
