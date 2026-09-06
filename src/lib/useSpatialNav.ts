"use client";

import { useEffect } from "react";

export function useSpatialNav() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"];
      if (!keys.includes(e.key)) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]')
      ).filter((el) => el.offsetParent !== null); // only visible elements

      if (focusables.length === 0) return;

      if (!activeEl || !focusables.includes(activeEl)) {
        focusables[0].focus();
        e.preventDefault();
        return;
      }

      if (e.key === "Enter") {
        activeEl.click();
        return;
      }

      e.preventDefault();
      const currentRect = activeEl.getBoundingClientRect();

      let bestCandidate: HTMLElement | null = null;
      let minDistance = Infinity;

      for (const candidate of focusables) {
        if (candidate === activeEl) continue;
        const rect = candidate.getBoundingClientRect();

        let isDirectionallyValid = false;
        let primaryDelta = 0;
        let secondaryDelta = 0;

        if (e.key === "ArrowRight" && rect.left >= currentRect.right - 10) {
          isDirectionallyValid = true;
          primaryDelta = rect.left - currentRect.right;
          secondaryDelta = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
        } else if (e.key === "ArrowLeft" && rect.right <= currentRect.left + 10) {
          isDirectionallyValid = true;
          primaryDelta = currentRect.left - rect.right;
          secondaryDelta = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
        } else if (e.key === "ArrowDown" && rect.top >= currentRect.bottom - 10) {
          isDirectionallyValid = true;
          primaryDelta = rect.top - currentRect.bottom;
          secondaryDelta = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
        } else if (e.key === "ArrowUp" && rect.bottom <= currentRect.top + 10) {
          isDirectionallyValid = true;
          primaryDelta = currentRect.top - rect.bottom;
          secondaryDelta = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
        }

        if (isDirectionallyValid) {
          // Weight movement in the primary axis over minor secondary axis divergence
          const distance = primaryDelta + secondaryDelta * 1.8;
          if (distance < minDistance) {
            minDistance = distance;
            bestCandidate = candidate;
          }
        }
      }

      if (bestCandidate) {
        bestCandidate.focus();
        bestCandidate.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
