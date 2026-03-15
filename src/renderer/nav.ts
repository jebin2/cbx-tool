import { SCROLL_FLAG_RESET_DELAY_MS, PAGE_SWITCH_SCROLL_THRESHOLD } from "./constants.ts";
import { autoScrollBtn, autoScrollGroup, autoScrollSpeedInput, currentImage, previewContainer, viewerNode } from "./dom.ts";
import { state } from "./state.ts";
import { loadHStripWindow, selectNextPage, selectPreviousPage, selectPage, togglePage, updateProgressBar } from "./ui.ts";

export function stopAutoScroll() {
  if (state.autoScrollInterval !== null) {
    cancelAnimationFrame(state.autoScrollInterval);
    state.autoScrollInterval = null;
    autoScrollBtn.classList.remove("active");
    autoScrollGroup?.classList.remove("active");
  }
}

export function startAutoScroll() {
  if (!state.pages.length) return;

  autoScrollBtn.classList.add("active");
  autoScrollGroup?.classList.add("active");

  function scrollStep() {
    if (viewerNode) {
      const speedSliderValue = parseInt(autoScrollSpeedInput.value || "2", 10);
      const speed = speedSliderValue * 0.5;
      if (previewContainer.classList.contains("hstrip")) {
        viewerNode.scrollBy({ left: speed, behavior: "instant" });
      } else {
        viewerNode.scrollBy({ top: speed, behavior: "instant" });
      }
    }
    state.autoScrollInterval = requestAnimationFrame(scrollStep);
  }

  state.autoScrollInterval = requestAnimationFrame(scrollStep);
}

export function setupScrollHandler() {
  if (!viewerNode) return;
  const activeViewerNode = viewerNode;

  // After scroll stops, sync sidebar highlight / progress bar for hstrip.
  activeViewerNode.addEventListener("scrollend", () => {
    if (previewContainer.classList.contains("hstrip")) {
      selectPage(state.selectedPageIndex, true);
    }
  });

  activeViewerNode.addEventListener("scroll", () => {
    if (state.isScrollingProgrammatically) return;

    const isHStrip = previewContainer.classList.contains("hstrip");
    const isContinuous = previewContainer.classList.contains("fit-width") || previewContainer.classList.contains("fit-height");

    if (isHStrip) {
      // Find which page is currently centered in the viewport.
      const lefts = state.hstripLefts;
      if (!lefts.length) return;
      const centerX = activeViewerNode.scrollLeft + activeViewerNode.clientWidth / 2;
      let newIndex = state.selectedPageIndex;
      for (let i = 0; i < lefts.length; i++) {
        if (!state.pages[i]?.disabled && lefts[i] <= centerX) newIndex = i;
      }
      // Defer DOM mutations to the next rAF to avoid forced layout from
      // reading scrollLeft after a DOM mutation in the same event handler.
      if (newIndex !== state.selectedPageIndex) {
        state.selectedPageIndex = newIndex;
        requestAnimationFrame(() => {
          loadHStripWindow(newIndex);
          updateProgressBar();
        });
      }
    } else if (isContinuous) {
      // Vertical page switching
      const st = activeViewerNode.scrollTop;
      const currentTop = currentImage.offsetTop;
      const currentBottom = currentTop + currentImage.offsetHeight;

      if (st > currentBottom - PAGE_SWITCH_SCROLL_THRESHOLD && state.selectedPageIndex < state.pages.length - 1) {
        state.isScrollingProgrammatically = true;
        const offset = st - currentBottom;
        const changed = selectNextPage(true);
        if (!changed) { state.isScrollingProgrammatically = false; return; }
        requestAnimationFrame(() => {
          activeViewerNode.scrollTo({ top: currentImage.offsetTop + offset, behavior: "instant" });
          setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
        });
      } else if (st < currentTop - PAGE_SWITCH_SCROLL_THRESHOLD && state.selectedPageIndex > 0) {
        state.isScrollingProgrammatically = true;
        const offset = currentTop - st;
        const changed = selectPreviousPage(true);
        if (!changed) { state.isScrollingProgrammatically = false; return; }
        requestAnimationFrame(() => {
          activeViewerNode.scrollTo({ top: (currentImage.offsetTop + currentImage.offsetHeight) - offset, behavior: "instant" });
          setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
        });
      }
    }
  });
}

export function setupKeyboardHandler() {
  document.addEventListener("keydown", (e) => {
    if (!state.pages.length) return;
    const isContinuous = previewContainer.classList.contains("fit-width") || previewContainer.classList.contains("fit-height");
    const isHStrip = previewContainer.classList.contains("hstrip");

    if (e.key === "ArrowRight") {
      if (isHStrip && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ left: 100, behavior: "smooth" });
      } else {
        selectNextPage();
      }
    } else if (e.key === "ArrowLeft") {
      if (isHStrip && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ left: -100, behavior: "smooth" });
      } else {
        selectPreviousPage();
      }
    } else if (e.key === "ArrowDown") {
      if (isContinuous && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: 100, behavior: "smooth" });
      } else if (!isHStrip) {
        selectNextPage();
      }
    } else if (e.key === "ArrowUp") {
      if (isContinuous && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: -100, behavior: "smooth" });
      } else if (!isHStrip) {
        selectPreviousPage();
      }
    } else if (e.key === "Delete" || e.key === "x") {
      togglePage(state.selectedPageIndex);
    } else if (e.key === " " || e.key === "Spacebar") {
      if (previewContainer.classList.contains("fit-width")) {
        e.preventDefault();
        if (state.autoScrollInterval !== null) {
          stopAutoScroll();
        } else {
          startAutoScroll();
        }
      }
    }
  });
}
