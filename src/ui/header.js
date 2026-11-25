import { DIRTY_HEADER, DIRTY_NOTICE } from "../state/store.js";

const PLAYSTYLE_LABELS = {
  normal: "普通补强",
  reroll: "赌狗低费",
  fast8: "高费运营",
  reorg: "阵容整理",
  ladder: "羁绊天梯"
};

function $(id) {
  return document.getElementById(id);
}

function closePopover(el) {
  if (el && typeof el.hidePopover === "function") {
    try { el.hidePopover(); } catch { /* ignore if not open */ }
  }
}

export function mountHeader(store) {
  const elSetPill = $("season-set-pill");
  const elSeasonName = $("season-name");
  const elSaveState = $("save-state");
  const btnLevelDec = $("btn-level-dec");
  const valLevel = $("val-level");
  const btnLevelInc = $("btn-level-inc");
  const btnExtraDec = $("btn-extra-dec");
  const valExtra = $("val-extra");
  const btnExtraInc = $("btn-extra-inc");
  const modeLabel = $("mode-label");
  const modeMenu = $("mode-menu");
  const btnAllowLocked = $("btn-allow-locked");
  const btnQuickReset = $("btn-quick-reset");
  const settingsMenu = $("settings-menu");
  const themeSeg = $("theme-seg");
  const btnImport = $("btn-import");
  const btnExport = $("btn-export");
  const btnBundled = $("btn-bundled");
  const btnDemo = $("btn-demo");
  const btnClear = $("btn-clear");
  const importFile = $("import-file");
  const noticeBar = $("notice-bar");

  if (btnLevelDec) {
    btnLevelDec.addEventListener("click", () => {
      const lvl = store.getState().level;
      if (lvl > 1) store.setSettings({ level: lvl - 1 });
    });
  }
  if (btnLevelInc) {
    btnLevelInc.addEventListener("click", () => {
      const lvl = store.getState().level;
      if (lvl < 10) store.setSettings({ level: lvl + 1 });
    });
  }
  if (btnExtraDec) {
    btnExtraDec.addEventListener("click", () => {
      const extra = store.getState().extraSlots || 0;
      if (extra > 0) store.setSettings({ extraSlots: extra - 1 });
    });
  }
  if (btnExtraInc) {
    btnExtraInc.addEventListener("click", () => {
      const extra = store.getState().extraSlots || 0;
      if (extra < 10) store.setSettings({ extraSlots: extra + 1 });
    });
  }

  if (modeMenu) {
    modeMenu.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-preset]");
      if (!btn) return;
      store.setPlaystyle(btn.dataset.preset);
      closePopover(modeMenu);
    });
  }

  if (btnAllowLocked) {
    btnAllowLocked.addEventListener("click", () => {
      const cur = !!store.getState().allowLocked;
      store.setSettings({ allowLocked: !cur });
    });
  }

  if (themeSeg) {
    themeSeg.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-theme-set]");
      if (!btn) return;
      store.setTheme(btn.dataset.themeSet);
    });
  }

  if (btnImport && importFile) {
    btnImport.addEventListener("click", () => {
      closePopover(settingsMenu);
      importFile.click();
    });
    importFile.addEventListener("change", () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch {
          store.notify("导入失败：JSON 格式错误。");
          return;
        }
        store.importSet(parsed);
      };
      reader.readAsText(file);
      importFile.value = "";
    });
  }

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      closePopover(settingsMenu);
      store.exportSet();
    });
  }
  if (btnBundled) {
    btnBundled.addEventListener("click", () => {
      closePopover(settingsMenu);
      store.useBundled();
    });
  }
  if (btnDemo) {
    btnDemo.addEventListener("click", () => {
      closePopover(settingsMenu);
      store.loadDemo();
    });
  }
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      closePopover(settingsMenu);
      store.resetAll();
    });
  }
  if (btnQuickReset) {
    btnQuickReset.addEventListener("click", () => {
      store.resetAll();
    });
  }
  if (noticeBar) {
    noticeBar.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-undo-reset]");
      if (btn) store.undoReset();
    });
  }

  let prevHeaderKey = "";
  let prevNotice = null;

  function renderHeader() {
    const game = store.getGame();
    const state = store.getState();
    const ui = store.getUI();
    const meta = (game && game.data && game.data.meta) || {};
    const playstyle = store.getPlaystyle();
    const theme = store.getTheme();

    const key = [
      meta.set ?? "",
      meta.name || "",
      store.isCustomSet() ? 1 : 0,
      ui.saveOk ? 1 : 0,
      state.level,
      state.extraSlots || 0,
      playstyle,
      state.allowLocked ? 1 : 0,
      theme
    ].join("|");

    if (key === prevHeaderKey) return;
    prevHeaderKey = key;

    if (elSetPill) {
      const setText = store.isCustomSet()
        ? "自定义" + (meta.set ? " S" + meta.set : "")
        : "SET " + (meta.set ?? 19);
      if (elSetPill.textContent !== setText) elSetPill.textContent = setText;
    }
    if (elSeasonName) {
      const nameText = meta.name || "云顶沙盘";
      if (elSeasonName.textContent !== nameText) elSeasonName.textContent = nameText;
    }
    if (elSaveState) {
      const saveText = ui.saveOk ? "已同步" : "未保存";
      if (elSaveState.textContent !== saveText) elSaveState.textContent = saveText;
      elSaveState.classList.toggle("is-error", !ui.saveOk);
    }

    if (valLevel) valLevel.textContent = String(state.level);
    if (btnLevelDec) btnLevelDec.disabled = state.level <= 1;
    if (btnLevelInc) btnLevelInc.disabled = state.level >= 10;

    const extra = state.extraSlots || 0;
    if (valExtra) valExtra.textContent = String(extra);
    if (btnExtraDec) btnExtraDec.disabled = extra <= 0;
    if (btnExtraInc) btnExtraInc.disabled = extra >= 10;

    if (modeLabel) {
      modeLabel.textContent = PLAYSTYLE_LABELS[playstyle] || PLAYSTYLE_LABELS.normal;
    }
    if (modeMenu) {
      modeMenu.querySelectorAll("[data-preset]").forEach((btn) => {
        const active = btn.dataset.preset === playstyle;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }

    if (btnAllowLocked) {
      const on = !!state.allowLocked;
      btnAllowLocked.setAttribute("aria-pressed", String(on));
      btnAllowLocked.classList.toggle("toggle-on", on);
    }

    if (themeSeg) {
      themeSeg.querySelectorAll("[data-theme-set]").forEach((btn) => {
        const active = btn.dataset.themeSet === theme;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
    }
  }

  function renderNotice() {
    if (!noticeBar) return;
    const ui = store.getUI();
    const msg = ui.notice || "";
    const undo = !!ui.canUndoReset;
    const key = msg + "|" + (undo ? 1 : 0);
    if (key === prevNotice) return;
    prevNotice = key;
    if (!msg) {
      noticeBar.textContent = "";
      noticeBar.hidden = true;
      return;
    }
    if (undo) {
      noticeBar.innerHTML =
        "<span>" + store.esc(msg) + "</span>" +
        '<button type="button" class="btn xs primary" data-undo-reset="1">撤销重置</button>';
    } else {
      noticeBar.textContent = msg;
    }
    noticeBar.hidden = false;
  }

  function update(dirtyMask) {
    if (dirtyMask & DIRTY_HEADER) renderHeader();
    if (dirtyMask & DIRTY_NOTICE) renderNotice();
  }

  return { update };
}
