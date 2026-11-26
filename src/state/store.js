import { classifyItem, itemUnitScore, resolveLooseItems, findEmblemItemForTrait, computeCraftSuggestions } from "../logic/item-affinity.js";
import { parseUnlockMeta, buildUnlockContext } from "../logic/unlock-planner.js";
import { planBoardReorg } from "../logic/reorg-planner.js";
import {
  encodeShareCode,
  buildShareUrl,
  buildShareText,
  decodeShareInput,
  extractShareToken,
  encodeOfficialTeamCode
} from "../logic/share-codec.js";

export const DIRTY_HEADER     = 1 << 0;
export const DIRTY_POP        = 1 << 1;
export const DIRTY_TRAITS     = 1 << 2;
export const DIRTY_EQUIP      = 1 << 3;
export const DIRTY_BOARD      = 1 << 4;
export const DIRTY_INSPECTOR  = 1 << 5;
export const DIRTY_LIB_STATE  = 1 << 6;
export const DIRTY_LIB_FILTER = 1 << 7;
export const DIRTY_RECS       = 1 << 8;
export const DIRTY_NOTICE     = 1 << 9;
export const DIRTY_ALL        = 0x3FF;

const KEY_PREFIX = "tft-board-v3:";
const OLD_KEY = "tft-set19-board-v1";
const THEME_KEY = "tft-ui-theme";
const ROWS = 4;
const COLS = 7;

const ROLE_LABELS = {
  carry: "主C",
  carry2: "副C",
  tank: "主坦",
  tank2: "副坦",
  bot: "挂件"
};

const COST_SOLID_HEX = {
  1: "#6b6b72",
  2: "#4cc38a",
  3: "#5b8def",
  4: "#b478e0",
  5: "#e0a04a",
  7: "#e884b4"
};

const SEARCH_SETTINGS = new Set([
  "level",
  "extraSlots",
  "mode",
  "viewMode",
  "allowLocked",
  "emblems",
  "prismatic",
  "traitTargets",
  "targetTraitCount",
  "focusId",
  "bannedIds",
  "unlockTargetId",
  "trackerMaxLevel"
]);

const ANALYSIS_ACTIONS = new Set([
  "add-unit",
  "star-up",
  "set-star",
  "set-mark",
  "context-unit",
  "equip-item",
  "unequip-item",
  "unequip-to-loose",
  "add-loose",
  "delete-loose",
  "craft-loose",
  "remove-unit",
  "apply-plan",
  "reset"
]);

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function safeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^javascript:/i.test(s) ? "" : s;
}

function cssEsc(val) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(val));
  }
  return String(val).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function freshState() {
  return {
    board: [],
    looseItems: [],
    emblems: {},
    prismatic: {},
    traitTargets: {},
    targetTraitCount: 0,
    focusId: null,
    level: 8,
    extraSlots: 0,
    mode: "auto",
    viewMode: "normal",
    libraryTab: "units",
    allowLocked: true,
    bannedIds: {},
    unlockTargetId: null,
    trackerMaxLevel: 10
  };
}

function getInitialTheme() {
  try {
    if (typeof document !== "undefined" && document.documentElement.dataset.theme) {
      return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    }
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    }
  } catch {
    /* ignore storage errors */
  }
  return "dark";
}

function installGlobalImageFallback() {
  if (typeof document === "undefined" || globalThis.__tftImgFallbackInstalled) return;
  globalThis.__tftImgFallbackInstalled = true;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (typeof HTMLImageElement === "undefined" || !(img instanceof HTMLImageElement) || !img.hasAttribute("data-alt")) {
      return;
    }
    const alt = img.getAttribute("data-alt");
    if (alt && img.dataset.swapped !== "1") {
      img.dataset.swapped = "1";
      img.src = alt;
      return;
    }
    if (img.dataset.poolManaged === "1") {
      img.hidden = true;
      const ph = img.parentElement && img.parentElement.querySelector(".hex-ph");
      if (ph) ph.hidden = false;
      return;
    }
    const ph = document.createElement("span");
    ph.className = "ph ph-sm " + img.className;
    ph.textContent = img.alt;
    img.replaceWith(ph);
  }, true);
}

export function createStore() {
  const listeners = new Set();
  let game = null;
  let customSet = null;
  let state = freshState();
  let analyzeTimer = null;
  let analyzeRaf = null;
  let lastResetSnapshot = null;
  let resetUndoTimer = null;
  let noticeAutoTimer = null;
  const MAX_HISTORY = 40;
  let undoStack = [];
  let redoStack = [];

  const ui = {
    q: "",
    cost: 0,
    role: "all",
    trait: "all",
    itemKind: "all",
    selected: null,
    gen: 0,
    setVersion: 0,
    preview: null,
    notice: "",
    canUndoReset: false,
    saveOk: true,
    theme: getInitialTheme(),
    pendingBans: new Map(),
    emblemPromptDismissed: false,
    dragAt: 0,
    pinTrait: null
  };

  const analysis = {
    rec: null,
    reorg: null,
    loosePlan: null,
    craftSuggestions: [],
    unlockCtx: { active: false },
    tracker: null,
    unlockTracker: null,
    previewDiff: null,
    labels: {}
  };

  function TFT() { return globalThis.TFT; }
  function TFTBoard() { return globalThis.TFTBoard; }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unitName(id) {
    const u = game && game.byId[id];
    return u ? (u.display || u.name || String(id)) : String(id);
  }

  function itemName(id) {
    const it = game && game.itemById[id];
    return it ? (it.name || String(id)) : String(id);
  }

  function spanOf(id) {
    const u = game && game.byId[id];
    return u && u.slots > 1 ? u.slots : 1;
  }

  function focusPos(unitId) {
    const map = globalThis.UNIT_FOCUS;
    if (!map || !unitId) return null;
    return Object.prototype.hasOwnProperty.call(map, unitId) ? map[unitId] : null;
  }

  function costColorVar(cost) {
    const c = Number(cost);
    const valid = c === 1 || c === 2 || c === 3 || c === 4 || c === 5 || c === 7 ? c : 1;
    return "var(--cost-" + valid + ")";
  }

  function costSolidHex(cost) {
    return COST_SOLID_HEX[Number(cost)] || COST_SOLID_HEX[1];
  }

  function srcList(rec) {
    if (!rec) return [];
    const local = safeUrl(rec.icon);
    const remote = safeUrl(rec.iconRemote);
    // Always prefer bundled same-origin icons (fast on EdgeOne/GH Pages & offline); fall back to remote only if missing.
    const out = [local, remote];
    return out.filter((v, i) => v && out.indexOf(v) === i);
  }

  function imgHtml(rec, cls, label, eager) {
    const name = rec ? (rec.display || rec.name || rec.id) : (label || "");
    const src = srcList(rec);
    if (!src.length) {
      return '<span class="ph ph-sm ' + esc(cls || "") + '">' + esc(name) + "</span>";
    }
    const focus = rec && rec.id ? focusPos(rec.id) : null;
    const pos = focus == null ? "" : ' style="object-position:' + focus + '% 50%"';
    return '<img class="' + esc(cls || "") + '" src="' + esc(src[0]) + '" alt="' + esc(name) +
      '" data-alt="' + esc(src[1] || "") + '"' + pos + (eager ? "" : ' loading="lazy"') + ">";
  }

  function roleLabel(id, mark) {
    if (mark) return ROLE_LABELS[mark] || "";
    const inferred = (analysis.rec && analysis.rec.labels && analysis.rec.labels[id]) || analysis.labels[id];
    if (!inferred || inferred === "bot") return "";
    return ROLE_LABELS[inferred] || "";
  }

  function selectedEntry() {
    if (!ui.selected) return null;
    return state.board.find((e) => e.id === ui.selected) || null;
  }

  function cloneBoard(board) {
    return (board || state.board).map((e) => ({
      id: e.id,
      star: e.star,
      mark: e.mark || "",
      position: e.position ? { row: e.position.row, col: e.position.col } : null,
      items: Array.isArray(e.items) ? e.items.slice() : []
    }));
  }

  function emit(mask) {
    if (!mask) return;
    listeners.forEach((fn) => {
      try { fn(mask); } catch (err) { console.error(err); }
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function saveKey() {
    const setId = game && game.data && game.data.meta ? game.data.meta.set : "builtin";
    return KEY_PREFIX + (customSet ? "custom" : String(setId || "builtin"));
  }

  function save() {
    if (typeof localStorage === "undefined" || !game) return;
    const payload = Object.assign(
      { schemaVersion: 3, set: game.data.meta && game.data.meta.set, custom: customSet },
      state
    );
    try {
      localStorage.setItem(saveKey(), JSON.stringify(payload));
      localStorage.setItem(KEY_PREFIX + "active", customSet ? "custom" : String((game.data.meta || {}).set || "builtin"));
      ui.saveOk = true;
    } catch {
      ui.saveOk = false;
    }
  }

  function migrateEntry(e, missing) {
    const miss = missing || { units: {}, items: {} };
    if (!e || !game.byId[e.id]) {
      if (e && e.id) miss.units[e.id] = true;
      return null;
    }
    const items = Array.isArray(e.items) ? e.items.filter((id) => {
      if (game.itemById[id]) return true;
      miss.items[id] = true;
      return false;
    }) : [];
    return {
      id: e.id,
      star: clamp(Number(e.star) || 1, 1, 3),
      mark: typeof e.mark === "string" ? e.mark : "",
      position: e.position ? { row: e.position.row, col: e.position.col } : null,
      items
    };
  }

  function setGame(raw, custom) {
    const next = TFT().create(TFT().normalizeSet(raw));
    game = next;
    customSet = custom ? game.data : null;
    ui.setVersion++;
  }

  function normalizeState() {
    if (!TFTBoard() || !game) return;
    const r = TFTBoard().normalize(state, game);
    if (r.error) {
      notify(r.error);
    } else if (r.state) {
      state = r.state;
    }
  }

  function load() {
    if (typeof localStorage === "undefined" || !game) return;
    const currentSet = (game.data.meta || {}).set;
    let v3 = null;
    let raw = null;
    try {
      const active = localStorage.getItem(KEY_PREFIX + "active");
      const partition = active === "custom" ? "custom" : String(currentSet || "builtin");
      v3 = localStorage.getItem(KEY_PREFIX + partition);
      raw = v3 || localStorage.getItem("tft-board-v2") || localStorage.getItem(OLD_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      ui.notice = "已保存的阵容损坏，已忽略。";
      return;
    }

    if (!v3 && !(saved.custom && saved.custom.units) && saved.set != null && String(saved.set) !== String(currentSet)) {
      ui.notice = "已保存的是其他赛季，未并入当前棋盘。";
      return;
    }

    if (saved.custom && saved.custom.units) {
      try {
        setGame(saved.custom, true);
      } catch {
        ui.notice = "已保存的自定义赛季数据无效，已使用内置数据。";
      }
    }

    const next = freshState();
    Object.keys(next).forEach((k) => {
      if (saved[k] != null) next[k] = saved[k];
    });

    const missing = { units: {}, items: {} };
    next.board = (Array.isArray(next.board) ? next.board : [])
      .map((e) => migrateEntry(e, missing))
      .filter(Boolean);

    // Preserve state.looseItems and filter unknown IDs cleanly
    const savedLoose = Array.isArray(saved.looseItems) ? saved.looseItems : [];
    next.looseItems = savedLoose.filter((id) => {
      if (game.itemById[id]) return true;
      missing.items[id] = true;
      return false;
    });

    // Migrate legacy saved.emblems[traitId] > 0 into real emblem items in state.looseItems
    const legacyEmblems = saved.emblems && typeof saved.emblems === "object" ? saved.emblems : {};
    let migratedEmblemCount = 0;
    Object.keys(legacyEmblems).forEach((traitId) => {
      const count = Number(legacyEmblems[traitId]) || 0;
      if (count <= 0) return;
      const emblemItem = findEmblemItemForTrait(game, traitId);
      if (emblemItem) {
        for (let i = 0; i < count; i++) {
          next.looseItems.push(emblemItem.id);
          migratedEmblemCount++;
        }
      }
    });
    next.emblems = {};

    if (!next.traitTargets || typeof next.traitTargets !== "object") next.traitTargets = {};
    if (!next.prismatic || typeof next.prismatic !== "object") next.prismatic = {};
    if (!next.bannedIds || typeof next.bannedIds !== "object") next.bannedIds = {};
    if (next.unlockTargetId && !game.byId[next.unlockTargetId]) next.unlockTargetId = null;
    next.trackerMaxLevel = clamp(Number(next.trackerMaxLevel) || 10, 1, 10);

    state = next;
    normalizeState();

    const missingIds = Object.keys(missing.units).concat(Object.keys(missing.items));
    const notices = [];
    if (migratedEmblemCount > 0) {
      notices.push("已将旧版 " + migratedEmblemCount + " 个纹章迁移至「已有装备」");
    }
    if (missingIds.length) {
      notices.push("存档中以下 ID 不存在，已跳过：" + missingIds.join("、"));
    }
    if (notices.length) {
      ui.notice = [ui.notice].concat(notices).filter(Boolean).join("；");
    }
  }

  function inferBaselineLabels(board, prevLabels) {
    const out = {};
    const prev = prevLabels || {};
    let hasCarry = false;
    let hasTank = false;

    board.forEach((e) => {
      if (e.mark) {
        out[e.id] = e.mark;
      } else if (prev[e.id]) {
        out[e.id] = prev[e.id];
      }
      if (out[e.id] === "carry") hasCarry = true;
      if (out[e.id] === "tank") hasTank = true;
    });

    if (!hasCarry && board.length) {
      let best = null;
      let bestScore = -1;
      board.forEach((e) => {
        if (out[e.id]) return;
        const u = game && game.byId[e.id];
        if (!u || u.roleGroup === "tank") return;
        let s = (u.cost || 1) * (e.star || 1) + (e.items ? e.items.length * 4 : 0);
        if (u.roleGroup === "marksman" || u.roleGroup === "caster") s += 3;
        if (s > bestScore) { bestScore = s; best = e; }
      });
      if (best) out[best.id] = "carry";
    }

    if (!hasTank && board.length) {
      let best = null;
      let bestScore = -1;
      board.forEach((e) => {
        if (out[e.id]) return;
        const u = game && game.byId[e.id];
        if (!u) return;
        let s = (u.cost || 1) * (e.star || 1) + (e.items ? e.items.length * 3 : 0);
        if (u.roleGroup === "tank") s += 10;
        else if (u.roleGroup === "fighter") s += 2;
        else s -= 5;
        if (s > bestScore) { bestScore = s; best = e; }
      });
      if (best && bestScore > 0) out[best.id] = "tank";
    }

    return out;
  }

  function computeQuickLoosePlan() {
    if (!game) return null;
    const labels = inferBaselineLabels(state.board, analysis.labels);
    analysis.craftSuggestions = computeCraftSuggestions(state.board, state.looseItems, game, labels);
    return resolveLooseItems(state.board, state.looseItems, game, labels);
  }

  function buildCtx(extraEmblems, looseItemFit) {
    const mergedEmblems = Object.assign({}, state.emblems || {});
    if (extraEmblems) {
      Object.keys(extraEmblems).forEach((tid) => {
        const cnt = Number(extraEmblems[tid]) || 0;
        if (cnt > 0) mergedEmblems[tid] = (mergedEmblems[tid] || 0) + cnt;
      });
    }
    return {
      level: state.level,
      mode: state.mode,
      allowLocked: state.allowLocked,
      emblems: mergedEmblems,
      prismatic: state.prismatic,
      extraSlots: state.extraSlots,
      looseItems: state.looseItems.slice(),
      focusId: state.focusId,
      unlockTargetId: state.unlockTargetId,
      traitTargets: state.traitTargets,
      targetTraitCount: state.targetTraitCount,
      bannedIds: Object.assign({}, state.bannedIds || {}),
      looseItemFit: looseItemFit || undefined
    };
  }

  function getContext() {
    const lp = analysis.loosePlan || computeQuickLoosePlan();
    return buildCtx(lp && lp.looseEmblems, lp && lp.looseItemFit);
  }

  function traitCounts() {
    const counts = {};
    if (!game) return counts;
    state.board.forEach((e) => {
      game.effectiveTraits(e).forEach((tid) => {
        const t = game.traitById[tid];
        counts[tid] = (counts[tid] || 0) + (t && t.countMode === "stars" ? (e.star || 1) : 1);
      });
    });
    Object.keys(state.emblems || {}).forEach((tid) => {
      counts[tid] = (counts[tid] || 0) + (state.emblems[tid] || 0);
    });
    (state.looseItems || []).forEach((itemId) => {
      const it = game.itemById[itemId];
      if (it && it.kind === "emblem" && it.trait) {
        counts[it.trait] = (counts[it.trait] || 0) + 1;
      }
    });
    return counts;
  }

  function cancelTrackers() {
    if (analysis.tracker && analysis.tracker.task && !analysis.tracker.done) {
      try { analysis.tracker.task.cancel(); } catch { /* ignore */ }
    }
    if (analysis.unlockTracker && analysis.unlockTracker.task && !analysis.unlockTracker.done) {
      try { analysis.unlockTracker.task.cancel(); } catch { /* ignore */ }
    }
    analysis.tracker = null;
    analysis.unlockTracker = null;
  }

  function pumpTracker(holder, gen, slotKey) {
    if (analysis[slotKey] !== holder || gen !== ui.gen || holder.done) return;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    let nodes = 0;
    let res = null;
    while (true) {
      res = holder.task.step(200);
      nodes += 200;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (res.done || nodes >= 3000 || now - start >= 14) break;
    }
    holder.res = res;
    holder.done = !!res.done;
    emit(DIRTY_RECS);
    if (!holder.done) {
      setTimeout(() => pumpTracker(holder, gen, slotKey), 0);
    }
  }

  function startTrackerTask(slotKey, gen, boardInput, ctxInput, options) {
    const holder = { gen, task: null, res: null, done: false, error: "" };
    analysis[slotKey] = holder;
    try {
      holder.task = game.track(boardInput, ctxInput, options);
    } catch (err) {
      holder.error = err.message || String(err);
      holder.done = true;
      return;
    }
    pumpTracker(holder, gen, slotKey);
  }

  function runAnalysis(gen) {
    if (gen !== ui.gen || !game) return;

    const prevLabels = Object.assign({}, analysis.labels);

    // 1. Baseline labels + resolveLooseItems
    const baseLabels = inferBaselineLabels(state.board, prevLabels);
    const loosePlan1 = resolveLooseItems(state.board, state.looseItems, game, baseLabels);

    // 2. Build ctx with looseEmblems + bannedIds + looseItemFit
    const ctx = buildCtx(loosePlan1.looseEmblems, loosePlan1.looseItemFit);

    // 3. Build unlock context
    const unlockCtx = buildUnlockContext(state, game, loosePlan1.virtualBoard, ctx);
    if (unlockCtx && unlockCtx.active && unlockCtx.virtualCtx) {
      if (!unlockCtx.virtualCtx.bannedIds) unlockCtx.virtualCtx.bannedIds = ctx.bannedIds;
      if (!unlockCtx.virtualCtx.looseItemFit) unlockCtx.virtualCtx.looseItemFit = ctx.looseItemFit;
    }

    // 4. Recommend
    const recBoard = unlockCtx.active && unlockCtx.virtualBoard ? unlockCtx.virtualBoard : loosePlan1.virtualBoard;
    const recCtx = unlockCtx.active && unlockCtx.virtualCtx ? unlockCtx.virtualCtx : ctx;
    let rec;
    try {
      rec = game.recommend(recBoard, recCtx);
    } catch (err) {
      rec = { error: err.message || String(err) };
    }

    if (gen !== ui.gen) return;

    // 5. Re-run resolveLooseItems with fresh rec.labels
    const freshLabels = rec && rec.labels ? rec.labels : baseLabels;
    const loosePlan2 = resolveLooseItems(state.board, state.looseItems, game, freshLabels);

    analysis.rec = rec;
    analysis.loosePlan = loosePlan2;
    analysis.craftSuggestions = computeCraftSuggestions(state.board, state.looseItems, game, freshLabels);
    analysis.unlockCtx = unlockCtx;
    analysis.labels = Object.assign({}, freshLabels);

    // 6. Start unlock mini-tracker if needed
    if (unlockCtx.active && unlockCtx.needsMiniTrack) {
      startTrackerTask("unlockTracker", gen, cloneBoard(state.board), ctx, {
        targetTraitCount: unlockCtx.miniTrackGoal,
        maxLevel: unlockCtx.miniTrackMaxLevel || 9,
        requireBoardRelatedLocked: true
      });
    }

    // 7. Start ladder tracker if in ladder view
    if (state.viewMode === "ladder") {
      startTrackerTask("tracker", gen, cloneBoard(state.board), ctx, {
        targetTraitCount: state.targetTraitCount || undefined,
        traitTargets: state.traitTargets,
        maxLevel: state.trackerMaxLevel || 10,
        requireBoardRelatedLocked: true
      });
    }

    // 7b. Run board reorganization planner when in reorg view
    if (state.viewMode === "reorg") {
      analysis.reorg = planBoardReorg(state.board, ctx, game, {
        traitTargets: state.traitTargets,
        labels: freshLabels,
        requireBoardRelatedLocked: true
      });
    } else {
      analysis.reorg = null;
    }

    // 8. Emit Frame 2 dirty mask (add DIRTY_BOARD only if role badges changed)
    let mask = DIRTY_RECS | DIRTY_EQUIP;
    const roleChanged = state.board.some((e) => {
      if (e.mark) return false;
      const oldR = prevLabels[e.id] && prevLabels[e.id] !== "bot" ? prevLabels[e.id] : "";
      const newR = freshLabels[e.id] && freshLabels[e.id] !== "bot" ? freshLabels[e.id] : "";
      return oldR !== newR;
    });
    if (roleChanged) mask |= DIRTY_BOARD | DIRTY_INSPECTOR;
    emit(mask);
  }

  function clearAnalyzeTimers() {
    if (analyzeRaf != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(analyzeRaf);
      analyzeRaf = null;
    }
    if (analyzeTimer != null) {
      clearTimeout(analyzeTimer);
      analyzeTimer = null;
    }
  }

  function scheduleAnalyze() {
    ui.gen++;
    ui.preview = null;
    analysis.previewDiff = null;
    cancelTrackers();
    clearAnalyzeTimers();
    const gen = ui.gen;
    const kick = () => {
      analyzeRaf = null;
      analyzeTimer = setTimeout(() => {
        analyzeTimer = null;
        runAnalysis(gen);
      }, 0);
    };
    if (typeof requestAnimationFrame === "function") {
      analyzeRaf = requestAnimationFrame(kick);
    } else {
      kick();
    }
  }

  function resolvePreviewPlan(spec) {
    if (!spec) return null;
    const idx = Number(spec.index);
    if (spec.kind === "plan") return analysis.rec && analysis.rec.plans ? analysis.rec.plans[idx] || null : null;
    if (spec.kind === "swap") return analysis.rec && analysis.rec.swaps ? analysis.rec.swaps[idx] || null : null;
    if (spec.kind === "reorg") return analysis.reorg && analysis.reorg.plans ? analysis.reorg.plans[idx] || null : null;
    if (spec.kind === "ladder") {
      return analysis.tracker && analysis.tracker.res && analysis.tracker.res.plans
        ? analysis.tracker.res.plans[idx] || null
        : null;
    }
    if (spec.kind === "unlock-route") {
      return analysis.unlockTracker && analysis.unlockTracker.res && analysis.unlockTracker.res.plans
        ? analysis.unlockTracker.res.plans[idx] || null
        : null;
    }
    return null;
  }

  function footprintFreeLocal(entries, unitId, row, col, skipIdx) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
    const span = spanOf(unitId);
    if (col + span - 1 >= COLS) return false;
    for (let i = 0; i < entries.length; i++) {
      if (i === skipIdx) continue;
      const p = entries[i].position;
      if (!p || p.row !== row) continue;
      const s = spanOf(entries[i].id);
      for (let k = 0; k < span; k++) {
        const c = col + k;
        if (c >= p.col && c < p.col + s) return false;
      }
    }
    return true;
  }

  function computePreviewDiff(spec) {
    const plan = resolvePreviewPlan(spec);
    if (!plan || !Array.isArray(plan.board) || !game) return null;

    const curById = {};
    state.board.forEach((e) => { curById[e.id] = e; });

    const nextEntries = plan.board.map((e) => ({
      id: e.id,
      star: clamp(Number(e.star) || 1, 1, 3),
      mark: e.mark || "",
      items: Array.isArray(e.items) ? e.items.slice() : [],
      position: null
    }));

    // Keep current positions for units that stay on the board
    nextEntries.forEach((e, idx) => {
      const cur = curById[e.id];
      if (cur && cur.position && footprintFreeLocal(nextEntries, e.id, cur.position.row, cur.position.col, idx)) {
        e.position = { row: cur.position.row, col: cur.position.col };
      }
    });

    // Place remaining units using game.place() + free-cell packing on a read-only clone
    const grid = typeof game.place === "function"
      ? game.place(nextEntries.map((e) => ({ id: e.id, star: e.star })))
      : null;

    nextEntries.forEach((e, idx) => {
      if (e.position) return;
      const candidates = [];
      if (grid) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const cell = grid[r] && grid[r][c];
            if (cell && cell.id === e.id) candidates.push({ row: r, col: c });
          }
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          candidates.push({ row: r, col: c });
        }
      }
      for (let k = 0; k < candidates.length; k++) {
        const cand = candidates[k];
        if (footprintFreeLocal(nextEntries, e.id, cand.row, cand.col, idx)) {
          e.position = cand;
          break;
        }
      }
    });

    const nextById = {};
    const byCoord = {};
    const adds = [];
    const removes = [];
    const starUps = [];

    nextEntries.forEach((e) => {
      if (!e.position) return;
      nextById[e.id] = e;
      const cur = curById[e.id];
      let kind = "keep";
      let note = "";
      if (!cur) {
        if (state.unlockTargetId && e.id === state.unlockTargetId) {
          kind = "ghost-target-unit";
          note = "解锁目标";
        } else {
          kind = "ghost-add";
          note = "+上场";
        }
        adds.push(e.id);
      } else if (e.star > cur.star) {
        kind = "ghost-star";
        note = cur.star + "→" + e.star + "★";
        starUps.push({ id: e.id, from: cur.star, to: e.star });
      }
      byCoord[e.position.row + "," + e.position.col] = {
        kind,
        entry: e,
        note,
        span: spanOf(e.id)
      };
    });

    // Mark cells of removed units if not occupied by a newly placed entry
    const nextCover = new Set();
    nextEntries.forEach((e) => {
      if (!e.position) return;
      const span = spanOf(e.id);
      for (let k = 0; k < span; k++) {
        nextCover.add(e.position.row + "," + (e.position.col + k));
      }
    });

    state.board.forEach((cur) => {
      if (nextById[cur.id]) return;
      removes.push(cur.id);
      if (!cur.position) return;
      const span = spanOf(cur.id);
      let blocked = false;
      for (let k = 0; k < span; k++) {
        if (nextCover.has(cur.position.row + "," + (cur.position.col + k))) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        byCoord[cur.position.row + "," + cur.position.col] = {
          kind: "ghost-remove",
          entry: cur,
          note: "换下",
          span
        };
      }
    });

    return {
      kind: spec.kind,
      index: spec.index,
      title: plan.title || plan.text || "推荐方案",
      plan,
      byCoord,
      adds,
      removes,
      starUps,
      targetUnitId: state.unlockTargetId || null
    };
  }

  function dirtyMaskForAction(action, prevState, nextState) {
    const t = action.type;
    if (t === "move-unit") return DIRTY_BOARD | DIRTY_INSPECTOR;

    if (t === "star-up" || t === "set-star") {
      let mask = DIRTY_BOARD | DIRTY_INSPECTOR;
      const entry = nextState.board.find((e) => e.id === action.id);
      if (entry && game) {
        const starTrait = game.effectiveTraits(entry).some((tid) => {
          const tr = game.traitById[tid];
          return tr && tr.countMode === "stars";
        });
        if (starTrait) mask |= DIRTY_TRAITS;
      }
      return mask;
    }

    if (t === "set-mark") return DIRTY_BOARD | DIRTY_INSPECTOR;

    if (t === "equip-item" || t === "unequip-item" || t === "add-loose" || t === "delete-loose" || t === "unequip-to-loose" || t === "craft-loose") {
      return DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_EQUIP | DIRTY_TRAITS | DIRTY_POP;
    }

    if (t === "add-unit" || t === "remove-unit" || t === "context-unit" || t === "apply-plan" || t === "reset") {
      let mask = DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_POP | DIRTY_TRAITS | DIRTY_EQUIP | DIRTY_LIB_STATE;
      if (prevState.level !== nextState.level) mask |= DIRTY_HEADER;
      if (t === "reset") mask |= DIRTY_HEADER;
      return mask;
    }

    if (t === "update-settings") {
      const keys = Object.keys(action.settings || {});
      let mask = 0;
      keys.forEach((k) => {
        if (k === "libraryTab") mask |= DIRTY_LIB_FILTER;
        else if (k === "level" || k === "extraSlots") mask |= DIRTY_HEADER | DIRTY_POP | DIRTY_RECS;
        else if (k === "mode" || k === "viewMode" || k === "allowLocked") mask |= DIRTY_HEADER | DIRTY_TRAITS | DIRTY_RECS;
        else if (k === "traitTargets" || k === "targetTraitCount" || k === "prismatic" || k === "emblems") mask |= DIRTY_TRAITS | DIRTY_RECS;
        else if (k === "focusId") mask |= DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_RECS;
        else if (k === "unlockTargetId") mask |= DIRTY_RECS | DIRTY_LIB_STATE | DIRTY_BOARD;
        else if (k === "bannedIds" || k === "trackerMaxLevel") mask |= DIRTY_RECS;
      });
      return mask;
    }

    return DIRTY_ALL;
  }

  function applyBoardActionFallback(prev, action) {
    // Defensive fallback if board.js hasn't loaded new actions yet in isolated runs
    const next = JSON.parse(JSON.stringify(prev));
    if (action.type === "add-loose") {
      if (!game.itemById[action.itemId]) return { state: prev, changed: false, error: "unknown item " + action.itemId };
      next.looseItems.push(action.itemId);
      return { state: next, changed: true, error: null };
    }
    if (action.type === "unequip-to-loose") {
      const entry = next.board.find((e) => e.id === action.id);
      if (!entry) return { state: prev, changed: false, error: "unit not on board" };
      if (!Number.isInteger(action.index) || entry.items[action.index] !== action.itemId) {
        return { state: prev, changed: false, error: "stale item index" };
      }
      entry.items.splice(action.index, 1);
      next.looseItems.push(action.itemId);
      return { state: next, changed: true, error: null };
    }
    return null;
  }

  function snapshotState(src) {
    return JSON.parse(JSON.stringify(src || state));
  }

  function pushUndo(snap) {
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function isUndoableAction(action) {
    if (!action) return false;
    if (action.type === "update-settings") {
      const keys = Object.keys(action.settings || {});
      return keys.some((k) => k !== "libraryTab" && k !== "viewMode");
    }
    return true;
  }

  function flashNotice(msg, ms) {
    if (noticeAutoTimer != null) {
      clearTimeout(noticeAutoTimer);
      noticeAutoTimer = null;
    }
    ui.canUndoReset = false;
    ui.notice = msg || "";
    emit(DIRTY_NOTICE);
    if (msg && ms > 0) {
      noticeAutoTimer = setTimeout(() => {
        noticeAutoTimer = null;
        if (ui.notice === msg && !ui.canUndoReset) {
          ui.notice = "";
          emit(DIRTY_NOTICE);
        }
      }, ms);
    }
  }

  function restoreSnapshot(snap, msg) {
    if (!snap || !game) return false;
    if (resetUndoTimer != null) {
      clearTimeout(resetUndoTimer);
      resetUndoTimer = null;
    }
    lastResetSnapshot = null;
    ui.canUndoReset = false;
    clearAllPendingBans();
    state = Object.assign(freshState(), snapshotState(snap));
    ui.selected = null;
    ui.preview = null;
    analysis.previewDiff = null;
    normalizeState();
    analysis.loosePlan = computeQuickLoosePlan();
    save();
    scheduleAnalyze();
    emit(DIRTY_ALL);
    if (msg) flashNotice(msg, 2400);
    return true;
  }

  function undo() {
    if (!undoStack.length || !game) return false;
    const prev = undoStack.pop();
    redoStack.push(snapshotState(state));
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    return restoreSnapshot(prev, "已撤销上一步");
  }

  function redo() {
    if (!redoStack.length || !game) return false;
    const next = redoStack.pop();
    undoStack.push(snapshotState(state));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    return restoreSnapshot(next, "已重做");
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function act(action) {
    if (!game || !TFTBoard()) return false;
    const prevState = state;
    const prevSnap = isUndoableAction(action) ? snapshotState(prevState) : null;
    let r = TFTBoard().apply(state, action, game);
    if (r.error && /^unknown action/.test(r.error)) {
      const fb = applyBoardActionFallback(state, action);
      if (fb) r = fb;
    }
    if (r.error) {
      notify(r.error);
      return false;
    }

    if (r.changed && prevSnap) pushUndo(prevSnap);
    state = r.state;
    if (action.type !== "reset" && (ui.canUndoReset || lastResetSnapshot)) {
      if (resetUndoTimer != null) {
        clearTimeout(resetUndoTimer);
        resetUndoTimer = null;
      }
      lastResetSnapshot = null;
      ui.canUndoReset = false;
    }
    if (ui.notice) {
      ui.notice = "";
      emit(DIRTY_NOTICE);
    }

    if (ui.selected && !selectedEntry()) ui.selected = null;

    const needAnalyze = ANALYSIS_ACTIONS.has(action.type) ||
      (action.type === "update-settings" && Object.keys(action.settings || {}).some((k) => SEARCH_SETTINGS.has(k)));

    if (action.type === "add-loose" || action.type === "delete-loose" || action.type === "craft-loose" || action.type === "equip-item" ||
        action.type === "unequip-item" || action.type === "unequip-to-loose" ||
        action.type === "add-unit" || action.type === "remove-unit" || action.type === "context-unit" ||
        action.type === "apply-plan" || action.type === "reset") {
      analysis.loosePlan = computeQuickLoosePlan();
    }

    if (action.type === "reset") {
      clearAllPendingBans();
      ui.selected = null;
      ui.preview = null;
      analysis.previewDiff = null;
    }

    save();
    let mask = dirtyMaskForAction(action, prevState, state);
    if (r.changed && prevSnap) mask |= DIRTY_HEADER;
    if (needAnalyze) scheduleAnalyze();
    emit(mask);
    return true;
  }

  function setSettings(settings) {
    return act({ type: "update-settings", settings });
  }

  function selectUnit(unitId) {
    const next = unitId || null;
    if (ui.selected === next) return;
    ui.selected = next;
    emit(DIRTY_BOARD | DIRTY_INSPECTOR);
  }

  function setTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    ui.theme = t;
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = t;
    }
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
    emit(DIRTY_HEADER);
  }

  function getTheme() {
    return ui.theme;
  }

  function setPlaystyle(preset) {
    if (preset === "ladder") return setSettings({ viewMode: "ladder" });
    if (preset === "reorg") return setSettings({ viewMode: "reorg" });
    if (preset === "reroll") return setSettings({ mode: "reroll" });
    if (preset === "fast8") return setSettings({ mode: "fast8" });
    return setSettings({ mode: "auto" });
  }

  function setViewMode(viewMode) {
    const v = viewMode === "ladder" || viewMode === "reorg" ? viewMode : "normal";
    if (state.viewMode === v) return true;
    return setSettings({ viewMode: v });
  }

  function setMode(mode) {
    const m = mode === "reroll" || mode === "fast8" ? mode : "auto";
    if (state.mode === m) return true;
    return setSettings({ mode: m });
  }

  function getPlaystyle() {
    if (state.mode === "reroll") return "reroll";
    if (state.mode === "fast8") return "fast8";
    return "normal";
  }

  function clearTraitTargets() {
    return setSettings({ traitTargets: {} });
  }

  function setUnlockTarget(unitId) {
    return setSettings({ unlockTargetId: unitId || null });
  }

  function togglePrismatic(traitId) {
    const next = Object.assign({}, state.prismatic || {});
    if (next[traitId]) delete next[traitId];
    else next[traitId] = true;
    return setSettings({ prismatic: next });
  }

  function toggleTraitTarget(traitId, need) {
    const next = Object.assign({}, state.traitTargets || {});
    if (next[traitId] === need) delete next[traitId];
    else next[traitId] = need;
    return setSettings({ traitTargets: next });
  }

  function togglePreview(spec) {
    if (!spec) {
      if (!ui.preview) return;
      ui.preview = null;
      analysis.previewDiff = null;
      emit(DIRTY_BOARD | DIRTY_RECS);
      return;
    }
    const same = ui.preview && ui.preview.kind === spec.kind && ui.preview.index === spec.index;
    if (same) {
      ui.preview = null;
      analysis.previewDiff = null;
    } else {
      ui.preview = { kind: spec.kind, index: spec.index };
      analysis.previewDiff = computePreviewDiff(ui.preview);
    }
    emit(DIRTY_BOARD | DIRTY_RECS);
  }

  function applyPlan(plan) {
    if (!plan || !Array.isArray(plan.board)) {
      notify("这个方案没有棋盘数据。");
      return false;
    }
    return act({
      type: "apply-plan",
      plan: {
        board: plan.board,
        looseItems: plan.looseItems || [],
        requiredLevel: plan.requiredLevel
      }
    });
  }

  function applyPreview() {
    if (!ui.preview) return false;
    const plan = resolvePreviewPlan(ui.preview);
    ui.preview = null;
    analysis.previewDiff = null;
    if (!plan) return false;
    return applyPlan(plan);
  }

  // Smart tactical auto-placement for a single newly added unit (all non-drag adds).
  // Places tanks/fighters centered front row, backline carries in back corners, assassins on front flanks,
  // and 2-slot units (Baron Nashor) in contiguous front/mid pairs without disturbing existing units.
  function findFirstFree(unitId) {
    const unit = game && game.byId && game.byId[unitId];
    const span = spanOf(unitId);
    const taken = new Set();
    state.board.forEach((e) => {
      if (!e.position) return;
      const s = spanOf(e.id);
      for (let k = 0; k < s; k++) {
        taken.add(e.position.row + "," + (e.position.col + k));
      }
    });

    const lane = unit ? (unit.lane || "mid") : "front";
    const rows = lane === "back" ? [3, 2, 1, 0]
      : lane === "mid" ? [1, 2, 0, 3]
        : [0, 1, 2, 3];
    const cols = (lane === "back" || lane === "assassin")
      ? [0, 6, 1, 5, 2, 4, 3]
      : [3, 2, 4, 1, 5, 0, 6];

    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (c + span > COLS) continue;
        let ok = true;
        for (let k = 0; k < span; k++) {
          if (taken.has(r + "," + (c + k))) { ok = false; break; }
        }
        if (ok) return { row: r, col: c };
      }
    }
    return null;
  }

  function addFirstFree(unitId) {
    if (!game) return false;
    const pos = findFirstFree(unitId);
    if (!pos) {
      notify("棋盘没有空位。");
      return false;
    }
    return act({ type: "add-unit", id: unitId, position: pos });
  }

  function addLooseItem(itemId) {
    return act({ type: "add-loose", itemId });
  }

  function craftLoose(idxA, idxB, compA, compB, resultItemId, targetId) {
    return act({ type: "craft-loose", idxA, idxB, compA, compB, resultItemId, targetId: targetId || null });
  }

  function loadMetaComp(comp) {
    if (!game || !comp || !Array.isArray(comp.units)) return false;
    pushUndo(snapshotState(state));
    clearAllPendingBans();
    const validEntries = comp.units
      .filter((u) => u && game.byId[u.id])
      .map((u) => ({
        id: u.id,
        star: clamp(Number(u.star) || 1, 1, 3),
        mark: "",
        position: null,
        items: Array.isArray(u.items) ? u.items.filter((it) => !!game.itemById[it]).slice(0, 3) : []
      }));
    // Compute optimal tactical placement via game.place()
    const grid = typeof game.place === "function"
      ? game.place(validEntries.map((e) => ({ id: e.id, star: e.star })))
      : null;
    if (grid) {
      const posById = {};
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = grid[r] && grid[r][c];
          if (cell && cell.id) posById[cell.id] = { row: r, col: c };
        }
      }
      validEntries.forEach((e) => {
        if (posById[e.id]) e.position = posById[e.id];
      });
    }
    state = Object.assign(freshState(), {
      level: clamp(Number(comp.level) || 8, 1, 10),
      mode: comp.mode === "reroll" || comp.mode === "fast8" ? comp.mode : "auto",
      viewMode: "normal",
      allowLocked: true,
      board: validEntries
    });
    ui.selected = null;
    ui.preview = null;
    analysis.previewDiff = null;
    normalizeState();
    analysis.loosePlan = computeQuickLoosePlan();
    save();
    scheduleAnalyze();
    emit(DIRTY_ALL);
    flashNotice(`已载入热门阵容「${comp.title}」（支持 Ctrl+Z 撤销）`, 3200);
    return true;
  }

  function applyMetaTargets(comp) {
    if (!game || !comp || !comp.traitTargets) return false;
    const targets = {};
    Object.keys(comp.traitTargets).forEach((tid) => {
      if (game.traitById[tid] && Number(comp.traitTargets[tid]) > 0) {
        targets[tid] = Number(comp.traitTargets[tid]);
      }
    });
    if (!Object.keys(targets).length) return false;
    const ok = setSettings({ traitTargets: targets, viewMode: "reorg" });
    if (ok) flashNotice(`已将「${comp.title}」核心羁绊设为整理目标`, 3000);
    return ok;
  }

  function equipLooseToTarget(looseIndex, targetUnitId) {
    const itemId = state.looseItems[looseIndex];
    if (!itemId) {
      notify("装备已不存在。");
      return false;
    }
    return act({
      type: "equip-item",
      id: targetUnitId,
      itemId,
      source: { kind: "loose", index: looseIndex }
    });
  }

  function setBanDomState(unitId, phase) {
    if (typeof document === "undefined") return;
    const nodes = document.querySelectorAll('[data-ban-unit="' + cssEsc(unitId) + '"]');
    nodes.forEach((el) => {
      el.classList.toggle("is-banning", phase === "grace" || phase === "sliding");
      el.classList.toggle("is-sliding-out", phase === "sliding");
    });
  }

  function clearAllPendingBans() {
    ui.pendingBans.forEach((entry, unitId) => {
      if (entry.timerId != null) clearTimeout(entry.timerId);
      setBanDomState(unitId, "none");
    });
    ui.pendingBans.clear();
  }

  function cancelBan(unitId) {
    const entry = ui.pendingBans.get(unitId);
    if (!entry) return false;
    if (entry.timerId != null) clearTimeout(entry.timerId);
    ui.pendingBans.delete(unitId);
    setBanDomState(unitId, "none");
    return true;
  }

  function startBan(unitId) {
    if (!unitId) return;
    if (ui.pendingBans.has(unitId)) {
      cancelBan(unitId);
      return;
    }
    const entry = { timerId: null, phase: "grace", startedAt: Date.now() };
    ui.pendingBans.set(unitId, entry);
    setBanDomState(unitId, "grace");

    entry.timerId = setTimeout(() => {
      if (ui.pendingBans.get(unitId) !== entry) return;
      entry.phase = "sliding";
      setBanDomState(unitId, "sliding");
      entry.timerId = setTimeout(() => {
        if (ui.pendingBans.get(unitId) !== entry) return;
        ui.pendingBans.delete(unitId);
        const nextBanned = Object.assign({}, state.bannedIds || {}, { [unitId]: true });
        setSettings({ bannedIds: nextBanned });
      }, 220);
    }, 1200);
  }

  function unbanUnit(unitId) {
    if (!state.bannedIds || !state.bannedIds[unitId]) return false;
    const nextBanned = Object.assign({}, state.bannedIds);
    delete nextBanned[unitId];
    return setSettings({ bannedIds: nextBanned });
  }

  function clearBans() {
    clearAllPendingBans();
    if (!state.bannedIds || !Object.keys(state.bannedIds).length) return true;
    return setSettings({ bannedIds: {} });
  }

  function isPendingBan(unitId) {
    return ui.pendingBans.has(unitId);
  }

  function setFilter(patch) {
    if (!patch || typeof patch !== "object") return;
    let changed = false;
    ["q", "cost", "role", "trait", "itemKind"].forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(patch, k) && ui[k] !== patch[k]) {
        ui[k] = patch[k];
        changed = true;
      }
    });
    if (changed) emit(DIRTY_LIB_FILTER);
  }

  function setLibraryTab(tab) {
    const nextTab = tab === "items" ? "items" : "units";
    if (state.libraryTab === nextTab) return true;
    return setSettings({ libraryTab: nextTab });
  }

  function useSet(raw, custom) {
    clearAllPendingBans();
    setGame(raw, custom);
    state.board = state.board
      .map((e) => ({ id: e.id, star: e.star, mark: e.mark, position: null, items: [] }))
      .filter((e) => !!game.byId[e.id]);
    state.looseItems = [];
    state.emblems = {};
    state.traitTargets = {};
    state.focusId = null;
    state.unlockTargetId = null;
    state.bannedIds = {};
    ui.selected = null;
    ui.preview = null;
    analysis.previewDiff = null;
    normalizeState();
    analysis.loosePlan = computeQuickLoosePlan();
    save();
    scheduleAnalyze();
    emit(DIRTY_ALL);
  }

  function importSet(parsed) {
    try {
      useSet(parsed, true);
      notify("");
      return true;
    } catch (err) {
      notify("导入失败：" + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  function exportSet() {
    if (!game || typeof document === "undefined") return;
    const blob = new Blob([JSON.stringify(game.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (game.data.meta && game.data.meta.set ? game.data.meta.set : "set") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function useBundled() {
    state.emblems = {};
    state.prismatic = {};
    state.board = [];
    state.looseItems = [];
    useSet(globalThis.SET19, false);
  }

  function loadDemo() {
    if (!game) return;
    pushUndo(snapshotState(state));
    clearAllPendingBans();
    const demo = [
      { id: "DA_Elise19", star: 2 },
      { id: "DA_Yunara19", star: 2 },
      { id: "DA_Annie19", star: 1 },
      { id: "DA_Lux19", star: 1 }
    ];
    state.board = [];
    demo.forEach((d) => {
      if (game.byId[d.id]) state.board.push(migrateEntry({ id: d.id, star: d.star }));
    });
    state.looseItems = [];
    state.emblems = {};
    state.bannedIds = {};
    state.traitTargets = {};
    state.unlockTargetId = null;
    state.focusId = null;
    state.level = 8;
    state.extraSlots = 0;
    ui.selected = null;
    ui.preview = null;
    ui.emblemPromptDismissed = false;
    analysis.previewDiff = null;
    normalizeState();
    analysis.loosePlan = computeQuickLoosePlan();
    save();
    scheduleAnalyze();
    emit(DIRTY_ALL);
  }

  function resetAll() {
    const hasContent =
      (state.board && state.board.length > 0) ||
      (state.looseItems && state.looseItems.length > 0) ||
      Object.keys(state.emblems || {}).length > 0 ||
      Object.keys(state.prismatic || {}).length > 0 ||
      Object.keys(state.traitTargets || {}).length > 0 ||
      Object.keys(state.bannedIds || {}).length > 0 ||
      !!state.unlockTargetId ||
      !!state.focusId ||
      (state.extraSlots || 0) > 0 ||
      (state.targetTraitCount || 0) > 0;
    const snap = hasContent ? JSON.parse(JSON.stringify(state)) : null;
    const ok = act({ type: "reset" });
    if (!ok) return false;
    if (snap) {
      if (resetUndoTimer != null) clearTimeout(resetUndoTimer);
      lastResetSnapshot = snap;
      ui.canUndoReset = true;
      ui.notice = "已一键重置棋盘、装备与全部目标";
      emit(DIRTY_NOTICE);
      resetUndoTimer = setTimeout(() => {
        resetUndoTimer = null;
        lastResetSnapshot = null;
        if (ui.canUndoReset) {
          ui.canUndoReset = false;
          ui.notice = "";
          emit(DIRTY_NOTICE);
        }
      }, 8000);
    }
    return true;
  }

  function undoReset() {
    if (!lastResetSnapshot || !game) return false;
    const snap = lastResetSnapshot;
    if (undoStack.length) undoStack.pop();
    return restoreSnapshot(snap, "已撤销重置");
  }

  function getShareCode() {
    return game ? encodeShareCode(state, game) : "";
  }

  function getShareUrl() {
    return game ? buildShareUrl(state, game) : "";
  }

  function getShareText() {
    return game ? buildShareText(state, game, analysis.rec) : "";
  }

  function getOfficialTeamCode(unitsOverride) {
    if (!game) return { code: "", count: 0, truncated: 0, skipped: [], error: "引擎未初始化" };
    return encodeOfficialTeamCode(unitsOverride || state.board, game);
  }

  function applyTacticalPlacement(entries) {
    if (!game || !entries.length || typeof game.place !== "function") return;
    const grid = game.place(entries.map((e) => ({ id: e.id, star: e.star })));
    if (!grid) return;
    const posById = {};
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r] && grid[r][c];
        if (cell && cell.id) posById[cell.id] = { row: r, col: c };
      }
    }
    entries.forEach((e) => {
      if (!e.position && posById[e.id]) e.position = posById[e.id];
    });
  }

  function importShareText(raw, opts) {
    if (!game) return { ok: false, error: "引擎未初始化" };
    const decoded = decodeShareInput(raw, game);
    if (decoded.error || !decoded.state) {
      if (!(opts && opts.silent)) notify(decoded.error || "导入失败");
      return { ok: false, error: decoded.error || "导入失败" };
    }
    if (!(opts && opts.noUndo)) pushUndo(snapshotState(state));
    clearAllPendingBans();
    const d = decoded.state;
    const importedBoard = d.board.map(migrateEntry).filter(Boolean);
    if (decoded.format === "official" || importedBoard.every((e) => !e.position)) {
      applyTacticalPlacement(importedBoard);
    }
    state = Object.assign(freshState(), {
      level: d.level,
      extraSlots: d.extraSlots,
      mode: d.mode,
      viewMode: "normal",
      allowLocked: d.allowLocked,
      focusId: d.focusId,
      unlockTargetId: d.unlockTargetId,
      board: importedBoard,
      looseItems: d.looseItems.slice(),
      emblems: Object.assign({}, d.emblems),
      prismatic: Object.assign({}, d.prismatic),
      traitTargets: Object.assign({}, d.traitTargets),
      bannedIds: Object.assign({}, d.bannedIds),
      targetTraitCount: d.targetTraitCount
    });
    ui.selected = null;
    ui.preview = null;
    analysis.previewDiff = null;
    normalizeState();
    analysis.loosePlan = computeQuickLoosePlan();
    save();
    scheduleAnalyze();
    emit(DIRTY_ALL);
    const suffix = decoded.warnings && decoded.warnings.length ? `（${decoded.warnings[0]}）` : "";
    if (!(opts && opts.silent)) {
      const msg = decoded.format === "official"
        ? `已导入官方游戏小队码：${state.board.length} 弈子（已自动站位）${suffix}`
        : `已导入残局：${state.level}级 · ${state.board.length} 弈子${suffix}`;
      flashNotice(msg, 3600);
    }
    return { ok: true, error: null, format: decoded.format || "sandbox", warnings: decoded.warnings || [] };
  }

  function cancelTracker() {
    if (analysis.tracker && analysis.tracker.task) {
      try { analysis.tracker.task.cancel(); } catch { /* ignore */ }
    }
    if (analysis.tracker) {
      analysis.tracker.done = true;
      analysis.tracker.res = Object.assign({}, analysis.tracker.res, { done: true, cancelled: true });
    }
    if (analysis.unlockTracker && analysis.unlockTracker.task) {
      try { analysis.unlockTracker.task.cancel(); } catch { /* ignore */ }
    }
    if (analysis.unlockTracker) {
      analysis.unlockTracker.done = true;
      analysis.unlockTracker.res = Object.assign({}, analysis.unlockTracker.res, { done: true, cancelled: true });
    }
    emit(DIRTY_RECS);
  }

  function dismissEmblemPrompt() {
    ui.emblemPromptDismissed = true;
    emit(DIRTY_EQUIP | DIRTY_RECS | DIRTY_NOTICE);
  }

  function notify(msg) {
    const next = msg || "";
    if (ui.notice === next) return;
    ui.notice = next;
    emit(DIRTY_NOTICE);
  }

  function init() {
    installGlobalImageFallback();
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = ui.theme;
    }
    setGame(globalThis.SET19, false);
    load();
    let loadedFromShare = false;
    if (typeof location !== "undefined") {
      const shareSource = (location.hash || "") + " " + (location.search || "");
      const shareToken = extractShareToken(shareSource);
      if (shareToken) {
        const res = importShareText(shareToken, { noUndo: true, silent: true });
        if (res.ok) {
          loadedFromShare = true;
          try {
            if (typeof history !== "undefined" && typeof history.replaceState === "function" && location.hash) {
              history.replaceState(null, "", location.href.split("#")[0]);
            }
          } catch { /* ignore */ }
          flashNotice(`已从分享链接载入残局（${state.level}级 · ${state.board.length} 弈子）`, 4200);
        }
      }
    }
    if (!loadedFromShare && !state.board.length && typeof location !== "undefined" && /[?&]demo=1/.test(location.search)) {
      const demo = [
        { id: "DA_Elise19", star: 2 },
        { id: "DA_Yunara19", star: 2 },
        { id: "DA_Annie19", star: 1 },
        { id: "DA_Lux19", star: 1 }
      ];
      demo.forEach((d) => {
        if (game.byId[d.id]) state.board.push(migrateEntry({ id: d.id, star: d.star }));
      });
      state.level = 8;
      normalizeState();
    }
    if (!loadedFromShare) {
      analysis.loosePlan = computeQuickLoosePlan();
      save();
      emit(DIRTY_ALL);
      scheduleAnalyze();
    }
  }

  return {
    init,
    subscribe,
    getState: () => state,
    getGame: () => game,
    getUI: () => ui,
    getAnalysis: () => analysis,
    getContext,
    traitCounts,
    isCustomSet: () => !!customSet,
    act,
    setSettings,
    selectUnit,
    setTheme,
    getTheme,
    setPlaystyle,
    setViewMode,
    setMode,
    getPlaystyle,
    setUnlockTarget,
    togglePrismatic,
    toggleTraitTarget,
    clearTraitTargets,
    togglePreview,
    applyPreview,
    applyPlan,
    addFirstFree,
    addLooseItem,
    craftLoose,
    equipLooseToTarget,
    loadMetaComp,
    applyMetaTargets,
    startBan,
    cancelBan,
    unbanUnit,
    clearBans,
    isPendingBan,
    setFilter,
    setLibraryTab,
    importSet,
    exportSet,
    useBundled,
    loadDemo,
    resetAll,
    undoReset,
    undo,
    redo,
    canUndo,
    canRedo,
    getShareCode,
    getShareUrl,
    getShareText,
    getOfficialTeamCode,
    importShareText,
    cancelTracker,
    dismissEmblemPrompt,
    notify,
    unitName,
    itemName,
    spanOf,
    roleLabel,
    srcList,
    focusPos,
    costColorVar,
    costSolidHex,
    esc,
    imgHtml
  };
}
