import { SCROLL_FLAG_RESET_DELAY_MS, PAGE_SWITCH_SCROLL_THRESHOLD } from "./constants.ts";
import { autoScrollBtn, autoScrollGroup, autoScrollSpeedInput, currentImage, fitWidthBtn, previewContainer, viewerNode } from "./dom.ts";
import { state } from "./state.ts";
import { selectPage, togglePage } from "./ui.ts";

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

  if (!fitWidthBtn.classList.contains("active")) {
    fitWidthBtn.click();
  }

  autoScrollBtn.classList.add("active");
  autoScrollGroup?.classList.add("active");

  function scrollStep() {
    if (viewerNode) {
      const speedSliderValue = parseInt(autoScrollSpeedInput.value || "2", 10);
      const speed = speedSliderValue * 0.5;
      viewerNode.scrollBy({ top: speed, behavior: "instant" });
    }
    state.autoScrollInterval = requestAnimationFrame(scrollStep);
  }

  state.autoScrollInterval = requestAnimationFrame(scrollStep);
}

export function setupScrollHandler() {
  if (!viewerNode) return;

  viewerNode.addEventListener("scroll", () => {
    if (!previewContainer.classList.contains("fit-width") || state.isScrollingProgrammatically) return;

    const st = viewerNode.scrollTop;
    const currentTop = currentImage.offsetTop;
    const currentBottom = currentTop + currentImage.offsetHeight;

    if (st > currentBottom - PAGE_SWITCH_SCROLL_THRESHOLD && state.selectedPageIndex < state.pages.length - 1) {
      state.isScrollingProgrammatically = true;
      const offset = st - currentBottom;
      selectPage(state.selectedPageIndex + 1, true);

      requestAnimationFrame(() => {
        viewerNode.scrollTo({ top: currentImage.offsetTop + offset, behavior: "instant" });
        setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    } else if (st < currentTop - PAGE_SWITCH_SCROLL_THRESHOLD && state.selectedPageIndex > 0) {
      state.isScrollingProgrammatically = true;
      const offset = currentTop - st;
      selectPage(state.selectedPageIndex - 1, true);

      requestAnimationFrame(() => {
        const targetScrollTop = (currentImage.offsetTop + currentImage.offsetHeight) - offset;
        viewerNode.scrollTo({ top: targetScrollTop, behavior: "instant" });
        setTimeout(() => { state.isScrollingProgrammatically = false; }, SCROLL_FLAG_RESET_DELAY_MS);
      });
    }
  });
}

export function setupKeyboardHandler() {
  document.addEventListener("keydown", (e) => {
    if (!state.pages.length) return;
    const isFitWidth = previewContainer.classList.contains("fit-width");

    if (e.key === "ArrowRight") {
      if (state.selectedPageIndex < state.pages.length - 1) selectPage(state.selectedPageIndex + 1);
    } else if (e.key === "ArrowLeft") {
      if (state.selectedPageIndex > 0) selectPage(state.selectedPageIndex - 1);
    } else if (e.key === "ArrowDown") {
      if (isFitWidth && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: 100, behavior: "smooth" });
      } else {
        if (state.selectedPageIndex < state.pages.length - 1) selectPage(state.selectedPageIndex + 1);
      }
    } else if (e.key === "ArrowUp") {
      if (isFitWidth && viewerNode) {
        e.preventDefault();
        viewerNode.scrollBy({ top: -100, behavior: "smooth" });
      } else {
        if (state.selectedPageIndex > 0) selectPage(state.selectedPageIndex - 1);
      }
    } else if (e.key === "Delete" || e.key === "x") {
      togglePage(state.selectedPageIndex);
    } else if (e.key === " " || e.key === "Spacebar") {
      if (isFitWidth) {
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
