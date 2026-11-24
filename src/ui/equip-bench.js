import { DIRTY_EQUIP, DIRTY_ALL } from "../state/store.js";

const MIN_SLOTS = 12;

const BADGE_CLASS = {
  carry: "to-carry",
  tank: "to-tank",
  rec: "to-rec",
  emblem: "to-emblem",
  crown: "to-crown"
};

function $(id) {
  return document.getElementById(id);
}

function closePopover(el) {
  if (el && typeof el.hidePopover === "function") {
    try { el.hidePopover(); } catch { /* ignore */ }
  }
}

export function mountEquipBench(store) {
  const emblemMenu = $("emblem-menu");
  const gridEl = $("equip-bench-grid");

  const slotPool = [];
  let lastSetVersion = -1;

  function createSlotRef(index) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "equip-tile empty-slot";
    el.style.padding = "0";
    el.dataset.slotIndex = String(index);

    const img = document.createElement("img");
    img.alt = "";
    img.dataset.poolManaged = "1";
    img.hidden = true;

    const ph = document.createElement("span");
    ph.className = "hex-ph ph ph-sm";
    ph.hidden = true;

    const badge = document.createElement("span");
    badge.className = "equip-assign";
    badge.hidden = true;

    el.appendChild(img);
    el.appendChild(ph);
    el.appendChild(badge);

    return {
      index,
      el,
      img,
      ph,
      badge,
      prevKey: "__init__",
      itemId: "",
      targetId: null
    };
  }

  function ensurePoolSize(count) {
    if (!gridEl) return;
    const needed = Math.max(MIN_SLOTS, Math.ceil(Math.max(MIN_SLOTS, count) / 6) * 6);
    while (slotPool.length < needed) {
      const ref = createSlotRef(slotPool.length);
      slotPool.push(ref);
      gridEl.appendChild(ref.el);
    }
    for (let i = 0; i < slotPool.length; i++) {
      slotPool[i].el.hidden = i >= needed;
    }
  }

  if (emblemMenu) {
    emblemMenu.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-emblem-item]");
      if (!btn) return;
      const itemId = btn.dataset.emblemItem;
      if (itemId) {
        store.addLooseItem(itemId);
        closePopover(emblemMenu);
      }
    });
  }

  if (gridEl) {
    gridEl.addEventListener("click", (e) => {
      if (Date.now() - store.getUI().dragAt < 250) return;
      const slotEl = e.target.closest && e.target.closest(".equip-tile");
      if (!slotEl) return;
      const idx = Number(slotEl.dataset.slotIndex);
      const ref = slotPool[idx];
      if (!ref || !ref.itemId) return;

      const targetId = ref.targetId || store.getUI().selected;
      if (!targetId) {
        store.notify("先选中一个棋盘棋子，或直接将装备拖拽到目标棋子上。");
        return;
      }
      store.equipLooseToTarget(idx, targetId);
    });

    gridEl.addEventListener("contextmenu", (e) => {
      const slotEl = e.target.closest && e.target.closest(".equip-tile");
      if (!slotEl) return;
      const idx = Number(slotEl.dataset.slotIndex);
      const ref = slotPool[idx];
      if (!ref || !ref.itemId) return;
      e.preventDefault();
      store.act({ type: "delete-loose", index: idx, itemId: ref.itemId });
    });
  }

  function rebuildForSet() {
    const game = store.getGame();
    lastSetVersion = store.getUI().setVersion;

    if (emblemMenu && game) {
      emblemMenu.textContent = "";
      const head = document.createElement("div");
      head.className = "emblem-menu-head";
      head.textContent = "添加纹章到已有装备";
      emblemMenu.appendChild(head);

      const emblems = (game.data.items || [])
        .filter((it) => it.kind === "emblem")
        .slice()
        .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "zh"));

      if (!emblems.length) {
        const empty = document.createElement("p");
        empty.className = "insp-empty";
        empty.textContent = "当前赛季无纹章装备";
        emblemMenu.appendChild(empty);
      } else {
        const grid = document.createElement("div");
        grid.className = "emblem-menu-grid";
        emblems.forEach((it) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "emblem-menu-opt";
          btn.dataset.emblemItem = it.id;
          btn.dataset.tip = "item:" + it.id;
          btn.setAttribute("aria-label", "添加 " + it.name);

          const src = store.srcList(it);
          if (src.length) {
            const img = document.createElement("img");
            img.src = src[0];
            img.alt = it.name;
            img.dataset.alt = src[1] || "";
            img.loading = "lazy";
            btn.appendChild(img);
          }

          const span = document.createElement("span");
          span.textContent = it.name.replace(/纹章$/, "");
          btn.appendChild(span);
          grid.appendChild(btn);
        });
        emblemMenu.appendChild(grid);
      }
    }

    ensurePoolSize(MIN_SLOTS);
    for (let i = 0; i < slotPool.length; i++) {
      slotPool[i].prevKey = "__force__";
    }
  }

  function renderBench() {
    const game = store.getGame();
    const state = store.getState();
    const analysis = store.getAnalysis();
    if (!gridEl || !game) return;

    if (store.getUI().setVersion !== lastSetVersion) {
      rebuildForSet();
    }

    const loose = state.looseItems || [];
    const assignments = (analysis.loosePlan && analysis.loosePlan.assignments) || [];
    ensurePoolSize(loose.length);

    for (let i = 0; i < slotPool.length; i++) {
      const ref = slotPool[i];
      if (ref.el.hidden) continue;

      const itemId = loose[i] || "";
      if (!itemId) {
        if (ref.prevKey !== "empty") {
          ref.prevKey = "empty";
          ref.itemId = "";
          ref.targetId = null;
          ref.el.className = "equip-tile empty-slot";
          ref.el.removeAttribute("data-drag");
          ref.el.removeAttribute("data-index");
          ref.el.removeAttribute("data-item");
          ref.el.removeAttribute("data-tip");
          ref.el.removeAttribute("title");
          ref.el.setAttribute("aria-label", "空装备槽");
          ref.img.hidden = true;
          ref.img.removeAttribute("src");
          ref.ph.hidden = true;
          ref.badge.hidden = true;
          ref.badge.textContent = "";
          ref.badge.className = "equip-assign";
        }
        continue;
      }

      const it = game.itemById[itemId];
      const assign = assignments[i] || null;
      const badgeKind = assign && assign.badgeKind ? assign.badgeKind : "";
      const badgeText = assign && assign.badgeText ? assign.badgeText : "";
      const targetId = assign && assign.targetId ? assign.targetId : null;
      const hint = assign && assign.hint ? assign.hint : "";
      const key = [itemId, badgeKind, badgeText, targetId || "", hint].join("|");

      if (key === ref.prevKey) continue;
      ref.prevKey = key;
      ref.itemId = itemId;
      ref.targetId = targetId;

      ref.el.className = "equip-tile";
      ref.el.style.background = "transparent";
      ref.el.style.border = "0";
      ref.el.dataset.drag = "loose-item";
      ref.el.dataset.index = String(i);
      ref.el.dataset.item = itemId;
      ref.el.dataset.tip = "item:" + itemId;
      const name = it ? it.name : itemId;
      const titleText = hint ? name + " · " + hint : name;
      ref.el.title = titleText;
      ref.el.setAttribute("aria-label", titleText);

      const src = store.srcList(it);
      if (src.length) {
        ref.img.src = src[0];
        ref.img.alt = name;
        ref.img.dataset.alt = src[1] || "";
        ref.img.dataset.swapped = "0";
        ref.img.hidden = false;
        ref.ph.hidden = true;
      } else {
        ref.img.hidden = true;
        ref.ph.textContent = name.slice(0, 2);
        ref.ph.hidden = false;
      }

      if (badgeText) {
        ref.badge.textContent = badgeText;
        ref.badge.className = "equip-assign " + (BADGE_CLASS[badgeKind] || "to-rec");
        ref.badge.hidden = false;
      } else {
        ref.badge.hidden = true;
      }
    }
  }

  function update(dirtyMask) {
    if (dirtyMask & (DIRTY_EQUIP | DIRTY_ALL)) {
      renderBench();
    }
  }

  return { update, rebuildForSet };
}
