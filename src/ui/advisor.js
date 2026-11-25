/**
 * Right-rail Strategy Advisor pool/renderer.
 * Supports Normal Mode (unlock target, plans, swaps, next buys, star-ups, banned recovery)
 * and Ladder Mode (emblem onboarding, constraints, DataTFT-style tracker plans).
 * Uses fingerprint gating + direct pending-ban DOM patching to avoid unnecessary innerHTML rebuilds.
 */

const DIRTY_RECS = 1 << 8;

const CONTRIB_LABELS = {
  damage: "伤害",
  frontline: "前排",
  traits: "羁绊",
  utility: "功能"
};

const POPULAR_EMBLEM_IDS = [
  "DA_KDA19_Emblem",
  "DA_Pentakill19_Emblem",
  "DA_Heartsteel19_Emblem",
  "DA_TrueDamage19_Emblem",
  "DA_Jazz19_Emblem",
  "DA_Arcanist19_Emblem",
  "DA_Juggernaut19_Emblem",
  "DA_Prodigy19_Emblem"
];

function gradeOf(mid) {
  if (mid >= 18) return "S";
  if (mid >= 8) return "A";
  if (mid >= 3) return "B";
  if (mid >= 1) return "C";
  if (mid >= 0) return "D";
  return "E";
}

function fmtScore(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const v = Math.round(n * 100) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

function describe(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  return x.text || x.label || x.message || x.name || x.id || "";
}

function uniqueStrings(arr) {
  const seen = Object.create(null);
  const out = [];
  for (let i = 0; i < (arr || []).length; i++) {
    const v = arr[i];
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

export function mountAdvisor(store) {
  const titleEl = document.getElementById("advisor-title");
  const subEl = document.getElementById("advisor-sub");
  const bodyEl = document.getElementById("advisor-body");

  let lastRenderKey = null;
  let lastRecRef = null;
  let lastReorgRef = null;
  let lastTrackerResRef = null;
  let lastUnlockResRef = null;
  let lastUnlockCtxRef = null;
  let hadPendingBans = false;

  const esc = (s) => store.esc(s);
  const imgHtml = (rec, cls, label, eager) => store.imgHtml(rec, cls, label, eager);

  function getContext() {
    const state = store.getState() || {};
    const game = store.getGame() || {};
    const ui = store.getUI() || {};
    const analysis = (typeof store.getAnalysis === "function" ? store.getAnalysis() : null) || {};
    return {
      state,
      game,
      ui,
      analysis,
      rec: analysis.rec || ui.rec || null,
      reorg: analysis.reorg || null,
      tracker: analysis.tracker || ui.tracker || null,
      unlockPlan: analysis.unlockCtx || analysis.unlockPlan || analysis.unlock || ui.unlockPlan || null,
      unlockTracker: analysis.unlockTracker || ui.unlockTracker || null
    };
  }

  function getActivePreview(ui) {
    if (ui.previewSpec && typeof ui.previewSpec === "object") return ui.previewSpec;
    if (ui.preview && typeof ui.preview === "object") return ui.preview;
    return null;
  }

  function isPreviewActive(ui, kind, index) {
    const p = getActivePreview(ui);
    if (p) return p.kind === kind && Number(p.index) === Number(index);
    if (kind === "ladder" && typeof ui.preview === "number") return ui.preview === Number(index);
    return false;
  }

  function getPendingBanEntry(ui, unitId) {
    const map = ui.pendingBans;
    if (map && typeof map.get === "function") {
      const entry = map.get(unitId);
      if (entry) return entry;
    }
    if (typeof store.isPendingBan === "function") {
      const res = store.isPendingBan(unitId);
      if (res && typeof res === "object") return res;
      if (res) return { phase: "grace" };
    }
    return null;
  }

  function syncPendingBans() {
    if (!bodyEl) return;
    const ui = store.getUI() || {};
    const map = ui.pendingBans;
    const hasAny = !!(map && map.size > 0);
    if (!hasAny && !hadPendingBans) return;

    const nodes = bodyEl.querySelectorAll("[data-ban-unit]");
    let stillActive = false;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const uid = el.getAttribute("data-ban-unit");
      const pending = uid ? getPendingBanEntry(ui, uid) : null;
      if (pending) {
        stillActive = true;
        el.classList.add("is-banning");
        el.classList.toggle("is-sliding-out", pending.phase === "sliding");
        if (!el.querySelector('[data-ban-ui="1"]')) {
          const isRow = el.classList.contains("action-row");
          if (isRow) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn xs danger";
            btn.setAttribute("data-cancel-ban", uid);
            btn.setAttribute("data-ban-ui", "1");
            btn.textContent = "撤销";
            const actionSlot = el.querySelector(".action-btn-slot");
            if (actionSlot) {
              actionSlot.dataset.hiddenDuringBan = "1";
              actionSlot.hidden = true;
              el.insertBefore(btn, actionSlot);
            } else {
              el.appendChild(btn);
            }
          } else {
            const undo = document.createElement("button");
            undo.type = "button";
            undo.className = "ban-label";
            undo.setAttribute("data-cancel-ban", uid);
            undo.setAttribute("data-ban-ui", "1");
            undo.style.border = "0";
            undo.style.background = "transparent";
            undo.style.cursor = "pointer";
            undo.style.padding = "0 2px";
            undo.textContent = "撤销";
            el.appendChild(undo);
          }
          const bar = document.createElement("span");
          bar.className = "ban-countdown";
          bar.setAttribute("data-ban-bar", "1");
          el.appendChild(bar);
        }
      } else if (el.classList.contains("is-banning") || el.classList.contains("is-sliding-out") || el.querySelector('[data-ban-ui="1"]')) {
        el.classList.remove("is-banning", "is-sliding-out");
        const uiNode = el.querySelector('[data-ban-ui="1"]');
        if (uiNode) uiNode.remove();
        const barNode = el.querySelector('[data-ban-bar="1"]');
        if (barNode) barNode.remove();
        const actionSlot = el.querySelector(".action-btn-slot");
        if (actionSlot && actionSlot.dataset.hiddenDuringBan === "1") {
          delete actionSlot.dataset.hiddenDuringBan;
          actionSlot.hidden = false;
        }
      }
    }
    hadPendingBans = hasAny || stillActive;
  }

  function unitById(game, id) {
    return (game.byId && game.byId[id]) || null;
  }

  function costVar(cost) {
    return typeof store.costColorVar === "function" ? store.costColorVar(cost) : "var(--cost-1)";
  }

  function costHex(cost) {
    return typeof store.costSolidHex === "function" ? store.costSolidHex(cost) : "#6b6b72";
  }

  function miniUnitHtml(game, unitOrSpec, opts) {
    const o = opts || {};
    const id = typeof unitOrSpec === "string" ? unitOrSpec : (unitOrSpec && (unitOrSpec.id || unitOrSpec.unitId));
    if (!id) return "";
    const u = unitById(game, id);
    const name = u ? (u.display || u.name || id) : store.unitName(id);
    const cost = u ? (u.cost || 1) : 1;
    const star = o.star || (typeof unitOrSpec === "object" && unitOrSpec.star) || 1;
    const lvl = typeof unitOrSpec === "object" && unitOrSpec.level ? unitOrSpec.level : 0;
    const cls = "mini-unit" + (o.out ? " is-out" : "");
    const starTxt = star > 1 ? ` ${star}★` : "";
    const lvlTxt = lvl > 0 ? ` (${lvl}级)` : "";
    const outStyle = o.out ? "opacity:0.65;text-decoration:line-through;" : "";
    return (
      `<span class="${cls}" data-tip="unit:${esc(id)}" data-ban-unit="${esc(id)}" style="--cost:${esc(costVar(cost))};--cost-solid:${esc(costHex(cost))};${outStyle}" title="${esc(name)}（右键本局屏蔽）">` +
      imgHtml(u, "mini-unit-img", name, false) +
      `<span>${esc(name + starTxt + lvlTxt)}</span>` +
      `</span>`
    );
  }

  function traitDeltaHtml(game, c) {
    if (!c) return "";
    if (typeof c === "string") return `<span class="trait-delta">${esc(c)}</span>`;
    const tid = c.id || c.traitId;
    const t = tid && game.traitById ? game.traitById[tid] : null;
    const name = t ? t.name : (c.name || tid || "羁绊");
    const from = c.from != null ? c.from : c.beforeCount;
    const to = c.to != null ? c.to : c.afterCount;
    let cls = "";
    if (to != null && from != null && t && Array.isArray(t.breakpoints)) {
      const state = store.getState() || {};
      const pris = !!(state.prismatic && state.prismatic[tid]);
      const tierAt = (n) => {
        let best = 0;
        for (let i = 0; i < t.breakpoints.length; i++) {
          const bp = t.breakpoints[i];
          const s = (pris && bp.prismaticStyle) ? bp.prismaticStyle : (bp.style || 0);
          if (s > 0 && n >= bp.need && bp.need > best) best = bp.need;
        }
        return best;
      };
      const fTier = tierAt(from);
      const tTier = tierAt(to);
      if (tTier > fTier) cls = "gain";
      else if (tTier < fTier) cls = "loss";
    } else if (c.reachedEffect) {
      cls = "gain";
    }
    const ico = t ? imgHtml(t, "trait-delta-ico", name, false) : "";
    const countTxt = from != null && to != null ? ` ${from}→${to}` : "";
    const tipAttr = tid ? ` data-tip="trait:${esc(tid)}"` : "";
    return `<span class="trait-delta ${cls}"${tipAttr}>${ico}<span>${esc(name)}${esc(countTxt)}</span></span>`;
  }

  function itemFitPillsHtml(game, matchedItems, forBuyRow) {
    const ids = uniqueStrings(matchedItems);
    if (!ids.length) return "";
    if (forBuyRow) {
      return ids.map((itemId) => {
        const it = game.itemById && game.itemById[itemId];
        const label = it ? it.name : store.itemName(itemId);
        return `<span class="fit-pill" data-tip="item:${esc(itemId)}">${imgHtml(it, "", label, false)}<span>契合${esc(label)}</span></span>`;
      }).join("");
    }
    const names = ids.map((id) => store.itemName(id)).join("、");
    return `<span class="trait-delta fit" data-tip="item:${esc(ids[0])}"><span>契合装备：${esc(names)}</span></span>`;
  }

  function gradeBoxHtml(row) {
    const a = row && row.assessment;
    if (!a || !a.score || a.score.mid == null) return "";
    const mid = a.score.mid;
    const finite = typeof mid === "number" && isFinite(mid);
    const unknown = a.status === "unknown";
    const letter = finite ? gradeOf(mid) : "—";
    const letterCls = finite ? `grade-${letter.toLowerCase()}` : "grade-c";
    const unknownPill = unknown ? `<span class="conf-pill">资料待补</span>` : "";
    return (
      `<div class="grade-box">` +
      `<span class="grade-letter ${letterCls}">${esc(letter)}</span>` +
      `<span class="grade-delta">${esc(fmtScore(mid))}</span>` +
      unknownPill +
      `</div>`
    );
  }

  function telemetrySubHtml(row) {
    const a = row && row.assessment;
    const parts = [];
    if (a && Array.isArray(a.contributions)) {
      for (let i = 0; i < a.contributions.length; i++) {
        const c = a.contributions[i];
        if (!c || !c.delta || typeof c.delta.mid !== "number" || !isFinite(c.delta.mid)) continue;
        if (Math.abs(c.delta.mid) < 0.005) continue;
        parts.push(`${CONTRIB_LABELS[c.bucket] || c.bucket || "分项"} ${fmtScore(c.delta.mid)}`);
      }
    }
    const blockers = (a && a.blockers) || [];
    const conditions = (a && a.conditions) || [];
    const reasons = (a && a.reasons && a.reasons.length ? a.reasons : (row && row.reasons)) || [];

    let html = parts.length ? `<div class="plan-sub">${esc(parts.join(" · "))}</div>` : "";
    if (blockers.length) {
      html += `<div class="plan-sub" style="color:var(--danger)">硬门槛：${esc(blockers.slice(0, 2).map(describe).join("；"))}</div>`;
    }
    if (conditions.length) {
      html += `<div class="plan-sub">条件：${esc(conditions.slice(0, 2).map(describe).join("；"))}</div>`;
    }
    if (reasons.length) {
      html += `<div class="plan-sub">${esc(reasons.slice(0, 3).map(describe).join("；"))}</div>`;
    }
    return html;
  }

  function renderUnlockZone(ctx) {
    const { state, game, ui, unlockPlan, unlockTracker } = ctx;
    const unlockables = (game.data && Array.isArray(game.data.units) ? game.data.units : [])
      .filter((u) => u && u.unlock)
      .slice()
      .sort((a, b) => (a.cost || 0) - (b.cost || 0) || String(a.display || a.name).localeCompare(String(b.display || b.name), "zh"));

    if (!unlockables.length && !state.unlockTargetId) return "";

    const optionsHtml = unlockables.map((u) => {
      const selected = u.id === state.unlockTargetId ? " selected" : "";
      return `<option value="${esc(u.id)}"${selected}>${u.cost}费 · ${esc(u.display || u.name)}</option>`;
    }).join("");

    if (!state.unlockTargetId) {
      return (
        `<section class="unlock-zone">` +
        `<div class="unlock-head">` +
        `<span class="eyebrow">解锁目标</span>` +
        `<select class="mini-select" data-unlock-select="1" aria-label="选择解锁目标">` +
        `<option value="">无（常规推荐）</option>` +
        optionsHtml +
        `</select>` +
        `</div>` +
        `</section>`
      );
    }

    const target = unitById(game, state.unlockTargetId);
    if (!target) {
      return (
        `<section class="unlock-zone">` +
        `<div class="unlock-head">` +
        `<span class="eyebrow">解锁目标</span>` +
        `<select class="mini-select" data-unlock-select="1" aria-label="选择解锁目标"><option value="">无</option>${optionsHtml}</select>` +
        `</div>` +
        `</section>`
      );
    }

    const meta = (unlockPlan && unlockPlan.meta) || target.unlock || {};
    const onBoard = (unlockPlan && typeof unlockPlan.alreadyOnBoard === "boolean")
      ? unlockPlan.alreadyOnBoard
      : (state.board || []).some((e) => e.id === target.id);
    const minLevel = meta.minLevel || meta.level || 0;
    const condText = meta.text || (target.unlock && target.unlock.text) || "";
    const levelSuffix = minLevel > 0 && !String(condText).includes(String(minLevel)) ? ` · 需 ${minLevel} 级` : "";

    let miniTrackHtml = "";
    if (unlockPlan && unlockPlan.needsMiniTrack) {
      const ut = unlockTracker || unlockPlan.tracker || null;
      const utRes = ut && ut.res ? ut.res : null;
      const routePlans = (utRes && utRes.plans) || unlockPlan.routePlans || [];
      const busy = !ut || !utRes || !utRes.done;
      const route = routePlans[0] || null;

      let statusHtml = "";
      if (ut && ut.error) {
        statusHtml = `<span>${esc(ut.error)}</span>`;
      } else if (busy) {
        const visited = utRes && utRes.visited ? ` · 已检 ${utRes.visited}` : "";
        statusHtml = `<span>解锁路线：<b>搜索中${visited}</b></span><button type="button" class="btn xs" data-cancel-track="1">取消</button>`;
      } else if (utRes && utRes.cancelled) {
        statusHtml = `<span>解锁路线：已取消</span>`;
      } else if (route) {
        statusHtml = `<span>解锁路线：<b>最少 +${(route.adds || []).length} 张</b> · ${route.finishLevel || minLevel || 9} 级成型</span>`;
      } else {
        statusHtml = `<span>解锁路线：当前约束下暂无可行路线</span>`;
      }

      let routeBody = "";
      if (route) {
        const previewing = isPreviewActive(ui, "unlock-route", 0);
        const addsHtml = (route.adds || []).map((a) => miniUnitHtml(game, a)).join("");
        const traitsHtml = (route.traitChanges || []).slice(0, 6).map((c) => traitDeltaHtml(game, c)).join("");
        routeBody =
          `<div class="plan-units">${addsHtml || '<span class="plan-sub">当前阵容已满足条件</span>'}</div>` +
          (traitsHtml ? `<div class="plan-traits">${traitsHtml}</div>` : "") +
          `<div class="plan-foot">` +
          `<span class="plan-sub">激活 ${route.activeTraitCount || unlockPlan.miniTrackGoal || 8} 条羁绊</span>` +
          `<div class="plan-btns">` +
          `<button type="button" class="btn sm${previewing ? " toggle-on" : ""}" data-preview-kind="unlock-route" data-preview-index="0">${previewing ? "预览中" : "预览路线"}</button>` +
          `<button type="button" class="btn sm primary" data-apply-kind="unlock-route" data-apply-index="0">应用路线</button>` +
          `</div>` +
          `</div>`;
      }

      miniTrackHtml =
        `<div class="unlock-route">` +
        `<div class="unlock-route-bar">${statusHtml}</div>` +
        routeBody +
        `</div>`;
    }

    return (
      `<section class="unlock-zone">` +
      `<div class="unlock-head">` +
      `<div class="unlock-who">` +
      `<span class="u-ava" data-tip="unit:${esc(target.id)}" style="--cost:${esc(costVar(target.cost || 1))}">${imgHtml(target, "", target.display || target.name, true)}</span>` +
      `<div style="min-width:0">` +
      `<div class="unlock-title">` +
      `<strong>${esc(target.display || target.name)}</strong>` +
      (onBoard
        ? `<span class="unlock-badge">已上场</span>`
        : `<span class="unlock-badge">预设上场</span><span class="conf-pill">待解锁</span>`) +
      `</div>` +
      (condText ? `<p class="unlock-cond">${esc(condText + levelSuffix)}</p>` : "") +
      `</div>` +
      `</div>` +
      `<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">` +
      `<select class="mini-select" style="width:108px;flex:0 0 108px;height:24px;font-size:11px" data-unlock-select="1" aria-label="更换解锁目标">${optionsHtml}</select>` +
      `<button type="button" class="btn xs ghost" data-unlock-clear="1" title="清除解锁目标" aria-label="清除解锁目标">×</button>` +
      `</div>` +
      `</div>` +
      miniTrackHtml +
      `</section>`
    );
  }

  function renderPlanCard(ctx, p, i) {
    if (!p) return "";
    if (p.assessment && (p.assessment.status === "blocked" || p.assessment.status === "not_recommended")) return "";
    const { game, ui, state } = ctx;
    const previewing = isPreviewActive(ui, "plan", i);

    let unitsHtml = "";
    if ((p.removes || []).length) {
      const outs = p.removes.map((id) => miniUnitHtml(game, id, { out: true })).join("");
      const ins = (p.adds || []).map((a) => miniUnitHtml(game, a)).join("");
      unitsHtml = `${outs}<span style="color:var(--text-muted);align-self:center">→</span>${ins}`;
    } else {
      unitsHtml = (p.adds || []).map((a) => miniUnitHtml(game, a)).join("");
    }

    const traitsHtml = (p.traitChanges || []).slice(0, 6).map((c) => traitDeltaHtml(game, c)).join("");
    const fitHtml = (p.matchedItems || []).length ? itemFitPillsHtml(game, p.matchedItems, false) : "";

    return (
      `<article class="plan-item${previewing ? " is-previewing" : ""}">` +
      `<div class="plan-top">` +
      `<div style="min-width:0">` +
      `<div class="plan-title">${esc(p.title || "推荐方案")}</div>` +
      `</div>` +
      gradeBoxHtml(p) +
      `</div>` +
      (unitsHtml ? `<div class="plan-units">${unitsHtml}</div>` : "") +
      (traitsHtml || fitHtml ? `<div class="plan-traits">${traitsHtml}${fitHtml}</div>` : "") +
      telemetrySubHtml(p) +
      `<div class="plan-foot">` +
      `<span class="plan-sub">等级 ${p.requiredLevel || state.level || 8}</span>` +
      `<div class="plan-btns">` +
      `<button type="button" class="btn sm${previewing ? " toggle-on" : ""}" data-preview-kind="plan" data-preview-index="${i}">${previewing ? "预览中" : "预览棋盘"}</button>` +
      `<button type="button" class="btn sm primary" data-apply-kind="plan" data-apply-index="${i}">应用方案</button>` +
      `</div>` +
      `</div>` +
      `</article>`
    );
  }

  function renderSwapCard(ctx, s, i) {
    if (!s) return "";
    if (s.assessment && (s.assessment.status === "blocked" || s.assessment.status === "not_recommended")) return "";
    const { game, ui } = ctx;
    const previewing = isPreviewActive(ui, "swap", i);
    const starChange = s.assessment && s.assessment.materialization && s.assessment.materialization.starChanges && s.assessment.materialization.starChanges[0];
    const fromStar = s.currentStars != null ? s.currentStars : (s.fromStar != null ? s.fromStar : (starChange && starChange.fromStar) || 1);
    const toStar = s.candidateStars != null ? s.candidateStars : (s.toStar != null ? s.toStar : (starChange && starChange.toStar) || s.requiredStars || 1);

    const outHtml = miniUnitHtml(game, s.out, { out: true, star: fromStar });
    const inHtml = miniUnitHtml(game, s.inn, { star: toStar });
    const inherited = (s.itemTransfers || []).flatMap((tr) => tr.items || []).filter(Boolean);
    const inheritNames = uniqueStrings(inherited).map((id) => store.itemName(id)).join("、");
    const traitsHtml = (s.traitChanges || []).slice(0, 6).map((c) => traitDeltaHtml(game, c)).join("");
    const applyText = s.requiredStars > 1 ? `按 ${s.requiredStars} 星应用替换` : "应用替换";
    const sysTagHtml = s.systemTag
      ? `<span class="sys-tag sys-${esc(s.systemTier || "upgrade")}">${esc(s.systemTag)}</span>`
      : "";

    return (
      `<article class="plan-item${previewing ? " is-previewing" : ""}">` +
      `<div class="plan-top">` +
      `<div style="min-width:0">` +
      `<div class="plan-title">${esc(s.text || `${store.unitName(s.out)} → ${store.unitName(s.inn)}`)}${sysTagHtml}</div>` +
      (inheritNames ? `<div class="plan-sub">继承装备：${esc(inheritNames)}</div>` : "") +
      `</div>` +
      gradeBoxHtml(s) +
      `</div>` +
      `<div class="plan-units">${outHtml}<span style="color:var(--text-muted);align-self:center">→</span>${inHtml}</div>` +
      (traitsHtml ? `<div class="plan-traits">${traitsHtml}</div>` : "") +
      telemetrySubHtml(s) +
      `<div class="plan-foot">` +
      `<span class="plan-sub">${s.requiredStars > 1 ? `建议 ${s.requiredStars}★ 替换` : "当前可替换"}</span>` +
      `<div class="plan-btns">` +
      `<button type="button" class="btn sm${previewing ? " toggle-on" : ""}" data-preview-kind="swap" data-preview-index="${i}">${previewing ? "预览中" : "预览棋盘"}</button>` +
      `<button type="button" class="btn sm primary" data-apply-kind="swap" data-apply-index="${i}">${applyText}</button>` +
      `</div>` +
      `</div>` +
      `</article>`
    );
  }

  function renderNextBuysSection(ctx) {
    const { game, rec, unlockPlan } = ctx;
    const prereqs = (unlockPlan && Array.isArray(unlockPlan.prereqActions)) ? unlockPlan.prereqActions : [];
    const nextRows = (rec && Array.isArray(rec.next)) ? rec.next : [];
    if (!prereqs.length && !nextRows.length) return "";

    const prereqHtml = prereqs.map((pr) => {
      const u = unitById(game, pr.id);
      const name = u ? (u.display || u.name) : store.unitName(pr.id);
      const cost = u ? u.cost : 1;
      const isStar = pr.action === "star" || pr.onBoard;
      const btn = isStar
        ? `<button type="button" class="btn xs primary action-btn-slot" data-buy-star="${esc(pr.id)}" data-need-star="${Number(pr.needStar) || 2}">升星</button>`
        : `<button type="button" class="btn xs primary action-btn-slot" data-buy-add="${esc(pr.id)}">+ 上阵</button>`;
      return (
        `<div class="action-row is-prereq" data-ban-unit="${esc(pr.id)}">` +
        `<div class="action-who" style="--cost:${esc(costVar(cost))};--cost-solid:${esc(costHex(cost))}">` +
        `<span class="action-ava-wrap" data-tip="unit:${esc(pr.id)}">${imgHtml(u, "action-ava", name, false)}</span>` +
        `<div class="action-text">` +
        `<strong><span data-tip="unit:${esc(pr.id)}">${esc(name)}</span> <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted)">${cost}费</span><span class="prereq-tag">解锁前置</span></strong>` +
        (pr.reason ? `<span>${esc(pr.reason)}</span>` : "") +
        `</div>` +
        `</div>` +
        btn +
        `</div>`
      );
    }).join("");

    const rowsHtml = nextRows.map((row) => {
      const u = unitById(game, row.id);
      const name = u ? (u.display || u.name) : store.unitName(row.id);
      const cost = u ? u.cost : 1;
      const sysTagHtml = row.systemTag
        ? `<span class="sys-tag sys-${esc(row.systemTier || "core")}">${esc(row.systemTag)}</span>`
        : "";
      const fitHtml = (row.matchedItems || []).length ? itemFitPillsHtml(game, row.matchedItems.slice(0, 2), true) : "";
      const rs = (row.reasons || []).slice(0, 2).map(describe).filter(Boolean).join("；");
      return (
        `<div class="action-row" data-ban-unit="${esc(row.id)}">` +
        `<div class="action-who" style="--cost:${esc(costVar(cost))};--cost-solid:${esc(costHex(cost))}">` +
        `<span class="action-ava-wrap" data-tip="unit:${esc(row.id)}">${imgHtml(u, "action-ava", name, false)}</span>` +
        `<div class="action-text">` +
        `<strong><span data-tip="unit:${esc(row.id)}">${esc(name)}</span> <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted)">${cost}费</span>${sysTagHtml}${fitHtml}</strong>` +
        (rs ? `<span>${esc(rs)}</span>` : "") +
        `</div>` +
        `</div>` +
        `<button type="button" class="btn xs action-btn-slot" data-buy-add="${esc(row.id)}">+ 上阵</button>` +
        `</div>`
      );
    }).join("");

    return (
      `<section class="adv-sec">` +
      `<div class="adv-sec-head"><span>下一步购买</span></div>` +
      `<div class="action-list">${prereqHtml}${rowsHtml}</div>` +
      `</section>`
    );
  }

  function renderStarUpsSection(ctx) {
    const { game, rec, state } = ctx;
    const onBoardIds = new Set((state.board || []).map((e) => e.id));
    const rows = ((rec && Array.isArray(rec.starUps)) ? rec.starUps : []).filter((s) => s && onBoardIds.has(s.id));
    if (!rows.length) return "";
    const html = rows.map((s) => {
      const u = unitById(game, s.id);
      const name = u ? (u.display || u.name) : store.unitName(s.id);
      const cost = u ? u.cost : 1;
      const rs = (s.reasons || []).slice(0, 2).map(describe).filter(Boolean).join("；");
      return (
        `<div class="action-row" data-ban-unit="${esc(s.id)}">` +
        `<div class="action-who" style="--cost:${esc(costVar(cost))};--cost-solid:${esc(costHex(cost))}">` +
        `<span class="action-ava-wrap" data-tip="unit:${esc(s.id)}">${imgHtml(u, "action-ava", name, false)}</span>` +
        `<div class="action-text">` +
        `<strong><span data-tip="unit:${esc(s.id)}">${esc(name)}</span> <span style="font-family:var(--font-mono);color:var(--accent)">${s.from}★ → ${s.to}★</span></strong>` +
        (rs ? `<span>${esc(rs)}</span>` : "") +
        `</div>` +
        `</div>` +
        `<button type="button" class="btn xs action-btn-slot" data-star-up="${esc(s.id)}">升星</button>` +
        `</div>`
      );
    }).join("");

    return (
      `<section class="adv-sec">` +
      `<div class="adv-sec-head"><span>升星优先</span></div>` +
      `<div class="action-list">${html}</div>` +
      `</section>`
    );
  }

  function renderHoldersAndLocks(ctx) {
    const { rec } = ctx;
    if (!rec) return "";
    const holderNotes = (rec.holders && Array.isArray(rec.holders.notes)) ? rec.holders.notes : [];
    const lockNotes = Array.isArray(rec.locks) ? rec.locks : [];
    if (!holderNotes.length && !lockNotes.length) return "";

    let html = `<section class="adv-sec">`;
    if (holderNotes.length) {
      html += `<div class="adv-sec-head"><span>持有者建议</span></div>`;
      html += holderNotes.map((h) => `<div class="plan-sub"><b>${esc(describe(h.label))}</b>：${esc(describe(h.text))}</div>`).join("");
    }
    if (lockNotes.length) {
      html += `<div class="adv-sec-head" style="margin-top:4px"><span>解锁提醒</span></div>`;
      html += lockNotes.map((l) => `<div class="plan-sub">${esc(describe(l))}</div>`).join("");
    }
    html += `</section>`;
    return html;
  }

  function renderBannedBar(ctx) {
    const { state, game } = ctx;
    const ids = Object.keys(state.bannedIds || {}).filter((id) => state.bannedIds[id]);
    if (!ids.length) return "";
    const chips = ids.map((id) => {
      const u = unitById(game, id);
      const name = u ? (u.display || u.name) : store.unitName(id);
      return (
        `<button type="button" class="banned-chip" data-unban="${esc(id)}" data-tip="unit:${esc(id)}" title="点击恢复 ${esc(name)}">` +
        imgHtml(u, "", name, false) +
        `<span>${esc(name)} ×</span>` +
        `</button>`
      );
    }).join("");
    return (
      `<section class="banned-bar">` +
      `<div class="banned-chips"><span>已屏蔽</span>${chips}</div>` +
      `<button type="button" class="btn xs ghost" data-clear-bans="1">全部恢复</button>` +
      `</section>`
    );
  }

  function renderSystemBanner(ctx) {
    const { game, rec, state } = ctx;
    const sys = rec && rec.system;
    if (!sys || sys.archetype === "open") return "";
    const primaries = Array.isArray(sys.primaryTraits) ? sys.primaryTraits : [];
    if (!primaries.length && (state.board || []).length < 2) return "";
    const traitsHtml = primaries.slice(0, 3).map((pt) => {
      const tr = game.traitById && game.traitById[pt.id];
      const ico = tr ? imgHtml(tr, "trait-delta-ico", pt.name, false) : "";
      return `<span class="sys-trait" data-tip="trait:${esc(pt.id)}">${ico}<span>${esc(pt.name)}</span></span>`;
    }).join("");
    const archCls = `arch-${esc(sys.archetype || "vertical")}`;
    return (
      `<section class="system-strip" aria-label="当前识别体系">` +
      `<div class="system-strip-left">` +
      `<span class="eyebrow">识别体系</span>` +
      `<div class="system-traits">${traitsHtml || '<span class="plan-sub" style="margin:0">多羁绊协同</span>'}</div>` +
      `</div>` +
      `<span class="sys-arch-pill ${archCls}">${esc(sys.archetypeLabel || "体系优先")}</span>` +
      `</section>`
    );
  }

  function renderNormalMode(ctx) {
    const { rec } = ctx;
    let html = renderUnlockZone(ctx);
    if (!rec) {
      html += `<p class="advisor-empty">暂无分析结果。</p>`;
      return html + renderBannedBar(ctx);
    }
    if (rec.error) {
      html += `<div class="advisor-empty" style="color:var(--danger);border-color:var(--danger)">${esc(rec.error)}</div>`;
      return html + renderBannedBar(ctx);
    }
    html += renderSystemBanner(ctx);
    if (rec.warnings && rec.warnings.length) {
      html += `<div class="plan-item" style="border-color:var(--accent-border);background:var(--accent-soft)">` +
        rec.warnings.map((w) => `<div class="plan-sub" style="color:var(--text-primary);margin-top:0">${esc(describe(w))}</div>`).join("") +
        `</div>`;
    }

    const open = Math.max(0, (rec.slots && rec.slots.max ? rec.slots.max : 0) - (rec.slots && rec.slots.used ? rec.slots.used : 0));
    const planCards = (rec.plans || []).map((p, i) => renderPlanCard(ctx, p, i)).filter(Boolean).join("");
    const plansTitle = open > 0 ? "补全阵容" : "推荐方案";
    html += `<section class="adv-sec"><div class="adv-sec-head"><span>${plansTitle}</span></div>` +
      (planCards || `<p class="advisor-empty">暂无补强方案。</p>`) + `</section>`;

    const swapRows = open > 1 ? (rec.swaps || []).slice(0, 2) : (rec.swaps || []);
    const swapTitle = open > 1 ? "稍后替换" : "核心升级与替换";
    const swapNote = open > 1 && swapRows.length ? `<div class="plan-sub">人口尚未满编，先补人，以下替换可留作后续升级。</div>` : "";
    const swapCards = swapRows.map((s, i) => renderSwapCard(ctx, s, i)).filter(Boolean).join("");
    const swapsHtml = (swapCards || open <= 1)
      ? `<section class="adv-sec"><div class="adv-sec-head"><span>${swapTitle}</span></div>${swapNote}${swapCards || '<p class="advisor-empty">暂无替换建议。</p>'}</section>`
      : "";

    if (open <= 0 && swapsHtml) html += swapsHtml;
    html += renderNextBuysSection(ctx);
    html += renderStarUpsSection(ctx);
    if (open > 0 && open <= 1 && swapsHtml) html += swapsHtml;
    html += renderHoldersAndLocks(ctx);
    if (open > 1 && swapsHtml) html += swapsHtml;
    html += renderBannedBar(ctx);
    return html;
  }

  function renderLadderOnboarding(ctx) {
    const { state, game, ui } = ctx;
    if (ui.emblemPromptDismissed) return "";
    const itemById = game.itemById || {};
    const hasLooseEmblem = (state.looseItems || []).some((id) => itemById[id] && itemById[id].kind === "emblem");
    const hasWornEmblem = (state.board || []).some((e) => (e.items || []).some((id) => itemById[id] && itemById[id].kind === "emblem"));
    if (hasLooseEmblem || hasWornEmblem) return "";

    const allEmblems = (game.data && Array.isArray(game.data.items) ? game.data.items : []).filter((it) => it && it.kind === "emblem");
    if (!allEmblems.length) return "";

    const quickPicks = [];
    for (let i = 0; i < POPULAR_EMBLEM_IDS.length; i++) {
      const it = itemById[POPULAR_EMBLEM_IDS[i]];
      if (it) quickPicks.push(it);
    }
    if (!quickPicks.length) quickPicks.push(...allEmblems.slice(0, 8));

    const pillsHtml = quickPicks.map((it) =>
      `<button type="button" class="emblem-pick-pill" data-pick-emblem="${esc(it.id)}" data-tip="item:${esc(it.id)}">` +
      imgHtml(it, "", it.name, false) +
      `<span>${esc(it.name)}</span></button>`
    ).join("");

    const optsHtml = allEmblems.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join("");

    return (
      `<section class="emblem-prompt">` +
      `<div class="emblem-prompt-head">` +
      `<span class="emblem-prompt-title">选择你的初始纹章</span>` +
      `<button type="button" class="btn xs ghost" data-dismiss-emblem="1">暂不添加</button>` +
      `</div>` +
      `<p class="emblem-prompt-sub">加入开局转职纹章后，天梯追踪器会自动将其纳入最低人口羁绊路径。</p>` +
      `<div class="emblem-quick-grid">${pillsHtml}</div>` +
      `<select class="mini-select" data-onboard-emblem="1" aria-label="全部纹章"><option value="">从全部 ${allEmblems.length} 件纹章中选择…</option>${optsHtml}</select>` +
      `</section>`
    );
  }

  function renderLadderMode(ctx) {
    const { state, game, ui, rec, tracker } = ctx;
    const goal = Number(state.targetTraitCount) || 0;
    const maxLevel = Number(state.trackerMaxLevel) || 10;
    const activeTraitsCount = (rec && Array.isArray(rec.traits))
      ? rec.traits.filter((t) => t && t.best && t.kind !== "solo").length
      : 0;
    const banCount = Object.keys(state.bannedIds || {}).filter((id) => state.bannedIds[id]).length;

    const goalPills = [6, 7, 8, 9, 10].map((n) =>
      `<button type="button" class="tc-pill${goal === n ? " active" : ""}" data-ladder-goal="${n}">${n}</button>`
    ).join("");

    const maxLvlPills = [7, 8, 9, 10].map((lvl) =>
      `<button type="button" class="tc-pill${maxLevel === lvl ? " active" : ""}" data-ladder-maxlvl="${lvl}">${lvl}级</button>`
    ).join("");

    const res = tracker && tracker.res;
    const busy = tracker && (!res || !res.done);
    let statusText = "请设定目标羁绊数或在左栏锁定羁绊档位";
    let extraHtml = "";
    if (tracker && tracker.error) {
      statusText = tracker.error;
    } else if (tracker) {
      if (!res) statusText = "计算中…";
      else if (res.locked && res.locked.length) {
        statusText = "无法计算：有目标档位不可用";
        extraHtml = res.locked.map((l) => `<div class="plan-sub" style="color:var(--danger)">${esc(describe(l.label || l.trait || l))}${l.reason ? "：" + esc(l.reason) : ""}</div>`).join("");
      } else if (res.cancelled) statusText = "已取消";
      else if (!res.done && res.plans && res.plans.length) statusText = "已找到方案，仍在验证最少棋子…";
      else if (!res.done) statusText = `计算中 · 已检 ${res.visited || 0} 个组合`;
      else if (res.minimalProven && res.plans && res.plans[0]) statusText = `已证明最少 +${res.plans[0].adds.length} 张`;
      else if (res.exhausted || !(res.plans || []).length) statusText = `当前约束至 ${maxLevel} 级无解`;
      else statusText = `找到 ${res.plans.length} 个方案`;
    }

    const constraintsHtml =
      `<section class="tracker-constraints">` +
      `<div class="tc-row"><span>目标羁绊数 <small style="color:var(--text-muted)">(当前 ${activeTraitsCount} 条)</small></span><div class="tc-pills">${goalPills}</div></div>` +
      `<div class="tc-row"><span>最高等级上限</span><div class="tc-pills">${maxLvlPills}</div></div>` +
      `<div class="tc-row"><span>必上（棋盘已锁 ${(state.board || []).length}）· 排除 ${banCount}</span></div>` +
      `<div class="tc-row" style="padding-top:4px;border-top:1px solid var(--border-subtle)">` +
      `<span style="color:var(--text-primary);font-weight:600">${esc(statusText)}</span>` +
      (busy ? `<button type="button" class="btn xs" data-cancel-track="1">取消</button>` : "") +
      `</div>` +
      extraHtml +
      `</section>`;

    const plans = (res && Array.isArray(res.plans)) ? res.plans : [];
    const plansHtml = plans.map((p, i) => {
      const previewing = isPreviewActive(ui, "ladder", i);
      const addsHtml = (p.adds || []).map((a) => miniUnitHtml(game, a)).join("");
      const traitsHtml = (p.traitChanges || []).slice(0, 6).map((c) => traitDeltaHtml(game, c)).join("");
      const stepsHtml = previewing && Array.isArray(p.steps) && p.steps.length
        ? `<ol class="plan-sub" style="padding-left:16px;margin:2px 0;display:flex;flex-direction:column;gap:2px">${p.steps.map((s) => `<li>${s.level} 级：+ ${(s.adds || []).map((id) => esc(store.unitName(typeof id === "string" ? id : id.id))).join("、")}，激活 ${s.activeTraitCount} 条</li>`).join("")}</ol>`
        : "";
      return (
        `<article class="plan-item${previewing ? " is-previewing" : ""}">` +
        `<div class="plan-top">` +
        `<div>` +
        `<div class="plan-title">${esc(p.title || `最少新增 ${(p.adds || []).length} 张`)}</div>` +
        `<div class="plan-sub">${p.finishLevel} 级成型 · 激活 ${p.activeTraitCount} 条羁绊</div>` +
        `</div>` +
        `<span class="unlock-badge">${p.finishLevel} 级</span>` +
        `</div>` +
        (addsHtml ? `<div class="plan-units">${addsHtml}</div>` : "") +
        (traitsHtml ? `<div class="plan-traits">${traitsHtml}</div>` : "") +
        stepsHtml +
        `<div class="plan-foot">` +
        `<span class="plan-sub">新增 ${(p.adds || []).length} 张</span>` +
        `<div class="plan-btns">` +
        `<button type="button" class="btn sm${previewing ? " toggle-on" : ""}" data-preview-kind="ladder" data-preview-index="${i}">${previewing ? "预览中" : `预览 ${p.finishLevel} 级`}</button>` +
        `<button type="button" class="btn sm primary" data-apply-kind="ladder" data-apply-index="${i}">应用方案</button>` +
        `</div>` +
        `</div>` +
        `</article>`
      );
    }).join("");

    return (
      renderLadderOnboarding(ctx) +
      constraintsHtml +
      `<section class="adv-sec">${plansHtml || (tracker && !busy ? '<p class="advisor-empty">暂无满足约束的路线。</p>' : "")}</section>` +
      renderBannedBar(ctx)
    );
  }

  function renderReorgMode(ctx) {
    const { state, game, ui, reorg } = ctx;
    const rawTargets = state.traitTargets || {};
    const targetEntries = Object.keys(rawTargets)
      .filter((tid) => Number(rawTargets[tid]) > 0 && game.traitById && game.traitById[tid])
      .map((tid) => ({ id: tid, trait: game.traitById[tid], need: Number(rawTargets[tid]) }));

    const targetChipsHtml = targetEntries.map(({ id, trait, need }) =>
      `<button type="button" class="reorg-target-chip" data-remove-target="${esc(id)}" data-need="${need}" data-tip="trait:${esc(id)}" title="点击取消此目标">` +
      imgHtml(trait, "trait-delta-ico", trait.name, false) +
      `<span>${esc(trait.name)} ${need}</span><span aria-hidden="true">×</span></button>`
    ).join("");

    let headBox = "";
    if (targetEntries.length) {
      headBox =
        `<section class="reorg-targets">` +
        `<div class="reorg-targets-head">` +
        `<span class="eyebrow">目标羁绊 (${targetEntries.length})</span>` +
        `<button type="button" class="btn xs ghost" data-clear-targets="1">清空目标</button>` +
        `</div>` +
        `<div class="reorg-target-chips">${targetChipsHtml}</div>` +
        `</section>`;
    }

    if (!reorg || reorg.status === "no-targets") {
      const quick = (reorg && reorg.quickSuggestions) || [];
      const quickHtml = quick.length
        ? `<div class="reorg-quick">` +
          `<div class="plan-sub" style="margin-top:0">或直接按当前棋盘一键设为目标：</div>` +
          `<div class="reorg-target-chips">` +
          quick.map((q) => {
            const tr = game.traitById && game.traitById[q.id];
            return `<button type="button" class="emblem-pick-pill" data-quick-target="${esc(q.id)}" data-need="${q.need}">` +
              (tr ? imgHtml(tr, "", tr.name, false) : "") +
              `<span>${esc(q.name)} ${q.need}</span></button>`;
          }).join("") +
          `</div></div>`
        : "";
      return (
        `<section class="reorg-targets">` +
        `<div class="emblem-prompt-title">按目标羁绊整理当前阵容</div>` +
        `<p class="emblem-prompt-sub">在左侧羁绊栏点击想要达成的档位（例如「离子火花 7」「护卫 2」），整理器会尽量保留高星与带装备核心，给出最少换人的调整方案。</p>` +
        quickHtml +
        `</section>` +
        renderBannedBar(ctx)
      );
    }

    if (reorg.status === "blocked") {
      const items = (reorg.blockedTargets || []).map((b) =>
        `<div class="reorg-banner is-warn">` +
        `<span><b>${esc(b.name)} ${b.need}</b>：${esc(b.reason)}</span>` +
        (b.reason.includes("棱彩")
          ? `<button type="button" class="btn xs primary" data-enable-prism="${esc(b.id)}">开启棱彩</button>`
          : "") +
        `</div>`
      ).join("");
      return headBox + items + renderBannedBar(ctx);
    }

    if (reorg.status === "already-met") {
      return (
        headBox +
        `<div class="reorg-banner is-good">` +
        `<span>当前棋盘（${reorg.used} / ${reorg.cap} 人口）已达成全部目标羁绊，无需换人！</span>` +
        `</div>` +
        renderBannedBar(ctx)
      );
    }

    const levelBanner = reorg.status === "need-level"
      ? `<div class="reorg-banner is-warn"><span>当前 <b>${reorg.level} 级（${reorg.cap} 人口）</b>无法同时达成所选目标，升至 <b>${reorg.minLevel} 级</b> 后可行：</span></div>`
      : "";

    const plans = reorg.plans || [];
    if (!plans.length) {
      return (
        headBox +
        `<p class="advisor-empty">当前等级与禁用/解锁约束下暂无可行调整，可尝试减少目标羁绊、开启棱彩、或提高等级。</p>` +
        renderBannedBar(ctx)
      );
    }

    const cardsHtml = plans.map((p, i) => {
      const previewing = isPreviewActive(ui, "reorg", i);
      const remHtml = (p.removes || []).map((id) => {
        const cur = (state.board || []).find((e) => e.id === id);
        return miniUnitHtml(game, id, { out: true, star: cur ? cur.star : 1 });
      }).join("");
      const addHtml = (p.adds || []).map((a) => miniUnitHtml(game, a)).join("");
      const diffHtml =
        `<div class="reorg-diff">` +
        (remHtml ? `<div class="reorg-diff-row"><span class="reorg-diff-label out">换下</span><div class="plan-units">${remHtml}</div></div>` : "") +
        (addHtml ? `<div class="reorg-diff-row"><span class="reorg-diff-label in">换上</span><div class="plan-units">${addHtml}</div></div>` : "") +
        `</div>`;

      const xferNames = uniqueStrings((p.itemTransfers || []).flatMap((tr) => tr.items || [])).map((id) => store.itemName(id));
      const xferHtml = xferNames.length
        ? `<div class="plan-sub">装备继承：${esc(xferNames.join("、"))}</div>`
        : "";
      const keptHtml = p.keptCount > 0
        ? `<div class="plan-sub">保留 ${p.keptCount} 张现有棋子${p.keptCoreNames && p.keptCoreNames.length ? "（含 " + esc(p.keptCoreNames.join("、")) + "）" : ""} · 核心保留率 ${p.keepPct}%</div>`
        : "";
      const traitsHtml = (p.traitChanges || []).slice(0, 6).map((c) => traitDeltaHtml(game, c)).join("");

      return (
        `<article class="plan-item${previewing ? " is-previewing" : ""}">` +
        `<div class="plan-top">` +
        `<div style="min-width:0">` +
        `<div class="plan-title">${esc(p.title)}</div>` +
        `<div class="plan-sub">人口 ${p.slots} / ${p.cap} · 激活 ${p.activeTraits} 条羁绊</div>` +
        `</div>` +
        `<span class="unlock-badge">保留 ${p.keepPct}%</span>` +
        `</div>` +
        diffHtml +
        (traitsHtml ? `<div class="plan-traits">${traitsHtml}</div>` : "") +
        xferHtml +
        keptHtml +
        `<div class="plan-foot">` +
        `<span class="plan-sub">等级 ${p.requiredLevel}</span>` +
        `<div class="plan-btns">` +
        `<button type="button" class="btn sm${previewing ? " toggle-on" : ""}" data-preview-kind="reorg" data-preview-index="${i}">${previewing ? "预览中" : "预览棋盘"}</button>` +
        `<button type="button" class="btn sm primary" data-apply-kind="reorg" data-apply-index="${i}">一键应用</button>` +
        `</div>` +
        `</div>` +
        `</article>`
      );
    }).join("");

    return headBox + levelBanner + `<section class="adv-sec">${cardsHtml}</section>` + renderBannedBar(ctx);
  }

  function computeRenderKey(ctx) {
    const { state, ui, rec, reorg, tracker, unlockPlan, unlockTracker } = ctx;
    const p = getActivePreview(ui);
    const previewKey = p ? `${p.kind}:${p.index}` : String(ui.preview ?? "");
    const bansKey = Object.keys(state.bannedIds || {}).filter((k) => state.bannedIds[k]).sort().join(",");
    const targetsKey = Object.keys(state.traitTargets || {}).sort().map((k) => `${k}:${state.traitTargets[k]}`).join(",");
    const tr = tracker && tracker.res;
    const utr = unlockTracker && unlockTracker.res;
    return [
      state.viewMode || "normal",
      state.unlockTargetId || "",
      bansKey,
      targetsKey,
      previewKey,
      ui.emblemPromptDismissed ? 1 : 0,
      state.targetTraitCount || 0,
      state.trackerMaxLevel || 10,
      (state.board || []).length,
      (state.looseItems || []).length,
      state.level || 8,
      state.extraSlots || 0,
      rec === null ? "null" : `${rec.slots?.used}/${rec.slots?.max}:${(rec.plans || []).length}:${(rec.swaps || []).length}:${(rec.next || []).length}:${(rec.starUps || []).length}:${(rec.warnings || []).length}:${rec.system?.archetype || ""}:${(rec.system?.primaryIds || []).join(",")}`,
      reorg === null ? "null" : `${reorg.status}:${reorg.minLevel || ""}:${(reorg.plans || []).length}`,
      tr ? `${tr.done}:${tr.visited}:${tr.cancelled}:${(tr.plans || []).length}` : (tracker ? tracker.error || "init" : "none"),
      utr ? `${utr.done}:${utr.visited}:${utr.cancelled}:${(utr.plans || []).length}` : (unlockTracker ? unlockTracker.error || "init" : "none"),
      unlockPlan ? `${unlockPlan.active}:${unlockPlan.alreadyOnBoard}:${unlockPlan.needsMiniTrack}:${(unlockPlan.prereqActions || []).length}` : "none"
    ].join("|");
  }

  function renderAll(ctx) {
    const { state, game, reorg } = ctx;
    if (titleEl) {
      titleEl.textContent = state.viewMode === "ladder" ? "羁绊天梯"
        : state.viewMode === "reorg" ? "阵容整理"
          : "策略建议";
    }
    if (subEl) {
      if (state.viewMode === "ladder") {
        const goalTxt = state.targetTraitCount ? `目标 ${state.targetTraitCount} 条` : "目标 自动";
        subEl.textContent = `${goalTxt} · 上限 ${state.trackerMaxLevel || 10} 级`;
      } else if (state.viewMode === "reorg") {
        const tCnt = Object.keys(state.traitTargets || {}).filter((k) => Number(state.traitTargets[k]) > 0).length;
        const cap = reorg && reorg.cap ? reorg.cap : (game && typeof game.capacity === "function" ? game.capacity(state.board || [], store.getContext()) : state.level || 8);
        subEl.textContent = tCnt ? `目标 ${tCnt} 项 · 人口上限 ${cap}` : "请在左栏点击目标羁绊";
      } else {
        subEl.textContent = "右键推荐棋子可禁用";
      }
    }
    if (bodyEl) {
      bodyEl.innerHTML = state.viewMode === "ladder" ? renderLadderMode(ctx)
        : state.viewMode === "reorg" ? renderReorgMode(ctx)
          : renderNormalMode(ctx);
      syncPendingBans();
    }
  }

  function applyActionByKind(ctx, kind, index) {
    const { rec, reorg, tracker, unlockPlan, unlockTracker } = ctx;
    let plan = null;
    if (kind === "plan") plan = rec && rec.plans && rec.plans[index];
    else if (kind === "swap") plan = rec && rec.swaps && rec.swaps[index];
    else if (kind === "reorg") plan = reorg && reorg.plans && reorg.plans[index];
    else if (kind === "ladder") plan = tracker && tracker.res && tracker.res.plans && tracker.res.plans[index];
    else if (kind === "unlock-route") {
      const ut = unlockTracker || (unlockPlan && unlockPlan.tracker);
      plan = (ut && ut.res && ut.res.plans && ut.res.plans[index]) || (unlockPlan && unlockPlan.routePlans && unlockPlan.routePlans[index]) || null;
    }
    if (plan) store.applyPlan(plan);
  }

  if (bodyEl) {
    bodyEl.addEventListener("contextmenu", (e) => {
      const banEl = e.target.closest && e.target.closest("[data-ban-unit]");
      if (!banEl) return;
      e.preventDefault();
      e.stopPropagation();
      const uid = banEl.getAttribute("data-ban-unit");
      if (uid) {
        store.startBan(uid);
        syncPendingBans();
      }
    });

    bodyEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      let el;
      if ((el = t.closest("[data-cancel-ban]"))) {
        e.preventDefault();
        e.stopPropagation();
        store.cancelBan(el.getAttribute("data-cancel-ban"));
        syncPendingBans();
        return;
      }
      if ((el = t.closest(".mini-unit.is-banning"))) {
        e.preventDefault();
        e.stopPropagation();
        store.cancelBan(el.getAttribute("data-ban-unit"));
        syncPendingBans();
        return;
      }
      if ((el = t.closest("[data-unban]"))) {
        store.unbanUnit(el.getAttribute("data-unban"));
        return;
      }
      if (t.closest("[data-clear-bans]")) {
        store.clearBans();
        return;
      }
      if (t.closest("[data-unlock-clear]")) {
        store.setUnlockTarget(null);
        return;
      }
      if ((el = t.closest("[data-buy-add]"))) {
        store.addFirstFree(el.getAttribute("data-buy-add"));
        return;
      }
      if ((el = t.closest("[data-buy-star]"))) {
        const id = el.getAttribute("data-buy-star");
        const need = Number(el.getAttribute("data-need-star")) || 2;
        store.act({ type: "set-star", id, star: need });
        return;
      }
      if ((el = t.closest("[data-star-up]"))) {
        store.act({ type: "star-up", id: el.getAttribute("data-star-up") });
        return;
      }
      if ((el = t.closest("[data-preview-kind]"))) {
        const kind = el.getAttribute("data-preview-kind");
        const index = Number(el.getAttribute("data-preview-index")) || 0;
        store.togglePreview({ kind, index });
        return;
      }
      if ((el = t.closest("[data-apply-kind]"))) {
        const kind = el.getAttribute("data-apply-kind");
        const index = Number(el.getAttribute("data-apply-index")) || 0;
        applyActionByKind(getContext(), kind, index);
        return;
      }
      if (t.closest("[data-cancel-track]")) {
        store.cancelTracker();
        return;
      }
      if (t.closest("[data-dismiss-emblem]")) {
        store.dismissEmblemPrompt();
        return;
      }
      if ((el = t.closest("[data-pick-emblem]"))) {
        store.addLooseItem(el.getAttribute("data-pick-emblem"));
        return;
      }
      if ((el = t.closest("[data-ladder-goal]"))) {
        const goal = Number(el.getAttribute("data-ladder-goal")) || 0;
        const cur = Number((store.getState() || {}).targetTraitCount) || 0;
        store.setSettings({ targetTraitCount: cur === goal ? 0 : goal });
        return;
      }
      if ((el = t.closest("[data-ladder-maxlvl]"))) {
        store.setSettings({ trackerMaxLevel: Number(el.getAttribute("data-ladder-maxlvl")) || 10 });
        return;
      }
      if ((el = t.closest("[data-remove-target]"))) {
        store.toggleTraitTarget(el.getAttribute("data-remove-target"), Number(el.getAttribute("data-need")) || 0);
        return;
      }
      if ((el = t.closest("[data-quick-target]"))) {
        store.toggleTraitTarget(el.getAttribute("data-quick-target"), Number(el.getAttribute("data-need")) || 0);
        return;
      }
      if (t.closest("[data-clear-targets]")) {
        store.clearTraitTargets();
        return;
      }
      if ((el = t.closest("[data-enable-prism]"))) {
        store.togglePrismatic(el.getAttribute("data-enable-prism"));
      }
    });

    bodyEl.addEventListener("change", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.hasAttribute("data-unlock-select")) {
        store.setUnlockTarget(t.value || null);
        return;
      }
      if (t.hasAttribute("data-onboard-emblem")) {
        const val = t.value;
        if (val) {
          t.value = "";
          store.addLooseItem(val);
        }
      }
    });
  }

  return {
    update(dirtyMask) {
      if ((dirtyMask & DIRTY_RECS) === 0) {
        syncPendingBans();
        return;
      }
      const ctx = getContext();
      const key = computeRenderKey(ctx);
      const trRes = ctx.tracker ? ctx.tracker.res : null;
      const utRes = ctx.unlockTracker ? ctx.unlockTracker.res : null;
      const refsSame =
        ctx.rec === lastRecRef &&
        ctx.reorg === lastReorgRef &&
        trRes === lastTrackerResRef &&
        utRes === lastUnlockResRef &&
        ctx.unlockPlan === lastUnlockCtxRef;

      if (key === lastRenderKey && refsSame) {
        syncPendingBans();
        return;
      }
      lastRenderKey = key;
      lastRecRef = ctx.rec;
      lastReorgRef = ctx.reorg;
      lastTrackerResRef = trRes;
      lastUnlockResRef = utRes;
      lastUnlockCtxRef = ctx.unlockPlan;
      renderAll(ctx);
    }
  };
}
