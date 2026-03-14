import { copyBtn, copyBtnLabel, currentImage } from "./dom.ts";
import { showMessageModal } from "./modal.ts";
import { state } from "./state.ts";
import { createBridgeUrl } from "./bridge.ts";
import { clearCopyButtonFeedback, setCopyButtonFeedback, updateCopyButtonState } from "./ui.ts";

function loadImageForClipboard(src: string): Promise<HTMLImageElement> {
  if (currentImage.src === src && currentImage.complete && currentImage.naturalWidth > 0) {
    return Promise.resolve(currentImage);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the page image for clipboard copy."));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not prepare the image for clipboard copy."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

async function createClipboardImageBlob(pageUrl: string): Promise<Blob> {
  const image = await loadImageForClipboard(pageUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error("The selected page is not ready to copy yet.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available for clipboard copy.");
  }

  ctx.drawImage(image, 0, 0, width, height);
  return canvasToBlob(canvas, "image/png");
}

async function copyImageViaBinaryBridge(blob: Blob) {
  if (!state.binaryConfig) {
    throw new Error("Binary bridge is not available.");
  }

  const response = await fetch(createBridgeUrl("/clipboard-image"), {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: await blob.arrayBuffer(),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      // Ignore JSON parse errors and use status text.
    }
    throw new Error(message || "Clipboard write failed.");
  }
}

async function copyImageViaWebClipboard(blob: Blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy is not supported in this app runtime.");
  }

  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}

export async function copyCurrentPageToClipboard() {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;

  clearCopyButtonFeedback();
  copyBtn.disabled = true;
  copyBtnLabel.textContent = "Copying...";

  try {
    const blob = await createClipboardImageBlob(selectedPage.url);
    if (state.binaryConfig) {
      await copyImageViaBinaryBridge(blob);
    } else {
      await copyImageViaWebClipboard(blob);
    }

    setCopyButtonFeedback("success", "Copied", "Current page copied to clipboard");
  } catch (error) {
    console.error("Error copying page to clipboard:", error);
    setCopyButtonFeedback("error", "Retry", "Copy failed");
    await showMessageModal({
      title: "Copy Failed",
      message: "Could not copy the current page to the clipboard: " + (error as Error).message,
    });
  } finally {
    updateCopyButtonState();
  }
}
