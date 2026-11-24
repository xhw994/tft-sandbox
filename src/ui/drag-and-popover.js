/**
 * Pointer-based 60fps GPU drag-and-drop engine + Native Top-Layer Popover (#rich-tip).
 * Uses #drag-ghost with rAF-throttled translate3d() and cached drop targets for minimal repaints.
 */

const ITEM_KIND_LABELS = {
  basic: "基础散件",
  normal: "成装",
  radiant: "光明武器",
  artifact: "奥恩神器",
  support: "辅助装备",
  emblem: "纹章",
  spatula: "冠冕",
  consumable: "消耗品"
};

export function mountDragAndPopover(store) {
  const ghostEl = document.getElementById("drag-ghost");
  const tipEl = document.getElementById("rich-tip");

  if (ghostEl) {
    ghostEl.style.pointerEvents = "none";
    ghostEl.hidden = true;
  }

  let drag = null;
  let dragEndedAt = -1000;
  let rafId = 0;
  let latestX = 0;
  let latestY = 0;

  let pinnedTraitId = null;
  let currentTipKey = null;

  const esc = (s) => store.esc(s);
  const imgHtml = (rec, cls, label, eager) => store.imgHtml(rec, cls, label, eager);

  // ---------- Popover (#rich-tip) ----------

  function activeTraitDetail(traitId) {
    const analysis = typeof store.getAnalysis === "function" ? store.getAnalysis() : null;
    const ui = store.getUI ? store.getUI() : null;
    const rec = (analysis && analysis.rec) || (ui && ui.rec) || null;
    const list = (rec && rec.traits) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === traitId) return list[i];
    }
    return null;
  }

  function unitTipHtml(id) {
    const game = store.getGame() || {};
    const u = game.byId && game.byId[id];
    if (!u) return "";
    const costHex = typeof store.costSolidHex === "function" ? store.costSolidHex(u.cost) : "#6b6b72";
    const traits = (u.traitNames && u.traitNames.length)
      ? u.traitNames
      : (u.traits || []).map((tid) => (game.traitById && game.traitById[tid] ? game.traitById[tid].name : tid));
    const st = u.stats || {};
    const manaText = u.manaless
      ? "无"
      : `${st.manaStart != null ? st.manaStart : 0}/${st.mana != null ? st.mana : 0}`;
    const roleMeta = [u.role, u.laneLabel, st.range != null ? `射程 ${st.range}` : ""].filter(Boolean).join(" · ");

    const statsParts = [
      st.hp != null ? `生命 ${st.hp}` : "",
      st.ad != null ? `攻击 ${st.ad}` : "",
      st.ar != null ? `护甲 ${st.ar}` : "",
      st.mr != null ? `魔抗 ${st.mr}` : "",
      st.as != null ? `攻速 ${st.as}` : "",
      `法力 ${manaText}`
    ].filter(Boolean).join(" · ");

    const ab = u.ability && (u.ability.name || u.ability.text)
      ? `<div class="tip-meta"><div><strong style="color:var(--text-primary)">${esc(u.ability.name || "技能")}</strong></div><div class="tip-desc">${esc(u.ability.text || "")}</div></div>`
      : "";
    const unlock = u.unlock && u.unlock.text
      ? `<div class="tip-meta"><div style="color:var(--accent)">解锁条件：${esc(u.unlock.text)}</div></div>`
      : "";

    return (
      `<div class="tip-head">` +
      `<span style="display:contents;--cost:${esc(costHex)}">${imgHtml(u, "", u.display || u.name, true)}</span>` +
      `<div style="min-width:0">` +
      `<div class="tip-title">${esc(u.display || u.name)} <span style="font-family:var(--font-mono);font-size:11px;color:${esc(costHex)}">${u.cost || 1}费</span></div>` +
      `<div class="tip-sub">${esc(traits.join(" / "))}${roleMeta ? ` · ${esc(roleMeta)}` : ""}</div>` +
      `</div>` +
      `</div>` +
      (statsParts ? `<div class="tip-sub" style="margin-bottom:5px;font-family:var(--font-mono)">${esc(statsParts)}</div>` : "") +
      ab +
      unlock
    );
  }

  function itemTipHtml(id) {
    const game = store.getGame() || {};
    const it = game.itemById && game.itemById[id];
    if (!it) return "";
    const cat = ITEM_KIND_LABELS[it.kind] || it.kind || "装备";
    const components = Array.isArray(it.buildsFrom) ? it.buildsFrom : [];
    const recipeHtml = components.length
      ? `<div class="tip-meta"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span>合成：</span>` +
        components.map((cid) => {
          const c = game.itemById && game.itemById[cid];
          const cname = c ? c.name : store.itemName(cid);
          const ico = c ? imgHtml(c, "", cname, true) : "";
          return `<span style="display:inline-flex;align-items:center;gap:3px">${ico.replace("<img ", '<img style="width:15px;height:15px;border-radius:3px" ')}<span>${esc(cname)}</span></span>`;
        }).join("<span>+</span>") +
        `</div></div>`
      : "";

    return (
      `<div class="tip-head">` +
      imgHtml(it, "", it.name, true) +
      `<div style="min-width:0">` +
      `<div class="tip-title">${esc(it.name)}</div>` +
      `<div class="tip-sub">${esc(cat)}</div>` +
      `</div>` +
      `</div>` +
      (it.text ? `<p class="tip-desc">${esc(it.text)}</p>` : "") +
      recipeHtml
    );
  }

  function traitTipHtml(id, pinned) {
    const game = store.getGame() || {};
    const state = store.getState() || {};
    const t = game.traitById && game.traitById[id];
    if (!t) return "";
    const detail = activeTraitDetail(id);
    const activeNeed = detail && detail.best ? detail.best.need : null;
    const prisOn = !!(state.prismatic && state.prismatic[id]);
    const kindLabel = t.kind === "band" ? "地区 / 乐队" : t.kind === "solo" ? "专属" : "职业";

    const bps = (t.breakpoints || []).map((bp) => {
      const isPris = bp.prismaticStyle === 5 || (!bp.style && bp.prismaticStyle > 0);
      const isActive = activeNeed === bp.need && (!isPris || prisOn);
      const txt = (isPris && bp.prismaticText) ? bp.prismaticText : (bp.text || bp.prismaticText || "");
      const activeStyle = isActive
        ? "color:var(--accent);font-weight:700;"
        : (isPris && !prisOn ? "opacity:0.55;" : "");
      return `<div style="${activeStyle}">${bp.need}${t.countMode === "stars" ? "★" : ""}：${esc(txt)}</div>`;
    }).join("");

    const pinClose = pinned
      ? `<button type="button" class="btn xs ghost" data-unpin-tip="1" aria-label="关闭固定详情" style="margin-left:auto">×</button>`
      : "";

    const curText = detail && detail.count
      ? `当前 ${detail.count}${t.countMode === "stars" ? "★" : ""}`
      : kindLabel;

    return (
      `<div class="tip-head">` +
      `<span class="trait-hex" style="width:28px;height:32px;flex-shrink:0">${imgHtml(t, "", t.name, true)}</span>` +
      `<div style="min-width:0;flex:1">` +
      `<div class="tip-title">${esc(t.name)}</div>` +
      `<div class="tip-sub">${esc(curText)}</div>` +
      `</div>` +
      pinClose +
      `</div>` +
      (t.desc ? `<p class="tip-desc">${esc(t.desc)}</p>` : "") +
      (bps ? `<div class="tip-meta">${bps}</div>` : "")
    );
  }

  function tipHtml(kind, id, pinned) {
    if (kind === "unit") return unitTipHtml(id);
    if (kind === "item") return itemTipHtml(id);
    if (kind === "trait") return traitTipHtml(id, pinned);
    return "";
  }

  function placeTip(anchorEl) {
    if (!tipEl || !anchorEl || !anchorEl.getBoundingClientRect) return;
    const r = anchorEl.getBoundingClientRect();
    const tw = tipEl.offsetWidth || 280;
    const th = tipEl.offsetHeight || 160;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right + 10;
    if (left + tw > vw - 8) left = Math.max(8, r.left - 10 - tw);
    if (left + tw > vw - 8) left = Math.max(8, vw - tw - 8);
    const top = Math.min(Math.max(8, r.top), Math.max(8, vh - th - 8));
    const px = `${Math.round(left)}px`;
    const py = `${Math.round(top)}px`;
    tipEl.style.setProperty("--tip-x", px);
    tipEl.style.setProperty("--tip-y", py);
    tipEl.style.left = px;
    tipEl.style.top = py;
  }

  function showTip(anchorEl, html, key, pinned) {
    if (!tipEl || !html) return;
    if (currentTipKey !== key || pinned) {
      tipEl.innerHTML = html;
      currentTipKey = key;
    }
    tipEl.classList.toggle("is-pinned", !!pinned);
    tipEl.style.pointerEvents = pinned ? "auto" : "none";
    tipEl.hidden = false;
    if (typeof tipEl.showPopover === "function") {
      try {
        if (!tipEl.matches(":popover-open")) tipEl.showPopover();
      } catch (_) {
        /* fallback to hidden=false */
      }
    }
    placeTip(anchorEl);
  }

  function hideTip() {
    pinnedTraitId = null;
    currentTipKey = null;
    if (!tipEl) return;
    tipEl.classList.remove("is-pinned");
    tipEl.style.pointerEvents = "none";
    if (typeof tipEl.hidePopover === "function") {
      try {
        if (tipEl.matches(":popover-open")) tipEl.hidePopover();
      } catch (_) {
        /* ignore */
      }
    }
    tipEl.hidden = true;
  }

  function togglePinTrait(traitId, anchorEl) {
    if (!traitId) return;
    if (pinnedTraitId === traitId) {
      hideTip();
      return;
    }
    pinnedTraitId = traitId;
    const html = tipHtml("trait", traitId, true);
    if (html) showTip(anchorEl, html, `pin:trait:${traitId}`, true);
  }

  function tipSpec(el) {
    const raw = el.getAttribute("data-tip") || "";
    const i = raw.indexOf(":");
    return i < 0 ? null : { kind: raw.slice(0, i), id: raw.slice(i + 1), raw };
  }

  function showHoverTip(el) {
    if (drag && drag.active) return;
    const spec = tipSpec(el);
    if (!spec || !spec.id) return;
    const html = tipHtml(spec.kind, spec.id, false);
    if (html) showTip(el, html, spec.raw, false);
  }

  document.addEventListener("pointerover", (e) => {
    if (pinnedTraitId || (drag && drag.active)) return;
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el) showHoverTip(el);
  });

  document.addEventListener("pointerout", (e) => {
    if (pinnedTraitId) return;
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hideTip();
  });

  document.addEventListener("focusin", (e) => {
    if (pinnedTraitId || (drag && drag.active)) return;
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el) showHoverTip(el);
  });

  document.addEventListener("focusout", () => {
    if (!pinnedTraitId) hideTip();
  });

  // Custom event dispatched by traits-pool.js when clicking trait medallion/name
  document.addEventListener("tft:pin-trait", (e) => {
    const d = e && e.detail;
    if (!d || !d.traitId) return;
    togglePinTrait(d.traitId, d.el || e.target);
  });

  // ---------- GPU Drag Engine ----------

  function payloadOf(el) {
    const kind = el.getAttribute("data-drag");
    if (kind === "unit") return { kind: "unit", id: el.dataset.unit };
    if (kind === "library-unit") return { kind: "library-unit", id: el.dataset.id };
    if (kind === "library-item") return { kind: "library-item", itemId: el.dataset.item };
    if (kind === "loose-item" || kind === "loose") {
      return { kind: "loose-item", itemId: el.dataset.item, index: Number(el.dataset.index) };
    }
    if (kind === "unit-item") {
      return {
        kind: "unit-item",
        unitId: el.dataset.unit,
        itemId: el.dataset.item,
        index: Number(el.dataset.index)
      };
    }
    return null;
  }

  function selectedUnitId() {
    const ui = store.getUI ? store.getUI() : null;
    return ui ? ui.selected || null : null;
  }

  function dropTargetUnit(t) {
    if (!t || !t.dataset) return null;
    if (t.dataset.drop === "cell") return t.dataset.unit || null;
    if (t.dataset.drop === "inspector" || t.dataset.drop === "inspector-items" || t.dataset.drop === "editor") {
      return selectedUnitId();
    }
    return null;
  }

  function isValidItemZone(t) {
    if (!t || !t.dataset) return false;
    if (t.dataset.drop === "equip-bench") return true;
    return !!dropTargetUnit(t);
  }

  function canDrop(p, t) {
    if (!p || !t || !t.dataset) return false;
    const d = t.dataset.drop;
    if (p.kind === "unit") return d === "cell";
    if (p.kind === "library-unit") return d === "cell" && !t.dataset.unit;
    if (p.kind === "library-item") return isValidItemZone(t);
    if (p.kind === "loose-item") return isValidItemZone(t);
    if (p.kind === "unit-item") return isValidItemZone(t);
    return false;
  }

  function isDeleteHover(p, t) {
    if (!p) return false;
    if (p.kind !== "loose-item" && p.kind !== "unit-item") return false;
    return !isValidItemZone(t);
  }

  function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("[data-drop]") : null;
  }

  function populateGhost(d) {
    if (!ghostEl) return;
    const p = d.payload;
    const isUnit = p.kind === "unit" || p.kind === "library-unit";
    ghostEl.className = "drag-ghost" + (isUnit ? " ghost-unit" : "");

    const game = store.getGame() || {};
    let html = "";
    let label = "";
    if (isUnit) {
      const u = game.byId && game.byId[p.id];
      label = u ? (u.display || u.name) : store.unitName(p.id);
      const costHex = u && typeof store.costSolidHex === "function" ? store.costSolidHex(u.cost) : "";
      if (costHex) ghostEl.style.setProperty("--cost", costHex);
      html = imgHtml(u, "ghost-img", label, true);
    } else if (p.itemId) {
      const it = game.itemById && game.itemById[p.itemId];
      label = it ? it.name : store.itemName(p.itemId);
      ghostEl.style.removeProperty("--cost");
      html = imgHtml(it, "ghost-img", label, true);
    }
    ghostEl.innerHTML = html + `<span>${esc(label)}</span>`;
    ghostEl.hidden = false;
  }

  function applyDragFrame() {
    rafId = 0;
    if (!drag || !drag.active || !ghostEl) return;

    ghostEl.style.transform = `translate3d(${Math.round(latestX + 12)}px, ${Math.round(latestY + 12)}px, 0)`;

    const t = dropTargetAt(latestX, latestY);
    const del = isDeleteHover(drag.payload, t);
    const ok = t ? canDrop(drag.payload, t) : false;
    const nextState = t ? (ok ? "ok" : (del ? "none" : "no")) : "none";

    if (t !== drag.lastTarget || nextState !== drag.lastDropState) {
      if (drag.lastTarget) {
        drag.lastTarget.classList.remove("drop-ok", "drop-no");
      }
      if (t && nextState !== "none") {
        t.classList.add(nextState === "ok" ? "drop-ok" : "drop-no");
      }
      drag.lastTarget = t;
      drag.lastDropState = nextState;
    }

    if (del !== drag.lastDelete) {
      ghostEl.classList.toggle("is-delete", del);
      drag.lastDelete = del;
    }
  }

  function scheduleFrame() {
    if (!rafId) rafId = requestAnimationFrame(applyDragFrame);
  }

  function performDrop(p, t) {
    if (!p) return;
    if (p.kind === "unit") {
      if (!t || t.dataset.drop !== "cell") return;
      store.act({
        type: "move-unit",
        id: p.id,
        position: { row: Number(t.dataset.row), col: Number(t.dataset.col) }
      });
      return;
    }
    if (p.kind === "library-unit") {
      if (!t || t.dataset.drop !== "cell" || t.dataset.unit) return;
      store.act({
        type: "add-unit",
        id: p.id,
        position: { row: Number(t.dataset.row), col: Number(t.dataset.col) }
      });
      return;
    }
    if (p.kind === "library-item") {
      if (!t) return;
      if (t.dataset.drop === "equip-bench") {
        store.addLooseItem(p.itemId);
        return;
      }
      const uid = dropTargetUnit(t);
      if (uid) {
        store.act({ type: "equip-item", id: uid, itemId: p.itemId, source: { kind: "library" } });
      }
      return;
    }
    if (p.kind === "loose-item") {
      if (t && t.dataset.drop === "equip-bench") return;
      const uid = dropTargetUnit(t);
      if (uid) {
        store.act({
          type: "equip-item",
          id: uid,
          itemId: p.itemId,
          source: { kind: "loose", index: p.index }
        });
        return;
      }
      store.act({ type: "delete-loose", index: p.index, itemId: p.itemId });
      return;
    }
    if (p.kind === "unit-item") {
      if (t && t.dataset.drop === "equip-bench") {
        store.act({ type: "unequip-to-loose", id: p.unitId, itemId: p.itemId, index: p.index });
        return;
      }
      const uid = dropTargetUnit(t);
      if (uid) {
        if (uid !== p.unitId) {
          store.act({
            type: "equip-item",
            id: uid,
            itemId: p.itemId,
            source: { kind: "unit", unitId: p.unitId, index: p.index }
          });
        }
        return;
      }
      store.act({ type: "unequip-item", id: p.unitId, itemId: p.itemId, index: p.index });
    }
  }

  function cleanupDrag() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (drag && drag.lastTarget) {
      drag.lastTarget.classList.remove("drop-ok", "drop-no");
    }
    if (drag && drag.el) {
      drag.el.classList.remove("drag-src");
    }
    if (ghostEl) {
      ghostEl.hidden = true;
      ghostEl.classList.remove("is-delete", "ghost-unit");
      ghostEl.style.transform = "";
      ghostEl.innerHTML = "";
    }
    document.body.classList.remove("dragging");
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragCancel);
    drag = null;
  }

  function markDragEnded() {
    dragEndedAt = performance.now();
    const ui = store.getUI && store.getUI();
    if (ui) ui.dragAt = Date.now();
  }

  function onDragMove(e) {
    if (!drag) return;
    latestX = e.clientX;
    latestY = e.clientY;
    if (!drag.active) {
      if (Math.hypot(latestX - drag.x, latestY - drag.y) <= 6) return;
      drag.active = true;
      document.body.classList.add("dragging");
      drag.el.classList.add("drag-src");
      hideTip();
      populateGhost(drag);
    }
    scheduleFrame();
  }

  function onDragEnd(e) {
    const d = drag;
    if (!d) return;
    if (!d.active) {
      cleanupDrag();
      return;
    }
    const t = dropTargetAt(e.clientX, e.clientY);
    cleanupDrag();
    markDragEnded();
    performDrop(d.payload, t);
  }

  function onDragCancel() {
    if (drag && drag.active) markDragEnded();
    cleanupDrag();
  }

  document.addEventListener("dragstart", (e) => e.preventDefault());

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest("button[data-cancel-ban], select, input, textarea")) return;
    const el = e.target.closest && e.target.closest("[data-drag]");
    if (!el || el.dataset.empty === "1") return;
    const payload = payloadOf(el);
    if (!payload) return;
    latestX = e.clientX;
    latestY = e.clientY;
    drag = {
      el,
      x: e.clientX,
      y: e.clientY,
      active: false,
      payload,
      lastTarget: null,
      lastDropState: "none",
      lastDelete: false
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragCancel);
  });

  // Suppress accidental clicks within 260ms after drag release
  document.addEventListener("click", (e) => {
    if (performance.now() - dragEndedAt < 260) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Pin / unpin trait popover clicks
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-unpin-tip]")) {
      hideTip();
      return;
    }
    const pinEl = t.closest("[data-pin-trait], [data-info]");
    if (pinEl && (!tipEl || !tipEl.contains(pinEl))) {
      const tid = pinEl.getAttribute("data-pin-trait") || pinEl.getAttribute("data-info");
      if (tid) {
        togglePinTrait(tid, pinEl);
        return;
      }
    }
    if (pinnedTraitId && !t.closest("[data-trait-pin]") && tipEl && !tipEl.contains(t)) {
      hideTip();
    }
  });

  return {
    hideTip,
    togglePinTrait,
    isDragging: () => !!(drag && drag.active)
  };
}
