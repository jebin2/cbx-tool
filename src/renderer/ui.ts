import type { ComicPage } from "./types.ts";
import {
  COPY_BTN_DEFAULT_LABEL,
  COPY_BTN_DEFAULT_TITLE,
  COPY_FEEDBACK_DURATION_MS,
  DRAG_SCROLL_MAX_SPEED,
  DRAG_SCROLL_THRESHOLD,
  SCROLL_FLAG_RESET_DELAY_MS,
} from "./constants.ts";
import {
  copyBtn,
  copyBtnLabel,
  currentImage,
  dropZone,
  extractBtn,
  pdfBtn,
  fitToggleBtn,
  hStripBtn,
  spreadBtn,
  spreadImage,
  landingContainer,
  loader,
  loaderText,
  nextImage,
  pageCount,
  pageList,
  prevImage,
  previewContainer,
  progressBar,
  progressBarContainer,
  recentFilesContainer,
  saveBtn,
  sidebar,
  toolbar,
  viewerNode,
} from "./dom.ts";
import { state } from "./state.ts";
import { replacePages } from "./pages.ts";

// ─── Fit toggle icon helpers ──────────────────────────────────────────────────

const FIT_WIDTH_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>`;
const FIT_HEIGHT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15v6h6M19 9V3h-6M5 21l7-7M19 3l-7 7" /></svg>`;

/** Call after switching to fit-height mode — button now offers fit-width */
export function setFitToggleToFitWidth() {
  fitToggleBtn.innerHTML = FIT_WIDTH_SVG;
  fitToggleBtn.title = "Fit to Width";
}

/** Call after switching to fit-width mode — button now offers fit-height */
export function setFitToggleToFitHeight() {
  fitToggleBtn.innerHTML = FIT_HEIGHT_SVG;
  fitToggleBtn.title = "Fit to Height";
}

// ─── Loader / viewer state ────────────────────────────────────────────────────

export function setLoaderVisible(isVisible: boolean, message = "Loading comic…") {
  loader.classList.toggle("hidden", !isVisible);
  if (isVisible) loaderText.textContent = message;
}

export function setSaveButtonMode(mode: "save" | "convert") {
  state.isFolderMode = mode === "convert";
  saveBtn.innerHTML = mode === "convert"
    ? `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l2 3h9a2 2 0 0 1 2 2z" />
          <polyline points="12 11 12 17M9 14l3 3 3-3" />
        </svg>
        Convert to CBZ
      `
    : `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save
      `;
}

// ─── Horizontal strip mode ────────────────────────────────────────────────────

const HSTRIP_BUFFER = 1; // extra pages preloaded beyond the viewport on each side
const HSTRIP_GAP = 16;   // must match CSS gap on .preview-container.hstrip

/** Half the window size: half the pages that fit in the viewport, plus a 1-page buffer. */
function hstripHalfWindow(): number {
  if (!viewerNode) return 3;
  const estimatedPageWidth = viewerNode.clientHeight * (2 / 3);
  const pagesPerView = Math.ceil(viewerNode.clientWidth / estimatedPageWidth);
  // half = half the viewport + buffer, so total window ≈ pagesPerView + 2*BUFFER + 1
  return Math.ceil(pagesPerView / 2) + HSTRIP_BUFFER;
}

/** Build one img node for a given page index (no src set yet). */
function makeHStripImg(pageIndex: number): HTMLImageElement {
  const page = state.pages[pageIndex];
  const img = document.createElement("img");
  img.className = "preview-image hstrip-page";
  img.dataset.pageIndex = String(pageIndex);
  img.alt = `Page ${pageIndex + 1}`;
  if (page.disabled) img.dataset.disabled = "true";
  // Pre-set estimated width so prepend scroll-compensation is accurate.
  if (viewerNode) img.style.width = Math.round(viewerNode.clientHeight * 2 / 3) + "px";
  img.addEventListener("load", () => {
    const prevW = parseInt(img.style.width) || 0;
    // Remove the estimated width so the browser computes the natural display
    // width at the CSS-constrained height (height: calc(...), width: auto).
    img.style.removeProperty("width");
    const actualW = img.offsetWidth;
    img.style.width = actualW + "px"; // lock actual rendered width
    const delta = actualW - prevW;
    // If this image is to the left of the current viewport, compensate scrollLeft
    // so the visible content doesn't jump.
    if (delta !== 0 && viewerNode && img.offsetLeft < viewerNode.scrollLeft) {
      viewerNode.scrollLeft += delta;
    }
    cacheHStripOffsets();
  });
  return img;
}

/** Cache offsetLeft for each element in the window, keyed by global page index. */
export function cacheHStripOffsets() {
  state.hstripPageOffsets = [];
  state.hstripPageElements.forEach((img, j) => {
    state.hstripPageOffsets[state.hstripWindowStart + j] = img.offsetLeft;
  });
}

/**
 * Expand the loaded window so that [centerIndex - half, centerIndex + half] is
 * always covered.  Only the images in this range exist in the DOM; no
 * placeholder elements are created for pages outside the window.
 */
export function loadHStripWindow(centerIndex: number) {
  const half = hstripHalfWindow();
  const targetLo = Math.max(0, centerIndex - half);
  const targetHi = Math.min(state.pages.length - 1, centerIndex + half);

  // If the center jumped completely outside the current window, rebuild.
  const currentEnd = state.hstripWindowStart + state.hstripPageElements.length - 1;
  if (centerIndex < state.hstripWindowStart || centerIndex > currentEnd) {
    rebuildHStripWindow(centerIndex);
    return;
  }

  // Expand right; prune from left to keep window bounded.
  while (state.hstripWindowStart + state.hstripPageElements.length - 1 < targetHi) {
    const nextIdx = state.hstripWindowStart + state.hstripPageElements.length;
    if (nextIdx >= state.pages.length) break;
    const img = makeHStripImg(nextIdx);
    if (!state.pages[nextIdx].disabled) img.src = state.pages[nextIdx].url;
    previewContainer.appendChild(img);
    state.hstripPageElements.push(img);

    // Prune the leftmost element if it's behind the load window.
    if (state.hstripWindowStart < targetLo) {
      const removed = state.hstripPageElements.shift()!;
      const removedWidth = removed.offsetWidth; // read before removing from DOM
      removed.remove();
      state.hstripWindowStart++;
      // Shift scrollLeft left by the removed width so visible content stays put.
      if (viewerNode) viewerNode.scrollLeft -= removedWidth + HSTRIP_GAP;
    }
  }

  // Expand left — prepend and compensate scrollLeft so viewport content is stable;
  // prune from the right to keep window bounded.
  while (state.hstripWindowStart > targetLo) {
    const prevIdx = state.hstripWindowStart - 1;
    const img = makeHStripImg(prevIdx);
    if (!state.pages[prevIdx].disabled) img.src = state.pages[prevIdx].url;
    previewContainer.insertBefore(img, state.hstripPageElements[0]);
    state.hstripPageElements.unshift(img);
    state.hstripWindowStart--;
    if (viewerNode) viewerNode.scrollLeft += img.offsetWidth + HSTRIP_GAP;

    // Prune the rightmost element if it's beyond the load window.
    const currentEnd = state.hstripWindowStart + state.hstripPageElements.length - 1;
    if (currentEnd > targetHi) {
      const removed = state.hstripPageElements.pop()!;
      removed.remove();
    }
  }

  cacheHStripOffsets();
}

/** Tear down and rebuild the window centered on centerIndex. */
function rebuildHStripWindow(centerIndex: number) {
  state.hstripPageElements.forEach((img) => img.remove());
  state.hstripPageElements = [];

  const half = hstripHalfWindow();
  const lo = Math.max(0, centerIndex - half);
  const hi = Math.min(state.pages.length - 1, centerIndex + half);
  state.hstripWindowStart = lo;

  for (let i = lo; i <= hi; i++) {
    const img = makeHStripImg(i);
    if (!state.pages[i].disabled) img.src = state.pages[i].url;
    previewContainer.appendChild(img);
    state.hstripPageElements.push(img);
  }

  requestAnimationFrame(() => {
    cacheHStripOffsets();
    const offsetInWindow = centerIndex - state.hstripWindowStart;
    const target = state.hstripPageElements[offsetInWindow];
    if (viewerNode && target) viewerNode.scrollLeft = target.offsetLeft;
  });
}

export function enterHStripMode() {
  prevImage.style.display = "none";
  currentImage.style.display = "none";
  spreadImage.style.display = "none";
  nextImage.style.display = "none";

  state.hstripPageElements = [];
  state.hstripWindowStart = 0;

  const center = state.selectedPageIndex >= 0 ? state.selectedPageIndex : 0;
  rebuildHStripWindow(center);
}

export function exitHStripMode() {
  state.hstripPageElements.forEach((img) => img.remove());
  state.hstripPageElements = [];
  state.hstripPageOffsets = [];
  state.hstripWindowStart = 0;
  prevImage.style.display = "";
  currentImage.style.display = "";
  spreadImage.style.display = "";
  nextImage.style.display = "";
}

export function showViewer(canExtract: boolean) {
  exitHStripMode();
  landingContainer.classList.add("hidden");
  recentFilesContainer.classList.add("hidden");
  dropZone.classList.add("hidden");
  progressBarContainer.classList.remove("hidden");
  previewContainer.classList.remove("hidden");
  previewContainer.classList.remove("fit-width", "spread", "hstrip");
  previewContainer.classList.add("fit-height");
  setFitToggleToFitWidth();
  hStripBtn.classList.remove("active");
  spreadBtn.classList.remove("active");
  state.isSpreadMode = false;
  viewerNode?.classList.remove("hstrip-mode");
  viewerNode?.classList.add("has-content");
  sidebar?.classList.remove("hidden");
  toolbar?.classList.remove("hidden");
  saveBtn.disabled = false;
  extractBtn.disabled = !canExtract;
  pdfBtn.disabled = false;
}

export function showLandingPage() {
  exitHStripMode();
  replacePages([]);
  state.currentFileName = "";
  state.currentFilePath = null;
  state.isFolderMode = false;
  state.selectedPageIndex = -1;

  pageList.innerHTML = "";
  pageCount.textContent = "—";
  progressBar.style.width = "0%";
  progressBarContainer.classList.add("hidden");
  previewContainer.classList.add("hidden");
  previewContainer.classList.remove("fit-width", "fit-height", "spread", "hstrip");
  setFitToggleToFitWidth();
  hStripBtn.classList.remove("active");
  spreadBtn.classList.remove("active");
  state.isSpreadMode = false;
  viewerNode?.classList.remove("hstrip-mode");
  sidebar?.classList.add("hidden");
  toolbar?.classList.add("hidden");
  landingContainer.classList.remove("hidden");
  dropZone.classList.remove("hidden");
  recentFilesContainer.classList.remove("hidden");
  viewerNode?.classList.remove("has-content");

  prevImage.removeAttribute("src");
  currentImage.removeAttribute("src");
  nextImage.removeAttribute("src");

  saveBtn.disabled = true;
  extractBtn.disabled = true;
  pdfBtn.disabled = true;
  copyBtn.disabled = true;
  clearCopyButtonFeedback();
  setLoaderVisible(false);

  if (viewerNode) {
    viewerNode.scrollTo({ top: 0, behavior: "instant" });
  }
}

// ─── Progress / copy button ───────────────────────────────────────────────────

export function updateProgressBar() {
  if (!progressBar) return;

  const selectedPage = state.pages[state.selectedPageIndex];
  const activePageCount = state.pages.filter((page) => !page.disabled).length;

  if (!selectedPage || selectedPage.disabled || activePageCount === 0) {
    progressBar.style.width = "0%";
    return;
  }

  const activePosition = state.pages
    .slice(0, state.selectedPageIndex + 1)
    .filter((page) => !page.disabled).length;
  const progress = (activePosition / activePageCount) * 100;
  progressBar.style.width = `${progress}%`;
}

export function clearCopyButtonFeedback() {
  if (state.copyFeedbackTimeout !== null) {
    clearTimeout(state.copyFeedbackTimeout);
    state.copyFeedbackTimeout = null;
  }

  copyBtn.classList.remove("success", "error");
  copyBtnLabel.textContent = COPY_BTN_DEFAULT_LABEL;
  copyBtn.title = COPY_BTN_DEFAULT_TITLE;
}

export function updateCopyButtonState() {
  const selectedPage = state.pages[state.selectedPageIndex];
  const hasSelectedPage = Boolean(selectedPage && !selectedPage.disabled);
  copyBtn.disabled = !hasSelectedPage;

  if (!hasSelectedPage) {
    clearCopyButtonFeedback();
  }
}

export function setCopyButtonFeedback(type: "success" | "error", label: string, title: string) {
  clearCopyButtonFeedback();
  copyBtn.classList.add(type);
  copyBtnLabel.textContent = label;
  copyBtn.title = title;
  state.copyFeedbackTimeout = window.setTimeout(() => {
    state.copyFeedbackTimeout = null;
    clearCopyButtonFeedback();
  }, COPY_FEEDBACK_DURATION_MS);
}

export function resetPageSelection() {
  state.selectedPageIndex = -1;
  prevImage.removeAttribute("src");
  currentImage.removeAttribute("src");
  spreadImage.removeAttribute("src");
  nextImage.removeAttribute("src");
  document.querySelectorAll(".page-item").forEach((item) => {
    item.classList.remove("selected");
  });
  updateCopyButtonState();
  updateProgressBar();
}

function findEnabledPageIndex(startIndex: number, direction: 1 | -1, includeStart = false) {
  let index = includeStart ? startIndex : startIndex + direction;

  while (index >= 0 && index < state.pages.length) {
    if (!state.pages[index].disabled) return index;
    index += direction;
  }

  return -1;
}

function findNearestEnabledPageIndex(index: number) {
  if (index < 0 || index >= state.pages.length) return -1;
  if (!state.pages[index].disabled) return index;

  const nextIndex = findEnabledPageIndex(index, 1);
  if (nextIndex !== -1) return nextIndex;

  return findEnabledPageIndex(index, -1);
}

// ─── Page list: item factory ──────────────────────────────────────────────────

function createPageItem(page: ComicPage, index: number): HTMLElement {
  const item = document.createElement("div");
  item.className =
    "page-item" +
    (index === state.selectedPageIndex ? " selected" : "") +
    (page.disabled ? " page-disabled" : "");
  item.draggable = true;
  item.dataset.pageIndex = index.toString();
  item.innerHTML = `
    <img src="${page.url}" alt="Page ${index + 1}" loading="lazy">
    <div class="page-info">
      <div class="page-num">${index + 1}</div>
      <div class="page-name" title="${page.filename}">${page.filename}</div>
    </div>
    <button class="remove-btn" title="${page.disabled ? "Restore" : "Remove"}">${page.disabled ? "+" : "×"}</button>
  `;
  return item;
}

// ─── Page list: drag-scroll helper ───────────────────────────────────────────

function handleDragScroll() {
  if (state.draggedItemIndex === null) {
    state.dragScrollRequest = null;
    return;
  }

  const rect = pageList.getBoundingClientRect();

  if (state.lastDragClientY < rect.top + DRAG_SCROLL_THRESHOLD) {
    const intensity = Math.min(
      1,
      (rect.top + DRAG_SCROLL_THRESHOLD - state.lastDragClientY) / DRAG_SCROLL_THRESHOLD
    );
    pageList.scrollTop -= intensity * DRAG_SCROLL_MAX_SPEED;
  } else if (state.lastDragClientY > rect.bottom - DRAG_SCROLL_THRESHOLD) {
    const intensity = Math.min(
      1,
      (state.lastDragClientY - (rect.bottom - DRAG_SCROLL_THRESHOLD)) / DRAG_SCROLL_THRESHOLD
    );
    pageList.scrollTop += intensity * DRAG_SCROLL_MAX_SPEED;
  }

  state.dragScrollRequest = requestAnimationFrame(handleDragScroll);
}

// ─── Page list: targeted DOM mutations ───────────────────────────────────────

function updatePageCount() {
  const activeCount = state.pages.filter((p) => !p.disabled).length;
  pageCount.textContent = `${activeCount}/${state.pages.length} pages`;
}

/**
 * Move one DOM node to its new position and re-index only the affected range.
 * O(range) attribute updates instead of O(n) full rebuild.
 */
function reorderPageItem(fromIndex: number, toIndex: number) {
  const items = Array.from(pageList.children) as HTMLElement[];
  const movingItem = items[fromIndex];

  pageList.removeChild(movingItem);

  const remaining = Array.from(pageList.children) as HTMLElement[];
  if (toIndex >= remaining.length) {
    pageList.appendChild(movingItem);
  } else {
    pageList.insertBefore(movingItem, remaining[toIndex]);
  }

  // Re-index and renumber only the items whose position shifted
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  Array.from(pageList.children).forEach((child, i) => {
    if (i < lo || i > hi) return;
    const el = child as HTMLElement;
    el.dataset.pageIndex = i.toString();
    const numEl = el.querySelector(".page-num");
    if (numEl) numEl.textContent = (i + 1).toString();
    el.classList.toggle("selected", i === state.selectedPageIndex);
  });

  updateProgressBar();
  updateCopyButtonState();
}

/**
 * Update a single item's disabled/enabled state without touching the rest.
 * O(1) DOM update instead of O(n) full rebuild.
 */
function patchPageItem(index: number) {
  const item = pageList.querySelector(`[data-page-index="${index}"]`) as HTMLElement | null;
  if (!item) return;

  const page = state.pages[index];
  item.classList.toggle("page-disabled", page.disabled);
  const btn = item.querySelector(".remove-btn") as HTMLButtonElement | null;
  if (btn) {
    btn.title = page.disabled ? "Restore" : "Remove";
    btn.textContent = page.disabled ? "+" : "×";
  }
}

/**
 * Append only the newly added pages without rebuilding the existing list.
 */
export function appendPageItems(newPages: ComicPage[], startingIndex: number) {
  newPages.forEach((page, i) => {
    pageList.appendChild(createPageItem(page, startingIndex + i));
  });
  updatePageCount();
  updateCopyButtonState();
}

// ─── Page list: full render + event delegation ────────────────────────────────

/**
 * Full rebuild. Use for initial load and reset-order. For incremental changes
 * use reorderPageItem, patchPageItem, or appendPageItems.
 */
export function renderPageList() {
  pageList.innerHTML = "";
  state.pages.forEach((page, index) => {
    pageList.appendChild(createPageItem(page, index));
  });
  updatePageCount();
  updateProgressBar();
  updateCopyButtonState();
}

/**
 * Wire all page-list interactions via event delegation.
 * Called once at startup — no per-item listeners needed.
 */
export function setupPageListEvents() {
  pageList.addEventListener("dragover", (e) => {
    e.preventDefault();
    state.lastDragClientY = e.clientY;

    const item = (e.target as HTMLElement).closest(".page-item") as HTMLElement | null;
    if (!item) return;
    const index = parseInt(item.dataset.pageIndex!);
    if (state.draggedItemIndex === null || state.draggedItemIndex === index) return;

    const rect = item.getBoundingClientRect();
    item.classList.remove("drop-target-above", "drop-target-below");
    if (e.clientY < rect.top + rect.height / 2) {
      item.classList.add("drop-target-above");
    } else {
      item.classList.add("drop-target-below");
    }
  });

  pageList.addEventListener("dragstart", (e) => {
    const item = (e.target as HTMLElement).closest(".page-item") as HTMLElement | null;
    if (!item) return;
    state.draggedItemIndex = parseInt(item.dataset.pageIndex!);
    item.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
    if (!state.dragScrollRequest) {
      state.dragScrollRequest = requestAnimationFrame(handleDragScroll);
    }
  });

  pageList.addEventListener("dragleave", (e) => {
    const item = (e.target as HTMLElement).closest(".page-item") as HTMLElement | null;
    if (!item) return;
    // Only remove the indicator when the pointer truly leaves the item,
    // not when it moves between the item's own children (img → page-info etc.).
    if (!item.contains(e.relatedTarget as Node | null)) {
      item.classList.remove("drop-target-above", "drop-target-below");
    }
  });

  pageList.addEventListener("drop", (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest(".page-item") as HTMLElement | null;
    if (!item) return;
    item.classList.remove("drop-target-above", "drop-target-below");

    if (state.draggedItemIndex === null) return;
    const index = parseInt(item.dataset.pageIndex!);
    if (state.draggedItemIndex === index) return;

    const rect = item.getBoundingClientRect();
    let dropIndex = index;
    if (e.clientY >= rect.top + rect.height / 2) dropIndex++;
    if (state.draggedItemIndex < dropIndex) dropIndex--;

    if (state.draggedItemIndex !== dropIndex) {
      const from = state.draggedItemIndex;
      const to = dropIndex;

      const [movedPage] = state.pages.splice(from, 1);
      state.pages.splice(to, 0, movedPage);

      if (state.selectedPageIndex === from) {
        state.selectedPageIndex = to;
      } else if (from < state.selectedPageIndex && to >= state.selectedPageIndex) {
        state.selectedPageIndex--;
      } else if (from > state.selectedPageIndex && to <= state.selectedPageIndex) {
        state.selectedPageIndex++;
      }

      reorderPageItem(from, to);
      selectPage(state.selectedPageIndex, true);
    }
  });

  pageList.addEventListener("dragend", (e) => {
    const item = (e.target as HTMLElement).closest(".page-item") as HTMLElement | null;
    if (item) item.classList.remove("dragging");
    state.draggedItemIndex = null;
    if (state.dragScrollRequest) {
      cancelAnimationFrame(state.dragScrollRequest);
      state.dragScrollRequest = null;
    }
    pageList.querySelectorAll(".page-item").forEach((i) =>
      i.classList.remove("drop-target-above", "drop-target-below")
    );
  });

  pageList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".page-item") as HTMLElement | null;
    if (!item) return;
    const index = parseInt(item.dataset.pageIndex!);

    if (target.classList.contains("remove-btn")) {
      e.stopPropagation();
      togglePage(index);
    } else if (!state.pages[index].disabled) {
      selectPage(index);
    }
  });
}

// ─── Page selection ───────────────────────────────────────────────────────────

export function selectPage(index: number, skipScrollBehavior = false) {
  const targetIndex = findNearestEnabledPageIndex(index);
  if (targetIndex === -1) {
    resetPageSelection();
    return;
  }

  state.selectedPageIndex = targetIndex;

  const isHStrip = previewContainer.classList.contains("hstrip");

  if (isHStrip) {
    loadHStripWindow(targetIndex);
    if (viewerNode && !skipScrollBehavior) {
      state.isScrollingProgrammatically = true;
      requestAnimationFrame(() => {
        viewerNode!.scrollLeft = state.hstripPageOffsets[targetIndex] ?? 0;
        setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
  } else {
    prevImage.removeAttribute("src");
    currentImage.removeAttribute("src");
    spreadImage.removeAttribute("src");
    nextImage.removeAttribute("src");

    if (state.isSpreadMode) {
      currentImage.src = state.pages[targetIndex].url;
      const spreadIndex = findEnabledPageIndex(targetIndex, 1);
      if (spreadIndex !== -1) spreadImage.src = state.pages[spreadIndex].url;
    } else {
      const prevIndex = findEnabledPageIndex(targetIndex, -1);
      const nextIndex = findEnabledPageIndex(targetIndex, 1);
      if (prevIndex !== -1) prevImage.src = state.pages[prevIndex].url;
      currentImage.src = state.pages[targetIndex].url;
      if (nextIndex !== -1) nextImage.src = state.pages[nextIndex].url;
    }

    if (viewerNode && !skipScrollBehavior && !state.isSpreadMode) {
      state.isScrollingProgrammatically = true;
      requestAnimationFrame(() => {
        viewerNode!.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
        setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
  }

  document.querySelectorAll(".page-item").forEach((item, i) => {
    item.classList.toggle("selected", i === targetIndex);
    if (i === targetIndex) {
      (item as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  });

  updateProgressBar();
  updateCopyButtonState();
}

export function selectNextPage(skipScrollBehavior = false) {
  if (state.isSpreadMode) {
    // Skip 2 enabled pages: right page of current pair → next left page
    const rightIndex = findEnabledPageIndex(state.selectedPageIndex, 1);
    if (rightIndex === -1) return false;
    const nextLeftIndex = findEnabledPageIndex(rightIndex, 1);
    if (nextLeftIndex === -1) return false;
    selectPage(nextLeftIndex, skipScrollBehavior);
    return true;
  }

  const nextIndex = findEnabledPageIndex(state.selectedPageIndex, 1);
  if (nextIndex !== -1) {
    selectPage(nextIndex, skipScrollBehavior);
    return true;
  }

  return false;
}

export function selectPreviousPage(skipScrollBehavior = false) {
  if (state.isSpreadMode) {
    // Go back 2 enabled pages; if only 1 back exists, go there
    const onePrevIndex = findEnabledPageIndex(state.selectedPageIndex, -1);
    if (onePrevIndex === -1) return false;
    const twoPrevIndex = findEnabledPageIndex(onePrevIndex, -1);
    selectPage(twoPrevIndex !== -1 ? twoPrevIndex : onePrevIndex, skipScrollBehavior);
    return true;
  }

  const prevIndex = findEnabledPageIndex(state.selectedPageIndex, -1);
  if (prevIndex !== -1) {
    selectPage(prevIndex, skipScrollBehavior);
    return true;
  }

  return false;
}

export function togglePage(index: number) {
  if (index < 0 || index >= state.pages.length) return;
  state.pages[index].disabled = !state.pages[index].disabled;
  patchPageItem(index);
  updatePageCount();

  if (state.pages[index].disabled && state.selectedPageIndex === index) {
    selectPage(index, true);
    return;
  }

  if (!state.pages[index].disabled && state.selectedPageIndex === -1) {
    selectPage(index);
    return;
  }

  if (state.selectedPageIndex !== -1) {
    selectPage(state.selectedPageIndex, true);
  } else {
    updateProgressBar();
    updateCopyButtonState();
  }
}

// ─── Full page replacement ────────────────────────────────────────────────────

export function applyOpenedPages(nextPages: ComicPage[], canExtract: boolean) {
  state.selectedPageIndex = -1;
  replacePages(nextPages);
  showViewer(canExtract);
  renderPageList();

  if (state.pages.length > 0) {
    selectPage(0);
  } else {
    resetPageSelection();
  }
}
