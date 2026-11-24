var TFTAssess = (function () {
  "use strict";
  var UNKNOWN = { lo: 0, mid: 0.5, hi: 1, confidence: "unknown" };
  var ROLE = {
    tank: { damage: "low", frontline: "high" }, fighter: { damage: "medium", frontline: "medium" },
    assassin: { damage: "medium", frontline: "low" }, marksman: { damage: "high", frontline: "low" },
    caster: { damage: "medium", frontline: "low" }, specialist: { damage: null, frontline: null }
  };
  var LEVEL = {
    low: { lo: 0.10, mid: 0.25, hi: 0.40, confidence: "low" },
    medium: { lo: 0.40, mid: 0.55, hi: 0.70, confidence: "low" },
    high: { lo: 0.65, mid: 0.80, hi: 0.95, confidence: "low" }
  };
  var STAR = { "1": { lo: 0.55, mid: 0.60, hi: 0.65 }, "2": { lo: 0.75, mid: 0.80, hi: 0.85 }, "3": { lo: 1, mid: 1, hi: 1 } };
  var UTIL = ["control", "survivability", "enemyDebuff", "teamSupport"];
  var PRIORITY = { "confirmed-structured": 3, "manually-verified": 2, "unverified-extraction": 1 };
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function indexOfUnit(board, id) { for (var i = 0; i < board.length; i++) if (board[i].id === id) return i; return -1; }
  function interval(v) {
    if (typeof v === "number") return { lo: v, mid: v, hi: v, confidence: "verified" };
    if (!v || v.unknown) return copy(UNKNOWN);
    if (v.level && LEVEL[v.level]) { var level = copy(LEVEL[v.level]); level.confidence = v.confidence || "low"; return level; }
    if (typeof v.lo === "number" && typeof v.mid === "number" && typeof v.hi === "number") return { lo: v.lo, mid: v.mid, hi: v.hi, confidence: v.confidence || "verified" };
    return copy(UNKNOWN);
  }
  function defaultProfile(data) {
    var units = {}, compat, solo;
    (data.units || []).forEach(function (u) {
      var prior = ROLE[u.roleGroup] || ROLE.specialist;
      compat = { carry: "unknown", carry2: "unknown", tank: "unknown", bot: "compatible" };
      if (u.roleGroup === "tank") { compat.tank = "compatible"; compat.carry = "incompatible"; compat.carry2 = "incompatible"; }
      if (u.roleGroup === "marksman" || u.roleGroup === "caster" || u.roleGroup === "assassin") { compat.carry = "compatible"; compat.carry2 = "compatible"; compat.tank = "incompatible"; }
      if (u.roleGroup === "fighter") { compat.carry2 = "compatible"; compat.tank = "compatible"; }
      var row = { unitId: u.id, supportedRoles: [], markCompatibility: compat };
      ["damage", "frontline"].forEach(function (r) { row[r] = prior[r] ? { level: prior[r], source: "curated-role-prior", patch: data.meta && data.meta.set || "unknown", confidence: "low" } : { unknown: true }; });
      row.supportedRoles = u.roleGroup === "tank" ? ["tank"] : (compat.carry === "compatible" ? ["carry", "carry2"] : (compat.tank === "compatible" ? ["tank"] : []));
      solo = (u.traits || []).some(function (tid) {
        var found = false;
        (data.traits || []).forEach(function (t) { if (t.id === tid && (t.champions || []).length === 1) found = true; });
        return found;
      });
      if (u.cost === 5 || solo || ["DA_Rell19", "DA_TwistedFate19", "DA_Nunu19"].indexOf(u.id) >= 0) row.review = { control: "unknown", survivability: "unknown", enemyDebuff: "unknown", teamSupport: "unknown", snapshot: u.id };
      if (u.id === "DA_Nunu19") row.review = { control: "verified-absent", survivability: "verified-absent", enemyDebuff: "verified-absent", teamSupport: "verified-absent", snapshot: u.id };
      if (u.id === "DA_TwistedFate19") row.review.shopDependency = true;
      if (u.id === "DA_Rell19") row.review.exclusiveMountState = true;
      units[u.id] = row;
    });
    return { id: "heuristic-v1", weights: { damage: 30, frontline: 30, traits: 25, utility: { control: 4, survivability: 4, enemyDebuff: 4, teamSupport: 3 } }, minNow: 2, roleStarFactor: copy(STAR), rolePriorLevels: copy(LEVEL), damageAggregation: { top: 2, coefficients: [1, 0.35], cap: 1 }, frontlineAggregation: { top: 3, coefficients: [1, 0.5, 0.25], cap: 1 }, trait: { strengthDivisor: 4 }, unknownEquippedItemDelta: { lo: -0.1, mid: 0, hi: 0.1 }, units: units, effects: [], traits: {}, itemEffects: {} };
  }
  function qFor(unit, star, role, profile, data) {
    var row = profile.units && profile.units[unit.id], e = row && row[role], raw, known = { lo: 0, mid: 0, hi: 0 }, unknown = false, evidenceUnknown = false, itemMap = {}, effects = profile.effects || [];
    if (!e || e.unknown) return copy(UNKNOWN);
    raw = interval(e.byStar && e.byStar[String(star)] || e);
    if (!(e.byStar && e.byStar[String(star)])) {
      var factor = (profile.roleStarFactor || STAR)[String(star)] || STAR[String(star)];
      raw.lo *= factor.lo; raw.mid *= factor.mid; raw.hi *= factor.hi;
    }
    (data.items || []).forEach(function (it) { itemMap[it.id] = it; });
    (unit.items || []).forEach(function (id) {
      var it = itemMap[id], recognized = false, directEffect = false, structural = it && (it.kind === "emblem" || it.teamSize > 0), ie = profile.itemEffects && profile.itemEffects[id];
      if (structural) return;
      if (ie && ie[role]) { known.lo += ie[role].lo || 0; known.mid += ie[role].mid || 0; known.hi += ie[role].hi || 0; recognized = true; }
      if (ie && (ie.effectId || ie.id || ie.owner || ie.channel || ie.mechanism)) {
        if (ownerOf(ie) === role) { var ieValue = effectValue(ie, star); known.lo += ieValue.lo; known.mid += ieValue.mid; known.hi += ieValue.hi; if (ieValue.confidence === "unknown") evidenceUnknown = true; }
        recognized = true; directEffect = true;
      }
      if (ie && (ie.utility || ie.traits)) recognized = true;
      effects.forEach(function (ef) { if (!directEffect && ef.itemId === id) { if (ownerOf(ef) === role) { var ev = effectValue(ef, star); known.lo += ev.lo; known.mid += ev.mid; known.hi += ev.hi; if (ev.confidence === "unknown") evidenceUnknown = true; } recognized = true; } });
      if (!recognized) unknown = true;
    });
    effects.forEach(function (ef) {
      if (ef.unitId !== unit.id && ef.sourceId !== unit.id) return;
      if (ownerOf(ef) !== role) return;
      var ev = effectValue(ef, star);
      known.lo += ev.lo; known.mid += ev.mid; known.hi += ev.hi;
      if (ev.confidence === "unknown") evidenceUnknown = true;
    });
    var ud = unknown ? profile.unknownEquippedItemDelta || { lo: -0.1, mid: 0, hi: 0.1 } : { lo: 0, mid: 0, hi: 0 };
    return { lo: clamp(raw.lo + known.lo + ud.lo), mid: clamp(raw.mid + known.mid + ud.mid), hi: clamp(raw.hi + known.hi + ud.hi), confidence: evidenceUnknown ? "unknown" : raw.confidence };
  }
  function aggregate(board, role, profile, data) {
    var qs = board.map(function (entry) { var q = qFor({ id: entry.id, items: entry.items || [] }, entry.star || 1, role, profile, data); q.sourceId = entry.id; return q; });
    qs.sort(function (a, b) { return b.mid - a.mid || b.lo - a.lo || b.hi - a.hi || String(a.sourceId).localeCompare(String(b.sourceId)); });
    var ag = role === "damage" ? profile.damageAggregation : profile.frontlineAggregation, lo = 0, mid = 0, hi = 0;
    for (var i = 0; i < Math.min(ag.top, qs.length); i++) { var c = ag.coefficients[i]; lo += qs[i].lo * c; mid += qs[i].mid * c; hi += qs[i].hi * c; }
    return { lo: Math.min(ag.cap, lo), mid: Math.min(ag.cap, mid), hi: Math.min(ag.cap, hi), sources: qs };
  }
  function ownerOf(effect, defaultOwner) {
    if (effect.channel === "economy" || effect.owner === "economy" || effect.nonCombat) return "economy";
    if (effect.sourceId === "DA_Rell19" && /shield|wave/i.test(effect.mechanism || effect.effectId || "")) return "frontline";
    if (/durability|mitigation|shield|heal/i.test(effect.mechanism || "") || effect.owner === "frontline") return "frontline";
    if (effect.mechanism === "damage" || effect.owner === "damage") return "damage";
    if (UTIL.indexOf(effect.channel || effect.owner) >= 0) return "utility";
    return effect.owner === "traits" ? "traits" : (defaultOwner || "utility");
  }
  function effectValue(effect, star) {
    if (effect.byStar && effect.byStar[String(star)]) return interval(effect.byStar[String(star)]);
    if (effect.starInvariant === true) return interval(effect);
    return copy(UNKNOWN);
  }
  function sourceCompare(a, b) {
    return b.mid - a.mid || b.lo - a.lo || b.hi - a.hi || String(a.sourceId).localeCompare(String(b.sourceId));
  }
  function featureDelta(before, after, cap, top) {
    before = before.slice().sort(sourceCompare);
    after = after.slice().sort(sourceCompare);
    var b = aggregateSources(before, cap, top), a = aggregateSources(after, cap, top);
    if (JSON.stringify(before) === JSON.stringify(after)) return { before: b, after: a, delta: { lo: 0, mid: 0, hi: 0 }, dependencyUncertain: false, hasUnknown: false };
    var idsB = {}, idsA = {}, shared = true, unknownChanged = false;
    before.forEach(function (x) { idsB[x.sourceId] = x; });
    after.forEach(function (x) { idsA[x.sourceId] = x; });
    Object.keys(idsB).concat(Object.keys(idsA)).forEach(function (id) {
      if (!idsB[id] || !idsA[id] || JSON.stringify(idsB[id]) !== JSON.stringify(idsA[id])) {
        if ((idsB[id] && idsB[id].confidence === "unknown") || (idsA[id] && idsA[id].confidence === "unknown")) { shared = false; unknownChanged = true; }
      }
    });
    if (unknownChanged) return { before: b, after: a, delta: { lo: a.lo - b.hi, mid: a.mid - b.mid, hi: a.hi - b.lo }, dependencyUncertain: true, hasUnknown: true };
    var ts = [0, .25, .5, .75, 1], diffs = [], hasUnknown = false;
    before.forEach(function (x) { after.forEach(function (y) { if (x.sourceId !== y.sourceId) { addCrossover(ts, x, y.mid); addCrossover(ts, y, x.mid); } }); });
    ts.forEach(function (t) { diffs.push(aggregateAt(after, before, cap, top, t, "after") - aggregateAt(before, after, cap, top, t, "before")); });
    before.forEach(function (x) {
      if (x.confidence !== "unknown") return;
      var withoutBefore = before.filter(function (row) { return row.sourceId !== x.sourceId; }), withoutAfter = after.filter(function (row) { return row.sourceId !== x.sourceId; });
      ts.forEach(function (t) {
        var oldMarginal = aggregateAt(before, withoutBefore, cap, top, t, "after") - aggregateAt(withoutBefore, before, cap, top, t, "before");
        var newMarginal = aggregateAt(after, withoutAfter, cap, top, t, "after") - aggregateAt(withoutAfter, after, cap, top, t, "before");
        if (oldMarginal !== newMarginal) hasUnknown = true;
      });
    });
    after.forEach(function (x) { if (x.confidence === "unknown" && !idsB[x.sourceId]) hasUnknown = true; });
    return { before: b, after: a, delta: { lo: Math.min.apply(Math, diffs), mid: aggregateAt(after, before, cap, top, .5, "after") - aggregateAt(before, after, cap, top, .5, "before"), hi: Math.max.apply(Math, diffs) }, dependencyUncertain: false, hasUnknown: hasUnknown };
  }
  function addCrossover(ts, unknown, value) {
    if (value < unknown.lo || value > unknown.hi || unknown.hi === unknown.lo) return;
    var t = value <= unknown.mid && unknown.mid !== unknown.lo ? .5 * (value - unknown.lo) / (unknown.mid - unknown.lo) : .5 + .5 * (value - unknown.mid) / (unknown.hi - unknown.mid);
    if (ts.indexOf(t) < 0) ts.push(t);
  }
  function sourceValue(row, t) {
    if (t <= .5) return row.lo + (row.mid - row.lo) * t * 2;
    return row.mid + (row.hi - row.mid) * (t - .5) * 2;
  }
  function aggregateAt(rows, other, cap, top, t, side) {
    var otherById = {};
    other.forEach(function (x) { otherById[x.sourceId] = x; });
    var vals = rows.map(function (x) {
      var match = otherById[x.sourceId], shared = match && match.lo === x.lo && match.mid === x.mid && match.hi === x.hi;
      return sourceValue(x, side === "before" && !shared ? 1 - t : t);
    });
    vals.sort(function (a, b) { return b - a; });
    var coeff = top === 2 ? [1, .35] : [1, .5, .25], sum = 0;
    for (var i = 0; i < Math.min(top, vals.length); i++) sum += vals[i] * coeff[i];
    return Math.min(cap, sum);
  }
  function sourceMarginal(rows, sourceId, cap, top) {
    var all = aggregateSources(rows, cap, top), without = aggregateSources(rows.filter(function (x) { return x.sourceId !== sourceId; }), cap, top);
    return all.mid - without.mid;
  }
  function aggregateSources(rows, cap, top) {
    var lo = [], mid = [], hi = [];
    rows.forEach(function (x) { lo.push(x.lo); mid.push(x.mid); hi.push(x.hi); });
    lo.sort(function (a,b) { return b-a; }); mid.sort(function (a,b) { return b-a; }); hi.sort(function (a,b) { return b-a; });
    var coeff = top === 2 ? [1,.35] : [1,.5,.25], sums = [0,0,0];
    for (var i=0;i<Math.min(top,rows.length);i++) { sums[0]+=lo[i]*coeff[i]; sums[1]+=mid[i]*coeff[i]; sums[2]+=hi[i]*coeff[i]; }
    return { lo:Math.min(cap,sums[0]), mid:Math.min(cap,sums[1]), hi:Math.min(cap,sums[2]) };
  }
  function resolveEffects(data, profile) {
    var all = (profile.effects || []).slice(), groups = {}, result = [];
    function addRows(rows, defaults) {
      (rows || []).forEach(function (raw) {
        var e = copy(raw);
        Object.keys(defaults || {}).forEach(function (key) { if (e[key] == null) e[key] = defaults[key]; });
        all.push(e);
      });
    }
    (data.traits || []).forEach(function (trait) {
      addRows(trait.effects, { scopeKey: trait.id, owner: "traits" });
      var cfg = profile.traits && profile.traits[trait.id];
      if (cfg && cfg !== trait) addRows(cfg.effects, { scopeKey: trait.id, owner: "traits" });
    });
    (data.items || []).forEach(function (item) { addRows(item.effects, { itemId: item.id }); });
    Object.keys(profile.itemEffects || {}).forEach(function (itemId) {
      var def = profile.itemEffects[itemId];
      if (def && (def.effectId || def.id || def.owner || def.channel || def.mechanism)) addRows([def], { itemId: itemId });
    });
    Object.keys(profile.units || {}).forEach(function (id) { addRows((profile.units[id] || {}).effects, { sourceId: id }); });
    all.forEach(function (e) {
      var rell = e.sourceId === "DA_Rell19" && /shield|wave/i.test(e.mechanism || e.effectId || "");
      var key = (rell ? "DA_Rell19:exclusive-shield-wave|" : String(e.effectId || e.id) + "|") + String(e.scopeKey || e.scope || e.itemId || "team");
      var rank = PRIORITY[e.source] || 0, old = groups[key], selected = e;
      if (rell) { selected = copy(e); selected.owner = "frontline"; selected.stacking = "exclusive"; selected.stackGroup = "DA_Rell19:mounted-unmounted"; }
      if (!old || rank > old.rank) groups[key] = { effect: selected, rank: rank };
      else if (rell && rank === old.rank) { if ((e.mid || 0) > (old.effect.mid || 0)) groups[key] = { effect: selected, rank: rank }; }
      else if (rank === old.rank && (e.lo !== old.effect.lo || e.mid !== old.effect.mid || e.hi !== old.effect.hi)) groups[key] = { effect: { effectId: e.effectId || e.id, scopeKey: e.scopeKey || e.scope, owner: ownerOf(e), lo: 0, mid: .5, hi: 1, unknown: true, confidence: "unknown" }, rank: rank };
    });
    Object.keys(groups).forEach(function (key) { result.push(groups[key].effect); });
    return result;
  }
  function assess(data, before, action, context, profile) {
    profile = copy(profile || defaultProfile(data)); context = context || {};
    profile.effects = resolveEffects(data, profile);
    before = (before || []).map(function (x) { return typeof x === "string" ? { id: x, star: 1, items: [] } : copy(x); });
    action = action || { type: "noop" };
    var after = before.map(copy), blockers = [], conditions = [], type = action.type || "add", outIndex = -1, incoming, target, lowerStarReplacement = false, markChanges = [];
    if (action.afterBoard) after = action.afterBoard.map(copy);
    else if (type === "replace") {
      outIndex = indexOfUnit(after, action.out || action.outId);
      incoming = action.unit || { id: action.in || action.unitId, star: action.star || 1, items: action.items || [] };
      if (outIndex < 0 || !findUnit(data, incoming.id)) blockers.push("invalid replacement");
      else if (context.focusId && after[outIndex].id === context.focusId) blockers.push("focusId unit cannot be replaced");
      else if (after[outIndex].star === 3 && (incoming.star || 1) < 3) blockers.push("cannot replace a 3-star with a lower star");
      else {
        if (after[outIndex].star === 2 && (incoming.star || 1) === 1) lowerStarReplacement = true;
        target = findUnit(data, incoming.id);
        if (incoming.star === 3 && incoming.auto && target.cost >= 4) blockers.push("automatic 3-star chase limited to costs 1-3");
        var old = after[outIndex], newEntry = copy(incoming);
        newEntry.star = incoming.star || 1;
        if (newEntry.star === 2 && old.star !== 2 && !(context.benchCopies && (context.benchCopies[newEntry.id] || 0) >= 3)) conditions.push("bench copies required for 2-star target");
        if (!newEntry.items) newEntry.items = old.items ? old.items.slice() : [];
        var mark = old.mark, comp = profile.units && profile.units[incoming.id] && profile.units[incoming.id].markCompatibility;
        if (mark && (comp && comp[mark]) === "compatible") { newEntry.mark = mark; }
        else if (mark) { delete newEntry.mark; conditions.push("choose mark for incoming unit"); }
        after[outIndex] = newEntry;
        if (mark && newEntry.mark) markChanges.push({ from: old.id, to: incoming.id, mark: mark });
      }
    } else if (type === "add") {
      incoming = action.unit || { id: action.id || action.unitId, star: action.star || 1, items: action.items || [] };
      if (!findUnit(data, incoming.id)) blockers.push("invalid unit");
      else if (indexOfUnit(after, incoming.id) >= 0) blockers.push("duplicate unit");
      else { after.push({ id: incoming.id, star: incoming.star || 1, items: incoming.items || [] }); target = findUnit(data, incoming.id); }
    } else if (type === "starUp") {
      outIndex = indexOfUnit(after, action.id);
      if (outIndex < 0) blockers.push("unit not on board");
      else {
        target = findUnit(data, after[outIndex].id);
        after[outIndex].star = action.to || Math.min(3, after[outIndex].star + 1);
        if (after[outIndex].star === 3 && target.cost >= 4 && action.auto !== false) blockers.push("automatic 3-star chase limited to costs 1-3");
        if (after[outIndex].star === 2 && !(context.benchCopies && (context.benchCopies[after[outIndex].id] || 0) >= 3 - before[outIndex].star)) conditions.push("bench copies required for 2-star");
        if (after[outIndex].star === 3 && !(context.benchCopies && (context.benchCopies[after[outIndex].id] || 0) >= 9 - before[outIndex].star * 3)) conditions.push("bench copies required for 3-star");
      }
    } else if (type !== "noop" && !action.afterBoard) blockers.push("unsupported action");
    if (!context.shop && after.some(function (e) { return e.id === "DA_TwistedFate19" && indexOfUnit(before, e.id) < 0; })) conditions.push("崔斯特商店/刷新收益依赖未输入的商店状态");
    var seen = {}, capacity = capacityBefore(data, before, context), slots = 0;
    after.forEach(function (entry) {
      if (seen[entry.id]) blockers.push("duplicate unit " + entry.id);
      seen[entry.id] = true;
      var unit = findUnit(data, entry.id);
      if (!unit) return;
      slots += unit.slots || 1;
      if (indexOfUnit(before, entry.id) < 0 && unit.unlock && !unlocked(unit, before)) blockers.push("unlock prerequisite missing for " + entry.id);
      if (indexOfUnit(before, entry.id) < 0 && !context.allowLocked && data.shopOdds && data.shopOdds.byLevel) {
        var shopRow = data.shopOdds.byLevel[String(context.level || 8)];
        if (shopRow && (shopRow[String(unit.cost)] || 0) < (data.shopOdds.minRoll == null ? 5 : data.shopOdds.minRoll)) blockers.push("shop odds below minRoll for " + unit.id);
      }
    });
    if (capacity && slots > capacity && type !== "fit") blockers.push("population capacity exceeded");
    (data.exclusive || []).forEach(function (group) { if (group.filter(function (id) { return indexOfUnit(after, id) >= 0; }).length > 1) blockers.push("exclusive unit conflict"); });
    if (blockers.length) after = before.map(copy);
    var rows = [], score = { lo: 0, mid: 0, hi: 0, minNow: profile.minNow == null ? 2 : profile.minNow }, anyUnknown = false;
    ["damage", "frontline"].forEach(function (bucket) {
      var oldRows = sources(before, bucket, profile, data), newRows = sources(after, bucket, profile, data);
      var res = featureDelta(oldRows, newRows, 1, bucket === "damage" ? 2 : 3);
      res.sourceIds = oldRows.concat(newRows).map(function (x) { return x.sourceId; }).filter(function (id, i, all) { return all.indexOf(id) === i; });
      res.sourceChanges = res.sourceIds.map(function (id) { var bo = oldRows.filter(function (x) { return x.sourceId === id; })[0], af = newRows.filter(function (x) { return x.sourceId === id; })[0]; return { sourceId: id, effectIds: [], beforeEvidence: bo || { lo: 0, mid: 0, hi: 0 }, afterEvidence: af || { lo: 0, mid: 0, hi: 0 }, explanationOnly: true }; });
      var w = profile.weights[bucket]; addContribution(rows, score, bucket, res, w);
      if (res.dependencyUncertain || res.hasUnknown) anyUnknown = true;
    });
    var traitRes = traitFeature(data, before, after, context, profile);
    if (traitRes.bucketDeltas) {
      ["damage", "frontline"].forEach(function (bucket) {
        var contribution = rows.filter(function (x) { return x.bucket === bucket; })[0];
        var delta = traitRes.bucketDeltas[bucket] || 0;
        if (contribution && delta) { contribution.delta.lo += delta; contribution.delta.mid += delta; contribution.delta.hi += delta; score.lo += delta * profile.weights[bucket]; score.mid += delta * profile.weights[bucket]; score.hi += delta * profile.weights[bucket]; }
      });
    }
    addContribution(rows, score, "traits", traitRes, profile.weights.traits);
    if (traitRes.dependencyUncertain || traitRes.unknown) anyUnknown = true;
    var utilRes = utilityFeature(data, before, after, profile, context);
    utilRes.delta.lo += traitRes.bucketDeltas.utility || 0;
    utilRes.delta.mid += traitRes.bucketDeltas.utility || 0;
    utilRes.delta.hi += traitRes.bucketDeltas.utility || 0;
    addContribution(rows, score, "utility", utilRes, 15);
    var duty = dutyCheck(before, after, profile, data, rows);
    if (duty.blocked) blockers.push(duty.message); else if (duty.unknown) anyUnknown = true;
    after.forEach(function (entry) {
      var oldEntry = before.filter(function (x) { return x.id === entry.id; })[0];
      if (!oldEntry || JSON.stringify(oldEntry.items || []) !== JSON.stringify(entry.items || [])) {
        var legalItems = checkItems(entry.items || [], entry.id, data);
        if (!legalItems.ok) blockers.push(legalItems.reason);
      }
    });
    var status;
    if (blockers.length) status = "blocked";
    else if (anyUnknown && score.lo <= score.minNow) status = "unknown";
    else if (conditions.length) status = "conditional";
    else if (score.lo > score.minNow && !starDrop(before, after) && !lowerStarReplacement) status = "now";
    else if (score.mid > 0 || positiveTwoToOne(before, after)) status = "alternative";
    else status = "not_recommended";
    var itemMoves = [], looseItems = [];
    if (type === "replace" && before[outIndex] && after[outIndex]) (before[outIndex].items || []).forEach(function (id) { if ((after[outIndex].items || []).indexOf(id) < 0) { looseItems.push(id); itemMoves.push({ itemId: id, to: null }); } });
    var result = { candidateId: action.candidateId || String(action.id || action.unitId || (action.out || "") + ">" + (action.in || "")), inputRevision: JSON.stringify({ set: data.meta && (data.meta.set || data.meta.id), board: before }), action: copy(action), status: status, blockers: blockers, conditions: conditions, contributions: rows, score: score, risks: [], reasons: [], materialization: { added: after.filter(function (x) { return indexOfUnit(before, x.id) < 0; }), removed: before.filter(function (x) { return indexOfUnit(after, x.id) < 0; }), starChanges: [], markChanges: markChanges, itemMoves: itemMoves, looseItems: looseItems, requiresUserApply: true } };
    if (type === "starUp" && conditions.length) result.materialization.added = [];
    before.forEach(function (oldEntry) { var changed = after.filter(function (x) { return x.id === oldEntry.id; })[0]; if (changed && changed.star !== oldEntry.star) result.materialization.starChanges.push({ unitId: oldEntry.id, from: oldEntry.star, to: changed.star }); });
    if (conditions.some(function (x) { return x.indexOf("2-star") >= 0; }) && type === "replace") result.materialization.added = result.materialization.added.filter(function (x) { return x.star !== 2; });
    return result;
  }
  function capacityBefore(data, board, context) {
    if (context.capacity != null) return context.capacity;
    var base = context.level == null ? Math.max(1, board.length) : context.level + (context.extraSlots || 0);
    function addItem(id) { (data.items || []).forEach(function (item) { if (item.id === id) base += item.teamSize || 0; }); }
    board.forEach(function (entry) { (entry.items || []).forEach(addItem); });
    (context.looseItems || []).forEach(addItem);
    return base;
  }
  function findUnit(data, id) { var found = null; (data.units || []).some(function (u) { if (u.id === id) { found = u; return true; } return false; }); return found; }
  function unlocked(unit, before) { var req = unit.unlock.units || []; return req.every(function (r) { var e = before.filter(function (x) { return x.id === r.id; })[0]; return e && e.star >= (r.star || 1); }); }
  function sources(board, bucket, profile, data) { return board.map(function (e) { var q = qFor(e, e.star || 1, bucket, profile, data); q.sourceId = e.id; return q; }); }
  function addContribution(rows, score, bucket, res, weight) {
    var d = res.delta || { lo: 0, mid: 0, hi: 0 };
    rows.push({ featureId: bucket + ".coverage", bucket: bucket, sourceIds: res.sourceIds || [], before: res.before || { lo: 0, mid: 0, hi: 0 }, after: res.after || { lo: 0, mid: 0, hi: 0 }, delta: d, sourceChanges: (res.sourceChanges || []).map(function (x) { x.explanationOnly = true; return x; }), dependencyUncertain: !!res.dependencyUncertain, futureOnly: !!res.futureOnly });
    score.lo += d.lo * weight; score.mid += d.mid * weight; score.hi += d.hi * weight;
  }
  function traitFeature(data, before, after, context, profile) {
    var cap = capacityBefore(data, before, context), totalB = 0, totalA = 0, unknown = false, futureOnly = true, bucketDeltas = { damage: 0, frontline: 0, utility: 0 };
    (data.traits || []).forEach(function (tr) {
      var cfg = profile.traits && profile.traits[tr.id] || tr, bps = cfg.breakpoints || [];
      var countB = traitCount(cfg, before, data, context), countA = traitCount(cfg, after, data, context);
      var reachedB = activeBreakpoints(bps, countB, context, tr.id), reachedA = activeBreakpoints(bps, countA, context, tr.id);
      if (cfg.resolution === "replace") { reachedB = reachedB.length ? [reachedB[reachedB.length - 1]] : []; reachedA = reachedA.length ? [reachedA[reachedA.length - 1]] : []; }
      var idsB = reachedB.map(function (bp) { return bp.need; }).join(","), idsA = reachedA.map(function (bp) { return bp.need; }).join(",");
      var beneficiariesB = traitBeneficiaries(tr.id, before, data), beneficiariesA = traitBeneficiaries(tr.id, after, data);
      if (!reachedB.length && !reachedA.length) { if (countB !== countA) futureOnly = true; return; }
      if (countB === countA && idsB === idsA && beneficiariesB.join("|") === beneficiariesA.join("|")) return;
      futureOnly = false;
      var sameActive = idsB === idsA, eligibleChanged = beneficiariesB.join("|") !== beneficiariesA.join("|");
      if (!sameActive && cfg.resolution !== "replace" && cfg.resolution !== "cumulative") { unknown = true; return; }
      if (eligibleChanged && !cfg.resolution) { unknown = true; return; }
      var activeEffects = reachedA.concat(reachedB).reduce(function (ids, bp) { return ids.concat(bp.effects || []); }, []);
      if (activeEffects.some(function (id) { return !(cfg.effects || []).some(function (ef) { return ef.effectId === id && !ef.unknown && ef.verified !== false; }); })) { unknown = true; return; }
      (cfg.effects || []).forEach(function (ef) {
        var onB = effectActive(ef, reachedB), onA = effectActive(ef, reachedA);
        if (!onA && !onB) return;
        if (ef.verified === false || ef.unknown) { unknown = true; return; }
        var v = effectValue(ef, ef.star || 1);
        if (v.confidence === "unknown") { unknown = true; return; }
        var ratioB = eligibleCountForEffect(ef, before, data, cap, tr.id), ratioA = eligibleCountForEffect(ef, after, data, cap, tr.id);
        var contributionB = onB ? v.mid * ratioB : 0, contributionA = onA ? v.mid * ratioA : 0, owner = ownerOf(ef, "traits");
        if (owner === "traits") { totalB += contributionB; totalA += contributionA; }
        else if (owner === "damage" || owner === "frontline") bucketDeltas[owner] += contributionA - contributionB;
        else if (owner === "utility") bucketDeltas.utility += (contributionA - contributionB) * ((profile.weights.utility[ef.channel] || 0) / 15);
      });
    });
    var b = Math.min(1, totalB / 4), a = Math.min(1, totalA / 4), d = { lo: unknown ? -1 : a-b, mid: a-b, hi: unknown ? 1 : a-b };
    return { before: { lo: b, mid: b, hi: b }, after: { lo: a, mid: a, hi: a }, delta: d, dependencyUncertain: false, unknown: unknown, futureOnly: futureOnly && totalA === totalB, bucketDeltas: bucketDeltas };
  }
  function activeBreakpoints(bps, count, context, traitId) {
    return bps.filter(function (bp) {
      if (bp.need > count) return false;
      var hasPrismatic = context && context.prismatic && context.prismatic[traitId];
      if ((bp.prismaticStyle >= 5 || bp.style >= 5) && !hasPrismatic) return bp.style > 0 && bp.style < 5;
      return true;
    });
  }
  function effectActive(effect, breakpoints) {
    return breakpoints.some(function (bp) { return (bp.effects || []).indexOf(effect.effectId) >= 0; });
  }
  function eligibleIds(effects, board, data) {
    var ids = [];
    board.forEach(function (entry) {
      var u = findUnit(data, entry.id);
      if (u && (!effects.length || effects.some(function (ef) { return !ef.eligibleRoles || ef.eligibleRoles.indexOf(u.roleGroup) >= 0; }))) ids.push(entry.id);
    });
    return ids;
  }
  function eligibleCountForEffect(effect, board, data, capacity, traitId) {
    var n = 0;
    board.forEach(function (entry) {
      var unit = findUnit(data, entry.id), member = !traitId || traitBeneficiary(traitId, entry, data);
      if (member && (!effect.eligibleRoles || (unit && effect.eligibleRoles.indexOf(unit.roleGroup) >= 0))) n++;
    });
    return Math.min(1, n / capacity);
  }
  function traitBeneficiary(traitId, entry, data) {
    var unit = findUnit(data, entry.id), member = unit && (unit.traits || []).indexOf(traitId) >= 0;
    if (!member) (entry.items || []).forEach(function (id) { (data.items || []).forEach(function (item) { if (item.id === id && item.kind === "emblem" && item.trait === traitId) member = true; }); });
    return !!member;
  }
  function traitBeneficiaries(traitId, board, data) {
    return board.filter(function (entry) { return traitBeneficiary(traitId, entry, data); }).map(function (entry) { return entry.id; }).sort();
  }
  function traitCount(tr, board, data, context) {
    var n = 0, emblems = context && context.emblems && context.emblems[tr.id] || 0;
    board.forEach(function (entry) {
      var unit = findUnit(data, entry.id), native = unit && (unit.traits || []).indexOf(tr.id) >= 0, worn = false;
      (entry.items || []).forEach(function (id) { (data.items || []).forEach(function (item) { if (item.id === id && item.kind === "emblem" && item.trait === tr.id) worn = true; }); });
      if (native || worn) n += tr.countMode === "stars" ? (entry.star || 1) : 1;
    });
    return n + emblems;
  }
  function eligibleCount(ef, board) { return ef.eligibleCount == null ? board.length : Math.min(board.length, ef.eligibleCount); }
  function utilityFeature(data, before, after, profile, context) {
    var deltas = {}, beforeValues = { lo: 0, mid: 0, hi: 0 }, afterValues = { lo: 0, mid: 0, hi: 0 }, delta = { lo: 0, mid: 0, hi: 0 }, unknown = false, dependencyUncertain = false;
    UTIL.forEach(function (channel) {
      var b = utilityChannel(before, channel, profile), a = utilityChannel(after, channel, profile), d, wt = profile.weights.utility[channel];
      if (b.signature === a.signature) d = { lo: 0, mid: 0, hi: 0 };
      else {
        var idsB = {}, idsA = {}, distinctUnknown = false, ts = [0, .25, .5, .75, 1], diffs = [];
        b.groups.forEach(function (g) { idsB[g.sourceId] = g; });
        a.groups.forEach(function (g) { idsA[g.sourceId] = g; });
        Object.keys(idsB).concat(Object.keys(idsA)).forEach(function (id) {
          var x = idsB[id], y = idsA[id];
          if ((!x || !y || x.lo !== y.lo || x.mid !== y.mid || x.hi !== y.hi) && ((x && x.unknown) || (y && y.unknown))) distinctUnknown = true;
        });
        if (distinctUnknown) {
          dependencyUncertain = true;
          d = { lo: a.lo - b.hi, mid: a.mid - b.mid, hi: a.hi - b.lo };
          unknown = true;
        } else {
          ts.forEach(function (t) { diffs.push(utilityAt(a.groups, b.groups, channel, t, "after") - utilityAt(b.groups, a.groups, channel, t, "before")); });
          d = { lo: Math.min.apply(Math, diffs), mid: utilityAt(a.groups, b.groups, channel, .5, "after") - utilityAt(b.groups, a.groups, channel, .5, "before"), hi: Math.max.apply(Math, diffs) };
          b.groups.forEach(function (g) {
            if (!g.unknown) return;
            var withoutB = b.groups.filter(function (x) { return x.sourceId !== g.sourceId; }), withoutA = a.groups.filter(function (x) { return x.sourceId !== g.sourceId; });
            var bm = utilityAt(b.groups, withoutB, channel, .5, "after") - utilityAt(withoutB, b.groups, channel, .5, "before");
            var am = utilityAt(a.groups, withoutA, channel, .5, "after") - utilityAt(withoutA, a.groups, channel, .5, "before");
            if (bm !== am) unknown = true;
          });
        }
      }
      deltas[channel] = d;
      beforeValues.lo += b.lo * wt / 15; beforeValues.mid += b.mid * wt / 15; beforeValues.hi += b.hi * wt / 15;
      afterValues.lo += a.lo * wt / 15; afterValues.mid += a.mid * wt / 15; afterValues.hi += a.hi * wt / 15;
      delta.lo += d.lo * wt / 15; delta.mid += d.mid * wt / 15; delta.hi += d.hi * wt / 15;
      if (b.signature !== a.signature && (b.unknown || a.unknown) && !dependencyUncertain) unknown = true;
    });
    return { before: beforeValues, after: afterValues, delta: delta, channelDeltas: deltas, unknown: unknown, dependencyUncertain: dependencyUncertain };
  }
  function utilityChannel(board, channel, profile) {
    var grouped = {}, effects = (profile.effects || []).filter(function (ef) { return !ef.unitId && !ef.sourceId && !ef.itemId; });
    board.forEach(function (entry) {
      var row = profile.units && profile.units[entry.id];
      (profile.effects || []).forEach(function (ef) {
        if (ef.unitId === entry.id || ef.sourceId === entry.id || (ef.itemId && (entry.items || []).indexOf(ef.itemId) >= 0)) { var c = copy(ef); c.star = entry.star || 1; effects.push(c); }
      });
      (row && row.effects || []).forEach(function (ef) { var c = copy(ef); c.star = entry.star || 1; effects.push(c); });
    });
    var signature = [];
    effects.forEach(function (ef) {
      if (ownerOf(ef) !== "utility" || (ef.channel || ef.owner) !== channel) return;
      var value = effectValue(ef, ef.star || 1), key = [ef.stackGroup || "", ef.target || "", ef.condition || ""].join("|");
      if (ef.stacking === "additive" && ef.stackCap == null) value = copy(UNKNOWN);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ value: value, stacking: ef.stacking, stackCap: ef.stackCap, effectId: ef.effectId || ef.id || key, sourceId: ef.unitId || ef.sourceId || ef.itemId || "team" });
      signature.push([ef.effectId || ef.id || key, ef.unitId || ef.sourceId || ef.itemId || "team", ef.star || 1, JSON.stringify(ef.byStar || [ef.lo, ef.mid, ef.hi]), ef.starInvariant === true].join(":"));
    });
    signature.sort();
    var groups = [];
    Object.keys(grouped).forEach(function (key) {
      var records = grouped[key], additive = records[0].stacking === "additive", g = { sourceId: key, lo: 0, mid: 0, hi: 0, unknown: false };
      records.forEach(function (record) {
        var v = record.value;
        if (additive) { g.lo += v.lo; g.mid += v.mid; g.hi += v.hi; }
        else { g.lo = Math.max(g.lo, v.lo); g.mid = Math.max(g.mid, v.mid); g.hi = Math.max(g.hi, v.hi); }
        if (v.confidence === "unknown") g.unknown = true;
      });
      if (additive && records[0].stackCap == null) { g.lo = 0; g.mid = .5; g.hi = 1; g.unknown = true; }
      else if (additive) { g.lo = Math.min(1, records[0].stackCap, g.lo); g.mid = Math.min(1, records[0].stackCap, g.mid); g.hi = Math.min(1, records[0].stackCap, g.hi); }
      groups.push(g);
    });
    return { lo: utilityAt(groups, groups, channel, 0, "after"), mid: utilityAt(groups, groups, channel, .5, "after"), hi: utilityAt(groups, groups, channel, 1, "after"), unknown: groups.some(function (g) { return g.unknown; }), groups: groups, signature: signature.join("|") };
  }
  function utilityAt(groups, other, channel, t, side) {
    var otherById = {};
    other.forEach(function (g) { otherById[g.sourceId] = g; });
    var values = groups.map(function (g) {
      var match = otherById[g.sourceId], shared = match && match.lo === g.lo && match.mid === g.mid && match.hi === g.hi;
      return sourceValue(g, side === "before" && !shared ? 1 - t : t);
    }).sort(function (a, b) { return b - a; });
    if (channel === "control") {
      var sum = 0, coeff = [1, .5, .25];
      for (var i = 0; i < Math.min(3, values.length); i++) sum += values[i] * coeff[i];
      return Math.min(1, sum);
    }
    var prod = 1;
    values.forEach(function (value) { prod *= 1 - value; });
    return 1 - prod;
  }
  function dutyCheck(before, after, profile, data) {
    var result={blocked:false,unknown:false}, roles=["damage","frontline"];
    roles.forEach(function(role){var b=aggregate(before,role,profile,data),a=aggregate(after,role,profile,data), marked=before.some(function(e){return e.mark===(role==="damage"?"carry":"tank")|| (role==="damage"&&e.mark==="carry2");});
      if(b.lo>=.3||marked){var floor=Math.min(b.lo,.6);if(a.hi<floor){result.blocked=true;result.message=role+" duty floor lost";}else if(a.lo<floor)result.unknown=true;}
    }); return result;
  }
  function checkItems(items, unitId, data) {
    var unique = {}, emblems = {}, native = findUnit(data, unitId), slots = 0;
    for (var i = 0; i < items.length; i++) {
      var item = null;
      (data.items || []).some(function (x) { if (x.id === items[i]) { item = x; return true; } return false; });
      if (!item) return { ok: false, reason: "unknown item " + items[i] };
      slots += item.slots || 1;
      if (slots > 3) return { ok: false, reason: "more than 3 item slots" };
      if (item.unique && unique[item.id]) return { ok: false, reason: "duplicate unique item " + item.id };
      unique[item.id] = true;
      if (item.kind === "emblem" && item.trait) {
        if (native && (native.traits || []).indexOf(item.trait) >= 0) return { ok: false, reason: "emblem on native trait holder" };
        if (emblems[item.trait]) return { ok: false, reason: "duplicate same-trait emblem" };
        emblems[item.trait] = true;
      }
    }
    return { ok: true };
  }
  function starDrop(before,after){return before.some(function(x){var y=after.filter(function(z){return z.id===x.id;})[0];return y&&y.star<x.star;});}
  function positiveTwoToOne(before,after){return before.some(function(x){var y=after.filter(function(z){return z.id!==x.id;})[0];return x.star===2&&y&&y.star===1;});}
  function chasePreference(cost,level){var prefs={"5":[1,2],"6":[2,3],"7":[3]};return prefs[String(level)]&&prefs[String(level)].indexOf(cost)>=0?1:0;}
  function sortAssessments(list,context) {
    var statusOrder={now:0,alternative:1,conditional:2,unknown:3};
    return list.filter(function(x){return x.status!=="blocked"&&x.status!=="not_recommended";}).slice().sort(function(a,b){
      var x=statusOrder[a.status],y=statusOrder[b.status];if(x!==y)return x-y;
      if(a.score.lo!==b.score.lo)return b.score.lo-a.score.lo;if(a.score.mid!==b.score.mid)return b.score.mid-a.score.mid;
      if(a.risks.length!==b.risks.length)return a.risks.length-b.risks.length;
      var ap=a.preferenceMatch||0,bp=b.preferenceMatch||0;if(ap!==bp)return bp-ap;
      return String(a.candidateId).localeCompare(String(b.candidateId));
    });
  }
  return { defaultProfile: defaultProfile, assess: assess, qFor: qFor, featureDelta: featureDelta, resolveEffects: resolveEffects, sortAssessments: sortAssessments, chasePreference: chasePreference, unknown: function(){return copy(UNKNOWN);} };
})();
