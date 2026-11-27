/**
 * Independent Set 19 "合奏 (Collab)" Combination Finder & Screenshot Portrait Matcher Modal.
 * Modularly decoupled from core engine.js; bridges optionally via loadMetaComp / getOfficialTeamCode.
 */
import {
  getCollabGroups,
  getCollabPoolIds,
  filterCollabGroups,
  suggestDiscriminatingUnits
} from "../logic/collab-matcher.js";
import { recognizeCollabScreenshot } from "../logic/avatar-ocr.js";
import { aliasesForUnit } from "../logic/search-aliases.js";

export function mountCollabModal(store) {
  const modalEl = document.getElementById("collab-modal");
  const openBtn = document.getElementById("btn-collab-open");
  if (!modalEl) return { open() {}, close() {} };

  let selectedIds = [];
  let excludedIds = [];
  let sortMode = "avg";
  let poolQuery = "";
  let poolExpanded = true;
  let ocrState = { busy: false, error: "", result: null };

  const esc = (s) => store.esc(s);

  function getSeasonPayload() {
    const sd = typeof window !== "undefined" ? window.SEASON_DATA : null;
    return (sd && sd.collab) || { groups: [], source: "离线数据", constantUnit: "DA_Sona19" };
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
    // Auto-fill high-confidence units into exact filter when strong group lock succeeds;
    // otherwise keep ranked OCR ordering visible without over-filtering to 0 results.
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

  function renderBody() {
    const bodyEl = modalEl.querySelector("#collab-dynamic-body");
    if (!bodyEl) return;
    const game = store.getGame();
    const groups = getCollabGroups();
    const poolIds = getCollabPoolIds(groups, game);
    const matched = filterCollabGroups(groups, selectedIds, excludedIds, sortMode);

    // If OCR returned a ranked list and no manual selection overrides it, show OCR-ranked order
    const ocrRankedMap = new Map();
    if (ocrState.result && Array.isArray(ocrState.result.rankedGroups)) {
      ocrState.result.rankedGroups.forEach((r, idx) => {
        ocrRankedMap.set(r.group.id, { rank: idx + 1, score: r.meanSim, totalScore: r.totalScore });
      });
    }
    const displayGroups = (!selectedIds.length && !excludedIds.length && ocrRankedMap.size)
      ? matched.slice().sort((a, b) => {
        const ra = ocrRankedMap.has(a.id) ? ocrRankedMap.get(a.id).rank : 999;
        const rb = ocrRankedMap.has(b.id) ? ocrRankedMap.get(b.id).rank : 999;
        return ra - rb;
      })
      : matched;

    // Units still reachable in at least one remaining candidate group
    const reachable = new Set();
    for (const g of matched) {
      for (const uid of g.units) reachable.add(uid);
    }

    // Selected & excluded chips
    const selChipsHtml = selectedIds.map((uid) => {
      const u = game && game.byId && game.byId[uid];
      const name = u ? u.display : uid;
      return (
        `<button type="button" class="cl-chip is-inc" data-cl-toggle="${esc(uid)}" title="点击移除筛选">` +
        store.imgHtml(u, "", name, false) +
        `<span>${esc(name)}</span><i aria-hidden="true">×</i></button>`
      );
    }).join("") + excludedIds.map((uid) => {
      const u = game && game.byId && game.byId[uid];
      const name = u ? u.display : uid;
      return (
        `<button type="button" class="cl-chip is-exc" data-cl-exc="${esc(uid)}" title="点击取消排除">` +
        `<span>非 ${esc(name)}</span><i aria-hidden="true">×</i></button>`
      );
    }).join("");

    // Discriminating next-pick hints when 2..14 groups remain
    const hints = matched.length >= 2 && matched.length <= 14
      ? suggestDiscriminatingUnits(matched, selectedIds, 6)
      : [];
    const hintsHtml = hints.length
      ? `<div class="cl-hints-row"><span class="cl-hints-label">再点 1 个快速锁定：</span>` +
        hints.map((h) => {
          const u = game && game.byId && game.byId[h.id];
          const name = u ? u.display : h.id;
          return `<button type="button" class="cl-hint-btn" data-cl-toggle="${esc(h.id)}">` +
            store.imgHtml(u, "", name, false) +
            `<span>${esc(name)}</span><em>${h.count}组</em></button>`;
        }).join("") + `</div>`
      : "";

    // OCR feedback panel
    let ocrBannerHtml = "";
    if (ocrState.busy) {
      ocrBannerHtml = `<div class="cl-ocr-result is-busy">正在本地提取 55 枚合奏头像特征并匹配 40 组组合…</div>`;
    } else if (ocrState.error) {
      ocrBannerHtml = `<div class="cl-ocr-result is-err">${esc(ocrState.error)}</div>`;
    } else if (ocrState.result) {
      const r = ocrState.result;
      const tileChips = r.tiles.map((t) => {
        const u = t.unitId && game && game.byId && game.byId[t.unitId];
        const name = u ? u.display : "未知";
        const active = t.unitId && selectedIds.includes(t.unitId);
        const altBtns = (t.top3 || []).slice(1, 3).map((alt) => {
          const au = game && game.byId && game.byId[alt.id];
          return au ? `<button type="button" class="cl-ocr-alt" data-cl-swap-from="${esc(t.unitId || "")}" data-cl-swap-to="${esc(alt.id)}" title="改为 ${esc(au.display)}">${esc(au.display)}</button>` : "";
        }).join("");
        return (
          `<div class="cl-ocr-tile${active ? " is-selected" : ""}">` +
          `<img class="cl-ocr-thumb" src="${esc(t.thumbUrl)}" alt="截图头像">` +
          `<button type="button" class="cl-ocr-match" data-cl-toggle="${esc(t.unitId || "")}" title="点击勾选/取消 ${esc(name)}">` +
          `<strong>${esc(name)}</strong><span>${t.confidence}%</span></button>` +
          (altBtns ? `<div class="cl-ocr-alts">${altBtns}</div>` : "") +
          `</div>`
        );
      }).join("");
      const leadMsg = r.strongGroupLock
        ? `已识别 ${r.tiles.length} 个头像并自动锁定最匹配组合（点击下方任意识别结果或备选名可微调）`
        : `已提取 ${r.tiles.length} 个头像，已按视觉相似度排序候选组合（可点选头像标签精确筛选）`;
      ocrBannerHtml =
        `<div class="cl-ocr-result">` +
        `<div class="cl-ocr-head"><span>${esc(leadMsg)}</span><button type="button" class="btn xs ghost" data-cl-clear-ocr="1">清除识别</button></div>` +
        `<div class="cl-ocr-tiles">${tileChips}</div>` +
        `</div>`;
    }

    // 55-unit pool picker grouped cleanly (filterable by pinyin/nickname search)
    const q = poolQuery.trim().toLowerCase();
    const visiblePool = poolIds.filter((uid) => {
      if (!q) return true;
      const u = game && game.byId && game.byId[uid];
      if (!u) return false;
      const hay = `${u.display} ${u.nameEn || ""} ${aliasesForUnit(u, game)}`.toLowerCase();
      return hay.includes(q);
    });

    const poolHtml = poolExpanded
      ? `<div class="cl-pool-grid">` +
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
            `<button type="button" class="${cls}" data-cl-toggle="${esc(uid)}" data-cl-ctx="${esc(uid)}" style="--cost-solid:${esc(store.costSolidHex(u.cost))}" title="${esc(u.display)} (${u.cost}费) · 左键选中 / 右键排除">` +
            store.imgHtml(u, "", u.display, false) +
            `<span>${esc(u.display)}</span>` +
            `</button>`
          );
        }).join("") +
        `</div>`
      : "";

    // Group cards
    const cardsHtml = displayGroups.length
      ? displayGroups.map((g) => {
        const isExact = matched.length === 1 && (selectedIds.length > 0 || excludedIds.length > 0);
        const ocrTag = ocrRankedMap.get(g.id);
        const unitsHtml = g.units.map((uid) => {
          const u = game && game.byId && game.byId[uid];
          if (!u) return "";
          const isPicked = selectedIds.includes(uid);
          return (
            `<div class="mc-unit${isPicked ? " is-picked" : ""}">` +
            `<div class="mc-ava" data-tip="unit:${esc(uid)}" style="--cost-solid:${esc(store.costSolidHex(u.cost))}">` +
            store.imgHtml(u, "", u.display, false) +
            `<span class="cl-cost-dot">${u.cost}</span>` +
            `</div>` +
            `<span class="mc-uname">${esc(u.display)}</span>` +
            `</div>`
          );
        }).join("");

        const traitsHtml = (g.sharedTraits || []).map((t) =>
          `<span class="sc-trait">${esc(`${t.count}${t.name}`)}</span>`
        ).join("");

        const bp3Txt = g.bp3 ? `3合奏 ${g.bp3.avg.toFixed(2)} (${g.bp3.top4}%)` : "";
        const bp5Txt = g.bp5 ? `5合奏 ${g.bp5.avg.toFixed(2)} (${g.bp5.top4}%)` : "";
        const statsTxt = [g.activeAvg ? `均名 ${g.activeAvg.toFixed(2)}` : "", bp3Txt, bp5Txt].filter(Boolean).join(" · ");

        return (
          `<article class="mc-card cl-card${isExact ? " is-exact" : ""}">` +
          `<div class="mc-head">` +
          `<div class="mc-title-wrap">` +
          `<span class="cl-gid">${esc(g.id)}</span>` +
          `<strong class="mc-title">${g.units.length} 弈子合奏 <em class="cl-sona-tag">+ 娑娜常驻</em></strong>` +
          (ocrTag && ocrTag.rank <= 3 ? `<span class="cl-ocr-rank">截图匹配 #${ocrTag.rank}</span>` : "") +
          `</div>` +
          (g.activeAvg ? `<span class="cl-avg-pill${g.activeAvg <= 4.25 ? " is-good" : ""}">均名 ${g.activeAvg.toFixed(2)}</span>` : "") +
          `</div>` +
          `<div class="mc-units">${unitsHtml}</div>` +
          `<div class="mc-foot">` +
          `<div class="mc-foot-left">` +
          `<div class="sc-traits">${traitsHtml || '<span class="mc-stats">跨羁绊混搭组合</span>'}</div>` +
          (statsTxt ? `<span class="mc-stats">${esc(statsTxt)}</span>` : "") +
          `</div>` +
          `<div class="sc-actions">` +
          `<button type="button" class="btn xs primary" data-cl-load="${esc(g.id)}">载入棋盘</button>` +
          `<button type="button" class="btn xs" data-cl-official="${esc(g.id)}" title="复制端游小队规划器官方代码">复制游戏码</button>` +
          `</div>` +
          `</div>` +
          `</article>`
        );
      }).join("")
      : `<p class="advisor-empty" style="grid-column:1/-1">没有同时满足当前筛选条件的合奏组合。请点击上方标签移除部分棋子，或点击「清空」。</p>`;

    bodyEl.innerHTML =
      `<div class="cl-active-strip">` +
      `<div class="cl-active-left">` +
      `<span class="cl-match-count">匹配 <b>${matched.length}</b> / ${groups.length} 组</span>` +
      (selChipsHtml ? `<div class="cl-chips">${selChipsHtml}</div>` : `<span class="drawer-hint">点选本局出现的 1–3 个合奏弈子，或直接 Ctrl+V 粘贴游戏内合奏头像截图</span>`) +
      `</div>` +
      `<div class="cl-active-right">` +
      `<button type="button" class="btn xs" data-cl-toggle-pool="1">${poolExpanded ? "收起棋子池" : "展开棋子池 (55)"}</button>` +
      ((selectedIds.length || excludedIds.length || ocrState.result) ? `<button type="button" class="btn xs ghost" data-cl-clear="1">清空</button>` : "") +
      `</div>` +
      `</div>` +
      ocrBannerHtml +
      hintsHtml +
      poolHtml +
      `<div class="mc-grid cl-grid">${cardsHtml}</div>`;
  }

  function renderShell() {
    const payload = getSeasonPayload();
    const groups = getCollabGroups();
    const syncBadge = [payload.source || "MetaTFT", `${groups.length} 组合`, "本地头像识别"].join(" · ");

    modalEl.innerHTML =
      `<div class="modal-shell">` +
      `<header class="drawer-head">` +
      `<div class="mc-modal-title">` +
      `<h2>S19 合奏组合速查</h2>` +
      `<span class="mc-sync-pill">${esc(syncBadge)}</span>` +
      `</div>` +
      `<button type="button" class="btn xs ghost" data-modal-close="1" aria-label="关闭">×</button>` +
      `</header>` +
      `<div class="cl-toolbar">` +
      `<input id="collab-search" class="sc-save-input" type="search" value="${esc(poolQuery)}" placeholder="拼音/外号搜合奏棋子（回车勾选首个）…" autofocus>` +
      `<div class="cl-ocr-drop" id="collab-ocr-drop">` +
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>` +
      `<span><b>Ctrl+V</b> 粘贴合奏头像截图识别</span>` +
      `<button type="button" class="btn xs" data-cl-upload="1">选择截图</button>` +
      `<input id="collab-ocr-file" type="file" accept="image/*" hidden>` +
      `</div>` +
      `<select id="collab-sort" class="mini-select cl-sort-select" aria-label="排序方式">` +
      `<option value="avg"${sortMode === "avg" ? " selected" : ""}>按激活均名</option>` +
      `<option value="bp3"${sortMode === "bp3" ? " selected" : ""}>按 3 合奏均名</option>` +
      `<option value="bp5"${sortMode === "bp5" ? " selected" : ""}>按 5 合奏均名</option>` +
      `<option value="size"${sortMode === "size" ? " selected" : ""}>6 弈子组优先</option>` +
      `</select>` +
      `</div>` +
      `<div id="collab-dynamic-body" class="cl-body"></div>` +
      `<footer class="drawer-foot">` +
      `<span class="drawer-hint">独立赛季玩法模块：左键勾选本局合奏弈子 · 右键排除 · 截图识别全程本地 Canvas 计算，零上传</span>` +
      `</footer>` +
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
    if (modalEl.open && typeof modalEl.close === "function") modalEl.close();
  }

  if (openBtn) openBtn.addEventListener("click", open);

  // Global Ctrl+V clipboard image paste whenever Collab modal is open
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

  // Drag & drop screenshot onto Collab modal
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
    if (e.target && e.target.id === "collab-sort") {
      sortMode = e.target.value || "avg";
      renderBody();
      return;
    }
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
    const groups = getCollabGroups();
    if ((el = t.closest("[data-cl-load]"))) {
      const gid = el.getAttribute("data-cl-load");
      const group = groups.find((g) => g.id === gid);
      if (group) {
        store.loadMetaComp({
          title: `合奏组合 ${group.id}`,
          level: Math.max(8, group.units.length),
          mode: "auto",
          units: group.units.map((id) => ({ id, star: 2, items: [] }))
        });
        close();
      }
      return;
    }
    if ((el = t.closest("[data-cl-official]"))) {
      const gid = el.getAttribute("data-cl-official");
      const group = groups.find((g) => g.id === gid);
      if (group) {
        const res = store.getOfficialTeamCode(group.units);
        if (res && res.code) {
          const flash = () => {
            el.textContent = "已复制 ✓";
            setTimeout(() => { if (el.isConnected) el.textContent = "复制游戏码"; }, 1800);
          };
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(res.code).then(flash, flash);
          } else {
            flash();
          }
        }
      }
    }
  });

  return { open, close };
}
