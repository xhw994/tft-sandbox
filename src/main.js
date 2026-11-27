import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/board.css";
import "./styles/armory-advisor.css";

import {
  createStore,
  DIRTY_HEADER,
  DIRTY_POP,
  DIRTY_TRAITS,
  DIRTY_EQUIP,
  DIRTY_BOARD,
  DIRTY_INSPECTOR,
  DIRTY_LIB_STATE,
  DIRTY_LIB_FILTER,
  DIRTY_RECS,
  DIRTY_NOTICE,
  DIRTY_ALL
} from "./state/store.js";

import { mountHeader } from "./ui/header.js";
import { mountTraitsPool } from "./ui/traits-pool.js";
import { mountEquipBench } from "./ui/equip-bench.js";
import { mountBoardPool } from "./ui/board-pool.js";
import { mountLibraryPool } from "./ui/library-pool.js";
import { mountAdvisor } from "./ui/advisor.js";
import { mountDragAndPopover } from "./ui/drag-and-popover.js";
import { mountSavedDrawer } from "./ui/saved-drawer.js";
import { mountMetaModal } from "./ui/meta-modal.js";
import { mountCollabModal } from "./ui/collab-modal.js";
import { mountCheatsheetModal } from "./ui/cheatsheet-modal.js";

const store = createStore();

const header = mountHeader(store);
const traitsPool = mountTraitsPool(store);
const equipBench = mountEquipBench(store);
const boardPool = mountBoardPool(store);
const libraryPool = mountLibraryPool(store);
const advisor = mountAdvisor(store);
const dragPopover = mountDragAndPopover(store);
mountSavedDrawer(store);
mountMetaModal(store);
const collabModal = mountCollabModal(store);
mountCheatsheetModal(store, { openCollab: () => collabModal.open() });

let lastGameData = (store.getGame() && store.getGame().data) || null;
let hasRenderedOnce = false;

function dispatchUpdate(dirtyMask) {
  hasRenderedOnce = true;
  const game = store.getGame();
  const curData = (game && game.data) || null;

  if (curData && curData !== lastGameData) {
    lastGameData = curData;
    if (typeof traitsPool.rebuildForSet === "function") traitsPool.rebuildForSet();
    if (typeof equipBench.rebuildForSet === "function") equipBench.rebuildForSet();
    if (typeof libraryPool.rebuildForSet === "function") libraryPool.rebuildForSet();
  }

  if (dirtyMask & (DIRTY_HEADER | DIRTY_NOTICE)) header.update(dirtyMask);
  if (dirtyMask & DIRTY_TRAITS) traitsPool.update(dirtyMask);
  if (dirtyMask & DIRTY_EQUIP) equipBench.update(dirtyMask);
  if (dirtyMask & (DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_POP)) boardPool.update(dirtyMask);
  if (dirtyMask & (DIRTY_LIB_STATE | DIRTY_LIB_FILTER)) libraryPool.update(dirtyMask);

  // Advisor checks DIRTY_RECS internally and also patches pending-ban state with zero full rebuild.
  advisor.update(dirtyMask);
}

store.subscribe(dispatchUpdate);

// Global image fallback: swap data-alt once, then degrade cleanly to text placeholder.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-alt")) return;
  const alt = img.getAttribute("data-alt");
  if (alt && img.dataset.swapped !== "1") {
    img.dataset.swapped = "1";
    img.src = alt;
    return;
  }
  const ph = document.createElement("span");
  ph.className = "ph ph-sm " + (img.className || "");
  ph.textContent = img.alt || "";
  img.replaceWith(ph);
}, true);

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    dragPopover.hideTip();
    const ui = store.getUI && store.getUI();
    const activePreview = (ui && ui.previewSpec && typeof ui.previewSpec === "object")
      ? ui.previewSpec
      : (ui && ui.preview && typeof ui.preview === "object" ? ui.preview : null);
    if (activePreview) store.togglePreview(activePreview);
    document.querySelectorAll("[popover]").forEach((el) => {
      try {
        if (el.matches(":popover-open") && typeof el.hidePopover === "function") el.hidePopover();
      } catch (_) {
        /* ignore */
      }
    });
    return;
  }

  if (isTypingTarget(document.activeElement)) return;

  const openDialog = document.querySelector("dialog[open]");

  if (e.key === "/") {
    e.preventDefault();
    const search = openDialog
      ? openDialog.querySelector('input[type="search"]')
      : document.getElementById("search-q");
    if (search) {
      search.focus();
      if (typeof search.select === "function") search.select();
    }
    return;
  }

  // Avoid mutating the background board while a modal dialog is open
  if (openDialog) return;

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (k === "y") {
      e.preventDefault();
      store.redo();
      return;
    }
  }

  const ui = store.getUI && store.getUI();
  const selId = ui && ui.selected;
  if (!selId) return;

  if (e.key === "1" || e.key === "2" || e.key === "3") {
    store.act({ type: "set-star", id: selId, star: Number(e.key) });
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    store.act({ type: "remove-unit", id: selId });
  }
});

window.__TFT_STORE__ = store;

store.init();

if (!hasRenderedOnce && store.getGame() && store.getGame().data) {
  dispatchUpdate(DIRTY_ALL);
}
