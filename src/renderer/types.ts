export type ComicPage = {
  filename: string;
  url: string;
  blob: Blob;
  disabled: boolean;
  originalOrder: number;
};

export type BinaryConfig = {
  port: number;
  token: string;
};

export type FileEntry = {
  name: string;
  path: string;
};

export type OpenableFile = File & {
  path?: string;
};

export type RPCType = {
  bun: {
    requests: {
      getBinaryConfig: {
        params: Record<string, never>;
        response: BinaryConfig;
      };
      showSaveDialog: {
        params: { defaultPath: string };
        response: { canceled: boolean; filePath?: string };
      };
      showOpenDialog: {
        params: { canChooseDirectory?: boolean; allowMultiple?: boolean; allowedFileTypes?: string };
        response: { canceled: boolean; filePaths: string[] };
      };
      getRecentFiles: {
        params: Record<string, never>;
        response: FileEntry[];
      };
      addRecentFile: {
        params: { name: string; filePath: string };
        response: { success: boolean };
      };
      clearRecentFiles: {
        params: Record<string, never>;
        response: { success: boolean };
      };
      extractCBR: {
        params: { filePath: string };
        response: { success: boolean; error?: string; files: FileEntry[] };
      };
      readFolder: {
        params: { folderPath: string };
        response: { success: boolean; error?: string; files: FileEntry[] };
      };
      extractArchiveToFolder: {
        params: {
          sourcePath: string;
          destinationPath: string;
          type: "cbz" | "cbr";
          filenames: string[];
        };
        response: { success: boolean; error?: string };
      };
    };
    messages: {};
    push: {};
  };
  webview: {
    requests: {};
    messages: {};
    push: {};
  };
};

export type RPC = {
  request: {
    [K in keyof RPCType["bun"]["requests"]]: (
      params: RPCType["bun"]["requests"][K]["params"]
    ) => Promise<RPCType["bun"]["requests"][K]["response"]>;
  };
};
