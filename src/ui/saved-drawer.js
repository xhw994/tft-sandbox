/**
 * Slide-over Drawer for "我的阵容收藏夹" (My Saved Lineups).
 * Offline-first localStorage bookmarks with pin, category filter, plain-text code interop, and JSON backup.
 */
import {
  listSavedComps,
  defaultCompName,
  saveCurrentComp,
  removeSavedComp,
  togglePinSavedComp,
  exportSavedCompsJson,
  importSavedCompsJson
} from "../logic/saved-comps.js";

function fmtRelTime(ts) {
  if (!ts) return "";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function mountSavedDrawer(store) {
  const drawerEl = document.getElementById("saved-drawer");
  const openBtn = document.getElementById("btn-saved-open");
  if (!drawerEl) return { open() {}, close() {} };

  let filterCat = "all";
  let showImportBox = false;
  let statusText = "";

  const esc = (s) => store.esc(s);

  function copyCode(text, label) {
    const okMsg = label || "已复制文本码";
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { statusText = okMsg; render(); },
        () => { statusText = "复制失败，请手动复制"; render(); }
      );
      return;
    }
    statusText = okMsg;
    render();
  }

  function render() {
    const state = store.getState();
    const game = store.getGame();
    const rec = store.getAnalysis() && store.getAnalysis().rec;
    const all = listSavedComps();
    const filtered = filterCat === "all" ? all : all.filter((c) => c.category === filterCat);
    const placeholderName = defaultCompName(state, game, rec);

    const cardsHtml = filtered.length
      ? filtered.map((c) => {
        const unitsHtml = (c.units || []).slice(0, 9).map((u) => {
          const unit = game && game.byId && game.byId[u.id];
          const cost = unit ? unit.cost : 1;
          const name = unit ? (unit.display || unit.name) : u.id;
          const star = u.star > 1 ? `<i class="sc-star">${u.star}★</i>` : "";
          return (
            `<span class="sc-unit" style="--cost-solid:${esc(store.costSolidHex(cost))}" title="${esc(name)}${u.star > 1 ? " " + u.star + "★" : ""}">` +
            store.imgHtml(unit, "", name, false) +
            star +
            `</span>`
          );
        }).join("");
        const traitsHtml = (c.traits || []).slice(0, 4).map((t) => `<span class="sc-trait">${esc(t)}</span>`).join("");
        const metaTxt = `${c.level || 8}级${c.archetypeLabel ? " · " + c.archetypeLabel : ""}`;
        return (
          `<article class="sc-card${c.pinned ? " is-pinned" : ""}">` +
          `<div class="sc-card-head">` +
          `<div class="sc-title-row">` +
          `<button type="button" class="sc-pin${c.pinned ? " active" : ""}" data-sc-pin="${esc(c.id)}" title="${c.pinned ? "取消置顶" : "置顶收藏"}" aria-label="置顶">★</button>` +
          `<strong class="sc-name">${esc(c.name)}</strong>` +
          `<span class="sc-meta">${esc(metaTxt)}</span>` +
          `</div>` +
          `<span class="sc-time">${esc(fmtRelTime(c.updatedAt))}</span>` +
          `</div>` +
          (unitsHtml ? `<div class="sc-units">${unitsHtml}</div>` : "") +
          `<div class="sc-foot">` +
          `<div class="sc-traits">${traitsHtml || '<span class="sc-time">无激活羁绊</span>'}</div>` +
          `<div class="sc-actions">` +
          `<button type="button" class="btn xs primary" data-sc-load="${esc(c.id)}">载入棋盘</button>` +
          `<button type="button" class="btn xs" data-sc-official="${esc(c.id)}" title="复制端游小队规划器官方代码">游戏码</button>` +
          `<button type="button" class="btn xs" data-sc-copy="${esc(c.id)}" title="复制沙盘完整残局码">沙盘码</button>` +
          `<button type="button" class="btn xs ghost" data-sc-del="${esc(c.id)}" title="删除收藏">删</button>` +
          `</div>` +
          `</div>` +
          `</article>`
        );
      }).join("")
      : `<p class="advisor-empty">暂无收藏阵容。摆好局面后点击上方「+ 保存当前局面」即可随时复盘或一键切换。</p>`;

    const importHtml = showImportBox
      ? `<div class="sc-import-inline">` +
        `<textarea id="sc-import-code-ta" class="share-textarea" rows="2" placeholder="粘贴 02...TFTSet19 官方游戏码、TFT19:... 或分享链接，统一识别载入"></textarea>` +
        `<div class="sc-import-actions">` +
        `<button type="button" class="btn xs" data-sc-toggle-import="1">收起</button>` +
        `<button type="button" class="btn xs primary" data-sc-do-import-code="1">载入到棋盘</button>` +
        `</div>` +
        `</div>`
      : "";

    drawerEl.innerHTML =
      `<div class="drawer-shell">` +
      `<header class="drawer-head">` +
      `<h2>我的阵容收藏夹 <span class="drawer-cnt">(${all.length})</span></h2>` +
      `<button type="button" class="btn xs ghost" data-drawer-close="1" aria-label="关闭">×</button>` +
      `</header>` +
      `<div class="sc-save-bar">` +
      `<input id="sc-save-name" class="sc-save-input" type="text" value="${esc(placeholderName)}" maxlength="48" aria-label="阵容名称">` +
      `<select id="sc-save-cat" class="mini-select sc-cat-select" aria-label="分类">` +
      `<option value="meta">上分常用</option>` +
      `<option value="review">残局复盘</option>` +
      `</select>` +
      `<button type="button" class="btn sm primary" data-sc-save="1">+ 保存当前</button>` +
      `</div>` +
      `<div class="sc-filter-bar">` +
      `<div class="sc-pills">` +
      `<button type="button" class="cost-pill${filterCat === "all" ? " active" : ""}" data-sc-filter="all">全部</button>` +
      `<button type="button" class="cost-pill${filterCat === "meta" ? " active" : ""}" data-sc-filter="meta">上分常用</button>` +
      `<button type="button" class="cost-pill${filterCat === "review" ? " active" : ""}" data-sc-filter="review">残局复盘</button>` +
      `</div>` +
      `<button type="button" class="btn xs" data-sc-toggle-import="1">导入阵容码</button>` +
      `</div>` +
      importHtml +
      (statusText ? `<div class="sc-status-bar">${esc(statusText)}</div>` : "") +
      `<div class="drawer-scroll">${cardsHtml}</div>` +
      `<footer class="drawer-foot">` +
      `<span class="drawer-hint">本地离线存储 · 支持 JSON 备份</span>` +
      `<div class="plan-btns">` +
      `<button type="button" class="btn xs" data-sc-export="1">导出全部</button>` +
      `<button type="button" class="btn xs" data-sc-import-file="1">导入备份</button>` +
      `<input id="sc-backup-file" type="file" accept="application/json,.json" hidden>` +
      `</div>` +
      `</footer>` +
      `</div>`;
  }

  function open() {
    statusText = "";
    showImportBox = false;
    render();
    if (typeof drawerEl.showModal === "function" && !drawerEl.open) {
      drawerEl.showModal();
    }
  }

  function close() {
    if (drawerEl.open && typeof drawerEl.close === "function") drawerEl.close();
  }

  if (openBtn) openBtn.addEventListener("click", open);

  drawerEl.addEventListener("click", (e) => {
    if (e.target === drawerEl) { close(); return; }
    const t = e.target;
    if (!t || !t.closest) return;
    let el;
    if (t.closest("[data-drawer-close]")) { close(); return; }
    if (t.closest("[data-sc-save]")) {
      const state = store.getState();
      if (!state.board || !state.board.length) {
        statusText = "当前棋盘为空，摆上棋子后再保存";
        render();
        return;
      }
      const nameInput = drawerEl.querySelector("#sc-save-name");
      const catSel = drawerEl.querySelector("#sc-save-cat");
      const entry = saveCurrentComp(state, store.getGame(), store.getAnalysis() && store.getAnalysis().rec, {
        name: nameInput ? nameInput.value : "",
        category: catSel ? catSel.value : "meta"
      });
      statusText = `已保存「${entry.name}」`;
      render();
      return;
    }
    if ((el = t.closest("[data-sc-filter]"))) {
      filterCat = el.getAttribute("data-sc-filter") || "all";
      render();
      return;
    }
    if (t.closest("[data-sc-toggle-import]")) {
      showImportBox = !showImportBox;
      render();
      return;
    }
    if (t.closest("[data-sc-do-import-code]")) {
      const ta = drawerEl.querySelector("#sc-import-code-ta");
      const res = store.importShareText(ta ? ta.value : "");
      if (res.ok) { close(); }
      else { statusText = res.error || "导入失败"; render(); }
      return;
    }
    if ((el = t.closest("[data-sc-pin]"))) {
      togglePinSavedComp(el.getAttribute("data-sc-pin"));
      render();
      return;
    }
    if ((el = t.closest("[data-sc-load]"))) {
      const id = el.getAttribute("data-sc-load");
      const item = listSavedComps().find((c) => c.id === id);
      if (item && item.code) {
        const res = store.importShareText(item.code);
        if (res.ok) close();
      }
      return;
    }
    if ((el = t.closest("[data-sc-official]"))) {
      const id = el.getAttribute("data-sc-official");
      const item = listSavedComps().find((c) => c.id === id);
      if (item && item.units) {
        const res = store.getOfficialTeamCode(item.units);
        if (res && res.code) copyCode(res.code, `已复制「${item.name}」官方游戏小队码`);
        else { statusText = (res && res.error) || "无法生成官方小队码"; render(); }
      }
      return;
    }
    if ((el = t.closest("[data-sc-copy]"))) {
      const id = el.getAttribute("data-sc-copy");
      const item = listSavedComps().find((c) => c.id === id);
      if (item && item.code) copyCode(`【云顶沙盘 · ${item.name}】\n${item.code}`, "已复制沙盘残局码");
      return;
    }
    if ((el = t.closest("[data-sc-del]"))) {
      removeSavedComp(el.getAttribute("data-sc-del"));
      statusText = "已删除收藏";
      render();
      return;
    }
    if (t.closest("[data-sc-export]")) {
      const blob = new Blob([exportSavedCompsJson()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "tft-sandbox-saved-comps.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      statusText = "已导出收藏备份 JSON";
      render();
      return;
    }
    if (t.closest("[data-sc-import-file]")) {
      const inp = drawerEl.querySelector("#sc-backup-file");
      if (inp) inp.click();
    }
  });

  drawerEl.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp || inp.id !== "sc-backup-file") return;
    const file = inp.files && inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importSavedCompsJson(String(reader.result || ""));
      statusText = res.ok ? `已导入 ${res.added} 套收藏阵容` : (res.error || "导入失败");
      render();
    };
    reader.readAsText(file);
  });

  return { open, close };
}
