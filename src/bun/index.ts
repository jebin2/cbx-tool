import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { writeFile } from "fs/promises";
import { randomBytes } from "crypto";

const securityToken = randomBytes(32).toString('hex');
let serverPort = 0;

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
        await writeFile(filePath, new Uint8Array(arrayBuffer));
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
        const fs = await import("fs/promises");
        const path = await import("path");
        const os = await import("os");
        const recentFilePath = path.join(os.homedir(), ".cbxtool", "recent.json");
        try {
          const content = await fs.readFile(recentFilePath, "utf-8");
          return JSON.parse(content);
        } catch (e: any) {
          if (e.code === "ENOENT") return [];
          console.error("Failed to read recent files:", e);
          return [];
        }
      },
      addRecentFile: async ({ name, filePath }: any) => {
        if (!filePath) return { success: false };
        const fs = await import("fs/promises");
        const fsSync = await import("fs");
        const path = await import("path");
        const os = await import("os");
        const dir = path.join(os.homedir(), ".cbxtool");
        const recentFilePath = path.join(dir, "recent.json");
        try {
          if (!fsSync.existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
          }
          let current: { name: string; path: string }[] = [];
          try {
            const content = await fs.readFile(recentFilePath, "utf-8");
            current = JSON.parse(content);
          } catch (e: any) {
            // Ignore read errors if it doesn't exist
          }

          // Remove if it already exists to bring it to the front
          current = current.filter((f) => f.path !== filePath);

          // Add to front
          current.unshift({ name, path: filePath });

          // Keep top 10
          if (current.length > 10) current = current.slice(0, 10);

          await fs.writeFile(recentFilePath, JSON.stringify(current, null, 2));
          return { success: true };
        } catch (e) {
          console.error("Failed to add recent file:", e);
          return { success: false };
        }
      },
      clearRecentFiles: async () => {
        const fs = await import("fs/promises");
        const path = await import("path");
        const os = await import("os");
        const recentFilePath = path.join(os.homedir(), ".cbxtool", "recent.json");
        try {
          await fs.unlink(recentFilePath);
          return { success: true };
        } catch (e: any) {
          // If it doesn't exist, clearing is effectively successful
          return { success: true };
        }
      },
      showSaveDialog: async ({ defaultPath }: any) => {
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

      showOpenDialog: async ({ canChooseDirectory = false, allowMultiple = false, allowedFileTypes = "" }: any = {}) => {
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

      extractCBR: async ({ filePath }: any) => {
        console.log(`[Backend] Extracting CBR: ${filePath}`);
        const { createExtractorFromData } = await import("node-unrar-js");
        const { unrarWasmB64 } = await import("./unrar-wasm");
        const os = await import("os");
        const path = await import("path");
        const fs = await import("fs");

        try {
          const fileCheck = Bun.file(filePath);
          if (!(await fileCheck.exists())) {
            throw new Error(`File does not exist: ${filePath}`);
          }

          const fileBuffer = await fileCheck.arrayBuffer();
          const wasmBuffer = Buffer.from(unrarWasmB64, 'base64');

          const extractor = await createExtractorFromData({
            data: fileBuffer,
            wasmBinary: wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength) as ArrayBuffer
          });

          const { files } = extractor.extract();

          const images: { name: string; path: string }[] = [];

          const tempBaseDir = path.join(os.tmpdir(), "cbx-tool-");
          const tempDir = fs.mkdtempSync(tempBaseDir);
          console.log(`[Backend] Temporary extraction folder: ${tempDir}`);

          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

          let fileCount = 0;
          for (const fileItem of files) {
            fileCount++;
            const filename = fileItem.fileHeader.name;

            if (fileItem.fileHeader.flags.directory) {
              continue;
            }

            const lastDot = filename.lastIndexOf(".");
            const ext = lastDot !== -1 ? filename.toLowerCase().slice(lastDot) : "";

            if (imageExtensions.includes(ext)) {
              if (fileItem.extraction) {
                const pagePath = path.join(tempDir, path.basename(filename));
                await Bun.write(pagePath, fileItem.extraction);
                images.push({
                  name: filename,
                  path: pagePath
                });
                if (images.length % 50 === 0) {
                  console.log(`[Backend] Progress: ${images.length} images extracted...`);
                }
              }
            }
          }


          return { success: true, files: images };

        } catch (e) {
          console.error("CBR Extraction Error:", e);
          return { success: false, error: (e as Error).message, files: [] };
        }
      },

      extractArchiveToFolder: async ({ sourcePath, destinationPath, type }: any) => {
        console.log(`[Backend] extractArchiveToFolder: ${sourcePath} -> ${destinationPath} (${type})`);
        const fs = await import("fs");
        const path = await import("path");

        try {
          if (!fs.existsSync(destinationPath)) {
            fs.mkdirSync(destinationPath, { recursive: true });
          }

          if (type === 'cbr') {
            const { createExtractorFromData } = await import("node-unrar-js");
            const { unrarWasmB64 } = await import("./unrar-wasm");
            const fileBuffer = await Bun.file(sourcePath).arrayBuffer();
            const wasmBuffer = Buffer.from(unrarWasmB64, 'base64');

            const extractor = await createExtractorFromData({
              data: fileBuffer,
              wasmBinary: wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength) as ArrayBuffer
            });

            const { files } = extractor.extract();
            for (const fileItem of files) {
              if (fileItem.fileHeader.flags.directory) continue;
              const targetFile = path.join(destinationPath, path.basename(fileItem.fileHeader.name));
              if (fileItem.extraction) {
                await Bun.write(targetFile, fileItem.extraction);
              }
            }
          } else if (type === 'cbz') {
            // Use JSZip on backend if possible, or simple Bun file read
            // Since we already use JSZip on frontend, Let's use it here too for consistency if needed, 
            // but for backend performance, we might want a native hook or just Bun.file.
            // Actually, for .cbz (ZIP), we can use the 'unzip' command if available or a library.
            // For simplicity and to avoid new dependencies, let's use JSZip which is already in package.json.
            const JSZip = (await import("jszip")).default;
            const fileBuffer = await Bun.file(sourcePath).arrayBuffer();
            const zip = await JSZip.loadAsync(fileBuffer);

            for (const [filename, file] of Object.entries(zip.files)) {
              if (file.dir) continue;
              const content = await file.async("uint8array");
              const targetFile = path.join(destinationPath, path.basename(filename));
              await Bun.write(targetFile, content);
            }
          }

          return { success: true };
        } catch (e) {
          console.error("Extraction to folder error:", e);
          return { success: false, error: (e as Error).message };
        }
      },

      readFolder: async ({ folderPath }: any) => {
        const { readdir, stat } = await import("fs/promises");
        const path = await import("path");

        try {
          const files = await readdir(folderPath);
          const images: { name: string; path: string; time: number }[] = [];
          const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

          for (const filename of files) {
            const ext = path.extname(filename).toLowerCase();
            if (imageExtensions.includes(ext)) {
              const filePath = path.join(folderPath, filename);
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
