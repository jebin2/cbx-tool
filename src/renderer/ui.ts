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

export function renderPageList() {
  pageList.innerHTML = "";
  const activeCount = state.pages.filter((p) => !p.disabled).length;
  pageCount.textContent = `${activeCount}/${state.pages.length} pages`;

  state.pages.forEach((page, index) => {
    const item = document.createElement("div");
    item.className =
      "page-item" +
      (index === state.selectedPageIndex ? " selected" : "") +
      (page.disabled ? " page-disabled" : "");
    item.draggable = true;
    item.innerHTML = `
      <img src="${page.url}" alt="Page ${index + 1}" loading="lazy">
      <div class="page-info">
        <div class="page-num">${index + 1}</div>
        <div class="page-name" title="${page.filename}">${page.filename}</div>
      </div>
      <button class="remove-btn" data-index="${index}" title="${page.disabled ? "Restore" : "Remove"}">${page.disabled ? "+" : "×"}</button>
    `;

    item.addEventListener("dragstart", (e) => {
      state.draggedItemIndex = index;
      item.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index.toString());
      }

      if (!state.dragScrollRequest) {
        state.dragScrollRequest = requestAnimationFrame(handleDragScroll);
      }
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (state.draggedItemIndex === null || state.draggedItemIndex === index) return;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      item.classList.remove("drop-target-above", "drop-target-below");
      if (e.clientY < midpoint) {
        item.classList.add("drop-target-above");
      } else {
        item.classList.add("drop-target-below");
      }

      state.lastDragClientY = e.clientY;
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-target-above", "drop-target-below");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drop-target-above", "drop-target-below");

      if (state.draggedItemIndex === null || state.draggedItemIndex === index) return;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      let dropIndex = index;

      if (e.clientY >= midpoint) {
        dropIndex++;
      }

      if (state.draggedItemIndex < dropIndex) {
        dropIndex--;
      }

      if (state.draggedItemIndex !== dropIndex) {
        const [movedPage] = state.pages.splice(state.draggedItemIndex, 1);
        state.pages.splice(dropIndex, 0, movedPage);

        if (state.selectedPageIndex === state.draggedItemIndex) {
          state.selectedPageIndex = dropIndex;
        } else if (state.draggedItemIndex < state.selectedPageIndex && dropIndex >= state.selectedPageIndex) {
          state.selectedPageIndex--;
        } else if (state.draggedItemIndex > state.selectedPageIndex && dropIndex <= state.selectedPageIndex) {
          state.selectedPageIndex++;
        }

        renderPageList();
        selectPage(state.selectedPageIndex, true);
      }
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      state.draggedItemIndex = null;
      if (state.dragScrollRequest) {
        cancelAnimationFrame(state.dragScrollRequest);
        state.dragScrollRequest = null;
      }
      document.querySelectorAll(".page-item").forEach((i) =>
        i.classList.remove("drop-target-above", "drop-target-below")
      );
    });

    item.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).classList.contains("remove-btn")) {
        selectPage(index);
      }
    });

    item.querySelector(".remove-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePage(index);
    });

    pageList.appendChild(item);
  });

  updateProgressBar();
  updateCopyButtonState();
}

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
  renderPageList();
  selectPage(state.selectedPageIndex);
}

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

