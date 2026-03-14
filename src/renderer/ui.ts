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
  fitHeightBtn,
  fitWidthBtn,
  landingContainer,
  loader,
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

// ─── Loader / viewer state ────────────────────────────────────────────────────

export function setLoaderVisible(isVisible: boolean) {
  loader.classList.toggle("hidden", !isVisible);
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

export function showViewer(canExtract: boolean) {
  landingContainer.classList.add("hidden");
  recentFilesContainer.classList.add("hidden");
  dropZone.classList.add("hidden");
  progressBarContainer.classList.remove("hidden");
  previewContainer.classList.remove("hidden");
  previewContainer.classList.remove("fit-width");
  previewContainer.classList.add("fit-height");
  fitWidthBtn.classList.remove("active");
  fitHeightBtn.classList.add("active");
  viewerNode?.classList.add("has-content");
  sidebar?.classList.remove("hidden");
  toolbar?.classList.remove("hidden");
  saveBtn.disabled = false;
  extractBtn.disabled = !canExtract;
}

// ─── Progress / copy button ───────────────────────────────────────────────────

export function updateProgressBar() {
  if (!progressBar) return;

  if (state.pages.length === 0 || state.selectedPageIndex < 0) {
    progressBar.style.width = "0%";
    return;
  }

  const progress = ((state.selectedPageIndex + 1) / state.pages.length) * 100;
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
  const hasSelectedPage =
    state.selectedPageIndex >= 0 && state.selectedPageIndex < state.pages.length;
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
  updateCopyButtonState();
  updateProgressBar();
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
    if (item) item.classList.remove("drop-target-above", "drop-target-below");
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
    } else {
      selectPage(index);
    }
  });
}

// ─── Page selection ───────────────────────────────────────────────────────────

export function selectPage(index: number, skipScrollBehavior = false) {
  if (index < 0 || index >= state.pages.length) return;
  state.selectedPageIndex = index;

  prevImage.removeAttribute("src");
  currentImage.removeAttribute("src");
  nextImage.removeAttribute("src");

  if (state.pages[index - 1]) prevImage.src = state.pages[index - 1].url;
  if (state.pages[index]) currentImage.src = state.pages[index].url;
  if (state.pages[index + 1]) nextImage.src = state.pages[index + 1].url;

  if (viewerNode && !skipScrollBehavior) {
    state.isScrollingProgrammatically = true;
    requestAnimationFrame(() => {
      viewerNode.scrollTo({ top: currentImage.offsetTop, behavior: "instant" });
      setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
    });
  }

  document.querySelectorAll(".page-item").forEach((item, i) => {
    item.classList.toggle("selected", i === index);
    if (i === index) {
      (item as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  });

  updateProgressBar();
  updateCopyButtonState();
}

export function togglePage(index: number) {
  if (index < 0 || index >= state.pages.length) return;
  state.pages[index].disabled = !state.pages[index].disabled;
  patchPageItem(index);
  updatePageCount();
  updateProgressBar();
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
