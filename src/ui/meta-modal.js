/**
 * Centered Modal for "S19 热门阵容库" (Set 19 Meta Comp Templates Library).
 * Powered by auto-synced static window.META_COMPS (MetaTFT public JSON API -> meta_comps.js).
 */
import { aliasesForUnit } from "../logic/search-aliases.js";

const ARCH_FILTERS = [
  ["all", "全部"],
  ["vertical", "垂直高羁绊"],
  ["flex_web", "多羁绊拼多多"],
  ["reroll", "低费赌狗"],
  ["fast_high", "高费运营"]
];

export function mountMetaModal(store) {
  const modalEl = document.getElementById("meta-modal");
  const openBtn = document.getElementById("btn-meta-open");
  if (!modalEl) return { open() {}, close() {} };

  let archFilter = "all";
  let query = "";

  const esc = (s) => store.esc(s);

  function getMetaPayload() {
    return (typeof window !== "undefined" && window.META_COMPS) || { comps: [], updatedAt: "", source: "内置数据", sampleGames: 0 };
  }

  function matchComp(comp, q, game) {
    if (archFilter !== "all" && comp.archetype !== archFilter) return false;
    if (!q) return true;
    const hay = [
      comp.title || "",
      comp.archetypeLabel || "",
      comp.tempo || "",
      ...(comp.traits || []).map((t) => t.name || ""),
      ...(comp.units || []).map((u) => {
        const unit = game && game.byId && game.byId[u.id];
        return unit ? `${unit.display} ${unit.nameEn} ${aliasesForUnit(unit, game)}` : u.id;
      })
    ].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderGrid() {
    const gridEl = modalEl.querySelector("#meta-cards-grid");
    if (!gridEl) return;
    const game = store.getGame();
    const payload = getMetaPayload();
    const q = query.trim().toLowerCase();
    const comps = (payload.comps || []).filter((c) => matchComp(c, q, game));

    if (!comps.length) {
      gridEl.innerHTML = `<p class="advisor-empty" style="grid-column:1/-1">没有匹配的热门阵容，试试清空筛选条件。</p>`;
      return;
    }

    gridEl.innerHTML = comps.map((c) => {
      const tierCls = c.tier === "S" ? "tier-s" : c.tier === "A" ? "tier-a" : "tier-b";
      const unitsHtml = (c.units || []).slice(0, 9).map((u) => {
        const unit = game && game.byId && game.byId[u.id];
        if (!unit) return "";
        const itemsHtml = (u.items || []).slice(0, 3).map((itemId) => {
          const it = game.itemById && game.itemById[itemId];
          return `<span class="mc-item" data-tip="item:${esc(itemId)}">${store.imgHtml(it, "", it ? it.name : itemId, false)}</span>`;
        }).join("");
        const starHtml = u.star >= 3 ? `<span class="mc-star3">3★</span>` : "";
        return (
          `<div class="mc-unit">` +
          `<div class="mc-ava" data-tip="unit:${esc(unit.id)}" style="--cost-solid:${esc(store.costSolidHex(unit.cost))}">` +
          store.imgHtml(unit, "", unit.display, false) +
          starHtml +
          `</div>` +
          `<span class="mc-uname">${esc(unit.display)}</span>` +
          (itemsHtml ? `<div class="mc-items">${itemsHtml}</div>` : "") +
          `</div>`
        );
      }).join("");

      const traitsHtml = (c.traits || []).slice(0, 4).map((t) =>
        `<span class="sc-trait">${esc(`${t.need}${t.name}`)}</span>`
      ).join("");

      const statsTxt = c.avgPlace
        ? `均名 ${c.avgPlace.toFixed(2)} · 前四 ${c.top4Rate}%`
        : "";

      return (
        `<article class="mc-card">` +
        `<div class="mc-head">` +
        `<div class="mc-title-wrap">` +
        `<span class="mc-tier ${tierCls}">${esc(c.tier || "A")}</span>` +
        `<strong class="mc-title">${esc(c.title)}</strong>` +
        `</div>` +
        `<span class="mc-meta-tag">${esc(c.archetypeLabel || "")} · ${esc(c.tempo || "")}</span>` +
        `</div>` +
        `<div class="mc-units">${unitsHtml}</div>` +
        `<div class="mc-foot">` +
        `<div class="mc-foot-left">` +
        `<div class="sc-traits">${traitsHtml}</div>` +
        (statsTxt ? `<span class="mc-stats">${esc(statsTxt)}</span>` : "") +
        `</div>` +
        `<div class="sc-actions">` +
        `<button type="button" class="btn xs primary" data-mc-load="${esc(c.id)}">载入棋盘</button>` +
        `<button type="button" class="btn xs" data-mc-target="${esc(c.id)}">设为目标羁绊</button>` +
        `<button type="button" class="btn xs" data-mc-official="${esc(c.id)}" title="复制端游小队规划器官方代码（直接粘贴进游戏）">复制游戏码</button>` +
        `</div>` +
        `</div>` +
        `</article>`
      );
    }).join("");
  }

  function renderFull() {
    const payload = getMetaPayload();
    const gamesTxt = payload.sampleGames ? `${Math.round(payload.sampleGames / 10000)}万场统计` : "";
    const syncBadge = [payload.source || "MetaTFT", payload.updatedAt ? `同步于 ${payload.updatedAt}` : "", gamesTxt].filter(Boolean).join(" · ");

    const pillsHtml = ARCH_FILTERS.map(([k, label]) =>
      `<button type="button" class="cost-pill${archFilter === k ? " active" : ""}" data-mc-arch="${k}">${esc(label)}</button>`
    ).join("");

    modalEl.innerHTML =
      `<div class="modal-shell">` +
      `<header class="drawer-head">` +
      `<div class="mc-modal-title">` +
      `<h2>S${esc(payload.set || 19)} 热门阵容库</h2>` +
      `<span class="mc-sync-pill">${esc(syncBadge)}</span>` +
      `</div>` +
      `<button type="button" class="btn xs ghost" data-modal-close="1" aria-label="关闭">×</button>` +
      `</header>` +
      `<div class="mc-toolbar">` +
      `<input id="mc-search" class="sc-save-input" type="search" value="${esc(query)}" placeholder="搜索阵容、英雄（支持拼音/外号）、羁绊…">` +
      `<div class="sc-pills">${pillsHtml}</div>` +
      `</div>` +
      `<div id="meta-cards-grid" class="mc-grid"></div>` +
      `<footer class="drawer-foot">` +
      `<span class="drawer-hint">载入阵容将自动最佳站位并支持 Ctrl+Z 撤销；「设为目标羁绊」可保留当前手牌直接进入阵容整理</span>` +
      `</footer>` +
      `</div>`;
    renderGrid();
  }

  function open() {
    archFilter = "all";
    query = "";
    renderFull();
    if (typeof modalEl.showModal === "function" && !modalEl.open) {
      modalEl.showModal();
    }
  }

  function close() {
    if (modalEl.open && typeof modalEl.close === "function") modalEl.close();
  }

  if (openBtn) openBtn.addEventListener("click", open);

  modalEl.addEventListener("input", (e) => {
    if (e.target && e.target.id === "mc-search") {
      query = e.target.value || "";
      renderGrid();
    }
  });

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) { close(); return; }
    const t = e.target;
    if (!t || !t.closest) return;
    let el;
    if (t.closest("[data-modal-close]")) { close(); return; }
    if ((el = t.closest("[data-mc-arch]"))) {
      archFilter = el.getAttribute("data-mc-arch") || "all";
      modalEl.querySelectorAll("[data-mc-arch]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-mc-arch") === archFilter);
      });
      renderGrid();
      return;
    }
    const payload = getMetaPayload();
    if ((el = t.closest("[data-mc-load]"))) {
      const id = el.getAttribute("data-mc-load");
      const comp = (payload.comps || []).find((c) => c.id === id);
      if (comp) {
        store.loadMetaComp(comp);
        close();
      }
      return;
    }
    if ((el = t.closest("[data-mc-target]"))) {
      const id = el.getAttribute("data-mc-target");
      const comp = (payload.comps || []).find((c) => c.id === id);
      if (comp) {
        store.applyMetaTargets(comp);
        close();
      }
      return;
    }
    if ((el = t.closest("[data-mc-official]"))) {
      const id = el.getAttribute("data-mc-official");
      const comp = (payload.comps || []).find((c) => c.id === id);
      if (comp) {
        const res = store.getOfficialTeamCode(comp.units);
        if (res && res.code) {
          const flashBtn = () => {
            el.textContent = "已复制 ✓";
            setTimeout(() => { if (el.isConnected) el.textContent = "复制游戏码"; }, 1800);
          };
          if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(res.code).then(flashBtn, flashBtn);
          } else {
            flashBtn();
          }
        }
      }
    }
  });

  return { open, close };
}
