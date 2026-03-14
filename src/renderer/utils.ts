import { IMAGE_EXTENSIONS } from "./constants.ts";

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.toLowerCase().slice(lastDot);
}

export function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "";
}

export function getFolderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).pop() || "Images";
}

export function getParentPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return lastSlash === -1 ? "" : filePath.slice(0, lastSlash + 1);
}

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExtension(filename));
}

export async function waitForUiTick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
