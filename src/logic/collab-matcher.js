/**
 * Independent Set 19 "合奏 (Collab)" combination filter & combinatorial group matcher.
 * Completely decoupled from core engine.js / assess.js so seasonal mechanics stay modular.
 */

export function getCollabGroups(seasonData) {
  const sd = seasonData || (typeof globalThis !== "undefined" ? globalThis.SEASON_DATA : null);
  return (sd && sd.collab && Array.isArray(sd.collab.groups)) ? sd.collab.groups : [];
}

/**
 * Returns all distinct unit IDs appearing across the 40 Collab groups, sorted by cost then display.
 */
export function getCollabPoolIds(groups, game) {
  const seen = new Set();
  for (const g of groups || []) {
    for (const uid of g.units || []) seen.add(uid);
  }
  const ids = [...seen];
  ids.sort((a, b) => {
    const ua = game && game.byId && game.byId[a];
    const ub = game && game.byId && game.byId[b];
    const ca = ua ? ua.cost : 9;
    const cb = ub ? ub.cost : 9;
    if (ca !== cb) return ca - cb;
    return (ua ? ua.display : a).localeCompare(ub ? ub.display : b, "zh-CN");
  });
  return ids;
}

/**
 * Exact subset filter over Collab groups.
 * - selectedIds: group must include EVERY selected unit
 * - excludedIds: group must include NONE of the excluded units
 * - sortMode: "avg" | "bp3" | "bp5" | "size"
 */
export function filterCollabGroups(groups, selectedIds, excludedIds, sortMode) {
  const sel = Array.isArray(selectedIds) ? selectedIds.filter(Boolean) : [];
  const exc = new Set(Array.isArray(excludedIds) ? excludedIds.filter(Boolean) : []);
  const list = (groups || []).filter((g) => {
    const set = new Set(g.units || []);
    for (const id of sel) {
      if (!set.has(id)) return false;
    }
    for (const id of exc) {
      if (set.has(id)) return false;
    }
    return true;
  });

  const mode = sortMode || "avg";
  list.sort((a, b) => {
    if (mode === "bp3") {
      return ((a.bp3 && a.bp3.avg) ?? 9) - ((b.bp3 && b.bp3.avg) ?? 9) || (a.activeAvg ?? 9) - (b.activeAvg ?? 9);
    }
    if (mode === "bp5") {
      return ((a.bp5 && a.bp5.avg) ?? 9) - ((b.bp5 && b.bp5.avg) ?? 9) || (a.activeAvg ?? 9) - (b.activeAvg ?? 9);
    }
    if (mode === "size") {
      return (b.units.length - a.units.length) || ((a.activeAvg ?? 9) - (b.activeAvg ?? 9));
    }
    return ((a.activeAvg ?? 9) - (b.activeAvg ?? 9)) || (b.units.length - a.units.length);
  });

  return list;
}

/**
 * Given the remaining candidate groups and already selected units, returns the best
 * discriminating units (closest to splitting remaining candidates in half) so the player
 * can identify their exact lobby Collab set in 1-2 clicks.
 */
export function suggestDiscriminatingUnits(remainingGroups, selectedIds, limit) {
  const n = (remainingGroups || []).length;
  if (n <= 1) return [];
  const sel = new Set(selectedIds || []);
  const freq = new Map();
  for (const g of remainingGroups) {
    for (const uid of g.units || []) {
      if (sel.has(uid)) continue;
      freq.set(uid, (freq.get(uid) || 0) + 1);
    }
  }
  const half = n / 2;
  return [...freq.entries()]
    .filter(([, cnt]) => cnt > 0 && cnt < n)
    .map(([id, cnt]) => ({
      id,
      count: cnt,
      splitScore: Math.abs(cnt - half)
    }))
    .sort((a, b) => a.splitScore - b.splitScore || b.count - a.count)
    .slice(0, limit || 8);
}

/**
 * Exact maximum-weight injective matching (bitmask DP) between K detected portrait tiles
 * and a Collab group G of M units (M <= 6, K <= 6).
 * tileScores: array of K objects/Maps mapping unitId -> similarity score.
 */
function maxBipartiteScore(tileScores, groupUnits) {
  const K = tileScores.length;
  const M = groupUnits.length;
  if (!K || !M) return { sum: 0, matched: 0, pairs: [] };

  const states = 1 << M;
  const dp = new Float64Array(states);
  const parentMask = new Int32Array(states * (K + 1));
  const parentUnit = new Int16Array(states * (K + 1));
  dp.fill(-1e9);
  dp[0] = 0;

  let curDp = dp;
  const history = [];

  for (let t = 0; t < K; t++) {
    const nextDp = new Float64Array(curDp);
    const pMask = new Int32Array(states);
    const pUnit = new Int16Array(states);
    for (let s = 0; s < states; s++) {
      pMask[s] = s;
      pUnit[s] = -1;
    }
    const scores = tileScores[t];
    for (let mask = 0; mask < states; mask++) {
      const base = curDp[mask];
      if (base <= -1e8) continue;
      for (let uIdx = 0; uIdx < M; uIdx++) {
        if (mask & (1 << uIdx)) continue;
        const uid = groupUnits[uIdx];
        const w = scores instanceof Map ? (scores.get(uid) ?? -0.5) : (scores[uid] ?? -0.5);
        const nm = mask | (1 << uIdx);
        const cand = base + w;
        if (cand > nextDp[nm]) {
          nextDp[nm] = cand;
          pMask[nm] = mask;
          pUnit[nm] = uIdx;
        }
      }
    }
    history.push({ pMask, pUnit });
    curDp = nextDp;
  }

  // Require matching min(K, M) tiles
  const need = Math.min(K, M);
  let bestMask = 0;
  let bestVal = -1e9;
  for (let mask = 0; mask < states; mask++) {
    let bits = 0;
    let x = mask;
    while (x) { x &= x - 1; bits++; }
    if (bits === need && curDp[mask] > bestVal) {
      bestVal = curDp[mask];
      bestMask = mask;
    }
  }

  // Reconstruct tile -> unit assignments
  const pairs = [];
  let mask = bestMask;
  for (let t = K - 1; t >= 0; t--) {
    const uIdx = history[t].pUnit[mask];
    const prev = history[t].pMask[mask];
    if (uIdx >= 0) {
      const uid = groupUnits[uIdx];
      const sMap = tileScores[t];
      const score = sMap instanceof Map ? (sMap.get(uid) ?? 0) : (sMap[uid] ?? 0);
      pairs.push({ tileIndex: t, unitId: uid, score });
    }
    mask = prev;
  }
  pairs.reverse();
  void parentMask;
  void parentUnit;
  return { sum: bestVal, matched: need, pairs };
}

/**
 * Ranks all 40 Collab groups jointly against K detected portrait tiles from a screenshot.
 * Rewards exact size match (5 tiles -> 5-unit group, 6 tiles -> 6-unit group) subtly
 * while primarily relying on bipartite visual similarity sum.
 */
export function scoreGroupsFromDetections(groups, tileScores) {
  if (!Array.isArray(tileScores) || !tileScores.length || !Array.isArray(groups) || !groups.length) {
    return [];
  }
  const K = tileScores.length;
  const ranked = groups.map((group) => {
    const res = maxBipartiteScore(tileScores, group.units || []);
    const meanSim = res.matched ? res.sum / res.matched : 0;
    // Slight bonus when screenshot tile count matches group size exactly (5 vs 6)
    const sizeBonus = (K >= 5 && group.units.length === K) ? 0.035 : (K === 6 && group.units.length === 5 ? -0.02 : 0);
    const totalScore = meanSim + sizeBonus;
    return {
      group,
      meanSim: Math.round(meanSim * 1000) / 1000,
      totalScore: Math.round(totalScore * 1000) / 1000,
      pairs: res.pairs
    };
  });

  ranked.sort((a, b) => b.totalScore - a.totalScore || (a.group.activeAvg ?? 9) - (b.group.activeAvg ?? 9));
  return ranked;
}
