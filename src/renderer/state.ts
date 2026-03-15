import type { ComicPage, BinaryConfig, RPC } from "./types.ts";

export const state = {
  currentFileName: "",
  currentFilePath: null as string | null,
  pages: [] as ComicPage[],
  selectedPageIndex: -1,
  openRequestId: 0,

  rpc: null as RPC | null,
  binaryConfig: null as BinaryConfig | null,
  isFolderMode: false,

  isSpreadMode: false,
  hstripWidths: [] as number[],
  hstripLefts: [] as number[],
  hstripTotalWidth: 0,
  hstripElementMap: new Map() as Map<number, HTMLImageElement>,
  vstripTops: [] as number[],
  vstripHeights: [] as number[],
  vstripTotalHeight: 0,
  vstripElementMap: new Map() as Map<number, HTMLImageElement>,
  isScrollingProgrammatically: false,
  autoScrollInterval: null as number | null,
  draggedItemIndex: null as number | null,
  dragScrollRequest: null as number | null,
  lastDragClientY: 0,
  copyFeedbackTimeout: null as number | null,
};
