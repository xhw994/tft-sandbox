import { DIRTY_BOARD, DIRTY_INSPECTOR, DIRTY_POP, DIRTY_ALL } from "../state/store.js";

const ROWS = 4;
const COLS = 7;
const MAX_ITEMS = 3;

const MARKS = [
  ["", "自动"],
  ["carry", "主C"],
  ["carry2", "副C"],
  ["tank", "主坦"],
  ["bot", "挂件"]
];

function $(id) {
  return document.getElementById(id);
}

export function mountBoardPool(store) {
  const popRatioEl = $("pop-ratio");
  const popSubEl = $("pop-sub");
  const previewBanner = $("preview-banner");
  const previewBannerText = $("preview-banner-text");
  const btnPreviewApply = $("btn-preview-apply");
  const btnPreviewExit = $("btn-preview-exit");
  const hexBoardEl = $("hex-board");
  const inspectorEl = $("inspector-dock");

  const cellPool = [];
  let prevPopKey = "";
  let prevBannerKey = "";
  let prevInspectorKey = "";

  function createCellRef(row, col) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "hex-cell empty";
    el.style.border = "0";
    el.style.padding = "0";
    el.style.background = "transparent";
    el.dataset.row = String(row);
    el.dataset.col = String(col);
    el.dataset.r = String(row);
    el.dataset.c = String(col);
    el.dataset.drop = "cell";
    el.style.setProperty("--r", String(row));
    el.style.setProperty("--c", String(col));
    el.setAttribute("aria-label", "第" + (row + 1) + "行第" + (col + 1) + "列 空");

    const shell = document.createElement("span");
    shell.className = "hex-shell";

    const face = document.createElement("span");
    face.className = "hex-face";

    const img = document.createElement("img");
    img.className = "portrait";
    img.alt = "";
    img.dataset.poolManaged = "1";
    img.hidden = true;

    const placeholder = document.createElement("span");
    placeholder.className = "hex-ph ph";
    placeholder.hidden = true;

    const nameEl = document.createElement("span");
    nameEl.className = "hex-name";
    nameEl.hidden = true;

    face.appendChild(img);
    face.appendChild(placeholder);
    face.appendChild(nameEl);
    shell.appendChild(face);

    const chrome = document.createElement("span");
    chrome.className = "hex-chrome";

    const starsEl = document.createElement("span");
    starsEl.className = "hex-stars";
    starsEl.hidden = true;
    const starIcons = [];
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("i");
      s.textContent = "★";
      s.hidden = true;
      starsEl.appendChild(s);
      starIcons.push(s);
    }

    const roleEl = document.createElement("span");
    roleEl.className = "hex-role";
    roleEl.hidden = true;

    const focusEl = document.createElement("span");
    focusEl.className = "hex-focus-pin";
    focusEl.textContent = "核心";
    focusEl.hidden = true;

    const ghostTagEl = document.createElement("span");
    ghostTagEl.className = "ghost-tag";
    ghostTagEl.hidden = true;

    const itemsEl = document.createElement("span");
    itemsEl.className = "hex-items";
    itemsEl.hidden = true;
    const itemSlots = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      const itemImg = document.createElement("img");
      itemImg.alt = "";
      itemImg.dataset.poolManaged = "1";
      itemImg.hidden = true;
      itemsEl.appendChild(itemImg);
      itemSlots.push(itemImg);
    }

    chrome.appendChild(starsEl);
    chrome.appendChild(roleEl);
    chrome.appendChild(focusEl);
    chrome.appendChild(ghostTagEl);
    chrome.appendChild(itemsEl);

    el.appendChild(shell);
    el.appendChild(chrome);

    return {
      row,
      col,
      el,
      shell,
      face,
      img,
      placeholder,
      nameEl,
      starsEl,
      starIcons,
      roleEl,
      focusEl,
      ghostTagEl,
      itemsEl,
      itemSlots,
      prevKey: "__init__",
      prevUnitId: "",
      prevItemsKey: ""
    };
  }

  function mountGridOnce() {
    if (!hexBoardEl || cellPool.length) return;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ref = createCellRef(r, c);
        cellPool.push(ref);
        frag.appendChild(ref.el);
      }
    }
    hexBoardEl.textContent = "";
    hexBoardEl.appendChild(frag);
  }

  if (btnPreviewApply) {
    btnPreviewApply.addEventListener("click", () => store.applyPreview());
  }
  if (btnPreviewExit) {
    btnPreviewExit.addEventListener("click", () => store.togglePreview(null));
  }

  if (hexBoardEl) {
    hexBoardEl.addEventListener("click", (e) => {
      if (Date.now() - store.getUI().dragAt < 250) return;
      const cellEl = e.target.closest && e.target.closest(".hex-cell");
      if (!cellEl) return;
      const unitId = cellEl.dataset.unit || "";
      if (unitId && !cellEl.classList.contains("is-ghost-only")) {
        store.selectUnit(unitId);
      } else {
        store.selectUnit(null);
      }
    });

    hexBoardEl.addEventListener("dblclick", (e) => {
      const cellEl = e.target.closest && e.target.closest(".hex-cell");
      if (!cellEl) return;
      const unitId = cellEl.dataset.unit || "";
      if (!unitId || cellEl.classList.contains("is-ghost-only")) return;
      store.act({ type: "star-up", id: unitId });
    });

    hexBoardEl.addEventListener("contextmenu", (e) => {
      const cellEl = e.target.closest && e.target.closest(".hex-cell");
      if (!cellEl) return;
      const unitId = cellEl.dataset.unit || "";
      if (!unitId || cellEl.classList.contains("is-ghost-only")) return;
      e.preventDefault();
      store.act({ type: "context-unit", id: unitId });
    });
  }

  if (inspectorEl) {
    inspectorEl.addEventListener("click", (e) => {
      if (Date.now() - store.getUI().dragAt < 250) return;
      const t = e.target;
      if (!t || !t.closest) return;

      const starBtn = t.closest("[data-insp-star]");
      if (starBtn) {
        store.act({ type: "set-star", id: starBtn.dataset.unit, star: Number(starBtn.dataset.inspStar) });
        return;
      }
      const markBtn = t.closest("[data-insp-mark]");
      if (markBtn) {
        store.act({ type: "set-mark", id: markBtn.dataset.unit, mark: markBtn.dataset.inspMark });
        return;
      }
      const focusBtn = t.closest("[data-insp-focus]");
      if (focusBtn) {
        const id = focusBtn.dataset.unit;
        const curFocus = store.getState().focusId;
        store.setSettings({ focusId: curFocus === id ? null : id });
        return;
      }
      const removeBtn = t.closest("[data-insp-remove]");
      if (removeBtn) {
        store.act({ type: "remove-unit", id: removeBtn.dataset.unit });
        return;
      }
      const unequipBtn = t.closest("[data-insp-unequip]");
      if (unequipBtn) {
        e.stopPropagation();
        store.act({
          type: "unequip-to-loose",
          id: unequipBtn.dataset.unit,
          itemId: unequipBtn.dataset.item,
          index: Number(unequipBtn.dataset.inspUnequip)
        });
      }
    });

    inspectorEl.addEventListener("contextmenu", (e) => {
      const slot = e.target.closest && e.target.closest('[data-drag="unit-item"]');
      if (!slot) return;
      e.preventDefault();
      store.act({
        type: "unequip-item",
        id: slot.dataset.unit,
        itemId: slot.dataset.item,
        index: Number(slot.dataset.index)
      });
    });
  }

  function renderPop() {
    const game = store.getGame();
    const state = store.getState();
    if (!game) return;

    const cap = game.capacity(state.board, store.getContext());
    const used = game.slotsOf(state.board);
    const extra = state.extraSlots || 0;
    const crown = Math.max(0, cap - state.level - extra);
    const over = used > cap;

    const key = [used, cap, state.level, extra, crown, over ? 1 : 0].join("|");
    if (key === prevPopKey) return;
    prevPopKey = key;

    if (popRatioEl) {
      popRatioEl.textContent = used + " / " + cap;
      popRatioEl.classList.toggle("is-over", over);
    }
    if (popSubEl) {
      const parts = ["等级 " + state.level, "额外人口 " + extra];
      if (crown > 0) parts.push("冠冕 " + crown);
      if (over) parts.push("超员");
      popSubEl.textContent = parts.join(" · ");
      popSubEl.classList.toggle("is-over", over);
    }
  }

  function renderPreviewBanner(diff) {
    document.body.classList.toggle("is-preview", !!diff);
    if (!previewBanner) return;
    const key = diff ? [diff.kind, diff.index, diff.title, diff.adds.length, diff.removes.length].join("|") : "none";
    if (key === prevBannerKey) return;
    prevBannerKey = key;

    if (!diff) {
      previewBanner.hidden = true;
      return;
    }

    previewBanner.hidden = false;
    if (previewBannerText) {
      const parts = ["正在预览：" + (diff.title || "推荐方案")];
      if (diff.adds.length) parts.push("+" + diff.adds.length + " 上场");
      if (diff.removes.length) parts.push("换下 " + diff.removes.map(store.unitName).join("、"));
      previewBannerText.textContent = parts.join(" · ");
    }
  }

  function renderBoard() {
    const game = store.getGame();
    const state = store.getState();
    const ui = store.getUI();
    const analysis = store.getAnalysis();
    if (!hexBoardEl || !game) return;

    mountGridOnce();

    const diff = ui.preview ? analysis.previewDiff : null;
    renderPreviewBanner(diff);

    const cellData = new Map();
    const coveredCells = new Set();

    if (diff && diff.byCoord) {
      Object.keys(diff.byCoord).forEach((coord) => {
        const info = diff.byCoord[coord];
        cellData.set(coord, info);
        if (info.span > 1 && info.entry && info.entry.position) {
          for (let k = 1; k < info.span; k++) {
            coveredCells.add(info.entry.position.row + "," + (info.entry.position.col + k));
          }
        }
      });
    } else {
      state.board.forEach((e) => {
        if (!e.position) return;
        const span = store.spanOf(e.id);
        const coord = e.position.row + "," + e.position.col;
        cellData.set(coord, { kind: "live", entry: e, note: "", span });
        for (let k = 1; k < span; k++) {
          coveredCells.add(e.position.row + "," + (e.position.col + k));
        }
      });
    }

    for (let i = 0; i < cellPool.length; i++) {
      const ref = cellPool[i];
      const coord = ref.row + "," + ref.col;
      const isCovered = coveredCells.has(coord);
      const data = isCovered ? null : cellData.get(coord) || null;
      const e = data ? data.entry : null;
      const u = e ? game.byId[e.id] : null;

      if (isCovered || !e || !u) {
        const emptyKey = isCovered ? "covered" : "empty";
        if (ref.prevKey === emptyKey) continue;
        ref.prevKey = emptyKey;
        ref.prevUnitId = "";
        ref.prevItemsKey = "";

        ref.el.className = isCovered ? "hex-cell empty covered" : "hex-cell empty";
        ref.el.style.removeProperty("--cost");
        ref.el.removeAttribute("data-unit");
        ref.el.removeAttribute("data-drag");
        ref.el.removeAttribute("data-tip");
        ref.el.setAttribute("aria-label", "第" + (ref.row + 1) + "行第" + (ref.col + 1) + "列 空");

        ref.img.hidden = true;
        ref.img.removeAttribute("src");
        ref.placeholder.hidden = true;
        ref.nameEl.hidden = true;
        ref.starsEl.hidden = true;
        ref.roleEl.hidden = true;
        ref.focusEl.hidden = true;
        ref.ghostTagEl.hidden = true;
        ref.itemsEl.hidden = true;
        continue;
      }

      const span = data.span || store.spanOf(e.id);
      const kind = data.kind || "live";
      const isGhostOnly = kind === "ghost-add" || kind === "ghost-target-unit" || kind === "ghost-remove";
      const isLiveSelected = !isGhostOnly && ui.selected === e.id;
      const isFocused = state.focusId === e.id;
      const role = store.roleLabel(e.id, e.mark);
      const roleCode = e.mark || (analysis.labels && analysis.labels[e.id]) || "";
      const items = Array.isArray(e.items) ? e.items : [];
      const itemsKey = items.join(",");

      const key = [
        e.id,
        e.star,
        e.mark || "",
        role,
        roleCode,
        isFocused ? 1 : 0,
        isLiveSelected ? 1 : 0,
        span,
        itemsKey,
        kind,
        data.note || ""
      ].join("|");

      if (key === ref.prevKey) continue;
      ref.prevKey = key;

      let cls = "hex-cell unit";
      if (span > 1) cls += " span2";
      if (isLiveSelected) cls += " selected";
      if (kind !== "live") cls += " " + kind;
      if (isGhostOnly) cls += " is-ghost-only";
      ref.el.className = cls;

      ref.el.style.setProperty("--cost", store.costColorVar(u.cost));
      ref.el.dataset.unit = e.id;
      ref.el.dataset.tip = "unit:" + e.id;
      if (!isGhostOnly && !diff) {
        ref.el.dataset.drag = "unit";
      } else {
        ref.el.removeAttribute("data-drag");
      }

      const itemNames = items.map(store.itemName).join("、") || "无";
      ref.el.setAttribute(
        "aria-label",
        "第" + (ref.row + 1) + "行第" + (ref.col + 1) + "列 " + u.display + " " + e.star + "星 装备 " + itemNames
      );

      if (ref.prevUnitId !== e.id) {
        ref.prevUnitId = e.id;
        const src = store.srcList(u);
        const focus = store.focusPos(e.id);
        if (src.length) {
          ref.img.src = src[0];
          ref.img.alt = u.display;
          ref.img.dataset.alt = src[1] || "";
          ref.img.dataset.swapped = "0";
          ref.img.style.objectPosition = focus == null ? "" : focus + "% 50%";
          ref.img.hidden = false;
          ref.placeholder.hidden = true;
        } else {
          ref.img.hidden = true;
          ref.placeholder.textContent = u.display;
          ref.placeholder.hidden = false;
        }
        ref.nameEl.textContent = u.display;
        ref.nameEl.hidden = false;
      }

      // Stars (hide stars if ghost-add/target shows top ghost tag so they don't collide)
      const hasGhostTag = !!data.note;
      ref.starsEl.hidden = hasGhostTag && isGhostOnly;
      ref.starsEl.className = "hex-stars star-" + e.star;
      ref.starsEl.setAttribute("aria-label", e.star + "星");
      for (let s = 0; s < 3; s++) {
        ref.starIcons[s].hidden = s >= e.star;
      }

      if (role && !isGhostOnly) {
        ref.roleEl.textContent = role;
        const rCls = roleCode === "carry" ? "role-carry"
          : roleCode === "carry2" ? "role-carry2"
            : (roleCode === "tank" || roleCode === "tank2") ? "role-tank" : "";
        ref.roleEl.className = "hex-role" + (rCls ? " " + rCls : "");
        ref.roleEl.hidden = false;
      } else {
        ref.roleEl.hidden = true;
      }

      ref.focusEl.hidden = !isFocused || isGhostOnly;

      if (hasGhostTag) {
        const gCls = kind === "ghost-target-unit" ? "unlock"
          : kind === "ghost-remove" ? "remove"
            : kind === "ghost-star" ? "unlock" : "add";
        ref.ghostTagEl.textContent = data.note;
        ref.ghostTagEl.className = "ghost-tag " + gCls;
        ref.ghostTagEl.hidden = false;
      } else {
        ref.ghostTagEl.hidden = true;
      }

      if (ref.prevItemsKey !== itemsKey) {
        ref.prevItemsKey = itemsKey;
        ref.itemsEl.hidden = items.length === 0;
        for (let idx = 0; idx < MAX_ITEMS; idx++) {
          const itemId = items[idx];
          const itemImg = ref.itemSlots[idx];
          if (!itemId) {
            itemImg.hidden = true;
            itemImg.removeAttribute("src");
            continue;
          }
          const it = game.itemById[itemId];
          const isrc = store.srcList(it);
          const iname = it ? it.name : itemId;
          itemImg.title = iname;
          if (isrc.length) {
            itemImg.src = isrc[0];
            itemImg.alt = iname;
            itemImg.dataset.alt = isrc[1] || "";
            itemImg.dataset.swapped = "0";
            itemImg.hidden = false;
          } else {
            itemImg.hidden = true;
          }
        }
      }
    }
  }

  function renderInspector() {
    if (!inspectorEl) return;
    const game = store.getGame();
    const state = store.getState();
    const ui = store.getUI();
    if (!game) return;

    const e = ui.selected ? state.board.find((x) => x.id === ui.selected) : null;
    if (!e || !game.byId[e.id]) {
      if (prevInspectorKey === "empty") return;
      prevInspectorKey = "empty";
      inspectorEl.innerHTML =
        '<div class="insp-empty">单击棋子选中 · 双击升星 · 右键卸装/降星/移出 · 拖拽换位或穿装 · 快捷键 1/2/3 切星 · Del 移出</div>';
      return;
    }

    const u = game.byId[e.id];
    const pos = e.position || { row: 0, col: 0 };
    const span = store.spanOf(e.id);
    const focused = state.focusId === e.id;
    const role = store.roleLabel(e.id, e.mark);
    const items = Array.isArray(e.items) ? e.items : [];
    const key = [e.id, e.star, e.mark || "", role, pos.row, pos.col, focused ? 1 : 0, items.join(",")].join("|");
    if (key === prevInspectorKey) return;
    prevInspectorKey = key;

    const esc = store.esc;
    const starBtns = [1, 2, 3].map((s) =>
      '<button type="button" class="' + (e.star === s ? "active" : "") +
      '" data-unit="' + esc(e.id) + '" data-insp-star="' + s + '" aria-pressed="' + (e.star === s) + '">' + s + "★</button>"
    ).join("");

    const markBtns = MARKS.map(([mVal, mLabel]) =>
      '<button type="button" class="' + (e.mark === mVal ? "active" : "") +
      '" data-unit="' + esc(e.id) + '" data-insp-mark="' + esc(mVal) + '" aria-pressed="' + (e.mark === mVal) + '">' + esc(mLabel) + "</button>"
    ).join("");

    const itemSlotsHtml = [0, 1, 2].map((i) => {
      const itemId = items[i];
      if (!itemId) {
        return '<span class="item-slot empty" data-drop="inspector">+ 拖入或点击装备</span>';
      }
      const it = game.itemById[itemId];
      const name = store.itemName(itemId);
      return '<span class="item-slot" data-drag="unit-item" data-unit="' + esc(e.id) + '" data-index="' + i +
        '" data-item="' + esc(itemId) + '" data-tip="item:' + esc(itemId) + '">' +
        store.imgHtml(it, "", name, true) +
        "<span>" + esc(name) + "</span>" +
        '<button type="button" class="btn xs ghost" style="padding:0 3px;height:18px" data-unit="' + esc(e.id) + '" data-item="' + esc(itemId) +
        '" data-insp-unequip="' + i + '" title="退回已有装备（右键直接删除）">×</button></span>';
    }).join("");

    inspectorEl.innerHTML =
      '<div class="insp-row">' +
        '<div class="insp-left" style="--cost-solid:' + esc(store.costSolidHex(u.cost)) + '">' +
          store.imgHtml(u, "insp-avatar", u.display, true) +
          '<div class="insp-meta">' +
            "<strong>" + esc(u.display) + "</strong>" +
            "<span>" + u.cost + "费 · " + esc((u.traitNames || []).join("/")) + " · (" + (pos.row + 1) + "," + (pos.col + 1) + ")</span>" +
          "</div>" +
        "</div>" +
        '<div class="insp-controls">' +
          '<div class="seg" role="group" aria-label="星级">' + starBtns + "</div>" +
          '<div class="seg" role="group" aria-label="职责">' + markBtns + "</div>" +
          '<button type="button" class="btn sm' + (focused ? " toggle-on" : "") + '" data-unit="' + esc(e.id) + '" data-insp-focus="1">' +
            (focused ? "★ 围绕此卡" : "围绕此卡") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="insp-row">' +
        '<div class="insp-items" data-drop="inspector">' + itemSlotsHtml + "</div>" +
        '<div class="insp-controls">' +
          '<button type="button" class="btn sm ghost danger" data-unit="' + esc(e.id) + '" data-insp-remove="1">移除</button>' +
        "</div>" +
      "</div>";
  }

  function update(dirtyMask) {
    if (dirtyMask & (DIRTY_POP | DIRTY_ALL)) renderPop();
    if (dirtyMask & (DIRTY_BOARD | DIRTY_ALL)) renderBoard();
    if (dirtyMask & (DIRTY_INSPECTOR | DIRTY_ALL)) renderInspector();
  }

  return { update };
}
