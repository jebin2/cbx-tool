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

    const filePath = url.searchParams.get("path");
    if (!filePath) return new Response("Missing path", { status: 400, headers });

    if (req.method === "GET") {
      return new Response(Bun.file(filePath), { headers });
    } else if (req.method === "POST") {
      try {
        const arrayBuffer = await req.arrayBuffer();
        await writeFile(filePath, Buffer.from(arrayBuffer));
        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 500, headers });
      }
    }

    return new Response("Not Found", { status: 404, headers });
  }
});

serverPort = server.port;

const rpc = defineElectrobunRPC("bun", {
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      getBinaryConfig: async () => {
        return { port: serverPort, token: securityToken };
      },
      showSaveDialog: async ({ defaultPath }: { defaultPath: string }) => {
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
        const fileName = defaultPath.split(/[\\\/]/).pop() || "comic.cbz";
        const normalizedFolderPath = folderPath.endsWith("/") || folderPath.endsWith("\\") 
          ? folderPath.slice(0, -1) 
          : folderPath;
        
        return { canceled: false, filePath: `${normalizedFolderPath}/${fileName}` };
      },

      showOpenDialog: async () => {
        const filePaths = await Electrobun.Utils.openFileDialog({
          allowedFileTypes: "*.cbz,*.cbr",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false
        });
        
        const canceled = filePaths.length === 0 || (filePaths.length === 1 && filePaths[0] === "");
        return { canceled, filePaths: canceled ? [] : filePaths };
      }
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
