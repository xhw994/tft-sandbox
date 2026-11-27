/**
 * Independent Set 19 "合奏 (Collab)" Combination Finder & Local Portrait Matcher Modal.
 * Focused Operate UI: large scannable champion portraits, zero filler copy, instant "/" search,
 * 1-click screen capture/paste/upload recognition, and avg-chip hover breakdown.
 */
import {
  getCollabGroups,
  getCollabPoolIds,
  filterCollabGroups,
  suggestDiscriminatingUnits
} from "../logic/collab-matcher.js";
import { recognizeCollabScreenshot } from "../logic/avatar-ocr.js";
import { isScreenCaptureSupported, captureAndCropRegion } from "../logic/screen-capture.js";
import { aliasesForUnit } from "../logic/search-aliases.js";

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
const ICON_CAPTURE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
const ICON_PASTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>';
const ICON_IMAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

/**
 * Generates a distinct, player-recognizable title from the 3 lowest-cost units in a Collab group.
 */
export function collabGroupTitle(group, game) {
  const units = (group && Array.isArray(group.units)) ? group.units : [];
  const names = units.slice(0, 3).map((uid) => {
    const u = game && game.byId && game.byId[uid];
    return u ? u.display : uid;
  });
  return names.join(" · ");
}

export function mountCollabModal(store) {
  const modalEl = document.getElementById("collab-modal");
  const openBtn = document.getElementById("btn-collab-open");
  if (!modalEl) return { open() {}, close() {} };

  let selectedIds = [];
  let excludedIds = [];
  let poolQuery = "";
  let poolExpanded = true;
  let ocrState = { busy: false, error: "", result: null };

  const esc = (s) => store.esc(s);

  function hideAvgTip() {
    const tip = modalEl.querySelector("#cl-avg-tip");
    if (tip) tip.hidden = true;
  }

  function showAvgTip(anchorEl, gid) {
    const tip = modalEl.querySelector("#cl-avg-tip");
    if (!tip || !anchorEl) return;
    const g = getCollabGroups().find((x) => x.id === gid);
    if (!g) return;

    const rows = [];
    if (g.activeAvg != null) {
      rows.push(`<div class="cl-tip-row"><span>激活均名</span><strong>${g.activeAvg.toFixed(2)}</strong></div>`);
    }
    if (g.bp3) {
      rows.push(`<div class="cl-tip-row"><span>3 合奏</span><strong>${g.bp3.avg.toFixed(2)}<em>前四 ${g.bp3.top4}%</em></strong></div>`);
    }
    if (g.bp5) {
      rows.push(`<div class="cl-tip-row"><span>5 合奏</span><strong>${g.bp5.avg.toFixed(2)}<em>前四 ${g.bp5.top4}%</em></strong></div>`);
    }
    if (g.games) {
      const sampleTxt = g.games >= 10000 ? `${(g.games / 10000).toFixed(1)} 万局` : `${g.games} 局`;
      rows.push(`<div class="cl-tip-meta">样本 ${sampleTxt}</div>`);
    }
    if (!rows.length) return;

    tip.innerHTML = rows.join("");
    tip.hidden = false;

    const ar = anchorEl.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const pad = 10;
    let left = Math.min(window.innerWidth - tr.width - pad, Math.max(pad, ar.right - tr.width));
    let top = ar.bottom + 6;
    if (top + tr.height + pad > window.innerHeight) {
      top = Math.max(pad, ar.top - tr.height - 6);
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function toggleInclude(uid) {
    if (!uid) return;
    excludedIds = excludedIds.filter((id) => id !== uid);
    if (selectedIds.includes(uid)) {
      selectedIds = selectedIds.filter((id) => id !== uid);
    } else {
      selectedIds = [...selectedIds, uid];
    }
    renderBody();
  }

  function toggleExclude(uid) {
    if (!uid) return;
    selectedIds = selectedIds.filter((id) => id !== uid);
    if (excludedIds.includes(uid)) {
      excludedIds = excludedIds.filter((id) => id !== uid);
    } else {
      excludedIds = [...excludedIds, uid];
    }
    renderBody();
  }

  function clearAllFilters() {
    selectedIds = [];
    excludedIds = [];
    poolQuery = "";
    ocrState = { busy: false, error: "", result: null };
    const qInput = modalEl.querySelector("#collab-search");
    if (qInput) qInput.value = "";
    renderBody();
  }

  async function handleImageBlob(blob) {
    if (!blob) return;
    const groups = getCollabGroups();
    const game = store.getGame();
    const poolIds = getCollabPoolIds(groups, game);
    ocrState = { busy: true, error: "", result: null };
    renderBody();

    const res = await recognizeCollabScreenshot(blob, groups, poolIds, store);
    if (res.error) {
      ocrState = { busy: false, error: res.error, result: null };
      renderBody();
      return;
    }

    ocrState = { busy: false, error: "", result: res };
    excludedIds = [];
    if (res.strongGroupLock && res.suggestedIds.length) {
      selectedIds = res.suggestedIds.slice();
    } else if (res.tiles.length <= 2 && res.suggestedIds.length) {
      selectedIds = res.suggestedIds.slice();
    } else {
      selectedIds = [];
    }
    renderBody();
  }

  async function handlePasteClick() {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.read === "function") {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = (item.types || []).find((t) => t.startsWith("image/"));
          if (imgType) {
            const blob = await item.getType(imgType);
            if (blob) {
              await handleImageBlob(blob);
              return;
            }
          }
        }
        ocrState = { busy: false, error: "剪贴板里还没有截图，截完图直接粘贴即可", result: ocrState.result };
        renderBody();
        return;
      } catch {
        // Permission denied or unsupported clipboard read -> fall through to gentle prompt
      }
    }
    ocrState = { busy: false, error: "浏览器未开放剪贴板读取，请直接按键盘粘贴截图", result: ocrState.result };
    renderBody();
  }

  async function handleCaptureClick() {
    try {
      const shell = modalEl.querySelector(".modal-shell") || modalEl;
      const blob = await captureAndCropRegion(shell);
      if (blob) await handleImageBlob(blob);
    } catch (err) {
      ocrState = { busy: false, error: (err && err.message) || "截屏失败，请改用粘贴截图", result: ocrState.result };
      renderBody();
    }
  }

  function updateToolbarControls(matchedCount, totalCount) {
    const countEl = modalEl.querySelector("#cl-match-count");
    if (countEl) {
      const filtered = selectedIds.length > 0 || excludedIds.length > 0;
      countEl.innerHTML = `<b${filtered ? ' class="is-filtered"' : ""}>${matchedCount}</b> / ${totalCount}`;
    }
    const clearBtn = modalEl.querySelector("[data-cl-clear]");
    if (clearBtn) {
      clearBtn.hidden = !(selectedIds.length || excludedIds.length || ocrState.result || ocrState.error);
    }
    const toggleBtn = modalEl.querySelector("[data-cl-toggle-pool]");
    if (toggleBtn) {
      toggleBtn.classList.toggle("is-collapsed", !poolExpanded);
      toggleBtn.setAttribute("aria-expanded", String(poolExpanded));
      toggleBtn.setAttribute("aria-label", poolExpanded ? "收起棋子池" : "展开棋子池");
      toggleBtn.setAttribute("title", poolExpanded ? "收起棋子池" : "展开棋子池");
    }
  }

  function renderBody() {
    const bodyEl = modalEl.querySelector("#collab-dynamic-body");
    if (!bodyEl) return;
    hideAvgTip();

    const game = store.getGame();
    const groups = getCollabGroups();
    const poolIds = getCollabPoolIds(groups, game);
    const matched = filterCollabGroups(groups, selectedIds, excludedIds, "avg");

    updateToolbarControls(matched.length, groups.length);

    const ocrRankedMap = new Map();
    if (ocrState.result && Array.isArray(ocrState.result.rankedGroups)) {
      ocrState.result.rankedGroups.forEach((r, idx) => {
        ocrRankedMap.set(r.group.id, { rank: idx + 1, score: r.meanSim });
      });
    }
    const displayGroups = (!selectedIds.length && !excludedIds.length && ocrRankedMap.size)
      ? matched.slice().sort((a, b) => {
        const ra = ocrRankedMap.has(a.id) ? ocrRankedMap.get(a.id).rank : 999;
        const rb = ocrRankedMap.has(b.id) ? ocrRankedMap.get(b.id).rank : 999;
        return ra - rb;
      })
      : matched;

    const reachable = new Set();
    for (const g of matched) {
      for (const uid of g.units) reachable.add(uid);
    }

    // Active filter chips + discriminating quick-picks (only rendered when active — zero noise when idle)
    const selChipsHtml = selectedIds.map((uid) => {
      const u = game && game.byId && game.byId[uid];
      const name = u ? u.display : uid;
      return (
        `<button type="button" class="cl-chip is-inc" data-cl-toggle="${esc(uid)}" aria-label="移除 ${esc(name)}">` +
        store.imgHtml(u, "", name, false) +
        `<span>${esc(name)}</span>${ICON_CLOSE}</button>`
      );
    }).join("") + excludedIds.map((uid) => {
      const u = game && game.byId && game.byId[uid];
      const name = u ? u.display : uid;
      return (
        `<button type="button" class="cl-chip is-exc" data-cl-exc="${esc(uid)}" aria-label="取消排除 ${esc(name)}">` +
        `<span>非 ${esc(name)}</span>${ICON_CLOSE}</button>`
      );
    }).join("");

    const hints = (selectedIds.length > 0 && matched.length >= 2 && matched.length <= 12)
      ? suggestDiscriminatingUnits(matched, selectedIds, 5)
      : [];
    const hintsHtml = hints.length
      ? `<div class="cl-hints-inline">` +
        hints.map((h) => {
          const u = game && game.byId && game.byId[h.id];
          const name = u ? u.display : h.id;
          return `<button type="button" class="cl-hint-btn" data-cl-toggle="${esc(h.id)}">` +
            store.imgHtml(u, "", name, false) +
            `<span>${esc(name)}</span><em>${h.count}</em></button>`;
        }).join("") + `</div>`
      : "";

    const filterRowHtml = (selChipsHtml || hintsHtml)
      ? `<div class="cl-filter-row"><div class="cl-chips">${selChipsHtml}</div>${hintsHtml}</div>`
      : "";

    // OCR feedback strip
    let ocrBannerHtml = "";
    if (ocrState.busy) {
      ocrBannerHtml = `<div class="cl-ocr-result is-busy">正在识别头像…</div>`;
    } else if (ocrState.error) {
      ocrBannerHtml =
        `<div class="cl-ocr-result is-err">` +
        `<span>${esc(ocrState.error)}</span>` +
        `<button type="button" class="btn xs ghost" data-cl-clear-ocr="1" aria-label="关闭提示">${ICON_CLOSE}</button>` +
        `</div>`;
    } else if (ocrState.result) {
      const r = ocrState.result;
      const tileChips = r.tiles.map((t) => {
        const u = t.unitId && game && game.byId && game.byId[t.unitId];
        const name = u ? u.display : "未知";
        const active = t.unitId && selectedIds.includes(t.unitId);
        const altBtns = (t.top3 || []).slice(1, 3).map((alt) => {
          const au = game && game.byId && game.byId[alt.id];
          return au
            ? `<button type="button" class="cl-ocr-alt" data-cl-swap-from="${esc(t.unitId || "")}" data-cl-swap-to="${esc(alt.id)}">${esc(au.display)}</button>`
            : "";
        }).join("");
        return (
          `<div class="cl-ocr-tile${active ? " is-selected" : ""}">` +
          `<img class="cl-ocr-thumb" src="${esc(t.thumbUrl)}" alt="截图头像">` +
          `<button type="button" class="cl-ocr-match" data-cl-toggle="${esc(t.unitId || "")}">` +
          `<strong>${esc(name)}</strong><span>${t.confidence}%</span></button>` +
          (altBtns ? `<div class="cl-ocr-alts">${altBtns}</div>` : "") +
          `</div>`
        );
      }).join("");
      ocrBannerHtml =
        `<div class="cl-ocr-result">` +
        `<div class="cl-ocr-tiles">${tileChips}` +
        `<button type="button" class="btn xs ghost cl-ocr-dismiss" data-cl-clear-ocr="1" aria-label="清除识别结果">${ICON_CLOSE}</button>` +
        `</div></div>`;
    }

    // Large 55-unit Collab pool picker (~50% modal height when expanded)
    const q = poolQuery.trim().toLowerCase();
    const visiblePool = poolIds.filter((uid) => {
      if (!q) return true;
      const u = game && game.byId && game.byId[uid];
      if (!u) return false;
      return `${u.display} ${u.nameEn || ""} ${aliasesForUnit(u, game)}`.toLowerCase().includes(q);
    });

    const poolHtml = poolExpanded
      ? `<div class="cl-pool-pane"><div class="cl-pool-grid">` +
        visiblePool.map((uid) => {
          const u = game && game.byId && game.byId[uid];
          if (!u) return "";
          const isSel = selectedIds.includes(uid);
          const isExc = excludedIds.includes(uid);
          const isReachable = reachable.has(uid);
          const cls = [
            "cl-pool-unit",
            isSel ? "is-sel" : "",
            isExc ? "is-exc" : "",
            !isSel && !isExc && (selectedIds.length || excludedIds.length) && !isReachable ? "is-dim" : ""
          ].filter(Boolean).join(" ");
          return (
            `<button type="button" class="${cls}" data-cl-toggle="${esc(uid)}" data-cl-ctx="${esc(uid)}" style="--cost-solid:${esc(store.costSolidHex(u.cost))}" aria-pressed="${isSel}">` +
            `<span class="cl-pool-ava">${store.imgHtml(u, "", u.display, false)}</span>` +
            `<span class="cl-pool-name">${esc(u.display)}</span>` +
            `</button>`
          );
        }).join("") +
        `</div></div>`
      : "";

    // Streamlined Collab group cards: 3-lowest-cost title, large 54px portraits, avg chip with hover breakdown, bottom-right load CTA
    const cardsHtml = displayGroups.length
      ? displayGroups.map((g) => {
        const isExact = matched.length === 1 && (selectedIds.length > 0 || excludedIds.length > 0);
        const ocrTag = ocrRankedMap.get(g.id);
        const title = collabGroupTitle(g, game);

        const traitsHtml = (g.sharedTraits || []).slice(0, 2).map((t) =>
          `<span class="cl-trait-tag">${esc(`${t.count}${t.name}`)}</span>`
        ).join("");

        const unitsHtml = g.units.map((uid) => {
          const u = game && game.byId && game.byId[uid];
          if (!u) return "";
          const isPicked = selectedIds.includes(uid);
          return (
            `<div class="cl-unit${isPicked ? " is-picked" : ""}">` +
            `<div class="cl-ava" data-tip="unit:${esc(uid)}" style="--cost-solid:${esc(store.costSolidHex(u.cost))}">` +
            store.imgHtml(u, "", u.display, false) +
            `<span class="cl-cost-dot">${u.cost}</span>` +
            `</div>` +
            `<span class="cl-uname">${esc(u.display)}</span>` +
            `</div>`
          );
        }).join("");

        return (
          `<article class="cl-card${isExact ? " is-exact" : ""}">` +
          `<div class="cl-card-head">` +
          `<div class="cl-card-title-wrap">` +
          `<strong class="cl-card-title">${esc(title)}</strong>` +
          traitsHtml +
          (ocrTag && ocrTag.rank <= 3 ? `<span class="cl-ocr-rank">匹配 #${ocrTag.rank}</span>` : "") +
          `</div>` +
          (g.activeAvg != null
            ? `<button type="button" class="cl-avg-pill${g.activeAvg <= 4.25 ? " is-good" : ""}" data-cl-stats="${esc(g.id)}" aria-label="查看合奏分段均名">均名 ${g.activeAvg.toFixed(2)}</button>`
            : "") +
          `</div>` +
          `<div class="cl-card-body">` +
          `<div class="cl-units">${unitsHtml}</div>` +
          `<button type="button" class="btn sm primary cl-load-btn" data-cl-load="${esc(g.id)}">载入棋盘</button>` +
          `</div>` +
          `</article>`
        );
      }).join("")
      : `<div class="cl-empty"><p>无匹配的合奏组合</p><button type="button" class="btn sm" data-cl-clear="1">重置筛选</button></div>`;

    bodyEl.innerHTML =
      filterRowHtml +
      ocrBannerHtml +
      poolHtml +
      `<div class="cl-results-pane"><div class="cl-grid">${cardsHtml}</div></div>`;
  }

  function renderShell() {
    const canCapture = isScreenCaptureSupported();
    modalEl.innerHTML =
      `<div class="modal-shell cl-shell">` +
      `<header class="drawer-head cl-head">` +
      `<h2>合奏</h2>` +
      `<button type="button" class="btn icon-btn ghost cl-close-btn" data-modal-close="1" aria-label="关闭">${ICON_CLOSE}</button>` +
      `</header>` +
      `<div class="cl-toolbar">` +
      `<div class="search-wrap cl-search-wrap">` +
      `<input id="collab-search" type="search" value="${esc(poolQuery)}" placeholder="搜索棋子…" aria-label="搜索合奏棋子" autofocus>` +
      `<span class="kbd" aria-hidden="true">/</span>` +
      `</div>` +
      `<div class="cl-img-actions" role="group" aria-label="头像截图识别">` +
      (canCapture ? `<button type="button" class="btn sm cl-act-btn" data-cl-capture="1">${ICON_CAPTURE}<span>截屏</span></button>` : "") +
      `<button type="button" class="btn sm cl-act-btn" data-cl-paste="1">${ICON_PASTE}<span>粘贴</span></button>` +
      `<button type="button" class="btn sm cl-act-btn" data-cl-upload="1">${ICON_IMAGE}<span>选图</span></button>` +
      `<input id="collab-ocr-file" type="file" accept="image/*" hidden>` +
      `</div>` +
      `<div class="cl-toolbar-right">` +
      `<span id="cl-match-count" class="cl-match-count"></span>` +
      `<button type="button" class="btn xs ghost" data-cl-clear="1" hidden>清空</button>` +
      `<button type="button" class="btn icon-btn cl-chevron-btn" data-cl-toggle-pool="1" aria-expanded="true" aria-label="收起棋子池" title="收起棋子池">${ICON_CHEVRON}</button>` +
      `</div>` +
      `</div>` +
      `<div id="collab-dynamic-body" class="cl-body"></div>` +
      `<div id="cl-avg-tip" class="cl-avg-tip" role="tooltip" hidden></div>` +
      `</div>`;
    renderBody();
  }

  function open() {
    renderShell();
    if (typeof modalEl.showModal === "function" && !modalEl.open) {
      modalEl.showModal();
    }
  }

  function close() {
    hideAvgTip();
    if (modalEl.open && typeof modalEl.close === "function") modalEl.close();
  }

  if (openBtn) openBtn.addEventListener("click", open);

  // Clipboard image paste anywhere while Collab modal is open
  document.addEventListener("paste", (e) => {
    if (!modalEl.open) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.startsWith("image/")) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          handleImageBlob(blob);
          return;
        }
      }
    }
  });

  // Drag & drop image anywhere onto modal
  modalEl.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
      modalEl.classList.add("is-drag-over");
    }
  });
  modalEl.addEventListener("dragleave", () => modalEl.classList.remove("is-drag-over"));
  modalEl.addEventListener("drop", (e) => {
    modalEl.classList.remove("is-drag-over");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type && file.type.startsWith("image/")) {
      e.preventDefault();
      handleImageBlob(file);
    }
  });

  // Fixed-position avg-chip stats hover & focus tooltip (never clipped by scroll containers)
  modalEl.addEventListener("pointerover", (e) => {
    const pill = e.target && e.target.closest && e.target.closest("[data-cl-stats]");
    if (pill) showAvgTip(pill, pill.getAttribute("data-cl-stats"));
  });
  modalEl.addEventListener("pointerout", (e) => {
    const pill = e.target && e.target.closest && e.target.closest("[data-cl-stats]");
    if (pill && (!e.relatedTarget || !pill.contains(e.relatedTarget))) hideAvgTip();
  });
  modalEl.addEventListener("focusin", (e) => {
    const pill = e.target && e.target.closest && e.target.closest("[data-cl-stats]");
    if (pill) showAvgTip(pill, pill.getAttribute("data-cl-stats"));
  });
  modalEl.addEventListener("focusout", (e) => {
    const pill = e.target && e.target.closest && e.target.closest("[data-cl-stats]");
    if (pill) hideAvgTip();
  });
  modalEl.addEventListener("scroll", hideAvgTip, true);

  modalEl.addEventListener("input", (e) => {
    if (e.target && e.target.id === "collab-search") {
      poolQuery = e.target.value || "";
      if (!poolExpanded) poolExpanded = true;
      renderBody();
    }
  });

  modalEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.id === "collab-search") {
      const q = poolQuery.trim().toLowerCase();
      if (!q) return;
      const game = store.getGame();
      const poolIds = getCollabPoolIds(getCollabGroups(), game);
      const first = poolIds.find((uid) => {
        const u = game && game.byId && game.byId[uid];
        return u && `${u.display} ${u.nameEn || ""} ${aliasesForUnit(u, game)}`.toLowerCase().includes(q);
      });
      if (first) {
        e.preventDefault();
        poolQuery = "";
        e.target.value = "";
        toggleInclude(first);
      }
    }
  });

  modalEl.addEventListener("change", (e) => {
    if (e.target && e.target.id === "collab-ocr-file") {
      const file = e.target.files && e.target.files[0];
      if (file) handleImageBlob(file);
      e.target.value = "";
    }
  });

  modalEl.addEventListener("contextmenu", (e) => {
    const el = e.target && e.target.closest && e.target.closest("[data-cl-ctx]");
    if (!el) return;
    e.preventDefault();
    toggleExclude(el.getAttribute("data-cl-ctx"));
  });

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) { close(); return; }
    const t = e.target;
    if (!t || !t.closest) return;
    let el;
    if (t.closest("[data-modal-close]")) { close(); return; }
    if (t.closest("[data-cl-capture]")) { handleCaptureClick(); return; }
    if (t.closest("[data-cl-paste]")) { handlePasteClick(); return; }
    if (t.closest("[data-cl-upload]")) {
      const inp = modalEl.querySelector("#collab-ocr-file");
      if (inp) inp.click();
      return;
    }
    if (t.closest("[data-cl-clear]")) { clearAllFilters(); return; }
    if (t.closest("[data-cl-clear-ocr]")) {
      ocrState = { busy: false, error: "", result: null };
      renderBody();
      return;
    }
    if (t.closest("[data-cl-toggle-pool]")) {
      poolExpanded = !poolExpanded;
      renderBody();
      return;
    }
    if ((el = t.closest("[data-cl-swap-to]"))) {
      const fromId = el.getAttribute("data-cl-swap-from");
      const toId = el.getAttribute("data-cl-swap-to");
      if (fromId) selectedIds = selectedIds.filter((id) => id !== fromId);
      if (toId && !selectedIds.includes(toId)) selectedIds = [...selectedIds, toId];
      renderBody();
      return;
    }
    if ((el = t.closest("[data-cl-toggle]"))) {
      toggleInclude(el.getAttribute("data-cl-toggle"));
      return;
    }
    if ((el = t.closest("[data-cl-exc]"))) {
      toggleExclude(el.getAttribute("data-cl-exc"));
      return;
    }
    if ((el = t.closest("[data-cl-load]"))) {
      const gid = el.getAttribute("data-cl-load");
      const group = getCollabGroups().find((g) => g.id === gid);
      if (group) {
        const title = collabGroupTitle(group, store.getGame());
        store.loadMetaComp({
          title: `合奏 · ${title}`,
          level: Math.max(8, group.units.length),
          mode: "auto",
          units: group.units.map((id) => ({ id, star: 2, items: [] }))
        });
        close();
      }
    }
  });

  return { open, close };
}
