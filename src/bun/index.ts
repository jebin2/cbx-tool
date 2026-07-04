import Electrobun, { BrowserWindow, defineElectrobunRPC, Screen } from "electrobun/bun";
import { randomBytes } from "crypto";
import { mkdir, mkdtemp, readdir, stat, unlink } from "fs/promises";
import { basename, extname, join } from "path";
import { homedir, tmpdir, platform } from "os";
const IS_WIN = platform() === "win32";

type RecentFileEntry = { name: string; path: string; lastPageIndex?: number; totalPages?: number };

// --- RPC handler param types (mirrors RPCType in renderer) ---
type AddRecentFileParams = { name: string; filePath: string };
type ShowSaveDialogParams = { defaultPath: string };
type ShowOpenDialogParams = { canChooseDirectory?: boolean; allowMultiple?: boolean; allowedFileTypes?: string };
type ExtractCBRParams = { filePath: string };
type ExtractCBZParams = { filePath: string };
type ListCBZParams = { filePath: string };
type ExtractArchiveToFolderParams = {
  sourcePath: string;
  destinationPath: string;
  type: "cbz" | "cbr";
  filenames: string[];
};
type ReadFolderParams = { folderPath: string };

// --- Shared RAR extractor factory ---
async function createRarExtractor(filePath: string) {
  const { createExtractorFromData } = await import("node-unrar-js");
  const { unrarWasmB64 } = await import("./unrar-wasm");

  const fileCheck = Bun.file(filePath);
  if (!(await fileCheck.exists())) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileBuffer = await fileCheck.arrayBuffer();
  const wasmBuffer = Buffer.from(unrarWasmB64, "base64");
  const wasmBinary = wasmBuffer.buffer.slice(
    wasmBuffer.byteOffset,
    wasmBuffer.byteOffset + wasmBuffer.byteLength
  ) as ArrayBuffer;

  return createExtractorFromData({ data: fileBuffer, wasmBinary });
}

// --- On-demand CBZ serving ---
// One archive is open at a time, so cache the last loaded zip. Storing the
// promise (not the resolved zip) lets concurrent /zip-entry requests share a
// single load instead of each re-reading the file.
type LoadedZip = Awaited<ReturnType<typeof import("jszip").loadAsync>>;
let zipCachePath: string | null = null;
let zipCachePromise: Promise<LoadedZip> | null = null;

function loadZipCached(filePath: string, forceReload = false): Promise<LoadedZip> {
  if (!forceReload && zipCachePath === filePath && zipCachePromise) {
    return zipCachePromise;
  }

  zipCachePath = filePath;
  zipCachePromise = (async () => {
    const JSZip = (await import("jszip")).default;
    const fileBuffer = await Bun.file(filePath).arrayBuffer();
    return JSZip.loadAsync(fileBuffer);
  })();
  // Drop a failed load so the next request retries instead of caching the error.
  zipCachePromise.catch(() => {
    if (zipCachePath === filePath) {
      zipCachePath = null;
      zipCachePromise = null;
    }
  });
  return zipCachePromise;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const securityToken = randomBytes(32).toString('hex');
let serverPort = 0;
const recentDir = join(homedir(), ".cbxtool");
const recentFilePath = join(recentDir, "recent.json");
const downloadsDir = join(homedir(), "Downloads");

async function loadRecentFilesFromDisk(): Promise<RecentFileEntry[]> {
  const recentFile = Bun.file(recentFilePath);
  if (!(await recentFile.exists())) {
    return [];
  }

  const content = await recentFile.text();
  return JSON.parse(content) as RecentFileEntry[];
}

// High-performance binary bridge
const server = Bun.serve({
  port: 0, // Random available port
  async fetch(req) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    // Set up CORS headers
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (token !== securityToken) {
      return new Response("Unauthorized", { status: 401, headers });
    }

    if (req.method === "POST" && url.pathname === "/clipboard-image") {
      try {
        const arrayBuffer = await req.arrayBuffer();
        Electrobun.Utils.clipboardWriteImage(new Uint8Array(arrayBuffer));
        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 500, headers });
      }
    }

    const filePath = url.searchParams.get("path");
    if (!filePath) return new Response("Missing path", { status: 400, headers });

    if (req.method === "GET" && url.pathname === "/zip-entry") {
      const entryName = url.searchParams.get("entry");
      if (!entryName) return new Response("Missing entry", { status: 400, headers });

      try {
        const zip = await loadZipCached(filePath);
        const entry = zip.files[entryName];
        if (!entry || entry.dir) {
          return new Response("Entry not found", { status: 404, headers });
        }

        const content = await entry.async("arraybuffer");
        const lastDot = entryName.lastIndexOf(".");
        const ext = lastDot !== -1 ? entryName.toLowerCase().slice(lastDot) : "";
        headers.set("Content-Type", CONTENT_TYPES[ext] || "application/octet-stream");
        return new Response(content, { headers });
      } catch (e) {
        console.error("zip-entry error:", e);
        return new Response("Failed to read entry", { status: 500, headers });
      }
    }

    if (req.method === "GET") {
      const bunFile = Bun.file(filePath);
      if (!(await bunFile.exists())) {
        return new Response("File not found", { status: 404, headers });
      }
      return new Response(bunFile, { headers });
    } else if (req.method === "POST") {
      try {
        const arrayBuffer = await req.arrayBuffer();
        await Bun.write(filePath, new Uint8Array(arrayBuffer));
        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 500, headers });
      }
    }

    return new Response("Not Found", { status: 404, headers });
  }
});

serverPort = server.port || 0;

console.log("[Backend] APP STARTING - Build Time: " + new Date().toISOString());

const rpc = defineElectrobunRPC("bun", {
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      getBinaryConfig: async () => {
        return { port: serverPort, token: securityToken };
      },
      getRecentFiles: async () => {
        try {
          return await loadRecentFilesFromDisk();
        } catch (e) {
          console.error("Failed to read recent files:", e);
          return [];
        }
      },
      addRecentFile: async ({ name, filePath }: AddRecentFileParams) => {
        if (!filePath) return { success: false };

        try {
          await mkdir(recentDir, { recursive: true });
          let current: RecentFileEntry[] = [];
          try {
            current = await loadRecentFilesFromDisk();
          } catch {
            // Ignore parse/read errors and rebuild the recent file list.
          }

          // Remove if it already exists to bring it to the front,
          // preserving its saved reading position.
          const existing = current.find((f) => f.path === filePath);
          current = current.filter((f) => f.path !== filePath);

          // Add to front
          current.unshift({ name, path: filePath, lastPageIndex: existing?.lastPageIndex, totalPages: existing?.totalPages });

          // Keep top 10
          if (current.length > 10) current = current.slice(0, 10);

          await Bun.write(recentFilePath, JSON.stringify(current, null, 2));
          return { success: true };
        } catch (e) {
          console.error("Failed to add recent file:", e);
          return { success: false };
        }
      },
      saveReadingPosition: async ({ filePath, pageIndex, totalPages }: { filePath: string; pageIndex: number; totalPages: number }) => {
        try {
          const current = await loadRecentFilesFromDisk();
          const entry = current.find((f) => f.path === filePath);
          if (!entry) return { success: false };
          entry.lastPageIndex = pageIndex;
          entry.totalPages = totalPages;
          await Bun.write(recentFilePath, JSON.stringify(current, null, 2));
          return { success: true };
        } catch (e) {
          console.error("Failed to save reading position:", e);
          return { success: false };
        }
      },
      getReadingPosition: async ({ filePath }: { filePath: string }) => {
        try {
          const current = await loadRecentFilesFromDisk();
          const entry = current.find((f) => f.path === filePath);
          return { pageIndex: entry?.lastPageIndex ?? 0 };
        } catch {
          return { pageIndex: 0 };
        }
      },
      clearRecentFiles: async () => {
        try {
          await unlink(recentFilePath);
          return { success: true };
        } catch {
          // If it doesn't exist, clearing is effectively successful
          return { success: true };
        }
      },
      showSaveDialog: async ({ defaultPath }: ShowSaveDialogParams) => {
        const filePaths = await Electrobun.Utils.openFileDialog({
          startingFolder: downloadsDir,
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false
        });

        const canceled = filePaths.length === 0 || (filePaths.length === 1 && filePaths[0] === "");
        if (canceled) {
          return { canceled: true };
        }

        const folderPath = filePaths[0];
        if (!folderPath || typeof folderPath !== 'string') {
          return { canceled: true };
        }

        const fileName = defaultPath.split(/[\\\/]/).pop() || "comic.cbz";
        const normalizedFolderPath = (folderPath.endsWith("/") || folderPath.endsWith("\\"))
          ? folderPath.slice(0, -1)
          : folderPath;

        const finalPath = `${normalizedFolderPath}/${fileName}`;
        console.log(`[Backend] showSaveDialog returning: ${finalPath}`);
        return { canceled: false, filePath: finalPath };
      },

      showOpenDialog: async ({ canChooseDirectory = false, allowMultiple = false, allowedFileTypes = "" }: ShowOpenDialogParams = {}) => {
        console.log(`[Backend] showOpenDialog called, canChooseDirectory: ${canChooseDirectory}, allowMultiple: ${allowMultiple}`);

        let fileTypes = allowedFileTypes;
        if (!fileTypes) {
          fileTypes = canChooseDirectory ? "" : "*.cbz,*.cbr";
        }

        const dialogOptions: any = {
          startingFolder: downloadsDir,
          canChooseFiles: !canChooseDirectory,
          canChooseDirectory: canChooseDirectory,
          allowsMultipleSelection: allowMultiple
        };
        if (!IS_WIN) dialogOptions.allowedFileTypes = fileTypes;

        const filePaths = await Electrobun.Utils.openFileDialog(dialogOptions);

        console.log(`[Backend] openFileDialog result:`, filePaths);
        const canceled = !filePaths || filePaths.length === 0 || (filePaths.length === 1 && filePaths[0] === "");
        return { canceled, filePaths: canceled ? [] : filePaths };
      },

      extractCBR: async ({ filePath }: ExtractCBRParams) => {
        console.log(`[Backend] Extracting CBR: ${filePath}`);

        try {
          const extractor = await createRarExtractor(filePath);
          const { files } = extractor.extract();

          const images: { name: string; path: string }[] = [];
          const tempDir = await mkdtemp(join(tmpdir(), "cbx-tool-"));
          console.log(`[Backend] Temporary extraction folder: ${tempDir}`);

          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

          for (const fileItem of files) {
            if (fileItem.fileHeader.flags.directory) continue;

            const filename = fileItem.fileHeader.name;
            const lastDot = filename.lastIndexOf(".");
            const ext = lastDot !== -1 ? filename.toLowerCase().slice(lastDot) : "";

            if (imageExtensions.includes(ext) && fileItem.extraction) {
              const pagePath = join(tempDir, basename(filename));
              await Bun.write(pagePath, fileItem.extraction);
              images.push({ name: filename, path: pagePath });
              if (images.length % 50 === 0) {
                console.log(`[Backend] Progress: ${images.length} images extracted...`);
              }
            }
          }

          // RAR entry order is archive order, not page order.
          images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

          return { success: true, files: images };
        } catch (e) {
          console.error("CBR Extraction Error:", e);
          return { success: false, error: (e as Error).message, files: [] };
        }
      },

      listCBZ: async ({ filePath }: ListCBZParams) => {
        console.log(`[Backend] Listing CBZ: ${filePath}`);
        try {
          // Force a reload so reopening a file that was modified on disk
          // (e.g. saved over) never serves stale entries from the cache.
          const zip = await loadZipCached(filePath, true);
          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

          const entries = Object.entries(zip.files)
            .filter(([name, f]) => !f.dir && imageExtensions.includes(extname(name).toLowerCase()))
            .map(([name]) => name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
            .map((name) => ({ name: basename(name), entry: name }));

          return { success: true, entries };
        } catch (e) {
          console.error("CBZ List Error:", e);
          return { success: false, error: (e as Error).message, entries: [] };
        }
      },

      extractCBZ: async ({ filePath }: ExtractCBZParams) => {
        console.log(`[Backend] Extracting CBZ: ${filePath}`);
        try {
          const JSZip = (await import("jszip")).default;
          const fileBuffer = await Bun.file(filePath).arrayBuffer();
          const zip = await JSZip.loadAsync(fileBuffer);

          const tempDir = await mkdtemp(join(tmpdir(), "cbx-tool-"));
          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
          const images: { name: string; path: string }[] = [];

          const entries = Object.entries(zip.files)
            .filter(([name, f]) => !f.dir && imageExtensions.includes(extname(name).toLowerCase()))
            .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

          for (const [name, file] of entries) {
            const content = await file.async("uint8array");
            const pagePath = join(tempDir, basename(name));
            await Bun.write(pagePath, content);
            images.push({ name: basename(name), path: pagePath });
          }

          return { success: true, files: images };
        } catch (e) {
          console.error("CBZ Extraction Error:", e);
          return { success: false, error: (e as Error).message, files: [] };
        }
      },

      extractArchiveToFolder: async ({ sourcePath, destinationPath, type, filenames }: ExtractArchiveToFolderParams) => {
        console.log(`[Backend] extractArchiveToFolder: ${sourcePath} -> ${destinationPath} (${type})`);

        try {
          await mkdir(destinationPath, { recursive: true });
          const allowedFilenames = new Set(filenames);

          if (type === "cbr") {
            const extractor = await createRarExtractor(sourcePath);
            const { files } = extractor.extract();
            for (const fileItem of files) {
              if (fileItem.fileHeader.flags.directory) continue;
              if (!allowedFilenames.has(fileItem.fileHeader.name)) continue;
              const targetFile = join(destinationPath, basename(fileItem.fileHeader.name));
              if (fileItem.extraction) {
                await Bun.write(targetFile, fileItem.extraction);
              }
            }
          } else if (type === "cbz") {
            const JSZip = (await import("jszip")).default;
            const fileBuffer = await Bun.file(sourcePath).arrayBuffer();
            const zip = await JSZip.loadAsync(fileBuffer);

            for (const [filename, file] of Object.entries(zip.files)) {
              if (file.dir) continue;
              if (!allowedFilenames.has(filename)) continue;
              const content = await file.async("uint8array");
              const targetFile = join(destinationPath, basename(filename));
              await Bun.write(targetFile, content);
            }
          }

          return { success: true };
        } catch (e) {
          console.error("Extraction to folder error:", e);
          return { success: false, error: (e as Error).message };
        }
      },

      readFolder: async ({ folderPath }: ReadFolderParams) => {
        try {
          const files = await readdir(folderPath);
          const images: { name: string; path: string; time: number }[] = [];
          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

          for (const filename of files) {
            const ext = extname(filename).toLowerCase();
            if (imageExtensions.includes(ext)) {
              const filePath = join(folderPath, filename);
              const stats = await stat(filePath);
              // Use birthtime if available and non-zero, otherwise mtime
              const time = stats.birthtimeMs || stats.mtimeMs;

              images.push({
                name: filename,
                path: filePath,
                time: time
              });
            }
          }

          // Sort by time, then name as fallback
          images.sort((a, b) => {
            if (a.time !== b.time) {
              return a.time - b.time;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          });

          return { success: true, files: images.map(({ name, path }) => ({ name, path })) };
        } catch (e) {
          console.error("Read Folder Error:", e);
          return { success: false, error: (e as Error).message, files: [] };
        }
      },
    }
  }
});

const { x, y, width, height } = Screen.getPrimaryDisplay().workArea;
const mainWindow = new BrowserWindow({
  frame: { x, y, width, height },
  title: "CBX Tool",
  url: "views://mainview/index.html",
  rpc,
});
mainWindow.maximize();

