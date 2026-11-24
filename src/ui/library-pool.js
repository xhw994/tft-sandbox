import { DIRTY_LIB_STATE, DIRTY_LIB_FILTER, DIRTY_ALL } from "../state/store.js";

const ITEM_KINDS = [
  ["normal", "成装"],
  ["artifact", "神器"],
  ["radiant", "光明"],
  ["emblem", "纹章"],
  ["basic", "散件"],
  ["support", "辅助"],
  ["spatula", "冠冕"],
  ["misc", "其他"]
];

function $(id) {
  return document.getElementById(id);
}

export function mountLibraryPool(store) {
  const tabUnits = $("tab-units");
  const tabItems = $("tab-items");
  const searchQ = $("search-q");
  const btnSearchClear = $("btn-search-clear");
  const costFilters = $("cost-filters");
  const kindFilters = $("kind-filters");
  const roleFilter = $("role-filter");
  const traitFilter = $("trait-filter");
  const unitsGrid = $("library-units-grid");
  const itemsGrid = $("library-items-grid");

  const unitPool = new Map();
  const itemPool = new Map();
  let unitsEmptyEl = null;
  let itemsEmptyEl = null;
  let prevOnBoard = new Set();
  let prevBanned = new Set();
  let prevUnlockTarget = null;
  let lastSetVersion = -1;

  if (tabUnits) tabUnits.textContent = "棋子";
  if (tabItems) tabItems.textContent = "装备";

  if (tabUnits) tabUnits.addEventListener("click", () => store.setLibraryTab("units"));
  if (tabItems) tabItems.addEventListener("click", () => store.setLibraryTab("items"));

  if (searchQ) {
    searchQ.addEventListener("input", () => store.setFilter({ q: searchQ.value }));
  }
  if (btnSearchClear) {
    btnSearchClear.addEventListener("click", () => {
      if (searchQ) {
        searchQ.value = "";
        searchQ.focus();
      }
      store.setFilter({ q: "" });
    });
  }

  if (costFilters) {
    costFilters.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-cost]");
      if (!btn) return;
      store.setFilter({ cost: Number(btn.dataset.cost) || 0 });
    });
  }
  if (kindFilters) {
    kindFilters.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-kind]");
      if (!btn) return;
      store.setFilter({ itemKind: btn.dataset.kind || "all" });
    });
  }
  if (roleFilter) {
    roleFilter.addEventListener("change", () => store.setFilter({ role: roleFilter.value || "all" }));
  }
  if (traitFilter) {
    traitFilter.addEventListener("change", () => store.setFilter({ trait: traitFilter.value || "all" }));
  }

  if (unitsGrid) {
    unitsGrid.addEventListener("click", (e) => {
      if (Date.now() - store.getUI().dragAt < 250) return;
      const tile = e.target.closest && e.target.closest(".u-card");
      if (!tile) return;
      const unitId = tile.dataset.id;
      if (unitId) store.addFirstFree(unitId);
    });

    unitsGrid.addEventListener("contextmenu", (e) => {
      const tile = e.target.closest && e.target.closest(".u-card");
      if (!tile) return;
      const unitId = tile.dataset.id;
      const entry = unitPool.get(unitId);
      if (!entry || !entry.meta.isLocked) return;
      e.preventDefault();
      const cur = store.getState().unlockTargetId;
      store.setUnlockTarget(cur === unitId ? null : unitId);
    });
  }

  if (itemsGrid) {
    itemsGrid.addEventListener("click", (e) => {
      if (Date.now() - store.getUI().dragAt < 250) return;
      const tile = e.target.closest && e.target.closest(".item-card");
      if (!tile) return;
      const itemId = tile.dataset.item;
      if (!itemId) return;

      const selectedId = store.getUI().selected;
      const selectedOnBoard = selectedId && store.getState().board.some((b) => b.id === selectedId);
      if (selectedOnBoard) {
        store.act({ type: "equip-item", id: selectedId, itemId, source: { kind: "library" } });
      } else {
        store.addLooseItem(itemId);
      }
    });
  }

  function createUnitTile(u, game) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "u-card";
    el.style.background = "transparent";
    el.dataset.drag = "library-unit";
    el.dataset.id = u.id;
    el.dataset.tip = "unit:" + u.id;
    el.style.setProperty("--cost", store.costColorVar(u.cost));
    el.style.setProperty("--cost-solid", store.costSolidHex(u.cost));
    el.setAttribute("aria-label", u.display + " " + u.cost + " 费，添加到空位");

    const hexWrap = document.createElement("span");
    hexWrap.className = "u-hex-wrap";

    const hex = document.createElement("span");
    hex.className = "u-hex";
    hex.style.display = "block";

    const src = store.srcList(u);
    if (src.length) {
      const img = document.createElement("img");
      img.src = src[0];
      img.alt = u.display;
      img.dataset.alt = src[1] || "";
      img.loading = "lazy";
      const focus = store.focusPos(u.id);
      if (focus != null) img.style.objectPosition = focus + "% 50%";
      hex.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "ph ph-sm";
      ph.textContent = u.display;
      hex.appendChild(ph);
    }
    hexWrap.appendChild(hex);

    const costBadge = document.createElement("span");
    costBadge.className = "u-cost-badge";
    costBadge.textContent = String(u.cost);
    hexWrap.appendChild(costBadge);

    if (u.unlock) {
      const lockBadge = document.createElement("span");
      lockBadge.className = "u-lock";
      lockBadge.textContent = "锁";
      lockBadge.title = "需解锁（右键设为解锁目标）";
      hexWrap.appendChild(lockBadge);
    }

    const badgeEl = document.createElement("span");
    badgeEl.className = "u-on-badge";
    badgeEl.textContent = "✓";
    badgeEl.hidden = true;
    hexWrap.appendChild(badgeEl);

    const nameEl = document.createElement("span");
    nameEl.className = "u-name";
    nameEl.textContent = u.display;

    const traitsEl = document.createElement("span");
    traitsEl.className = "u-traits";
    (u.traits || []).slice(0, 3).forEach((tid) => {
      const t = game.traitById[tid];
      if (!t) return;
      const tSrc = store.srcList(t);
      if (tSrc.length) {
        const ti = document.createElement("img");
        ti.src = tSrc[0];
        ti.alt = t.name;
        ti.dataset.alt = tSrc[1] || "";
        ti.loading = "lazy";
        traitsEl.appendChild(ti);
      }
    });

    el.appendChild(hexWrap);
    el.appendChild(nameEl);
    el.appendChild(traitsEl);

    return {
      el,
      badgeEl,
      meta: {
        id: u.id,
        cost: u.cost,
        roleGroup: u.roleGroup || "specialist",
        traits: Array.isArray(u.traits) ? u.traits : [],
        search: [u.keywords || "", u.display || "", u.name || "", u.nameEn || ""].join(" ").toLowerCase(),
        isLocked: !!u.unlock
      }
    };
  }

  function createItemTile(it) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "item-card";
    el.dataset.drag = "library-item";
    el.dataset.item = it.id;
    el.dataset.tip = "item:" + it.id;
    el.setAttribute("aria-label", it.name);

    const src = store.srcList(it);
    if (src.length) {
      const img = document.createElement("img");
      img.src = src[0];
      img.alt = it.name;
      img.dataset.alt = src[1] || "";
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "ph ph-sm";
      ph.textContent = it.name;
      el.appendChild(ph);
    }

    const nameEl = document.createElement("span");
    nameEl.className = "item-card-name";
    nameEl.textContent = it.name;
    el.appendChild(nameEl);

    return {
      el,
      meta: {
        id: it.id,
        kind: it.kind || "misc",
        search: ((it.name || "") + " " + (it.text || "")).toLowerCase()
      }
    };
  }

  function rebuildFilterControls(game) {
    if (costFilters) {
      costFilters.textContent = "";
      const costs = [];
      (game.data.units || []).forEach((u) => {
        if (costs.indexOf(u.cost) < 0) costs.push(u.cost);
      });
      costs.sort((a, b) => a - b);

      const frag = document.createDocumentFragment();
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "cost-pill active";
      allBtn.dataset.cost = "0";
      allBtn.setAttribute("aria-pressed", "true");
      allBtn.textContent = "全部";
      frag.appendChild(allBtn);

      costs.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cost-pill";
        btn.dataset.cost = String(c);
        btn.setAttribute("aria-pressed", "false");

        const dot = document.createElement("span");
        dot.className = "cost-dot" + (c === 7 ? " c7" : "");
        if (c !== 7) dot.style.setProperty("--c", store.costColorVar(c));
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(String(c)));
        frag.appendChild(btn);
      });
      costFilters.appendChild(frag);
    }

    if (kindFilters) {
      kindFilters.textContent = "";
      const present = {};
      (game.data.items || []).forEach((it) => { present[it.kind] = 1; });

      const frag = document.createDocumentFragment();
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "cost-pill active";
      allBtn.dataset.kind = "all";
      allBtn.setAttribute("aria-pressed", "true");
      allBtn.textContent = "全部";
      frag.appendChild(allBtn);

      ITEM_KINDS.forEach(([k, label]) => {
        if (!present[k]) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cost-pill";
        btn.dataset.kind = k;
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = label;
        frag.appendChild(btn);
      });
      kindFilters.appendChild(frag);
    }

    if (traitFilter) {
      traitFilter.textContent = "";
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = "全部羁绊";
      traitFilter.appendChild(allOpt);

      const bands = (game.data.traits || []).filter((t) => t.kind !== "solo");
      const solos = (game.data.traits || []).filter((t) => t.kind === "solo");

      if (bands.length) {
        const g = document.createElement("optgroup");
        g.label = "羁绊";
        bands.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t.id;
          opt.textContent = t.name;
          g.appendChild(opt);
        });
        traitFilter.appendChild(g);
      }
      if (solos.length) {
        const g = document.createElement("optgroup");
        g.label = "独行";
        solos.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t.id;
          opt.textContent = t.name;
          g.appendChild(opt);
        });
        traitFilter.appendChild(g);
      }
    }
  }

  function rebuildForSet() {
    const game = store.getGame();
    if (!game) return;

    lastSetVersion = store.getUI().setVersion;
    unitPool.clear();
    itemPool.clear();
    prevOnBoard = new Set();
    prevBanned = new Set();
    prevUnlockTarget = null;

    rebuildFilterControls(game);

    if (unitsGrid) {
      unitsGrid.textContent = "";
      const sortedUnits = (game.data.units || []).slice().sort((a, b) =>
        a.cost - b.cost || String(a.display).localeCompare(String(b.display), "zh")
      );
      const frag = document.createDocumentFragment();
      sortedUnits.forEach((u) => {
        const entry = createUnitTile(u, game);
        unitPool.set(u.id, entry);
        frag.appendChild(entry.el);
      });
      unitsEmptyEl = document.createElement("p");
      unitsEmptyEl.className = "advisor-empty";
      unitsEmptyEl.style.gridColumn = "1 / -1";
      unitsEmptyEl.textContent = "没有匹配的棋子";
      unitsEmptyEl.hidden = true;
      frag.appendChild(unitsEmptyEl);
      unitsGrid.appendChild(frag);
    }

    if (itemsGrid) {
      itemsGrid.textContent = "";
      const kindOrder = {};
      ITEM_KINDS.forEach((pair, i) => { kindOrder[pair[0]] = i; });
      const sortedItems = (game.data.items || []).slice().sort((a, b) =>
        (kindOrder[a.kind] == null ? 9 : kindOrder[a.kind]) - (kindOrder[b.kind] == null ? 9 : kindOrder[b.kind]) ||
        String(a.name).localeCompare(String(b.name), "zh")
      );
      const frag = document.createDocumentFragment();
      sortedItems.forEach((it) => {
        const entry = createItemTile(it);
        itemPool.set(it.id, entry);
        frag.appendChild(entry.el);
      });
      itemsEmptyEl = document.createElement("p");
      itemsEmptyEl.className = "advisor-empty";
      itemsEmptyEl.style.gridColumn = "1 / -1";
      itemsEmptyEl.textContent = sortedItems.length ? "没有匹配的装备" : "此赛季未提供装备数据";
      itemsEmptyEl.hidden = sortedItems.length > 0;
      frag.appendChild(itemsEmptyEl);
      itemsGrid.appendChild(frag);
    }
  }

  function applyFilter() {
    const state = store.getState();
    const ui = store.getUI();
    const itemsMode = state.libraryTab === "items";

    if (tabUnits) {
      tabUnits.classList.toggle("active", !itemsMode);
      tabUnits.setAttribute("aria-pressed", String(!itemsMode));
    }
    if (tabItems) {
      tabItems.classList.toggle("active", itemsMode);
      tabItems.setAttribute("aria-pressed", String(itemsMode));
    }
    if (unitsGrid) unitsGrid.hidden = itemsMode;
    if (itemsGrid) itemsGrid.hidden = !itemsMode;
    if (costFilters) costFilters.hidden = itemsMode;
    if (kindFilters) kindFilters.hidden = !itemsMode;
    if (roleFilter) roleFilter.hidden = itemsMode;
    if (traitFilter) traitFilter.hidden = itemsMode;

    if (searchQ && searchQ.value !== ui.q) searchQ.value = ui.q;
    if (btnSearchClear) btnSearchClear.hidden = !ui.q;
    if (roleFilter && roleFilter.value !== ui.role) roleFilter.value = ui.role;
    if (traitFilter && traitFilter.value !== ui.trait) traitFilter.value = ui.trait;

    if (costFilters) {
      costFilters.querySelectorAll("[data-cost]").forEach((b) => {
        const on = Number(b.dataset.cost) === ui.cost;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    if (kindFilters) {
      kindFilters.querySelectorAll("[data-kind]").forEach((b) => {
        const on = b.dataset.kind === ui.itemKind;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }

    const q = (ui.q || "").trim().toLowerCase();

    if (!itemsMode) {
      let shown = 0;
      unitPool.forEach(({ el, meta }) => {
        const ok =
          (!ui.cost || meta.cost === ui.cost) &&
          (ui.role === "all" || meta.roleGroup === ui.role) &&
          (ui.trait === "all" || meta.traits.indexOf(ui.trait) >= 0) &&
          (!q || meta.search.indexOf(q) >= 0);
        if (el.hidden === ok) el.hidden = !ok;
        if (ok) shown++;
      });
      if (unitsEmptyEl) unitsEmptyEl.hidden = shown > 0;
    } else {
      let shown = 0;
      itemPool.forEach(({ el, meta }) => {
        const ok =
          (ui.itemKind === "all" || meta.kind === ui.itemKind) &&
          (!q || meta.search.indexOf(q) >= 0);
        if (el.hidden === ok) el.hidden = !ok;
        if (ok) shown++;
      });
      if (itemsEmptyEl) itemsEmptyEl.hidden = shown > 0;
    }
  }

  function applyBoardPresence() {
    const state = store.getState();
    const curOnBoard = new Set((state.board || []).map((e) => e.id));
    const curBanned = new Set(Object.keys(state.bannedIds || {}).filter((id) => state.bannedIds[id]));

    prevOnBoard.forEach((id) => {
      if (!curOnBoard.has(id)) {
        const entry = unitPool.get(id);
        if (entry) {
          entry.el.classList.remove("on-board");
          entry.badgeEl.hidden = true;
        }
      }
    });
    curOnBoard.forEach((id) => {
      if (!prevOnBoard.has(id)) {
        const entry = unitPool.get(id);
        if (entry) {
          entry.el.classList.add("on-board");
          entry.badgeEl.hidden = false;
        }
      }
    });
    prevOnBoard = curOnBoard;

    prevBanned.forEach((id) => {
      if (!curBanned.has(id)) {
        const entry = unitPool.get(id);
        if (entry) entry.el.classList.remove("is-banned");
      }
    });
    curBanned.forEach((id) => {
      if (!prevBanned.has(id)) {
        const entry = unitPool.get(id);
        if (entry) entry.el.classList.add("is-banned");
      }
    });
    prevBanned = curBanned;

    const curTarget = state.unlockTargetId || null;
    if (curTarget !== prevUnlockTarget) {
      if (prevUnlockTarget) {
        const oldEntry = unitPool.get(prevUnlockTarget);
        if (oldEntry) oldEntry.el.classList.remove("is-unlock-target");
      }
      if (curTarget) {
        const newEntry = unitPool.get(curTarget);
        if (newEntry) newEntry.el.classList.add("is-unlock-target");
      }
      prevUnlockTarget = curTarget;
    }
  }

  function update(dirtyMask) {
    if (store.getUI().setVersion !== lastSetVersion) {
      rebuildForSet();
    }
    if (dirtyMask & (DIRTY_LIB_STATE | DIRTY_ALL)) {
      applyBoardPresence();
    }
    if (dirtyMask & (DIRTY_LIB_FILTER | DIRTY_ALL)) {
      applyFilter();
    }
  }

  return { update, rebuildForSet };
}
