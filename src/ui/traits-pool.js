import { DIRTY_TRAITS, DIRTY_ALL } from "../state/store.js";

function $(id) {
  return document.getElementById(id);
}

function effectiveStyle(bp, traitId, prisMap) {
  if (prisMap && prisMap[traitId] && bp.prismaticStyle) return bp.prismaticStyle;
  return bp.style || 0;
}

function bestTierOf(trait, count, prisMap) {
  let bestNeed = 0;
  let bestStyle = 0;
  const bps = trait.breakpoints || [];
  for (let i = 0; i < bps.length; i++) {
    const bp = bps[i];
    const s = effectiveStyle(bp, trait.id, prisMap);
    if (s > 0 && count >= bp.need && bp.need >= bestNeed) {
      bestNeed = bp.need;
      bestStyle = s;
    }
  }
  return { need: bestNeed, style: bestStyle };
}

function tierLabelOf(style) {
  if (style >= 5) return "棱彩";
  if (style === 1) return "铜";
  if (style === 2) return "银";
  if (style === 3) return "金";
  if (style === 4) return "彩";
  return "未激活";
}

export function mountTraitsPool(store) {
  const activeCountEl = $("active-trait-count");
  const btnGoalDec = $("btn-goal-dec");
  const valGoalEl = $("val-goal");
  const btnGoalInc = $("btn-goal-inc");
  const listEl = $("traits-list");
  const targetBarEl = $("traits-target-bar");

  const rowPool = new Map();
  let emptyNoteEl = null;
  let lastOrderKey = "";
  let lastSetVersion = -1;
  let lastGoalKey = "";
  let lastTargetBarKey = "";

  if (targetBarEl) {
    targetBarEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-open-reorg]")) {
        store.setPlaystyle("reorg");
        return;
      }
      if (t.closest("[data-clear-targets]")) {
        store.clearTraitTargets();
      }
    });
  }

  if (btnGoalDec) {
    btnGoalDec.addEventListener("click", () => {
      const cur = store.getState().targetTraitCount || 0;
      if (cur > 0) store.setSettings({ targetTraitCount: cur - 1 });
    });
  }

  if (btnGoalInc) {
    btnGoalInc.addEventListener("click", () => {
      const game = store.getGame();
      const maxTraits = game && game.data && game.data.traits ? game.data.traits.length : 47;
      const cur = store.getState().targetTraitCount || 0;
      if (cur < maxTraits) store.setSettings({ targetTraitCount: cur + 1 });
    });
  }

  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      const bpBtn = target.closest("[data-trait][data-need]");
      if (bpBtn) {
        if (bpBtn.disabled) return;
        store.toggleTraitTarget(bpBtn.dataset.trait, Number(bpBtn.dataset.need));
        return;
      }

      const prismBtn = target.closest("[data-prism-trait]");
      if (prismBtn) {
        store.togglePrismatic(prismBtn.dataset.prismTrait);
        return;
      }

      const pinTrigger = target.closest("[data-trait-pin]");
      if (pinTrigger) {
        listEl.dispatchEvent(new CustomEvent("tft:pin-trait", {
          bubbles: true,
          detail: { traitId: pinTrigger.dataset.traitPin, el: pinTrigger }
        }));
      }
    });
  }

  function createTraitRow(trait) {
    const row = document.createElement("div");
    row.className = "trait-row inactive";
    row.dataset.traitRow = trait.id;

    // Hexagonal TFT metal medallion
    const hexEl = document.createElement("div");
    hexEl.className = "trait-hex";
    hexEl.dataset.traitPin = trait.id;
    hexEl.dataset.tip = "trait:" + trait.id;
    hexEl.title = trait.name + "（点击固定详情）";

    const src = store.srcList(trait);
    if (src.length) {
      const img = document.createElement("img");
      img.src = src[0];
      img.alt = trait.name;
      img.dataset.alt = src[1] || "";
      img.loading = "lazy";
      hexEl.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "ph ph-sm";
      ph.textContent = trait.name.slice(0, 2);
      hexEl.appendChild(ph);
    }

    const topEl = document.createElement("div");
    topEl.className = "trait-top";

    const titleWrap = document.createElement("span");
    titleWrap.className = "trait-title-wrap";

    const nameEl = document.createElement("span");
    nameEl.className = "trait-name";
    nameEl.textContent = trait.name;
    nameEl.dataset.traitPin = trait.id;
    nameEl.dataset.tip = "trait:" + trait.id;
    titleWrap.appendChild(nameEl);

    const hasPrismatic = !!trait.prismatic || (trait.breakpoints || []).some((b) => b.prismaticStyle >= 5);
    let prismBtn = null;
    if (hasPrismatic) {
      prismBtn = document.createElement("button");
      prismBtn.type = "button";
      prismBtn.className = "prism-toggle";
      prismBtn.dataset.prismTrait = trait.id;
      prismBtn.textContent = "棱彩";
      prismBtn.title = "需海克斯解锁棱彩，点击开关";
      prismBtn.setAttribute("aria-pressed", "false");
      titleWrap.appendChild(prismBtn);
    }

    const countEl = document.createElement("span");
    countEl.className = "trait-cnt";
    countEl.textContent = "0";

    topEl.appendChild(titleWrap);
    topEl.appendChild(countEl);

    const bpsEl = document.createElement("div");
    bpsEl.className = "trait-bps";

    const bpRefs = (trait.breakpoints || []).map((bp) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bp";
      btn.dataset.trait = trait.id;
      btn.dataset.need = String(bp.need);
      btn.textContent = String(bp.need);
      btn.setAttribute("aria-pressed", "false");
      bpsEl.appendChild(btn);
      return { bp, btn };
    });

    row.appendChild(hexEl);
    row.appendChild(topEl);
    row.appendChild(bpsEl);

    return {
      trait,
      row,
      hexEl,
      countEl,
      bpRefs,
      prismBtn,
      prevSnap: ""
    };
  }

  function rebuildForSet() {
    const game = store.getGame();
    if (!listEl || !game) return;

    rowPool.clear();
    listEl.textContent = "";
    lastOrderKey = "";
    lastGoalKey = "";
    lastSetVersion = store.getUI().setVersion;

    emptyNoteEl = document.createElement("p");
    emptyNoteEl.className = "advisor-empty";
    emptyNoteEl.style.margin = "8px 2px";
    emptyNoteEl.textContent = "摆上棋子或添加纹章后显示羁绊";
    listEl.appendChild(emptyNoteEl);

    (game.data.traits || []).forEach((trait) => {
      rowPool.set(trait.id, createTraitRow(trait));
    });
  }

  function renderGoalAndCount(activeCount) {
    const game = store.getGame();
    const state = store.getState();
    const maxTraits = game && game.data && game.data.traits ? game.data.traits.length : 47;
    const goal = state.targetTraitCount || 0;
    const key = activeCount + "|" + goal + "|" + maxTraits;
    if (key === lastGoalKey) return;
    lastGoalKey = key;

    if (activeCountEl) activeCountEl.textContent = activeCount + " 激活";
    if (valGoalEl) valGoalEl.textContent = String(goal);
    if (btnGoalDec) btnGoalDec.disabled = goal <= 0;
    if (btnGoalInc) btnGoalInc.disabled = goal >= maxTraits;
  }

  function updateRow(ref, n, best, target, prisMap) {
    const prisOn = !!(prisMap && prisMap[ref.trait.id]);
    const snap = n + "|" + best.need + "|" + best.style + "|" + (target || 0) + "|" + (prisOn ? 1 : 0);
    if (snap === ref.prevSnap) return;
    ref.prevSnap = snap;

    const active = best.need > 0;
    ref.row.classList.toggle("is-active", active);
    ref.row.classList.toggle("inactive", !active);
    ref.row.classList.toggle("has-target", target > 0);

    // Update hexagonal tier medallion color
    let hexCls = "trait-hex";
    if (best.style >= 5) hexCls += " tier-5";
    else if (best.style === 4) hexCls += " tier-4";
    else if (best.style === 3) hexCls += " tier-3";
    else if (best.style === 2) hexCls += " tier-2";
    else if (best.style === 1) hexCls += " tier-1";
    ref.hexEl.className = hexCls;

    ref.countEl.textContent = String(n);

    for (let i = 0; i < ref.bpRefs.length; i++) {
      const { bp, btn } = ref.bpRefs[i];
      const style = effectiveStyle(bp, ref.trait.id, prisMap);
      const isPrisOnly = !bp.style && bp.prismaticStyle >= 5;
      const isDisabledPris = isPrisOnly && !prisOn;
      const styleIdx = style >= 5 ? 5 : style;
      const reached = style > 0 && n >= bp.need && best.need >= bp.need;
      const isTarget = target === bp.need;

      let cls = "bp";
      if (isDisabledPris) {
        cls += " s5 disabled";
      } else {
        if (styleIdx > 0) cls += " s" + styleIdx;
        cls += reached ? " on" : " unmet";
      }
      if (isTarget) cls += " target";

      btn.className = cls;
      btn.disabled = isDisabledPris;
      btn.setAttribute("aria-pressed", String(isTarget));
      const label = isDisabledPris
        ? ref.trait.name + " " + bp.need + " 棱彩未开启"
        : ref.trait.name + " " + bp.need + " " + tierLabelOf(style) + (isTarget ? "（目标）" : "");
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }

    if (ref.prismBtn) {
      ref.prismBtn.classList.toggle("on", prisOn);
      ref.prismBtn.setAttribute("aria-pressed", String(prisOn));
      ref.prismBtn.title = prisOn ? "棱彩已开启（点击关闭）" : "需海克斯解锁棱彩（点击开启）";
    }
  }

  function renderTraits() {
    const game = store.getGame();
    const state = store.getState();
    if (!listEl || !game) return;

    if (store.getUI().setVersion !== lastSetVersion) {
      rebuildForSet();
    }

    const counts = store.traitCounts();
    const prisMap = state.prismatic || {};
    const targets = state.traitTargets || {};
    const visible = [];
    let activeCount = 0;

    (game.data.traits || []).forEach((t, idx) => {
      const n = counts[t.id] || 0;
      const target = targets[t.id] || 0;
      const prisOn = !!prisMap[t.id];
      if (!n && !target && !prisOn) return;
      const best = bestTierOf(t, n, prisMap);
      if (best.need > 0 && t.kind !== "solo") activeCount++;
      visible.push({ t, n, target, best, idx });
    });

    visible.sort((a, b) => {
      const aa = a.best.need > 0 || a.target ? 0 : 1;
      const bb = b.best.need > 0 || b.target ? 0 : 1;
      return aa - bb || b.best.style - a.best.style || b.n - a.n || a.idx - b.idx;
    });

    renderGoalAndCount(activeCount);

    const orderKey = visible.map((v) => v.t.id).join("|");
    if (emptyNoteEl) emptyNoteEl.hidden = visible.length > 0;

    if (orderKey !== lastOrderKey) {
      lastOrderKey = orderKey;
      const visibleSet = new Set(visible.map((v) => v.t.id));
      rowPool.forEach((ref, tid) => {
        if (!visibleSet.has(tid) && ref.row.parentNode === listEl) {
          listEl.removeChild(ref.row);
        }
      });
      let cursor = emptyNoteEl ? emptyNoteEl.nextSibling : listEl.firstChild;
      for (let i = 0; i < visible.length; i++) {
        const ref = rowPool.get(visible[i].t.id);
        if (!ref) continue;
        if (cursor !== ref.row) {
          listEl.insertBefore(ref.row, cursor || null);
        } else {
          cursor = cursor.nextSibling;
        }
      }
    }

    for (let i = 0; i < visible.length; i++) {
      const v = visible[i];
      const ref = rowPool.get(v.t.id);
      if (ref) updateRow(ref, v.n, v.best, v.target, prisMap);
    }

    if (targetBarEl) {
      const targetIds = Object.keys(targets).filter((k) => Number(targets[k]) > 0);
      const inReorg = state.viewMode === "reorg";
      const barKey = targetIds.length + "|" + (inReorg ? 1 : 0);
      if (barKey !== lastTargetBarKey) {
        lastTargetBarKey = barKey;
        if (!targetIds.length) {
          targetBarEl.hidden = true;
          targetBarEl.textContent = "";
        } else {
          targetBarEl.hidden = false;
          targetBarEl.innerHTML =
            '<span class="ttb-label">目标羁绊 <b>' + targetIds.length + "</b> 项</span>" +
            '<div class="ttb-actions">' +
            (inReorg
              ? '<span class="ttb-active">整理中</span>'
              : '<button type="button" class="btn xs primary" data-open-reorg="1">整理阵容</button>') +
            '<button type="button" class="btn xs ghost" data-clear-targets="1" title="清空目标羁绊">清空</button>' +
            "</div>";
        }
      }
    }
  }

  function update(dirtyMask) {
    if (dirtyMask & (DIRTY_TRAITS | DIRTY_ALL)) {
      renderTraits();
    }
  }

  return { update, rebuildForSet };
}
