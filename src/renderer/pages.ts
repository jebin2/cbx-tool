import JSZip from "jszip";
import type { ComicPage, FileEntry } from "./types.ts";
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
  });
}

export function replacePages(nextPages: ComicPage[]) {
  disposePages(state.pages);
  state.pages = nextPages;
}

export function loadPagesFromBridgeFiles(files: FileEntry[], startingOrder = 0): ComicPage[] {
  return files.map((file, index) => createBridgePage(file.name, file.path, startingOrder + index));
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
