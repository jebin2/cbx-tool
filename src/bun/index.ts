import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { randomBytes } from "crypto";
import { mkdir, mkdtemp, readdir, stat, unlink } from "fs/promises";
import { basename, extname, join } from "path";
import { homedir, tmpdir } from "os";

type RecentFileEntry = { name: string; path: string };

// --- RPC handler param types (mirrors RPCType in renderer) ---
type AddRecentFileParams = { name: string; filePath: string };
type ShowSaveDialogParams = { defaultPath: string };
type ShowOpenDialogParams = { canChooseDirectory?: boolean; allowMultiple?: boolean; allowedFileTypes?: string };
type ExtractCBRParams = { filePath: string };
type ExtractArchiveToFolderParams = { sourcePath: string; destinationPath: string; type: "cbz" | "cbr" };
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

const securityToken = randomBytes(32).toString('hex');
let serverPort = 0;
const recentDir = join(homedir(), ".cbxtool");
const recentFilePath = join(recentDir, "recent.json");

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

    if (req.method === "GET") {
      return new Response(Bun.file(filePath), { headers });
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

          // Remove if it already exists to bring it to the front
          current = current.filter((f) => f.path !== filePath);

          // Add to front
          current.unshift({ name, path: filePath });

          // Keep top 10
          if (current.length > 10) current = current.slice(0, 10);

          await Bun.write(recentFilePath, JSON.stringify(current, null, 2));
          return { success: true };
        } catch (e) {
          console.error("Failed to add recent file:", e);
          return { success: false };
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
          startingFolder: defaultPath.includes("/") ? defaultPath.slice(0, defaultPath.lastIndexOf("/")) : "~/",
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

        const filePaths = await Electrobun.Utils.openFileDialog({
          allowedFileTypes: fileTypes,
          canChooseFiles: !canChooseDirectory,
          canChooseDirectory: canChooseDirectory,
          allowsMultipleSelection: allowMultiple
        });

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

          return { success: true, files: images };
        } catch (e) {
          console.error("CBR Extraction Error:", e);
          return { success: false, error: (e as Error).message, files: [] };
        }
      },

      extractArchiveToFolder: async ({ sourcePath, destinationPath, type }: ExtractArchiveToFolderParams) => {
        console.log(`[Backend] extractArchiveToFolder: ${sourcePath} -> ${destinationPath} (${type})`);

        try {
          await mkdir(destinationPath, { recursive: true });

          if (type === "cbr") {
            const extractor = await createRarExtractor(sourcePath);
            const { files } = extractor.extract();
            for (const fileItem of files) {
              if (fileItem.fileHeader.flags.directory) continue;
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

const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  title: "CBX Tool",
  url: "views://mainview/index.html",
  rpc,
});
