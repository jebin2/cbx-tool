import { appModal, autoScrollBtn, autoScrollGroup, autoScrollSpeedInput, pageList, previewContainer, viewerNode } from "./dom.ts";
import { state } from "./state.ts";
import { loadHStripWindow, loadVStripWindow, selectNextPage, selectPreviousPage, selectPage, togglePage, updateProgressBar } from "./ui.ts";
import { scheduleReadingPositionSave } from "./progress.ts";

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

  // Time-based so the speed is the same on any refresh rate. The slider maps
  // to pixels/second (value * 30 == the old value * 0.5 px/frame at 60 Hz).
  let lastTimestamp: number | null = null;
  let pendingScroll = 0;

  function scrollStep(now: number) {
    if (viewerNode && lastTimestamp !== null) {
      // Clamp long gaps (frame stalls) so scrolling doesn't jump to catch up.
      const elapsedMs = Math.min(now - lastTimestamp, 100);
      const speedSliderValue = parseInt(autoScrollSpeedInput.value || "2", 10);
      const pixelsPerSecond = speedSliderValue * 30;
      // Accumulate fractional pixels — repeated sub-pixel scrollBy calls
      // would each round to zero and stall at low speeds.
      pendingScroll += (pixelsPerSecond * elapsedMs) / 1000;
      const step = Math.trunc(pendingScroll);
      if (step !== 0) {
        pendingScroll -= step;
        if (previewContainer.classList.contains("hstrip")) {
          viewerNode.scrollBy({ left: step, behavior: "instant" });
        } else {
          viewerNode.scrollBy({ top: step, behavior: "instant" });
        }
      }
    }
    lastTimestamp = now;
    state.autoScrollInterval = requestAnimationFrame(scrollStep);
  }

  state.autoScrollInterval = requestAnimationFrame(scrollStep);
}

function updateSidebarHighlight(targetIndex: number) {
  document.querySelectorAll(".page-item").forEach((item, i) => {
    item.classList.toggle("selected", i === targetIndex);
  });
}

export function setupScrollHandler() {
  if (!viewerNode) return;
  const activeViewerNode = viewerNode;

  // After scroll stops, sync sidebar highlight / progress bar for hstrip and vstrip.
  const syncAfterScrollStops = () => {
    if (previewContainer.classList.contains("hstrip") || previewContainer.classList.contains("vstrip")) {
      selectPage(state.selectedPageIndex, true);
    }
  };

  if ("onscrollend" in window) {
    activeViewerNode.addEventListener("scrollend", syncAfterScrollStops);
  } else {
    // WebKit builds without scrollend: treat 150ms of scroll silence as the end.
    let scrollIdleTimer: number | null = null;
    activeViewerNode.addEventListener("scroll", () => {
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = window.setTimeout(() => {
        scrollIdleTimer = null;
        syncAfterScrollStops();
      }, 150);
    });
  }

  activeViewerNode.addEventListener("scroll", () => {
    if (state.isScrollingProgrammatically) return;

    const isHStrip = previewContainer.classList.contains("hstrip");
    const isVStrip = previewContainer.classList.contains("vstrip");

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
        scheduleReadingPositionSave();
        requestAnimationFrame(() => {
          loadHStripWindow(newIndex);
          updateProgressBar();
          updateSidebarHighlight(newIndex);
        });
      }
    } else if (isVStrip) {
      const tops = state.vstripTops;
      if (!tops.length) return;
      const centerY = activeViewerNode.scrollTop + activeViewerNode.clientHeight / 2;
      let newIndex = state.selectedPageIndex;
      for (let i = 0; i < tops.length; i++) {
        if (!state.pages[i]?.disabled && tops[i] <= centerY) newIndex = i;
      }
      if (newIndex !== state.selectedPageIndex) {
        state.selectedPageIndex = newIndex;
        scheduleReadingPositionSave();
        requestAnimationFrame(() => {
          loadVStripWindow(newIndex);
          updateProgressBar();
          updateSidebarHighlight(newIndex);
        });
      }
    }
  });
}

export function setupKeyboardHandler() {
  document.addEventListener("keydown", (e) => {
    if (!state.pages.length || !appModal.classList.contains("hidden")) return;
    const isVStrip = previewContainer.classList.contains("vstrip");
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
      if (isVStrip && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: 100, behavior: "smooth" });
      } else if (!isHStrip) {
        selectNextPage();
      }
    } else if (e.key === "ArrowUp") {
      if (isVStrip && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: -100, behavior: "smooth" });
      } else if (!isHStrip) {
        selectPreviousPage();
      }
    } else if (e.key === "Delete" || e.key === "x") {
      togglePage(state.selectedPageIndex);
    } else if (e.key === " " || e.key === "Spacebar") {
      if (previewContainer.classList.contains("fit-width") || previewContainer.classList.contains("vstrip")) {
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
