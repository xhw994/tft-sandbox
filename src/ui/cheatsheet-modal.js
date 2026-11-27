/**
 * Set 19 Cheat Sheet / Trait Loot & Reference Tables Modal ("速查表").
 * Covers: True Damage Bling Cashouts, Hyperpop Hype Milestones, 8-Bit High Scores,
 * Other Traits (Ionic Spark / Gu Feng / Illbeats / Heartsteel / Collab Orbs),
 * 32 Unlockable Quests (live from game.data.units), 25 Opening Encounters, and Shop Odds / Pool / XP.
 */
import { aliasesForUnit } from "../logic/search-aliases.js";

const TABS = [
  ["trueDamage", "真实伤害"],
  ["hyperpop", "高能流行"],
  ["eightBit", "8比特·女枪"],
  ["otherTraits", "其他羁绊"],
  ["unlocks", "解锁任务"],
  ["encounters", "开局奇遇"],
  ["economy", "概率与卡池"]
];

function tierClass(tier) {
  if (tier === "彩") return "cs-tier-prism";
  if (tier === "金") return "cs-tier-gold";
  if (tier === "银") return "cs-tier-silver";
  if (tier === "铜") return "cs-tier-bronze";
  return "cs-tier-base";
}

export function mountCheatsheetModal(store, hooks) {
  const modalEl = document.getElementById("cheatsheet-modal");
  const openBtn = document.getElementById("btn-cheatsheet-open");
  if (!modalEl) return { open() {}, close() {} };

  let activeTab = "trueDamage";
  let query = "";
  let unlockCost = 0;

  const esc = (s) => store.esc(s);

  function getTables() {
    const sd = typeof window !== "undefined" ? window.SEASON_DATA : null;
    return (sd && sd.tables) || null;
  }

  function matchQ(str) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return String(str || "").toLowerCase().includes(q);
  }

  function renderTrueDamage(td) {
    if (!td) return `<p class="advisor-empty">暂无真实伤害数据。</p>`;
    const sidesHtml = (td.sides || []).map((s) =>
      `<div class="cs-rule-card is-${esc(s.accent || "good")}">` +
      `<strong>${esc(s.side)}</strong>` +
      `<p>${esc(s.rule)}</p>` +
      `<ul>${(s.tiers || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` +
      `</div>`
    ).join("");

    const rows = (td.cashouts || []).filter((c) =>
      matchQ(`${c.bling} ${c.value} ${c.tier} ${(c.drops || []).map((d) => d.reward).join(" ")}`)
    );

    const cardsHtml = rows.map((c) =>
      `<article class="cs-loot-card">` +
      `<div class="cs-loot-head">` +
      `<div class="cs-loot-key"><span class="cs-tier-dot ${tierClass(c.tier)}">${esc(c.tier)}</span><strong>${c.bling} 珠光贵气</strong></div>` +
      `<span class="cs-val-pill">${esc(c.value)}</span>` +
      `</div>` +
      `<div class="cs-drops">${(c.drops || []).map((d) =>
        `<div class="cs-drop-row"><span class="cs-pct">${esc(d.pct)}</span><span class="cs-reward">${esc(d.reward)}</span></div>`
      ).join("")}</div>` +
      `</article>`
    ).join("");

    return (
      `<p class="cs-summary">${esc(td.summary)}</p>` +
      `<div class="cs-rule-grid">${sidesHtml}</div>` +
      `<div class="cs-loot-grid">${cardsHtml || '<p class="advisor-empty">无匹配奖励档位</p>'}</div>`
    );
  }

  function renderHyperpop(hp) {
    if (!hp) return `<p class="advisor-empty">暂无高能流行数据。</p>`;
    const formulaHtml =
      `<div class="cs-card-block">` +
      `<div class="cs-block-head"><strong>星级 × 羁绊热度倍率表</strong><span>每参与击杀额外 +1 基础热度</span></div>` +
      `<div class="cs-pills-line">${(hp.multipliers || []).map((m) => `<span class="sc-trait">${esc(m)}</span>`).join("")}</div>` +
      `<table class="cs-table"><thead><tr><th>星级</th><th>(2) ×1</th><th>(3) ×1.5</th><th>(4) ×2.5</th><th>(5) ×3</th></tr></thead><tbody>` +
      (hp.formulaRows || []).map((r) =>
        `<tr><td><b>${esc(r.star)}</b></td><td>${r.t2}</td><td>${r.t3}</td><td>${r.t4}</td><td class="cs-hi">${r.t5}</td></tr>`
      ).join("") +
      `</tbody></table></div>`;

    const rows = (hp.milestones || []).filter((m) => matchQ(`${m.hype} ${m.reward} ${m.tier}`));
    const tableHtml =
      `<div class="cs-card-block">` +
      `<div class="cs-block-head"><strong>全 19 档热度里程碑奖励</strong><span>达到即领，可全部拿满</span></div>` +
      `<table class="cs-table cs-milestone-table"><thead><tr><th>档位</th><th>所需热度</th><th>解锁奖励</th></tr></thead><tbody>` +
      rows.map((m) =>
        `<tr><td><span class="cs-tier-dot ${tierClass(m.tier)}">${esc(m.tier)}</span></td><td class="cs-mono"><b>${m.hype.toLocaleString()}</b></td><td>${esc(m.reward)}</td></tr>`
      ).join("") +
      `</tbody></table></div>`;

    return `<p class="cs-summary">${esc(hp.summary)}</p>${formulaHtml}${tableHtml}`;
  }

  function renderEightBit(eb) {
    if (!eb) return `<p class="advisor-empty">暂无 8 比特数据。</p>`;
    const rows = (eb.milestones || []).filter((m) => matchQ(`${m.score} ${m.reward} ${m.tier}`));
    return (
      `<p class="cs-summary">${esc(eb.summary)}</p>` +
      `<div class="cs-card-block">` +
      `<div class="cs-block-head"><strong>8 比特高分榜奖励（厄运小姐 ×3 伤害计分）</strong><span>需厄运小姐在场才会累计分数</span></div>` +
      `<table class="cs-table cs-milestone-table"><thead><tr><th>档位</th><th>目标总伤害分</th><th>达成奖励</th></tr></thead><tbody>` +
      rows.map((m) =>
        `<tr><td><span class="cs-tier-dot ${tierClass(m.tier)}">${esc(m.tier)}</span></td><td class="cs-mono"><b>${esc(m.score)}</b></td><td>${esc(m.reward)}</td></tr>`
      ).join("") +
      `</tbody></table></div>`
    );
  }

  function renderOtherTraits(ot) {
    if (!ot) return `<p class="advisor-empty">暂无羁绊机制数据。</p>`;
    const blocks = [];

    if (ot.ionicSpark && matchQ(`离子火花 ${ot.ionicSpark.summary} ${(ot.ionicSpark.charms || []).map((c) => c.name + c.effect).join(" ")}`)) {
      blocks.push(
        `<section class="cs-card-block">` +
        `<div class="cs-block-head"><strong>${esc(ot.ionicSpark.title)}</strong></div>` +
        `<p class="cs-sub-desc">${esc(ot.ionicSpark.summary)}</p>` +
        `<div class="cs-mini-grid">${(ot.ionicSpark.charms || []).map((c) =>
          `<div class="cs-mini-item"><span class="cs-pct">${esc(c.pct)}</span><b>${esc(c.name)}</b><em>${esc(c.effect)}</em></div>`
        ).join("")}</div></section>`
      );
    }

    if (ot.guFeng && matchQ(`国风 卷轴 11级 ${ot.guFeng.summary} ${(ot.guFeng.scrolls || []).map((s) => s.name + s.effect).join(" ")}`)) {
      blocks.push(
        `<section class="cs-card-block">` +
        `<div class="cs-block-head"><strong>${esc(ot.guFeng.title)}</strong></div>` +
        `<p class="cs-sub-desc">${esc(ot.guFeng.summary)}</p>` +
        `<div class="cs-rule-grid">${(ot.guFeng.scrolls || []).map((s, idx) =>
          `<div class="cs-rule-card is-${idx === 0 ? "good" : "warn"}"><strong>${esc(s.name)}</strong><p>${esc(s.effect)}</p></div>`
        ).join("")}</div></section>`
      );
    }

    if (ot.illbeats && matchQ(`大触打击乐 分贝 混音 金币 ${ot.illbeats.summary}`)) {
      blocks.push(
        `<section class="cs-card-block">` +
        `<div class="cs-block-head"><strong>${esc(ot.illbeats.title)}</strong><span>括号后为 (4) 大触 1.65× 强化数值</span></div>` +
        `<p class="cs-sub-desc">${esc(ot.illbeats.summary)}</p>` +
        `<table class="cs-table"><thead><tr><th>分贝</th><th>生命值 (2-3 / 4)</th><th>攻击力 (2-3 / 4)</th><th>法术强度 (2-3 / 4)</th><th>击杀掉钱率 (2-3 / 4)</th></tr></thead><tbody>` +
        (ot.illbeats.dbRows || []).map((r) =>
          `<tr><td class="cs-mono"><b>${r.db} dB</b></td><td class="cs-mono">${esc(r.hp)}</td><td class="cs-mono">${esc(r.ad)}</td><td class="cs-mono">${esc(r.ap)}</td><td class="cs-mono cs-hi">${esc(r.goldPct)}</td></tr>`
        ).join("") +
        `</tbody></table>` +
        `<div class="cs-pills-line" style="margin-top:8px"><span class="drawer-hint">击杀每次掉钱：</span>` +
        (ot.illbeats.goldByStage || []).map((g) => `<span class="sc-trait">${esc(g.stage)} ${esc(g.gold)}</span>`).join("") +
        `</div></section>`
      );
    }

    if (ot.heartsteel && matchQ(`心之钢 本命 光环 ${(ot.heartsteel.members || []).map((m) => m.who + m.bonus).join(" ")}`)) {
      blocks.push(
        `<section class="cs-card-block">` +
        `<div class="cs-block-head"><strong>${esc(ot.heartsteel.title)}</strong></div>` +
        `<p class="cs-sub-desc">${esc(ot.heartsteel.summary)}</p>` +
        `<div class="cs-mini-grid">${(ot.heartsteel.members || []).map((m) =>
          `<div class="cs-mini-item"><b>${esc(m.who)}</b><em>${esc(m.bonus)}</em></div>`
        ).join("")}</div></section>`
      );
    }

    if (ot.collabLoot && matchQ(`合奏 灵感 法球 ${ot.collabLoot.summary}`)) {
      blocks.push(
        `<section class="cs-card-block">` +
        `<div class="cs-block-head"><strong>${esc(ot.collabLoot.title)}</strong>` +
        `<button type="button" class="btn xs primary" data-cs-open-collab="1">打开合奏组合筛选 →</button></div>` +
        `<p class="cs-sub-desc">${esc(ot.collabLoot.summary)}</p>` +
        `<table class="cs-table"><thead><tr><th>阶段</th><th>期望价值</th><th>合奏法球掉落概率</th></tr></thead><tbody>` +
        (ot.collabLoot.stages || []).map((s) =>
          `<tr><td><b>${esc(s.stage)}</b></td><td class="cs-mono cs-hi">${esc(s.avgVal)}</td><td>${esc(s.drops)}</td></tr>`
        ).join("") +
        `</tbody></table></section>`
      );
    }

    return blocks.join("") || `<p class="advisor-empty">无匹配羁绊机制条目</p>`;
  }

  function renderUnlocks() {
    const game = store.getGame();
    const units = (game && game.data && game.data.units ? game.data.units : [])
      .filter((u) => u && u.unlock)
      .sort((a, b) => a.cost - b.cost || (a.unlock.level || 0) - (b.unlock.level || 0) || a.display.localeCompare(b.display, "zh-CN"));

    const costPills = [0, 2, 3, 4, 5, 7].map((c) =>
      `<button type="button" class="cost-pill${unlockCost === c ? " active" : ""}" data-cs-ucost="${c}">${c === 0 ? `全部 (${units.length})` : `${c} 费`}</button>`
    ).join("");

    const filtered = units.filter((u) => {
      if (unlockCost > 0 && u.cost !== unlockCost) return false;
      const tNames = (u.traits || []).map((tid) => (game.traitById[tid] ? game.traitById[tid].name : "")).join(" ");
      return matchQ(`${u.display} ${u.nameEn || ""} ${aliasesForUnit(u, game)} ${tNames} ${u.unlock.text || ""}`);
    });

    const curTarget = store.getState().unlockTargetId;
    const rowsHtml = filtered.map((u) => {
      const traitsTxt = (u.traits || [])
        .map((tid) => (game.traitById[tid] ? game.traitById[tid].name : ""))
        .filter(Boolean)
        .join(" · ");
      const isTarget = curTarget === u.id;
      return (
        `<div class="cs-unlock-row${isTarget ? " is-target" : ""}">` +
        `<div class="mc-ava" style="--cost-solid:${esc(store.costSolidHex(u.cost))}">` +
        store.imgHtml(u, "", u.display, false) +
        `<span class="cl-cost-dot">${u.cost}</span>` +
        `</div>` +
        `<div class="cs-unlock-info">` +
        `<div class="cs-unlock-head"><strong>${esc(u.display)}</strong><span class="cs-unlock-traits">${esc(traitsTxt)}</span></div>` +
        `<p>${esc(u.unlock.text || "")}</p>` +
        `</div>` +
        `<button type="button" class="btn xs${isTarget ? " toggle-on" : ""}" data-cs-set-unlock="${esc(u.id)}">${isTarget ? "已设为目标" : "设为解锁目标"}</button>` +
        `</div>`
      );
    }).join("");

    return (
      `<div class="cs-unlock-bar"><div class="sc-pills">${costPills}</div><span class="drawer-hint">点击右侧按钮可直接在主沙盘生成解锁前置路线</span></div>` +
      `<div class="cs-unlock-list">${rowsHtml || '<p class="advisor-empty">无匹配的可解锁弈子</p>'}</div>`
    );
  }

  function renderEncounters(encs) {
    const list = (encs || []).filter((e) => matchQ(`${e.name} ${e.desc}`));
    if (!list.length) return `<p class="advisor-empty">无匹配的开局奇遇</p>`;
    return (
      `<p class="cs-summary">本赛季共 ${encs.length} 种开局奇遇，按官方出现概率由高到低排列：</p>` +
      `<div class="cs-enc-grid">` +
      list.map((e) =>
        `<div class="cs-enc-card">` +
        `<div class="cs-enc-head"><strong>${esc(e.name)}</strong><span class="cs-pct">${e.chance.toFixed(1)}%</span></div>` +
        `<p>${esc(e.desc)}</p>` +
        `</div>`
      ).join("") +
      `</div>`
    );
  }

  function renderEconomy(eco) {
    if (!eco) return `<p class="advisor-empty">暂无概率数据。</p>`;
    const oddsHtml =
      `<section class="cs-card-block">` +
      `<div class="cs-block-head"><strong>商店刷卡概率（S19 · 1–11 级）</strong><span>11 级由 4 国风【巨兽卷轴】解锁</span></div>` +
      `<table class="cs-table cs-odds-table"><thead><tr><th>等级</th><th class="c1">1 费</th><th class="c2">2 费</th><th class="c3">3 费</th><th class="c4">4 费</th><th class="c5">5 费</th></tr></thead><tbody>` +
      (eco.shopOdds || []).map((r) =>
        `<tr><td><b>${r.lvl} 级</b>${r.note ? ` <em class="drawer-hint">${esc(r.note)}</em>` : ""}</td>` +
        [r.c1, r.c2, r.c3, r.c4, r.c5].map((v, idx) =>
          `<td class="cs-mono${v >= 30 ? " cs-hi" : (v === 0 ? " cs-zero" : "")}" data-cost="${idx + 1}">${v > 0 ? v + "%" : "—"}</td>`
        ).join("") + `</tr>`
      ).join("") +
      `</tbody></table></section>`;

    const poolHtml =
      `<section class="cs-card-block">` +
      `<div class="cs-block-head"><strong>弈子牌库张数（同行争抢参考）</strong><span>7 费为解锁专属弈子</span></div>` +
      `<table class="cs-table"><thead><tr><th>费用</th><th>单卡张数</th><th>英雄种数</th><th>同费总牌库</th><th>备注</th></tr></thead><tbody>` +
      (eco.poolSizes || []).map((p) =>
        `<tr><td><b style="color:${esc(store.costSolidHex(p.cost))}">${p.cost} 费</b></td><td class="cs-mono"><b>${p.copies} 张</b></td><td class="cs-mono">${p.unique} 个</td><td class="cs-mono">${p.total} 张</td><td class="drawer-hint">${esc(p.note || "")}</td></tr>`
      ).join("") +
      `</tbody></table></section>`;

    const xpHtml =
      `<section class="cs-card-block">` +
      `<div class="cs-block-head"><strong>升级所需经验值（1 → 10 级）</strong><span>每 4 金币 = 4 经验</span></div>` +
      `<div class="cs-xp-strip">` +
      (eco.levelXp || []).map((x) =>
        `<div class="cs-xp-box"><span>${esc(x.from)}</span><strong>${x.xp} XP</strong></div>`
      ).join("") +
      `</div></section>`;

    return oddsHtml + poolHtml + xpHtml;
  }

  function renderContent() {
    const contentEl = modalEl.querySelector("#cs-body-scroll");
    if (!contentEl) return;
    const tables = getTables();
    if (activeTab === "trueDamage") contentEl.innerHTML = renderTrueDamage(tables && tables.trueDamage);
    else if (activeTab === "hyperpop") contentEl.innerHTML = renderHyperpop(tables && tables.hyperpop);
    else if (activeTab === "eightBit") contentEl.innerHTML = renderEightBit(tables && tables.eightBit);
    else if (activeTab === "otherTraits") contentEl.innerHTML = renderOtherTraits(tables && tables.otherTraits);
    else if (activeTab === "unlocks") contentEl.innerHTML = renderUnlocks();
    else if (activeTab === "encounters") contentEl.innerHTML = renderEncounters(tables && tables.encounters);
    else contentEl.innerHTML = renderEconomy(tables && tables.economy);
  }

  function renderShell() {
    const tables = getTables();
    const patchBadge = `Patch ${(tables && tables.patch) || "19.1e"} · 离线速查`;
    const tabsHtml = TABS.map(([id, label]) =>
      `<button type="button" class="cs-tab${activeTab === id ? " active" : ""}" data-cs-tab="${id}" role="tab" aria-selected="${activeTab === id}">${esc(label)}</button>`
    ).join("");

    modalEl.innerHTML =
      `<div class="modal-shell">` +
      `<header class="drawer-head">` +
      `<div class="mc-modal-title">` +
      `<h2>S19 羁绊奖励与速查表</h2>` +
      `<span class="mc-sync-pill">${esc(patchBadge)}</span>` +
      `</div>` +
      `<div class="cs-head-right">` +
      `<input id="cs-search" class="sc-save-input cs-search-input" type="search" value="${esc(query)}" placeholder="搜索奖励 / 英雄 / 奇遇…">` +
      `<button type="button" class="btn xs ghost" data-modal-close="1" aria-label="关闭">×</button>` +
      `</div>` +
      `</header>` +
      `<nav class="cs-tabs" role="tablist" aria-label="速查分类">${tabsHtml}</nav>` +
      `<div id="cs-body-scroll" class="cs-scroll"></div>` +
      `</div>`;
    renderContent();
  }

  function open(initialTab) {
    if (initialTab && TABS.some(([id]) => id === initialTab)) activeTab = initialTab;
    query = "";
    renderShell();
    if (typeof modalEl.showModal === "function" && !modalEl.open) {
      modalEl.showModal();
    }
  }

  function close() {
    if (modalEl.open && typeof modalEl.close === "function") modalEl.close();
  }

  if (openBtn) openBtn.addEventListener("click", () => open());

  modalEl.addEventListener("input", (e) => {
    if (e.target && e.target.id === "cs-search") {
      query = e.target.value || "";
      renderContent();
    }
  });

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) { close(); return; }
    const t = e.target;
    if (!t || !t.closest) return;
    let el;
    if (t.closest("[data-modal-close]")) { close(); return; }
    if ((el = t.closest("[data-cs-tab]"))) {
      activeTab = el.getAttribute("data-cs-tab") || "trueDamage";
      modalEl.querySelectorAll("[data-cs-tab]").forEach((b) => {
        const on = b.getAttribute("data-cs-tab") === activeTab;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
      });
      renderContent();
      return;
    }
    if ((el = t.closest("[data-cs-ucost]"))) {
      unlockCost = Number(el.getAttribute("data-cs-ucost")) || 0;
      renderContent();
      return;
    }
    if ((el = t.closest("[data-cs-set-unlock]"))) {
      const uid = el.getAttribute("data-cs-set-unlock");
      if (uid) {
        const cur = store.getState().unlockTargetId;
        store.setUnlockTarget(cur === uid ? null : uid);
        if (cur !== uid) close();
        else renderContent();
      }
      return;
    }
    if (t.closest("[data-cs-open-collab]")) {
      close();
      if (hooks && typeof hooks.openCollab === "function") hooks.openCollab();
    }
  });

  return { open, close };
}
