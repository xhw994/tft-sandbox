import { itemUnitScore } from "./item-affinity.js";

const UNLOCK_TRAIT_ALIASES = {
  hyperpop: "DA_GlitterBomb19",
  classical: "DA_Virtuosos19",
  renegade: "DA_Renegade19",
  "混沌战士": "DA_Renegade19",
  trickshot: "DA_Trickshot19",
  pentakill: "DA_Pentakill19",
  swiftstriker: "DA_Swiftstriker19",
  "ionic spark": "DA_IonicSpark19",
  "离子火花粉丝": "DA_IonicSpark19",
  hitmaker: "DA_Hitmaker19",
  "裁决战士": "DA_Mosher19"
};

function goldValue(cost, star) {
  return (cost || 1) * Math.pow(3, Math.max(0, (star || 1) - 1));
}

function copyEntry(e) {
  return {
    id: e.id,
    star: e.star || 1,
    mark: e.mark || "",
    position: e.position ? { row: e.position.row, col: e.position.col } : null,
    items: Array.isArray(e.items) ? e.items.slice() : []
  };
}

function effectiveStyle(bp, traitId, prisMap) {
  if (prisMap && prisMap[traitId] && bp.prismaticStyle) return bp.prismaticStyle;
  return bp.style || 0;
}

function extractUnlockTraitIds(text, game) {
  if (!text || !game) return [];
  const raw = String(text);
  const lower = raw.toLowerCase();
  const out = [];
  const seen = {};
  const pushId = (tid) => {
    if (tid && game.traitById && game.traitById[tid] && !seen[tid]) {
      seen[tid] = 1;
      out.push(tid);
    }
  };
  let m;
  const re = /【([^】]+)】/g;
  while ((m = re.exec(raw)) !== null) {
    const token = m[1].trim();
    const low = token.toLowerCase();
    if (UNLOCK_TRAIT_ALIASES[low]) pushId(UNLOCK_TRAIT_ALIASES[low]);
    for (const tr of (game.data.traits || [])) {
      if (tr.name === token || tr.id === token) pushId(tr.id);
    }
  }
  for (const alias of Object.keys(UNLOCK_TRAIT_ALIASES)) {
    if (lower.includes(alias)) pushId(UNLOCK_TRAIT_ALIASES[alias]);
  }
  return out;
}

function countTraitsForBoard(board, ctx, game) {
  const counts = {};
  for (const e of board) {
    const eff = game.effectiveTraits(e);
    for (const tid of eff) {
      const tr = game.traitById[tid];
      if (!tr) continue;
      counts[tid] = (counts[tid] || 0) + (tr.countMode === "stars" ? (e.star || 1) : 1);
    }
  }
  const emblems = (ctx && ctx.emblems) || {};
  for (const tid of Object.keys(emblems)) {
    const n = Number(emblems[tid]) || 0;
    if (n > 0) counts[tid] = (counts[tid] || 0) + n;
  }
  // Note: ctx.emblems already includes looseEmblems from store.buildCtx(), so do NOT re-count ctx.looseItems emblems here.
  return counts;
}

function activeNonSoloCount(counts, ctx, game) {
  const pris = (ctx && ctx.prismatic) || {};
  let active = 0;
  for (const tr of (game.data.traits || [])) {
    if (tr.kind === "solo") continue;
    const c = counts[tr.id] || 0;
    let ok = false;
    for (const bp of (tr.breakpoints || [])) {
      if (effectiveStyle(bp, tr.id, pris) > 0 && c >= bp.need) {
        ok = true;
        break;
      }
    }
    if (ok) active++;
  }
  return active;
}

function isLockedRelatedToBoard(unit, ownedIds, boardTraitIds, activeCount, ctx, game) {
  const info = typeof game.unlockInfo === "function" ? game.unlockInfo(unit) : unit.unlock;
  if (!info) return true;
  if (Array.isArray(info.units) && info.units.length) {
    return info.mode === "any"
      ? info.units.some((r) => !!ownedIds[r.id])
      : info.units.every((r) => !!ownedIds[r.id]);
  }
  const text = String(info.text || "");
  const cntMatch = text.match(/激活\s*(\d+)\s*个/);
  if (cntMatch) {
    const need = Number(cntMatch[1]) || 0;
    if (need > 0 && activeCount < need - 1) return false;
  }
  const reqTraits = extractUnlockTraitIds(text, game);
  if (reqTraits.length) {
    return reqTraits.some((tid) => !!boardTraitIds[tid]);
  }
  return (unit.traits || []).some((tid) => {
    const tr = game.traitById[tid];
    return tr && tr.kind !== "solo" && !!boardTraitIds[tid];
  });
}

function hasKeysOnBoard(unit, board, game) {
  const info = typeof game.unlockInfo === "function" ? game.unlockInfo(unit) : unit.unlock;
  if (!info || !Array.isArray(info.units) || !info.units.length) return true;
  const held = (id, star) => board.some((e) => e.id === id && (e.star || 1) >= (star || 1));
  return info.mode === "any"
    ? info.units.some((r) => held(r.id, r.star))
    : info.units.every((r) => held(r.id, r.star));
}

function exclusiveConflict(unitId, idSet, game) {
  const groups = (game.data && game.data.exclusive) || [];
  for (const g of groups) {
    if (!g.includes(unitId)) continue;
    for (const other of g) {
      if (other !== unitId && idSet[other]) return true;
    }
  }
  return false;
}

function keepCostOf(entry, game, ctx, targetTraitSet, labels) {
  const u = game.byId[entry.id];
  if (!u) return 1;
  let score = goldValue(u.cost, entry.star || 1);
  for (const itemId of (entry.items || [])) {
    const it = game.itemById[itemId];
    if (!it) continue;
    if (it.kind === "emblem" && it.trait && targetTraitSet.has(it.trait)) score += 14;
    else if (it.kind === "basic") score += 4;
    else if (it.kind !== "emblem") score += 10;
  }
  if (ctx && ctx.focusId && entry.id === ctx.focusId) score += 200;
  const inferred = (labels && labels[entry.id]) || "";
  if (entry.mark === "carry" || entry.mark === "tank") score += 28;
  else if (entry.mark === "carry2") score += 16;
  else if (entry.mark === "bot") score -= 6;
  else if (inferred === "carry" || inferred === "tank") score += 12;
  else if (inferred === "carry2") score += 6;
  return Math.max(1, score);
}

function traitChangesBetween(beforeBoard, afterBoard, ctx, game) {
  const before = countTraitsForBoard(beforeBoard, ctx, game);
  const after = countTraitsForBoard(afterBoard, ctx, game);
  const pris = (ctx && ctx.prismatic) || {};
  const tierAt = (tr, c) => {
    let best = 0;
    for (const bp of (tr.breakpoints || [])) {
      if (effectiveStyle(bp, tr.id, pris) > 0 && c >= bp.need && bp.need > best) best = bp.need;
    }
    return best;
  };
  const changes = [];
  for (const tr of (game.data.traits || [])) {
    const f = before[tr.id] || 0;
    const t = after[tr.id] || 0;
    if (f === t) continue;
    const fTier = tierAt(tr, f);
    const tTier = tierAt(tr, t);
    changes.push({
      id: tr.id,
      name: tr.name,
      from: f,
      to: t,
      delta: t - f,
      reachedEffect: tTier > fTier,
      droppedEffect: tTier < fTier
    });
  }
  changes.sort((a, b) =>
    (b.reachedEffect ? 1 : 0) - (a.reachedEffect ? 1 : 0) ||
    (a.droppedEffect ? 1 : 0) - (b.droppedEffect ? 1 : 0) ||
    Math.abs(b.delta) - Math.abs(a.delta) ||
    b.to - a.to
  );
  return changes;
}

function transferRemovedItems(removedEntries, addedEntries, baseLoose, game) {
  const looseOut = (baseLoose || []).slice();
  const transfers = [];
  const addedPool = addedEntries.map((e) => ({
    entry: e,
    unit: game.byId[e.id]
  }));

  for (const rem of removedEntries) {
    const remItems = Array.isArray(rem.items) ? rem.items : [];
    const transferredTo = {};
    for (const itemId of remItems) {
      const it = game.itemById[itemId];
      if (!it) continue;
      // Find best added unit that can legally take this item
      let bestTarget = null;
      let bestScore = -Infinity;
      for (const cand of addedPool) {
        if (!cand.unit) continue;
        const curItems = cand.entry.items || [];
        const slotsUsed = curItems.reduce((s, id) => s + ((game.itemById[id] && game.itemById[id].slots) || 1), 0);
        if (slotsUsed + (it.slots || 1) > 3) continue;
        if (it.unique && curItems.includes(itemId)) continue;
        if (it.kind === "emblem" && it.trait) {
          if ((cand.unit.traits || []).includes(it.trait)) continue;
          if (curItems.some((id) => game.itemById[id] && game.itemById[id].trait === it.trait)) continue;
        }
        const sc = it.kind === "emblem" ? 2 : itemUnitScore(it, cand.unit, game);
        if (sc > bestScore) {
          bestScore = sc;
          bestTarget = cand;
        }
      }
      if (bestTarget && bestScore >= 0.5) {
        bestTarget.entry.items.push(itemId);
        transferredTo[bestTarget.entry.id] = transferredTo[bestTarget.entry.id] || [];
        transferredTo[bestTarget.entry.id].push(itemId);
      } else {
        looseOut.push(itemId);
      }
    }
    for (const toId of Object.keys(transferredTo)) {
      transfers.push({ from: rem.id, to: toId, items: transferredTo[toId] });
    }
  }

  return { looseItems: looseOut, itemTransfers: transfers };
}

function buildQuickSuggestions(board, ctx, game) {
  const counts = countTraitsForBoard(board, ctx, game);
  const pris = (ctx && ctx.prismatic) || {};
  const list = [];
  for (const tr of (game.data.traits || [])) {
    if (tr.kind === "solo") continue;
    const cur = counts[tr.id] || 0;
    if (cur <= 0) continue;
    const enabledBps = (tr.breakpoints || []).filter((bp) => effectiveStyle(bp, tr.id, pris) > 0);
    const nextBp = enabledBps.find((bp) => bp.need > cur) || enabledBps[enabledBps.length - 1];
    if (!nextBp) continue;
    list.push({
      id: tr.id,
      name: tr.name,
      current: cur,
      need: nextBp.need,
      gap: Math.max(0, nextBp.need - cur)
    });
  }
  list.sort((a, b) => b.current - a.current || a.gap - b.gap || a.need - b.need);
  return list.slice(0, 5);
}

/**
 * Search minimal-disruption adjustments (removes + adds) on the current board
 * to satisfy left-rail `traitTargets` within population capacity.
 */
export function planBoardReorg(boardInput, ctx, game, options = {}) {
  if (!game || !game.data) {
    return { status: "empty", targets: [], blockedTargets: [], plans: [], quickSuggestions: [] };
  }
  const board = (boardInput || []).filter((e) => e && game.byId[e.id]).map(copyEntry);
  const safeCtx = Object.assign({ level: 8, extraSlots: 0, emblems: {}, prismatic: {}, looseItems: [], bannedIds: {}, allowLocked: true }, ctx || {});
  const rawTargets = options.traitTargets || safeCtx.traitTargets || {};
  const pris = safeCtx.prismatic || {};
  const labels = options.labels || {};
  const requireBoardLocked = options.requireBoardRelatedLocked !== false;
  const maxPlans = options.maxPlans || 3;

  const currentCounts = countTraitsForBoard(board, safeCtx, game);
  const targets = [];
  const blockedTargets = [];

  for (const tid of Object.keys(rawTargets)) {
    const tr = game.traitById[tid];
    const need = Number(rawTargets[tid]) || 0;
    if (!tr || tr.kind === "solo" || need <= 0) continue;
    const bp = (tr.breakpoints || []).find((b) => b.need === need);
    if (!bp || effectiveStyle(bp, tid, pris) <= 0) {
      blockedTargets.push({
        id: tid,
        name: tr.name,
        need,
        reason: bp && bp.prismaticStyle ? "需先在左栏开启棱彩" : "该档位不可用"
      });
      continue;
    }
    targets.push({
      id: tid,
      name: tr.name,
      need,
      countMode: tr.countMode || "units",
      current: currentCounts[tid] || 0
    });
  }

  if (blockedTargets.length) {
    return {
      status: "blocked",
      targets,
      blockedTargets,
      plans: [],
      quickSuggestions: buildQuickSuggestions(board, safeCtx, game)
    };
  }

  if (!targets.length) {
    return {
      status: "no-targets",
      targets: [],
      blockedTargets: [],
      plans: [],
      quickSuggestions: buildQuickSuggestions(board, safeCtx, game)
    };
  }

  const curCap = game.capacity(board, safeCtx);
  const curUsed = game.slotsOf(board);
  const alreadyMet = curUsed <= curCap && targets.every((t) => t.current >= t.need);
  if (alreadyMet) {
    return {
      status: "already-met",
      cap: curCap,
      used: curUsed,
      level: safeCtx.level,
      targets,
      blockedTargets: [],
      plans: [],
      quickSuggestions: []
    };
  }

  const targetTraitSet = new Set(targets.map((t) => t.id));
  const ownedIds = {};
  const boardTraitIds = {};
  for (const e of board) {
    ownedIds[e.id] = 1;
    for (const tid of game.effectiveTraits(e)) boardTraitIds[tid] = 1;
  }
  for (const tid of Object.keys(safeCtx.emblems || {})) {
    if ((safeCtx.emblems[tid] || 0) > 0) boardTraitIds[tid] = 1;
  }
  const ownedActive = activeNonSoloCount(currentCounts, safeCtx, game);

  // Compute keep cost for each current unit and sort removable order (cheapest/least-core first)
  const boardMeta = board.map((e, idx) => {
    const u = game.byId[e.id];
    const eff = game.effectiveTraits(e);
    let targetHits = 0;
    for (const tid of eff) if (targetTraitSet.has(tid)) targetHits++;
    return {
      idx,
      entry: e,
      unit: u,
      slots: (u && u.slots) || 1,
      isFocus: !!(safeCtx.focusId && e.id === safeCtx.focusId),
      targetHits,
      keepCost: keepCostOf(e, game, safeCtx, targetTraitSet, labels)
    };
  });
  const totalKeepValue = boardMeta.reduce((s, m) => s + m.keepCost, 0);

  function searchAtLevel(level) {
    const lvlCtx = Object.assign({}, safeCtx, { level });
    const cap = game.capacity(board, lvlCtx);
    const banned = safeCtx.bannedIds || {};

    // Candidate pool: units not on board, legal at level, carrying >= 1 target trait
    const addCands = (game.data.units || []).filter((u) => {
      if (ownedIds[u.id] || banned[u.id]) return false;
      const isLock = !!(typeof game.unlockInfo === "function" ? game.unlockInfo(u) : u.unlock);
      if (!safeCtx.allowLocked && isLock) return false;
      if (!game.rollable(u, lvlCtx)) return false;
      const hitsTarget = (u.traits || []).some((tid) => targetTraitSet.has(tid));
      if (!hitsTarget) return false;
      if (requireBoardLocked && isLock && !isLockedRelatedToBoard(u, ownedIds, boardTraitIds, ownedActive, lvlCtx, game)) {
        return false;
      }
      return true;
    });

    const T = targets.length;
    const candMask = addCands.map((u) => targets.map((t) => ((u.traits || []).includes(t.id) ? 1 : 0)));
    const candHits = candMask.map((row) => row.reduce((a, b) => a + b, 0));
    const candLocked = addCands.map((u) => !!(typeof game.unlockInfo === "function" ? game.unlockInfo(u) : u.unlock));

    // Order candidates: more target traits first, unlocked before locked, synergy with board, cheaper/rollable first
    const order = addCands.map((_, i) => i).sort((a, b) => {
      if (candHits[b] !== candHits[a]) return candHits[b] - candHits[a];
      if (candLocked[a] !== candLocked[b]) return (candLocked[a] ? 1 : 0) - (candLocked[b] ? 1 : 0);
      const ovA = (addCands[a].traits || []).filter((tid) => boardTraitIds[tid]).length;
      const ovB = (addCands[b].traits || []).filter((tid) => boardTraitIds[tid]).length;
      if (ovB !== ovA) return ovB - ovA;
      return (game.rollPct(level, addCands[b].cost) - game.rollPct(level, addCands[a].cost)) ||
        (addCands[a].cost - addCands[b].cost) ||
        String(addCands[a].id).localeCompare(String(addCands[b].id));
    });

    const sortedCands = order.map((i) => addCands[i]);
    const sortedMask = order.map((i) => candMask[i]);
    const sortedHits = order.map((i) => candHits[i]);
    const sortedSlots = sortedCands.map((u) => u.slots || 1);
    const M = sortedCands.length;

    // Precompute suffix trait supply & suffix max target-hit sum for tight pruning
    const suffixSupply = Array.from({ length: T }, () => new Array(M + 1).fill(0));
    for (let t = 0; t < T; t++) {
      for (let i = M - 1; i >= 0; i--) {
        suffixSupply[t][i] = suffixSupply[t][i + 1] + sortedMask[i][t];
      }
    }
    const maxSlotsPossible = Math.min(M, cap);
    const suffixMaxHits = Array.from({ length: M + 1 }, () => new Array(maxSlotsPossible + 1).fill(0));
    for (let i = M - 1; i >= 0; i--) {
      // Sorted descending by candHits, so greedy top-r hits from i..M-1 is an exact upper bound for r units
      for (let r = 1; r <= maxSlotsPossible; r++) {
        suffixMaxHits[i][r] = Math.max(suffixMaxHits[i + 1][r], sortedHits[i] + suffixMaxHits[i + 1][r - 1]);
      }
    }

    // Removable units sorted by ascending keepCost (prefer dropping expendable non-target units first)
    const flexMeta = boardMeta.slice().sort((a, b) =>
      (a.isFocus ? 1 : 0) - (b.isFocus ? 1 : 0) ||
      a.targetHits - b.targetHits ||
      a.keepCost - b.keepCost
    );

    const results = [];
    const seenBoards = new Set();
    let nodes = 0;
    const NODE_LIMIT = 14000;

    function solveAdds(keptMeta, removedMeta) {
      const keptBoard = keptMeta.map((m) => m.entry);
      const usedSlots = game.slotsOf(keptBoard);
      const remSlots = cap - usedSlots;
      if (remSlots < 0) return;

      const keptCounts = countTraitsForBoard(keptBoard, lvlCtx, game);
      const defs = targets.map((t) => Math.max(0, t.need - (keptCounts[t.id] || 0)));
      const totalDef = defs.reduce((a, b) => a + b, 0);

      if (totalDef === 0) {
        recordSolution(keptMeta, removedMeta, []);
        return;
      }
      if (remSlots === 0 || M === 0) return;
      for (let t = 0; t < T; t++) {
        if (defs[t] > remSlots || defs[t] > suffixSupply[t][0]) return;
      }

      const keptIdSet = {};
      for (const m of keptMeta) keptIdSet[m.entry.id] = 1;
      const chosenIdxs = [];
      let bestAddCountForSplit = Infinity;

      function dfsAdd(start, slotsLeft, defArr, defSum) {
        if (nodes++ > NODE_LIMIT) return;
        if (defSum === 0) {
          if (chosenIdxs.length <= bestAddCountForSplit) {
            bestAddCountForSplit = chosenIdxs.length;
            recordSolution(keptMeta, removedMeta, chosenIdxs.map((i) => sortedCands[i]));
          }
          return;
        }
        if (chosenIdxs.length >= bestAddCountForSplit) return;
        if (slotsLeft <= 0 || start >= M) return;

        const maxUnitsLeft = Math.min(slotsLeft, bestAddCountForSplit - chosenIdxs.length);
        if (maxUnitsLeft <= 0) return;
        const maxPossibleHits = suffixMaxHits[start][Math.min(maxUnitsLeft, maxSlotsPossible)] || 0;
        if (defSum > maxPossibleHits) return;

        for (let t = 0; t < T; t++) {
          if (defArr[t] > maxUnitsLeft || defArr[t] > suffixSupply[t][start]) return;
        }

        for (let i = start; i < M; i++) {
          if (nodes > NODE_LIMIT) return;
          const sl = sortedSlots[i];
          if (sl > slotsLeft) continue;
          // Must help at least one currently unmet target deficit
          let helps = 0;
          const mRow = sortedMask[i];
          for (let t = 0; t < T; t++) {
            if (defArr[t] > 0 && mRow[t]) helps++;
          }
          if (!helps) continue;
          const u = sortedCands[i];
          if (exclusiveConflict(u.id, keptIdSet, game)) continue;

          keptIdSet[u.id] = 1;
          chosenIdxs.push(i);
          const nextDefs = defArr.slice();
          let nextSum = defSum;
          for (let t = 0; t < T; t++) {
            if (nextDefs[t] > 0 && mRow[t]) {
              nextDefs[t]--;
              nextSum--;
            }
          }
          dfsAdd(i + 1, slotsLeft - sl, nextDefs, nextSum);
          chosenIdxs.pop();
          delete keptIdSet[u.id];
        }
      }

      dfsAdd(0, remSlots, defs, totalDef);
    }

    function recordSolution(keptMeta, removedMeta, addUnits) {
      const keptEntries = keptMeta.map((m) => copyEntry(m.entry));
      const addedEntries = addUnits.map((u) => ({ id: u.id, star: 1, mark: "", position: null, items: [] }));
      const finalBoard = keptEntries.concat(addedEntries);

      // Verify all unlock keys on final board
      for (const u of addUnits) {
        if (!hasKeysOnBoard(u, finalBoard, game)) return;
      }

      // Transfer items from removed units to added units or return to looseItems
      const xfer = transferRemovedItems(removedMeta.map((m) => m.entry), addedEntries, safeCtx.looseItems, game);
      const finalCtx = Object.assign({}, lvlCtx, { looseItems: xfer.looseItems });
      if (game.slotsOf(finalBoard) > game.capacity(finalBoard, finalCtx)) return;

      const boardKey = finalBoard.map((e) => e.id).sort().join("|");
      if (seenBoards.has(boardKey)) return;
      seenBoards.add(boardKey);

      const keepLoss = removedMeta.reduce((s, m) => s + m.keepCost, 0);
      const dropFocus = removedMeta.some((m) => m.isFocus);
      const lockedAdds = addUnits.filter((u) => !!(typeof game.unlockInfo === "function" ? game.unlockInfo(u) : u.unlock)).length;
      const ev = game.evaluate(finalBoard, finalCtx, null);
      const activeTraits = activeNonSoloCount(countTraitsForBoard(finalBoard, finalCtx, game), finalCtx, game);

      // Build human-readable summary & assessment
      const remIds = removedMeta.map((m) => m.entry.id);
      const addsSpec = addedEntries.map((e) => ({ id: e.id, star: e.star, mark: e.mark }));
      const title = remIds.length === 0
        ? `无需换人 · 补 ${addsSpec.length} 张`
        : (addsSpec.length === 0
          ? `下掉 ${remIds.length} 张即可达标`
          : `换下 ${remIds.length} 张 → 上阵 ${addsSpec.length} 张`);

      const keepPct = totalKeepValue > 0
        ? Math.max(0, Math.round(((totalKeepValue - keepLoss) / totalKeepValue) * 100))
        : 100;

      let assessment = null;
      try {
        assessment = game.assessCandidate(
          board,
          { type: "plan", afterBoard: finalBoard, candidateId: "reorg:" + boardKey },
          finalCtx
        );
      } catch {
        assessment = null;
      }

      const traitChanges = traitChangesBetween(board, finalBoard, finalCtx, game);
      const keptCoreNames = keptMeta
        .filter((m) => m.isFocus || m.entry.mark === "carry" || m.entry.mark === "tank" || (m.entry.star || 1) >= 2 || (m.entry.items || []).length > 0)
        .slice(0, 4)
        .map((m) => m.unit.display + ((m.entry.star || 1) > 1 ? `${m.entry.star}★` : ""));

      results.push({
        id: boardKey,
        title,
        board: finalBoard,
        looseItems: xfer.looseItems,
        removes: remIds,
        adds: addsSpec,
        itemTransfers: xfer.itemTransfers,
        requiredLevel: level,
        slots: game.slotsOf(finalBoard),
        cap,
        keepLoss,
        keepPct,
        dropFocus,
        lockedAdds,
        activeTraits,
        evalScore: ev ? ev.total : 0,
        traitChanges,
        assessment,
        keptCount: keptMeta.length,
        keptCoreNames
      });
    }

    // Iterate over removal count r = 0..maxRem (stop expanding r once we have strong plans keeping focus)
    const maxRem = Math.min(flexMeta.length, 6);
    const chosenRem = [];

    function enumRemovals(r, start) {
      if (nodes > NODE_LIMIT) return;
      if (chosenRem.length === r) {
        const remSet = new Set(chosenRem);
        const keptMeta = flexMeta.filter((_, idx) => !remSet.has(idx));
        const removedMeta = chosenRem.map((idx) => flexMeta[idx]);
        solveAdds(keptMeta, removedMeta);
        return;
      }
      for (let i = start; i <= flexMeta.length - (r - chosenRem.length); i++) {
        if (nodes > NODE_LIMIT) return;
        // Skip removing focus unless we haven't found any plan without dropping focus
        if (flexMeta[i].isFocus && results.some((p) => !p.dropFocus)) continue;
        chosenRem.push(i);
        enumRemovals(r, i + 1);
        chosenRem.pop();
      }
    }

    for (let r = 0; r <= maxRem; r++) {
      enumRemovals(r, 0);
      // Once we found plans at removal count r (and tried r+1 for better keepLoss/dual-trait swaps), stop expanding
      if (results.length >= maxPlans && r >= 1) {
        const minRemFound = Math.min(...results.map((p) => p.removes.length));
        if (r >= minRemFound + 1) break;
      }
      if (nodes > NODE_LIMIT) break;
    }

    results.sort((a, b) =>
      (a.dropFocus ? 1 : 0) - (b.dropFocus ? 1 : 0) ||
      a.removes.length - b.removes.length ||
      (a.keepLoss - b.keepLoss) ||
      (a.adds.length - b.adds.length) ||
      (a.lockedAdds - b.lockedAdds) ||
      (b.activeTraits - a.activeTraits) ||
      (b.evalScore - a.evalScore) ||
      a.id.localeCompare(b.id)
    );

    return results.slice(0, maxPlans);
  }

  let plans = searchAtLevel(safeCtx.level);
  if (plans.length) {
    return {
      status: "ok",
      cap: curCap,
      used: curUsed,
      level: safeCtx.level,
      targets,
      blockedTargets: [],
      plans,
      quickSuggestions: []
    };
  }

  // Current level cannot fit all target traits — probe up to +2 levels (max 10) for actionable guidance
  for (let nextLvl = safeCtx.level + 1; nextLvl <= Math.min(10, safeCtx.level + 2); nextLvl++) {
    const nextPlans = searchAtLevel(nextLvl);
    if (nextPlans.length) {
      return {
        status: "need-level",
        cap: curCap,
        used: curUsed,
        level: safeCtx.level,
        minLevel: nextLvl,
        targets,
        blockedTargets: [],
        plans: nextPlans,
        quickSuggestions: []
      };
    }
  }

  return {
    status: "impossible",
    cap: curCap,
    used: curUsed,
    level: safeCtx.level,
    targets,
    blockedTargets: [],
    plans: [],
    quickSuggestions: []
  };
}
