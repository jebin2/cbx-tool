import { PDFDocument } from "pdf-lib";
import { state } from "./state.ts";
import { showMessageModal, showPromptModal } from "./modal.ts";
import { setLoaderVisible } from "./ui.ts";
import { writeBridgeFile } from "./bridge.ts";
import { getParentPath } from "./utils.ts";

function detectImageType(bytes: Uint8Array): "jpeg" | "png" | "other" {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  return "other";
}

function toBitmapJpeg(imageUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob
            ? blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject)
            : reject(new Error("Canvas toBlob failed")),
        "image/jpeg",
        0.92,
      );
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = imageUrl;
  });
}

export async function exportAsPdf() {
  const activePages = state.pages.filter((p) => !p.disabled);
  if (!activePages.length) return;

  const baseName = state.currentFileName.replace(/\.(cbz|cbr)$/i, "");
  const defaultName = baseName + ".pdf";

  const newName = await showPromptModal({
    title: "Export as PDF",
    defaultValue: defaultName,
    confirmLabel: "Export",
  });
  if (!newName) return;

  const finalName = newName.toLowerCase().endsWith(".pdf") ? newName : newName + ".pdf";

  let savePath: string | null = null;
  if (state.rpc && state.binaryConfig) {
    let defaultPath = finalName;
    if (state.currentFilePath && !state.isFolderMode) {
      defaultPath = getParentPath(state.currentFilePath) + finalName;
    }
    const result = await state.rpc.request.showSaveDialog({ defaultPath });
    if (result.canceled || !result.filePath) return;
    savePath = result.filePath;
  }

  setLoaderVisible(true, "Exporting PDF…");
  try {
    const pdfDoc = await PDFDocument.create();

    for (const page of activePages) {
      const blobData = page.blob ?? await fetch(page.url).then((r) => r.blob());
      const arrayBuffer = await blobData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const type = detectImageType(bytes);

      let img;
      if (type === "jpeg") {
        img = await pdfDoc.embedJpg(bytes);
      } else if (type === "png") {
        img = await pdfDoc.embedPng(bytes);
      } else {
        // Convert unsupported formats (webp, gif, bmp) to JPEG via canvas
        const jpegBytes = await toBitmapJpeg(page.url);
        img = await pdfDoc.embedJpg(jpegBytes);
      }

      const pdfPage = pdfDoc.addPage([img.width, img.height]);
      pdfPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }

    const pdfBytes = await pdfDoc.save();

    if (savePath && state.binaryConfig) {
      await writeBridgeFile(savePath, pdfBytes.buffer as ArrayBuffer);
      await showMessageModal({
        title: "Exported",
        message: `PDF saved to ${savePath}`,
      });
    } else {
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalName;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error("PDF export error:", err);
    await showMessageModal({
      title: "Export Failed",
      message: "Error exporting PDF: " + (err as Error).message,
    });
  } finally {
    setLoaderVisible(false);
  }
}
