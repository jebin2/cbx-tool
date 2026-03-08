import { unrarWasmB64 } from "./src/bun/unrar-wasm";
import { createExtractorFromData } from "node-unrar-js";

async function test() {
  try {
    const wasmBuffer = Buffer.from(unrarWasmB64, 'base64');
    const wasmBinary = wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength);
    console.log("WASM Binary Size:", wasmBinary.byteLength);
    
    // We don't have a real rar file here to test full extraction, 
    // but we can see if the library initializes.
    // createExtractorFromData usually tries to compile the WASM immediately.
    try {
        await createExtractorFromData({ data: new ArrayBuffer(0), wasmBinary: wasmBinary as ArrayBuffer });
    } catch (e) {
        // It will fail because of empty data, but we want to see if it's a WASM error
        console.log("Expected init error (data):", (e as Error).message);
    }
    console.log("WASM test finished without crashing.");
  } catch (err) {
    console.error("WASM Test Failed:", err);
  }
}

test();
