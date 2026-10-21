"use client";

import { useEffect } from "react";

const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

export function ModalScrollLock() {
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const originalBodyOverflow = body.style.overflow;
    const originalBodyOverscroll = body.style.overscrollBehavior;
    const originalHtmlOverflow = html.style.overflow;
    const originalHtmlOverscroll = html.style.overscrollBehavior;
    const adjustedScrollStyles = new Map<HTMLElement, { overscroll: string; webkitScrolling: string }>();
    let locked = false;

    const visibleModals = () => Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR))
      .filter((modal) => modal.getClientRects().length > 0 && window.getComputedStyle(modal).visibility !== "hidden");

    const lock = () => {
      if (locked) return;
      locked = true;
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      body.dataset.modalScrollLocked = "true";
    };

    const unlock = () => {
      if (!locked) return;
      locked = false;
      body.style.overflow = originalBodyOverflow;
      body.style.overscrollBehavior = originalBodyOverscroll;
      html.style.overflow = originalHtmlOverflow;
      html.style.overscrollBehavior = originalHtmlOverscroll;
      delete body.dataset.modalScrollLocked;
      adjustedScrollStyles.forEach((styles, element) => {
        element.style.overscrollBehavior = styles.overscroll;
        if (styles.webkitScrolling) element.style.setProperty("-webkit-overflow-scrolling", styles.webkitScrolling);
        else element.style.removeProperty("-webkit-overflow-scrolling");
        delete element.dataset.modalScrollContainer;
      });
      adjustedScrollStyles.clear();
    };

    const sync = () => {
      const modals = visibleModals();
      if (!modals.length) {
        unlock();
        return;
      }
      lock();
      const modalSet = new Set(modals);
      const scrollableElements = new Set<HTMLElement>();
      modals.forEach((modal) => {
        const elements = [modal, ...Array.from(modal.querySelectorAll<HTMLElement>("*"))];
        elements.forEach((element) => {
          const overflowY = window.getComputedStyle(element).overflowY;
          if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) {
            scrollableElements.add(element);
            if (!adjustedScrollStyles.has(element)) {
              adjustedScrollStyles.set(element, {
                overscroll: element.style.overscrollBehavior,
                webkitScrolling: element.style.getPropertyValue("-webkit-overflow-scrolling"),
              });
            }
            element.dataset.modalScrollContainer = "true";
            element.style.overscrollBehavior = "contain";
            element.style.setProperty("-webkit-overflow-scrolling", "touch");
          }
        });
      });
      adjustedScrollStyles.forEach((styles, element) => {
        if (!scrollableElements.has(element) || !modalSet.has(element.closest<HTMLElement>(MODAL_SELECTOR) ?? element)) {
          element.style.overscrollBehavior = styles.overscroll;
          if (styles.webkitScrolling) element.style.setProperty("-webkit-overflow-scrolling", styles.webkitScrolling);
          else element.style.removeProperty("-webkit-overflow-scrolling");
          delete element.dataset.modalScrollContainer;
          adjustedScrollStyles.delete(element);
        }
      });
    };

    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (!locked) return;
      const target = event.target;
      if (!(target instanceof Element)) {
        event.preventDefault();
        return;
      }
      const modal = target.closest<HTMLElement>(MODAL_SELECTOR);
      const scrollContainer = target.closest<HTMLElement>('[data-modal-scroll-container="true"]');
      if (!modal || !visibleModals().includes(modal) || !scrollContainer) event.preventDefault();
    };

    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "style", "open", "aria-hidden"] });
    document.addEventListener("touchmove", preventBackgroundTouchMove, { capture: true, passive: false });
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("touchmove", preventBackgroundTouchMove, true);
      unlock();
    };
  }, []);

  return null;
}
