import type { RPCType, RPC } from "./types.ts";
import { state } from "./state.ts";

export function createBridgeUrl(pathname: string, params: Record<string, string> = {}): string {
  if (!state.binaryConfig) {
    throw new Error("Binary bridge is not available.");
  }

  const url = new URL(`http://localhost:${state.binaryConfig.port}${pathname}`);
  url.searchParams.set("token", state.binaryConfig.token);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

export async function fetchBridgeBlob(filePath: string): Promise<Blob> {
  const response = await fetch(createBridgeUrl("/file", { path: filePath }));
  if (!response.ok) {
    throw new Error(response.statusText || "File fetch failed.");
  }
  return response.blob();
}

export async function fetchBridgeFile(filePath: string, fileName: string, type = "application/octet-stream") {
  const blob = await fetchBridgeBlob(filePath);
  return new File([blob], fileName, { type });
}

export async function writeBridgeFile(filePath: string, content: ArrayBuffer) {
  const response = await fetch(createBridgeUrl("/file", { path: filePath }), {
    method: "POST",
    body: content,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      // Ignore JSON parse failures and keep the response status text.
    }
    throw new Error(message || "File save failed.");
  }
}

export async function initRPC(onReady: () => void) {
  try {
    const { Electroview } = await import("electrobun/view");

    const electroview = new Electroview({
      rpc: Electroview.defineRPC<RPCType>({
        maxRequestTime: Infinity,
        handlers: {
          requests: {},
        },
      }),
    });

    state.rpc = electroview.rpc as RPC;
    console.log("RPC initialized successfully");
    state.binaryConfig = await state.rpc.request.getBinaryConfig({});
    onReady();
  } catch (error) {
    console.error("Failed to initialize RPC:", error);
  }
}
