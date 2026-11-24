/* Board completer. The set file supplies units, traits, items, shop odds and unlocks.
 * A cost is recommendable only when its shop chance is at least shopOdds.minRoll.
 * K/DA-style traits count star totals. Style 5 stays off until that trait is marked.
 * Population (capacity) is level + extraSlots + crown teamSize; shop odds read level only.
 */
var TFT = (function () {
  var STYLE_VALUE = { 1: 16, 2: 34, 3: 48, 4: 72, 5: 96 };
  var STYLE_NAME = { 1: "铜", 2: "银", 3: "金", 4: "彩", 5: "棱彩" };
  var STAR_MULT = [0, 1, 1.85, 3.35];
  var DAMAGE_NAME = { physical: "物理", magic: "魔法", hybrid: "混合" };
  var LANE_NAME = { front: "前排", mid: "中排", back: "后排", assassin: "切入" };
  var MAX_POP = 28;
  var THIEF_TAG = "Item.Equippable.Item.ThiefsGloves";
  var DEFAULT_ODDS = {
    minRoll: 5,
    byLevel: {
      1: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 },
      2: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 },
      3: { 1: 75, 2: 25, 3: 0, 4: 0, 5: 0 },
      4: { 1: 55, 2: 30, 3: 15, 4: 0, 5: 0 },
      5: { 1: 45, 2: 33, 3: 20, 4: 2, 5: 0 },
      6: { 1: 30, 2: 40, 3: 25, 4: 5, 5: 0 },
      7: { 1: 19, 2: 30, 3: 35, 4: 15, 5: 1 },
      8: { 1: 18, 2: 25, 3: 32, 4: 22, 5: 3 },
      9: { 1: 10, 2: 15, 3: 25, 4: 30, 5: 20 },
      10: { 1: 5, 2: 10, 3: 20, 4: 40, 5: 25 }
    }
  };

  function hasOwn(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }
  function isInt(v) { return typeof v === "number" && Math.floor(v) === v; }

  // Only relative paths, http(s) and data:image may be used; anything else is dropped.
  function safeUrl(url) {
    if (typeof url !== "string") return "";
    var v = url.trim();
    if (!v) return "";
    if (/^(https?:\/\/|data:image\/)/i.test(v)) return v;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(v) || /^[\/\\]/.test(v)) return "";
    return v;
  }

  function create(data) {
    var byId = {};
    var traitById = {};
    var itemById = {};
    data.units.forEach(function (unit) { byId[unit.id] = unit; });
    data.traits.forEach(function (trait) { traitById[trait.id] = trait; });
    (data.items || []).forEach(function (item) { itemById[item.id] = item; });
    var defaultProf = typeof TFTAssess !== "undefined" ? TFTAssess.defaultProfile(data) : null;
    function assessAction(beforeBoard, action, ctx) {
      return TFTAssess.assess(data, beforeBoard, action, ctx || {}, ctx && ctx.profile || defaultProf);
    }
    function orderedAssessmentRows(rows) {
      var byCandidate = {};
      rows.forEach(function (row) { if (row.assessment) byCandidate[row.assessment.candidateId] = row; });
      return TFTAssess.sortAssessments(rows.map(function (row) { return row.assessment; }).filter(Boolean)).map(function (a) { return byCandidate[a.candidateId]; }).filter(Boolean);
    }

    function clampStar(star) {
      star = star | 0;
      if (star < 1) return 1;
      if (star > 3) return 3;
      return star;
    }

    function slotsOf(board) {
      var n = 0;
      for (var i = 0; i < board.length; i++) n += byId[board[i].id].slots;
      return n;
    }

    function itemOf(id) { return hasOwn(itemById, id) ? itemById[id] : null; }

    function teamSizeOf(id) {
      var item = itemOf(id);
      return item ? item.teamSize || 0 : 0;
    }

    // Population: level + extra slots + crown teamSize on units and in the loose area; capped at the physical board.
    function capacity(board, ctx) {
      var n = ctx.level + (ctx.extraSlots || 0);
      for (var i = 0; i < board.length; i++) {
        var items = board[i].items || [];
        for (var j = 0; j < items.length; j++) n += teamSizeOf(items[j]);
      }
      var loose = ctx.looseItems || [];
      for (var k = 0; k < loose.length; k++) n += teamSizeOf(loose[k]);
      return Math.min(MAX_POP, n);
    }

    function room(board, ctx) { return capacity(board, ctx) - slotsOf(board); }

    // Native traits plus worn emblem traits, de-duplicated. Returns the shared array when nothing is worn.
    function effectiveTraits(entry) {
      var unit = byId[entry.id];
      var base = unit ? unit.traits : [];
      var items = entry.items || [];
      if (!items.length) return base;
      var out = base.slice();
      for (var i = 0; i < items.length; i++) {
        var info = itemOf(items[i]);
        if (info && info.kind === "emblem" && info.trait && out.indexOf(info.trait) < 0) out.push(info.trait);
      }
      return out;
    }

    function itemInvest(info) {
      if (!info) return 0;
      var tags = info.tags || [];
      if (tags.indexOf(THIEF_TAG) >= 0 || (info.kind === "basic" && info.slots >= 3)) return 6;
      if (info.kind === "emblem" || info.teamSize > 0) return 0;
      if (info.kind === "basic") return 1;
      if (info.kind === "normal" || info.kind === "radiant" || info.kind === "artifact" || info.kind === "support") return 2;
      return 0;
    }

    function investmentOfItems(ids) {
      var n = 0;
      for (var i = 0; i < ids.length; i++) n += itemInvest(itemOf(ids[i]));
      return n;
    }

    function investmentOf(entry) { return investmentOfItems(entry.items || []); }

    // Item rules for a unit's full item list. Returns an error string or null.
    function itemsProblem(unitId, items) {
      var unit = byId[unitId];
      var slots = 0;
      var seen = {};
      var emblems = {};
      for (var i = 0; i < items.length; i++) {
        var info = itemOf(items[i]);
        if (!info) return "未知装备 " + items[i];
        slots += info.slots || 1;
        if (info.unique) {
          if (seen[items[i]]) return info.name + " 不能重复佩戴";
          seen[items[i]] = 1;
        }
        if (info.kind === "emblem" && info.trait) {
          if (unit.traits.indexOf(info.trait) >= 0) return unit.display + " 已有原生羁绊，不能佩戴同羁绊纹章";
          if (emblems[info.trait]) return "同羁绊纹章不能重复佩戴";
          emblems[info.trait] = 1;
        }
      }
      if (slots > 3) return "装备槽超过 3";
      return null;
    }

    function emblemOf(ctx, traitId) {
      var bag = ctx.emblems || {};
      var v = bag[traitId];
      if (typeof v === "number") return v > 0 ? (v | 0) : 0;
      return v ? 1 : 0;
    }

    // Counts one trait. state.emblems is an extra count kept separate from worn emblems.
    function traitCount(trait, board, ctx) {
      var raw = 0;
      for (var i = 0; i < board.length; i++) {
        if (effectiveTraits(board[i]).indexOf(trait.id) < 0) continue;
        raw += trait.countMode === "stars" ? board[i].star : 1;
      }
      var emblem = emblemOf(ctx, trait.id);
      return { raw: raw, emblem: emblem, total: raw + emblem };
    }

    function prismaticOn(ctx, traitId) {
      return !!(ctx.prismatic && ctx.prismatic[traitId]);
    }

    function enabledStyle(bp, pris) {
      if (pris && bp.prismaticStyle) return bp.prismaticStyle;
      return bp.style || 0;
    }

    function breakpointState(trait, count, ctx) {
      var pris = prismaticOn(ctx, trait.id);
      var best = null;
      var next = null;
      var bps = trait.breakpoints;
      for (var i = 0; i < bps.length; i++) {
        var bp = bps[i];
        var style = enabledStyle(bp, pris);
        if (!style) continue;
        var text = style >= 5 && bp.prismaticText ? bp.prismaticText : bp.text;
        if (count >= bp.need) {
          if (!best || bp.need >= best.need) best = { need: bp.need, style: style, text: text };
        } else if (!next) {
          next = { need: bp.need, style: style, text: bp.text || bp.prismaticText || "" };
        }
      }
      var bestV = 0;
      var flatSteps = 0;
      for (var j = 0; j < bps.length; j++) {
        var step = bps[j];
        var stepStyle = enabledStyle(step, pris);
        if (!stepStyle || count < step.need) continue;
        var stepV = STYLE_VALUE[stepStyle] || 0;
        if (stepV > bestV) bestV = stepV;
        else flatSteps += 1;
      }
      var partial = 0;
      if (next) {
        var prev = best ? best.need : 0;
        var span = Math.max(1, next.need - prev);
        var prog = Math.max(0, count - prev) / span;
        var gap = (STYLE_VALUE[next.style] || 0) - bestV;
        if (gap <= 0) gap = 14;
        partial = prog * gap * 0.7;
      }
      return { best: best, next: next, value: bestV + flatSteps * 14 + partial };
    }

    function depthScale(trait) {
      var maxNeed = 0;
      var bps = trait.breakpoints;
      for (var i = 0; i < bps.length; i++) {
        if (bps[i].style) maxNeed = Math.max(maxNeed, bps[i].need);
      }
      if (maxNeed <= 2) return 0.58;
      if (maxNeed <= 4) return 0.82;
      return 1;
    }

    function buildAnchor(board, ctx) {
      var anchor = {};
      for (var i = 0; i < data.traits.length; i++) {
        var trait = data.traits[i];
        if (trait.kind === "solo") continue;
        var counted = traitCount(trait, board, ctx);
        if (counted.total < 2) continue;
        var stars = 0;
        var bodies = 0;
        for (var b = 0; b < board.length; b++) {
          if (effectiveTraits(board[b]).indexOf(trait.id) < 0) continue;
          stars += board[b].star;
          bodies += 1;
        }
        var depth = trait.countMode === "stars" ? bodies : counted.total;
        var mul = depth >= 4 ? 1.85 : depth === 3 ? 1.5 : 1.25;
        if (stars > bodies) mul += Math.min(0.35, (stars - bodies) * 0.12);
        anchor[trait.id] = mul;
      }
      return anchor;
    }

    function copyEntry(entry) {
      return {
        id: entry.id,
        star: entry.star,
        mark: entry.mark || "",
        position: entry.position ? { row: entry.position.row, col: entry.position.col } : null,
        items: (entry.items || []).slice()
      };
    }

    function unlockInfo(unit) {
      var raw = unit && unit.unlock;
      if (!raw) return null;
      if (typeof raw === "string") return { text: raw, level: 0, units: [], mode: "all" };
      return {
        text: raw.text || "",
        level: raw.level || 0,
        units: raw.units || [],
        mode: raw.mode || "all"
      };
    }

    function isLocked(unit) {
      var info = unlockInfo(unit);
      if (!info) return false;
      return !!(info.text || info.level || info.units.length);
    }

    function isBanned(ctx, unitId) {
      return !!(ctx && ctx.bannedIds && ctx.bannedIds[unitId]);
    }

    function looseFitOf(ctx, unit) {
      if (!ctx || !ctx.looseItemFit || typeof ctx.looseItemFit.scoreUnit !== "function" || !unit) return null;
      var fit = ctx.looseItemFit.scoreUnit(unit);
      if (!fit || !(fit.bonus > 0 || (fit.matchedItems && fit.matchedItems.length))) return null;
      return fit;
    }

    function collectPlanMatchedItems(adds, ctx) {
      if (!ctx || !ctx.looseItemFit || typeof ctx.looseItemFit.scoreUnit !== "function") return null;
      var seen = {};
      var out = [];
      (adds || []).forEach(function (add) {
        var id = typeof add === "string" ? add : add.id;
        var unit = byId[id];
        if (!unit) return;
        var fit = looseFitOf(ctx, unit);
        if (!fit || !fit.matchedItems) return;
        fit.matchedItems.forEach(function (itemId) {
          if (!seen[itemId]) {
            seen[itemId] = 1;
            out.push(itemId);
          }
        });
      });
      return out;
    }

    function orderNextRows(rows, ctx) {
      var ordered = orderedAssessmentRows(rows);
      if (!ctx || !ctx.looseItemFit || !ordered.some(function (r) { return r.itemFitBonus > 0; })) {
        return ordered;
      }
      var statusOrder = { now: 0, alternative: 1, conditional: 2, unknown: 3 };
      return ordered.slice().sort(function (a, b) {
        var sa = statusOrder[a.assessment.status];
        var sb = statusOrder[b.assessment.status];
        if (sa !== sb) return sa - sb;
        var aLo = a.assessment.score.lo + (a.itemFitBonus || 0) * 0.45;
        var bLo = b.assessment.score.lo + (b.itemFitBonus || 0) * 0.45;
        if (Math.abs(aLo - bLo) > 1e-9) return bLo - aLo;
        var aMid = a.assessment.score.mid + (a.itemFitBonus || 0) * 0.45;
        var bMid = b.assessment.score.mid + (b.itemFitBonus || 0) * 0.45;
        if (Math.abs(aMid - bMid) > 1e-9) return bMid - aMid;
        if (a.assessment.risks.length !== b.assessment.risks.length) return a.assessment.risks.length - b.assessment.risks.length;
        var ap = a.assessment.preferenceMatch || 0;
        var bp = b.assessment.preferenceMatch || 0;
        if (ap !== bp) return bp - ap;
        return String(a.assessment.candidateId).localeCompare(String(b.assessment.candidateId));
      });
    }

    function oddsRow(level) {
      var table = (data.shopOdds && data.shopOdds.byLevel) || DEFAULT_ODDS.byLevel;
      return table[level] || table[String(level)] || {};
    }

    function minRoll() {
      if (data.shopOdds && data.shopOdds.minRoll) return data.shopOdds.minRoll;
      return DEFAULT_ODDS.minRoll;
    }

    function rollPct(level, cost) {
      var row = oddsRow(level);
      var pct = row[cost];
      if (pct == null) pct = row[String(cost)];
      return pct == null ? 0 : pct;
    }

    function rollable(unit, ctx) {
      if (rollPct(ctx.level, unit.cost) < minRoll()) return false;
      var info = unlockInfo(unit);
      if (info && info.level && ctx.level < info.level) return false;
      return true;
    }

    function heldAt(board, id, star) {
      for (var i = 0; i < board.length; i++) {
        if (board[i].id === id && board[i].star >= (star || 1)) return true;
      }
      return false;
    }

    function hasKeys(unit, board) {
      var info = unlockInfo(unit);
      if (!info || !info.units.length) return true;
      if (info.mode === "any") {
        for (var i = 0; i < info.units.length; i++) {
          if (heldAt(board, info.units[i].id, info.units[i].star)) return true;
        }
        return false;
      }
      for (var j = 0; j < info.units.length; j++) {
        if (!heldAt(board, info.units[j].id, info.units[j].star)) return false;
      }
      return true;
    }

    function exclusiveBlocked(unit, ids) {
      var groups = data.exclusive || [];
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].indexOf(unit.id) < 0) continue;
        for (var j = 0; j < groups[i].length; j++) {
          if (groups[i][j] !== unit.id && ids[groups[i][j]]) return true;
        }
      }
      return false;
    }

    function curveOf(ctx) {
      var mode = ctx.mode || "auto";
      var row = oddsRow(ctx.level);
      var cut = mode === "fast8" ? minRoll() : 20;
      var ideal = 1;
      Object.keys(row).forEach(function (cost) {
        if (row[cost] >= cut) ideal = Math.max(ideal, Number(cost));
      });
      if (mode === "reroll") ideal = Math.min(3, ideal);
      return { ideal: ideal, floor: Math.max(1, ideal - 1), star: mode === "reroll" ? 3 : 2 };
    }

    function isCarryRole(unit) {
      if (unit.roleGroup === "marksman" || unit.roleGroup === "caster" || unit.roleGroup === "assassin" || unit.roleGroup === "fighter") return true;
      return unit.roleGroup === "specialist" && unit.lane === "back";
    }

    function isTankRole(unit) {
      return unit.roleGroup === "tank";
    }

    function realTank(unit, ctx) {
      return isTankRole(unit);
    }
    function carryScore(unit, star) {
      var weight = { marksman: 1.3, caster: 1.25, assassin: 1.2, fighter: 0.85, specialist: 0.75, tank: 0.2 }[unit.roleGroup] || 0.5;
      var ad = unit.stats.ad || (unit.dynamic ? 40 : 20);
      return Math.pow(unit.cost, 1.05) * STAR_MULT[star] * weight * (ad + unit.stats.as * 40);
    }

    function tankScore(unit, star) {
      var weight = { tank: 1.4, fighter: 0.8, specialist: 0.4, assassin: 0.15, marksman: 0.12, caster: 0.15 }[unit.roleGroup] || 0.35;
      var hp = unit.stats.hp || (unit.dynamic ? 900 : 500);
      return hp * ((unit.stats.ar || 0) + (unit.stats.mr || 0) + 20) * STAR_MULT[star] * weight * Math.pow(unit.cost, 0.35) / 1000;
    }

    function bucketScore(unit, star, tankBucket) {
      return tankBucket ? tankScore(unit, star) : carryScore(unit, star);
    }

    function goldValue(cost, star) {
      return (cost || 1) * Math.pow(3, Math.max(0, (star || 1) - 1));
    }

    function fullStatus(unit, star, curve, mode) {
      var s = star || 1;
      if (mode === "reroll") {
        if (unit.cost > 3) return "offplan";
        if (s >= 3) return "ok";
        if (s === 2) return "thin";
        return "behind";
      }
      if (s >= 3) {
        var gold = goldValue(unit.cost, s);
        if (gold >= goldValue(curve.ideal, curve.star)) return "ok";
        if (gold >= goldValue(curve.floor, curve.star)) return "thin";
      }
      if (unit.cost < curve.floor) return "behind";
      if (s < curve.star && unit.cost <= curve.ideal) return "behind";
      if (s < curve.star) return "thin";
      if (unit.cost < curve.ideal) return "thin";
      return "ok";
    }

    function costStatus(unit, curve, mode, star) {
      if (mode === "reroll") return unit.cost <= 3 ? "ok" : "offplan";
      var s = star || 1;
      if (s >= 3) {
        var gold = goldValue(unit.cost, s);
        if (gold >= goldValue(curve.ideal, curve.star)) return "ok";
        if (gold >= goldValue(curve.floor, curve.star)) return "thin";
      }
      if (unit.cost < curve.floor) return "behind";
      if (unit.cost < curve.ideal) return "thin";
      return "ok";
    }

    function traitFit(entry, board, ctx) {
      var fit = 0;
      var ids = effectiveTraits(entry);
      for (var i = 0; i < ids.length; i++) {
        var trait = traitById[ids[i]];
        if (!trait) continue;
        var state = breakpointState(trait, traitCount(trait, board, ctx).total, ctx);
        if (state.best && state.best.style > 0) fit += state.best.style * 10 + (trait.kind === "solo" ? 1 : state.best.need);
      }
      return fit;
    }
    function qualifiedTankEntry(entry, ctx, profile) {
      return isTankRole(byId[entry.id]);
    }
    // Labels are a post-score display inference and never affect assessment.
    function classify(board, ctx) {
      var mode = ctx.mode || "auto", curve = curveOf(ctx), rows = [];
      for (var i = 0; i < board.length; i++) {
        var entry = board[i], unit = byId[entry.id];
        if (!unit || entry.mark === "bot") continue;
        var damageQ = TFTAssess.qFor(entry, entry.star || 1, "damage", ctx.profile || defaultProf, data);
        var frontlineQ = TFTAssess.qFor(entry, entry.star || 1, "frontline", ctx.profile || defaultProf, data);
        rows.push({ id: entry.id, star: entry.star || 1, mark: entry.mark || "", invest: investmentOf(entry), damageQ: damageQ, frontlineQ: frontlineQ, status: fullStatus(unit, entry.star, curve, mode), carryRole: isCarryRole(unit), tankRole: isTankRole(unit), cost: unit.cost, fit: traitFit(entry, board, ctx) });
      }
      function tankRank(row) {
        var gold = goldValue(row.cost, row.star);
        var investBonus = (row.invest || 0) * 2.5;
        var traitBonus = row.fit > 0 ? 6 + Math.min(4, row.fit * 0.08) : 0;
        return gold + investBonus + traitBonus;
      }
      function cmpKey(a, b, kind) {
        var qA = kind === "carry" ? a.damageQ : a.frontlineQ, qB = kind === "carry" ? b.damageQ : b.frontlineQ;
        var tupleA = kind === "carry"
          ? [a.star, a.fit, a.cost, a.invest, qA.mid, qA.lo]
          : [tankRank(a), a.star, a.cost, a.invest, a.fit, qA.mid, qA.lo];
        var tupleB = kind === "carry"
          ? [b.star, b.fit, b.cost, b.invest, qB.mid, qB.lo]
          : [tankRank(b), b.star, b.cost, b.invest, b.fit, qB.mid, qB.lo];
        for (var k = 0; k < tupleA.length; k++) if (tupleA[k] !== tupleB[k]) return tupleB[k] - tupleA[k];
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }
      function infer(kind, skip) {
        var pool = rows.filter(function (row) {
          if (skip && skip.some(function (item) { return item.id === row.id; })) return false;
          return kind === "tank" ? qualifiedTankEntry({ id: row.id, star: row.star, mark: row.mark }, ctx, ctx.profile || defaultProf) : row.carryRole;
        });
        pool.sort(function (a, b) { return cmpKey(a, b, kind); });
        return pool.length ? [pool[0]] : [];
      }
      var markedCarry = rows.filter(function (row) { return row.mark === "carry" || row.mark === "carry2"; });
      var markedTank = rows.filter(function (row) { return row.mark === "tank" && qualifiedTankEntry({ id: row.id, star: row.star, mark: row.mark }, ctx, ctx.profile || defaultProf); });
      markedCarry.sort(function (a, b) { return (a.mark === "carry2" ? 1 : 0) - (b.mark === "carry2" ? 1 : 0) || cmpKey(a, b, "carry"); });
      var carry = markedCarry.length ? markedCarry : infer("carry"), tank = markedTank.length ? markedTank : infer("tank", carry);
      function tag(list, auto) { return list.map(function (row) { row.source = auto ? "auto" : "player"; return row; }); }
      var labels = {};
      carry.forEach(function (row) { labels[row.id] = row.mark === "carry2" ? "carry2" : "carry"; });
      tank.forEach(function (row) { labels[row.id] = "tank"; });
      var secondary = rows.filter(function (row) { return row.carryRole && row.id !== (carry[0] && carry[0].id) && row.id !== (tank[0] && tank[0].id); });
      secondary.sort(function (a, b) { return cmpKey(a, b, "carry"); });
      if (secondary.length && (secondary[0].fit > 0 || secondary[0].star >= 2 || secondary[0].cost >= 4 || secondary[0].invest >= 2) && !labels[secondary[0].id]) labels[secondary[0].id] = "carry2";
      rows.forEach(function (row) { if (labels[row.id]) return; if (row.mark === "bot") labels[row.id] = "bot"; else if (row.mark === "tank" && row.tankRole) labels[row.id] = "tank"; else if (row.mark === "carry" || row.mark === "carry2") labels[row.id] = row.mark; else if (row.invest > 0 && row.tankRole) labels[row.id] = "tank2"; else labels[row.id] = "bot"; });
      board.forEach(function (entry) { if (entry.mark === "bot") labels[entry.id] = "bot"; });
      return { curve: curve, carry: tag(carry, !markedCarry.length), tank: tag(tank, !markedTank.length), labels: labels };
    }

    function holderPenalty(board, ctx) {
      if (board.length < 4) return 0;
      var found = classify(board, ctx);
      var mode = ctx.mode || "auto";
      var curve = found.curve;
      var penalty = 0;
      if (!found.carry.length) penalty += 16;
      else {
        var carryCost = costStatus(byId[found.carry[0].id], curve, mode, found.carry[0].star);
        if (carryCost === "behind") penalty += 18;
        else if (carryCost === "offplan") penalty += 12;
      }
      if (!found.tank.length) penalty += board.length >= 6 ? 32 : 24;
      else if (costStatus(byId[found.tank[0].id], curve, mode, found.tank[0].star) === "behind") penalty += 14;
      var extraCarries = board.filter(function (e) {
        var unit = byId[e.id];
        return isCarryRole(unit) && unit.cost >= curve.floor && investmentOf(e) <= 0 && e.mark !== "bot";
      }).length;
      if (extraCarries > 2) penalty += (extraCarries - 2) * 12;
      return penalty;
    }

    function expectText(curve, ctx) {
      if ((ctx.mode || "auto") === "reroll") return "低费三星要 3 星，费用不超过 3";
      return ctx.level + " 级最好 " + curve.star + " 星 " + curve.ideal + " 费，至少 " + curve.star + " 星 " + curve.floor + " 费";
    }

    function suggest(role, board, ctx) {
      var ids = {}, shared = {};
      board.forEach(function (entry) {
        ids[entry.id] = 1;
        effectiveTraits(entry).forEach(function (tid) { shared[tid] = 1; });
      });
      var rows = [];
      for (var u = 0; u < data.units.length; u++) {
        var unit = data.units[u];
        if (ids[unit.id] || isBanned(ctx, unit.id) || !rollable(unit, ctx) || (!ctx.allowLocked && isLocked(unit)) || !hasKeys(unit, board) || exclusiveBlocked(unit, ids)) continue;
        if (!(role === "tank" ? isTankRole(unit) : isCarryRole(unit))) continue;
        var overlap = 0;
        for (var k = 0; k < unit.traits.length; k++) if (shared[unit.traits[k]]) overlap++;
        var q = TFTAssess.qFor({ id: unit.id, items: [] }, 1, role === "tank" ? "frontline" : "damage", ctx.profile || defaultProf, data);
        rows.push({ id: unit.id, overlap: overlap, q: q, pref: TFTAssess.chasePreference(unit.cost, ctx.level) });
      }
      rows.sort(function (a, b) {
        return b.overlap - a.overlap || b.q.mid - a.q.mid || b.q.lo - a.q.lo || b.pref - a.pref || (a.id < b.id ? -1 : 1);
      });
      return rows.slice(0, 3).map(function (row) { return row.id; });
    }

    function holderNotes(board, ctx) {
      var found = classify(board, ctx);
      var curve = found.curve;
      var notes = [];
      var statusName = { ok: "合适", thin: "勉强", behind: "落后", offplan: "不对口", missing: "没有" };
      function push(role, row) {
        var label = role === "tank" ? "主坦" : (row && row.mark === "carry2" ? "副C" : "主C");
        if (!row) {
          var upgrades = role === "tank" ? suggest(role, board, ctx, curve) : [];
          notes.push({
            role: role,
            label: label,
            status: "missing",
            id: "",
            source: "auto",
            text: (role === "tank" ? "没有主坦。场上全是输出，装备不够分。" : "没有" + label + "。") + expectText(curve, ctx) +
              (upgrades.length ? "。可换上：" + upgrades.map(function (id) { return byId[id].display; }).join("、") : ""),
            upgrades: upgrades
          });
          return;
        }
        var unit = byId[row.id];
        var mode = ctx.mode || "auto";
        var prefix = row.source === "auto" ? "推测" : "";
        var starGap = mode !== "reroll" && row.star < curve.star && unit.cost >= curve.ideal;
        var replace = !starGap && (row.status === "behind" || row.status === "offplan" || (row.status === "thin" && unit.cost < curve.ideal));
        var starLine = starGap ? "先升到 " + curve.star + " 星。" : "";
        var goldOk = mode !== "reroll" && row.star >= 3 && unit.cost < curve.ideal && row.status === "ok";
        var noteText = goldOk
          ? prefix + label + " " + unit.display + " " + row.star + " 星 " + unit.cost + " 费（价值 " + goldValue(unit.cost, row.star) + " 金），" + statusName[row.status] + "。"
          : prefix + label + " " + unit.display + " " + row.star + " 星 " + unit.cost + " 费，" + statusName[row.status] + "。" + starLine + expectText(curve, ctx);
        notes.push({
          role: role,
          label: label,
          status: row.status,
          id: row.id,
          source: row.source,
          text: noteText,
          upgrades: row.status === "ok" || !replace ? [] : suggest(role, board, ctx, curve)
        });
      }
      if (!found.carry.length) push("carry", null);
      else found.carry.forEach(function (row) { push("carry", row); });
      if (!found.tank.length) push("tank", null);
      else found.tank.forEach(function (row) { push("tank", row); });
      if (found.carry.length) {
        var carry2Names = board.filter(function (entry) { return found.labels[entry.id] === "carry2"; })
          .map(function (entry) { return byId[entry.id].display; });
        if (carry2Names.length >= 2) notes.push({
          role: "carry2", label: "副C", status: "offplan", id: "", source: "auto",
          text: "场上副C过多（" + carry2Names.join("、") + "），装备不够分。建议只留 1 个副C，其余换成前排坦克。",
          upgrades: []
        });
      }
      return { curve: curve, notes: notes };
    }

    function keepReport(board) {
      var out = [];
      for (var i = 0; i < board.length; i++) {
        var targets = [];
        var needStar = 1;
        for (var u = 0; u < data.units.length; u++) {
          var info = unlockInfo(data.units[u]);
          if (!info) continue;
          for (var r = 0; r < info.units.length; r++) {
            if (info.units[r].id !== board[i].id) continue;
            targets.push(data.units[u].display);
            if (info.units[r].star > needStar) needStar = info.units[r].star;
          }
        }
        if (!targets.length) continue;
        var label = board[i].star >= needStar
          ? "留着，用来解锁 " + targets.join("、")
          : "留着并升到 " + needStar + " 星，用来解锁 " + targets.join("、");
        out.push({ id: board[i].id, label: label, targets: targets });
      }
      return out;
    }

    function lockNotes(board, ctx, suggested) {
      var counts = {};
      for (var i = 0; i < board.length; i++) {
        var traits = effectiveTraits(board[i]);
        for (var t = 0; t < traits.length; t++) counts[traits[t]] = (counts[traits[t]] || 0) + 1;
      }
      var owned = boardIds(board);
      var notes = [];
      for (var u = 0; u < data.units.length; u++) {
        var unit = data.units[u];
        if (owned[unit.id]) continue;
        var info = unlockInfo(unit);
        if (!info || !info.units.length) continue;
        if (info.level && ctx.level < info.level) continue;
        if (hasKeys(unit, board)) continue;
        var played = false;
        for (var k = 0; k < unit.traits.length; k++) {
          var trait = traitById[unit.traits[k]];
          if (trait && trait.kind !== "solo" && counts[trait.id] >= 2) played = true;
        }
        if (!played) continue;
        if (!suggested || !suggested[unit.id]) continue;
        var names = info.units.map(function (req) {
          var name = byId[req.id] ? byId[req.id].display : req.id;
          return (req.star > 1 ? req.star + " 星 " : "") + name;
        });
        notes.push({
          id: unit.id,
          text: "解锁「" + unit.display + "」需要场上留着 " + names.join(info.mode === "any" ? " 或 " : "、")
        });
      }
      return notes.slice(0, 4);
    }

    function oddsView(level) {
      var row = oddsRow(level);
      var costs = Object.keys(row).map(Number).sort(function (a, b) { return a - b; });
      return costs.map(function (cost) {
        return { cost: cost, pct: row[cost] || row[String(cost)] || 0, on: (row[cost] || 0) >= minRoll() };
      });
    }

    function isFront(unit) {
      return unit.lane === "front" || unit.lane === "assassin" || unit.roleGroup === "tank" || unit.roleGroup === "fighter";
    }

    function isBack(unit) {
      return unit.lane === "back" || unit.roleGroup === "marksman" || unit.roleGroup === "caster";
    }

    function coveragePenalty(board) {
      if (board.length < 4) return 0;
      var front = 0;
      var back = 0;
      for (var i = 0; i < board.length; i++) {
        var unit = byId[board[i].id];
        if (isFront(unit)) front++;
        if (isBack(unit)) back++;
      }
      var penalty = 0;
      if (front === 0) penalty += 36;
      else if (board.length >= 6 && front < 2) penalty += 18;
      if (back === 0) penalty += 26;
      else if (board.length >= 6 && back < 2) penalty += 10;
      return penalty;
    }

    function unitValue(unit, star, ctx) {
      var value = Math.pow(unit.cost, 1.12) * 4.2 * STAR_MULT[star];
      var mode = ctx.mode || "auto";
      if (mode === "reroll") {
        if (unit.cost <= 3) value *= 1.35;
        else value *= 0.42;
        if (star === 3 && unit.cost <= 3) value += 16;
        if (unit.grantsUnit && unit.cost <= 3) value += 26 * STAR_MULT[star];
      } else if (mode === "fast8") {
        if (unit.cost <= 2) value *= 0.34;
        else if (unit.cost === 3) value *= 0.72;
        else value *= 1.16;
      } else {
        var cap = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 7 }[ctx.level] || 5;
        if (unit.cost > cap) value -= (unit.cost - cap) * 10;
        if (unit.cost >= 7 && ctx.level < 9) value -= 40;
        if (ctx.level >= 8 && unit.cost === 1) value -= 3;
      }
      if (unit.slots > 1) value -= 12;
      return value;
    }

    function evaluate(board, ctx, opt) {
      var mains = [];
      var solos = 0;
      var details = [];
      for (var i = 0; i < data.traits.length; i++) {
        var trait = data.traits[i];
        var counted = traitCount(trait, board, ctx);
        if (!counted.total) continue;
        var state = breakpointState(trait, counted.total, ctx);
        var weighted = trait.kind === "solo" ? 6 : state.value;
        if (trait.kind === "solo") solos += weighted;
        else {
          if (trait.kind === "band") weighted *= 1.22;
          weighted *= depthScale(trait);
          if (ctx.anchor && ctx.anchor[trait.id]) weighted *= ctx.anchor[trait.id];
          if (opt && opt.focus === trait.id) weighted *= opt.focusMul || 1.85;
          mains.push(weighted);
        }
        details.push({
          id: trait.id,
          name: trait.name,
          kind: trait.kind,
          countMode: trait.countMode,
          raw: counted.raw,
          emblem: counted.emblem,
          count: counted.total,
          best: state.best,
          next: state.next,
          desc: trait.desc,
          icon: trait.icon,
          prismatic: trait.prismatic,
          breakpoints: trait.breakpoints
        });
      }
      mains.sort(function (a, b) { return b - a; });
      var falloff = [1, 0.62, 0.36, 0.2, 0.12];
      var traitPart = solos;
      for (var m = 0; m < mains.length; m++) traitPart += mains[m] * (falloff[m] || 0.08);
      var bodies = 0;
      for (var j = 0; j < board.length; j++) bodies += unitValue(byId[board[j].id], board[j].star, ctx);
      var penalty = coveragePenalty(board) + holderPenalty(board, ctx);
      details.sort(function (a, b) {
        var ak = a.kind === "solo" ? 1 : 0;
        var bk = b.kind === "solo" ? 1 : 0;
        if (ak !== bk) return ak - bk;
        var as = a.best ? a.best.style : 0;
        var bs = b.best ? b.best.style : 0;
        if (bs !== as) return bs - as;
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "zh");
      });
      return { total: traitPart + bodies - penalty, traitPart: traitPart, traits: details };
    }

    function boardIds(board) {
      var ids = {};
      for (var i = 0; i < board.length; i++) ids[board[i].id] = 1;
      return ids;
    }

    function legal(board, ctx, remain) {
      var ids = boardIds(board);
      var out = [];
      for (var i = 0; i < data.units.length; i++) {
        var unit = data.units[i];
        if (ids[unit.id]) continue;
        if (isBanned(ctx, unit.id)) continue;
        if (unit.slots > remain) continue;
        if (!rollable(unit, ctx)) continue;
        if (!ctx.allowLocked && isLocked(unit)) continue;
        if (!hasKeys(unit, board)) continue;
        if (exclusiveBlocked(unit, ids)) continue;
        out.push(unit);
      }
      return out;
    }

    // Shares a non-solo trait (native or worn emblem) with the board.
    function sharesCore(unit, board) {
      var shared = {};
      for (var i = 0; i < board.length; i++) {
        var traits = effectiveTraits(board[i]);
        for (var t = 0; t < traits.length; t++) {
          var trait = traitById[traits[t]];
          if (trait && trait.kind !== "solo") shared[traits[t]] = 1;
        }
      }
      return unit.traits.some(function (id) {
        var trait = traitById[id];
        return !!trait && trait.kind !== "solo" && !!shared[id];
      });
    }

    // Foreign units (no shared non-solo trait) are never offered; low-cost ones must activate or advance a trait.
    function admissible(unit, board, ctx) {
      if (!board.length) return true;
      if (!sharesCore(unit, board)) return false;
      if (unit.cost >= curveOf(ctx).floor) return true;
      var trial = board.concat([{ id: unit.id, star: 1, mark: "" }]);
      return reasons(board, trial, ctx).length > 0;
    }

    function shortlist(board, ctx, opt, remain) {
      var base = evaluate(board, ctx, opt);
      var rows = [];
      var units = legal(board, ctx, remain).filter(function (unit) { return admissible(unit, board, ctx); });
      for (var i = 0; i < units.length; i++) {
        var unit = units[i];
        var trial = board.concat([{ id: unit.id, star: 1 }]);
        var ev = evaluate(trial, ctx, opt);
        var fit = looseFitOf(ctx, unit);
        var fitDelta = fit && fit.bonus > 0 ? fit.bonus * 0.6 : 0;
        rows.push({ id: unit.id, delta: ev.total - base.total + fitDelta, trait: ev.traitPart - base.traitPart, score: ev.total });
      }
      rows.sort(function (a, b) { return b.delta - a.delta || (a.id < b.id ? -1 : 1); });
      var picked = [];
      var seen = {};
      for (var j = 0; j < rows.length && picked.length < 10; j++) {
        seen[rows[j].id] = 1;
        picked.push(rows[j]);
      }
      rows.sort(function (a, b) { return b.trait - a.trait || b.delta - a.delta; });
      for (var k = 0; k < rows.length && picked.length < 14; k++) {
        if (seen[rows[k].id] || rows[k].trait <= 0) continue;
        seen[rows[k].id] = 1;
        picked.push(rows[k]);
      }
      return picked;
    }

    function fill(start, ctx, opt) {
      var width = (opt && opt.beam) || 8;
      var beam = [{ board: start.map(copyEntry), adds: [], score: evaluate(start, ctx, opt).total }];
      for (var step = 0; step < 12; step++) {
        var next = [];
        var grew = false;
        for (var b = 0; b < beam.length; b++) {
          var state = beam[b];
          var remain = room(state.board, ctx);
          if (remain <= 0) {
            next.push(state);
            continue;
          }
          var cands = shortlist(state.board, ctx, opt, remain);
          var added = false;
          for (var c = 0; c < cands.length; c++) {
            if (cands[c].delta <= 0.2) continue;
            added = true;
            grew = true;
            next.push({
              board: state.board.concat([{ id: cands[c].id, star: 1, mark: "" }]),
              adds: state.adds.concat([cands[c].id]),
              score: cands[c].score
            });
          }
          if (!added) next.push(state);
        }
        if (!grew) break;
        next.sort(function (a, b) { return b.score - a.score; });
        var dedup = [];
        var seen = {};
        for (var n = 0; n < next.length && dedup.length < width; n++) {
          var key = next[n].board.map(function (e) { return e.id; }).sort().join("|");
          if (seen[key]) continue;
          seen[key] = 1;
          dedup.push(next[n]);
        }
        beam = dedup;
      }
      beam.sort(function (a, b) { return b.score - a.score; });
      return beam[0];
    }

    function countLabel(traitMode, count) {
      return traitMode === "stars" ? count + "★" : String(count);
    }

    function reasons(before, after, ctx) {
      var ids = {};
      function mark(board) {
        for (var i = 0; i < board.length; i++) {
          var traits = effectiveTraits(board[i]);
          for (var t = 0; t < traits.length; t++) ids[traits[t]] = 1;
        }
      }
      mark(before);
      mark(after);
      var lines = [];
      Object.keys(ids).forEach(function (id) {
        var trait = traitById[id];
        if (!trait) return;
        var c0 = traitCount(trait, before, ctx).total;
        var c1 = traitCount(trait, after, ctx).total;
        if (c0 === c1) return;
        var s0 = breakpointState(trait, c0, ctx);
        var s1 = breakpointState(trait, c1, ctx);
        var n0 = s0.best ? s0.best.need : 0;
        var n1 = s1.best ? s1.best.need : 0;
        if (n1 > n0) {
          lines.push({ gain: trait.kind === "solo" ? 1 : 2, text: trait.name + " " + countLabel(trait.countMode, c0) + "→" + countLabel(trait.countMode, c1) + "，" + n1 + STYLE_NAME[s1.best.style] });
        } else if (c1 > c0 && s1.next) {
          lines.push({ gain: 1, text: trait.name + " " + countLabel(trait.countMode, c1) + "/" + s1.next.need });
        }
      });
      lines.sort(function (a, b) { return b.gain - a.gain || a.text.localeCompare(b.text, "zh"); });
      return lines.slice(0, 4).map(function (line) { return line.text; });
    }

    function activeSummary(ev) {
      return ev.traits.filter(function (t) { return t.best && t.kind !== "solo"; }).map(function (t) {
        return t.name + " " + countLabel(t.countMode, t.count) + STYLE_NAME[t.best.style];
      });
    }

    function biggestGain(before, after, ctx) {
      var best = null;
      for (var i = 0; i < data.traits.length; i++) {
        var trait = data.traits[i];
        if (trait.kind === "solo") continue;
        var c0 = traitCount(trait, before, ctx).total;
        var c1 = traitCount(trait, after, ctx).total;
        var v0 = breakpointState(trait, c0, ctx).value;
        var v1 = breakpointState(trait, c1, ctx).value;
        var delta = (trait.kind === "band" ? 1.22 : 1) * (v1 - v0);
        if (delta > 0.5 && (!best || delta > best.delta)) best = { id: trait.id, name: trait.name, delta: delta };
      }
      return best;
    }

    function traitChangesOf(before, after, ctx) {
      var out = [];
      for (var i = 0; i < data.traits.length; i++) {
        var trait = data.traits[i];
        if (trait.kind === "solo") continue;
        var c0 = traitCount(trait, before, ctx).total;
        var c1 = traitCount(trait, after, ctx).total;
        if (c0 !== c1) out.push({ id: trait.id, name: trait.name, from: c0, to: c1 });
      }
      return out;
    }

    function materialize(start, result, ctx, title) {
      var adds = result.adds.map(function (id) { return { id: id, star: 1, mark: "", items: [] }; });
      var board = start.map(copyEntry).concat(adds);
      var ev = evaluate(board, ctx, null);
      var gain = biggestGain(start, board, ctx);
      var plan = {
        title: title || (gain ? "补「" + gain.name + "」" : "补强散件"),
        focus: gain ? gain.name : "",
        adds: adds,
        board: board,
        looseItems: (ctx.looseItems || []).slice(),
        removes: [],
        itemTransfers: [],
        requiredStars: 1,
        requiredLevel: ctx.level,
        traitChanges: traitChangesOf(start, board, ctx),
        reasons: reasons(start, board, ctx),
        traits: activeSummary(ev),
        slots: slotsOf(board),
        score: ev.total
      };
      var matchedItems = collectPlanMatchedItems(adds, ctx);
      if (matchedItems) plan.matchedItems = matchedItems;
      return plan;
    }

    function dedupePlans(plans) {
      var seen = {};
      var out = [];
      plans.sort(function (a, b) { return b.score - a.score; });
      for (var i = 0; i < plans.length; i++) {
        var key = plans[i].adds.map(function (a) { return a.id; }).sort().join("|");
        if (!key || seen[key]) continue;
        seen[key] = 1;
        out.push(plans[i]);
      }
      return out;
    }

    function openings(ctx) {
      var plans = [];
      var bands = data.traits.filter(function (t) { return t.kind === "band" && t.champions.length >= 3; });
      for (var i = 0; i < bands.length; i++) {
        var band = bands[i];
        var filled = fill([], ctx, { focus: band.id, focusMul: 2.3, beam: 3 });
        var count = traitCount(band, filled.board, ctx).total;
        var styled = band.breakpoints.filter(function (bp) { return bp.style; });
        var room0 = band.countMode === "stars" ? band.champions.length : Math.min(ctx.level, band.champions.length);
        var goal = styled.length ? styled[0].need : 99;
        for (var g = 0; g < styled.length; g++) {
          if (styled[g].need <= room0) goal = styled[g].need;
        }
        if (count < goal) continue;
        plans.push(materialize([], filled, ctx, "起步「" + band.name + "」"));
      }
      var ranked = dedupePlans(plans);
      if (ranked.length < 2) {
        var mixed = fill([], ctx, { beam: 6 });
        ranked = dedupePlans(ranked.concat([materialize([], mixed, ctx, "综合起步")]));
      }
      return ranked.slice(0, 3);
    }

    function enginePlans(start, ctx) {
      if ((ctx.mode || "auto") !== "reroll") return [];
      var plans = [];
      for (var i = 0; i < data.units.length; i++) {
        var unit = data.units[i];
        if (!unit.grantsUnit || unit.cost > 3) continue;
        var owned = false;
        for (var s = 0; s < start.length; s++) if (start[s].id === unit.id) owned = true;
        if (!owned && (isBanned(ctx, unit.id) || !rollable(unit, ctx) || (!ctx.allowLocked && isLocked(unit)) || !hasKeys(unit, start))) continue;
        var seed = start.map(copyEntry);
        if (!owned) {
          if (unit.slots > room(seed, ctx)) continue;
          seed = seed.concat([{ id: unit.id, star: 1, mark: "" }]);
        }
        var filled = fill(seed, ctx, { beam: 4 });
        var adds = filled.adds.slice();
        if (!owned) adds.unshift(unit.id);
        if (!adds.length) continue;
        plans.push(materialize(start, { adds: adds, score: filled.score }, ctx, "三星引擎「" + unit.display + "」"));
      }
      return plans;
    }

    // Drops the lowest-impact units until population fits. The focus unit is never dropped.
    function fit(owned, ctx) {
      var kept = owned.map(copyEntry), dropped = [], focus = ctx.focusId || null, conflict = false;
      function key(entry) {
        var unit = byId[entry.id], d = TFTAssess.qFor(entry, entry.star || 1, "damage", ctx.profile || defaultProf, data);
        var f = TFTAssess.qFor(entry, entry.star || 1, "frontline", ctx.profile || defaultProf, data);
        return [entry.star || 1, entry.mark && entry.mark !== "bot" ? 1 : 0, investmentOf(entry), Math.max(d.mid, f.mid), Math.max(d.lo, f.lo), TFTAssess.chasePreference(unit.cost, ctx.level)];
      }
      function less(a, b) {
        var ka = key(a), kb = key(b);
        for (var j = 0; j < ka.length; j++) if (ka[j] !== kb[j]) return ka[j] < kb[j];
        return a.id > b.id;
      }
      var guard = 0;
      while (room(kept, ctx) < 0 && kept.length && guard++ < 24) {
        var best = -1;
        for (var i = 0; i < kept.length; i++) {
          if (kept[i].id === focus) continue;
          var trial = kept.slice(0, i).concat(kept.slice(i + 1));
          var assessment = assessAction(kept, { type: "fit", afterBoard: trial, candidateId: "fit:" + kept[i].id }, ctx);
          if (assessment.status === "blocked") continue;
          if (best < 0 || less(kept[i], kept[best])) best = i;
        }
        if (best < 0) { conflict = true; break; }
        dropped.push(kept[best]);
        kept = kept.slice(0, best).concat(kept.slice(best + 1));
      }
      return { kept: kept, dropped: dropped, conflict: conflict };
    }

    function committedTraits(board, ctx) {
      var ranked = [];
      for (var i = 0; i < data.traits.length; i++) {
        var trait = data.traits[i];
        if (trait.kind === "solo") continue;
        var count = traitCount(trait, board, ctx).total;
        if (!count) continue;
        var state = breakpointState(trait, count, ctx);
        if (!state.best && count < 2) continue;
        var value = state.value * (trait.kind === "band" ? 1.22 : 1);
        ranked.push({ trait: trait, value: value, count: count });
      }
      ranked.sort(function (a, b) { return b.value - a.value || b.count - a.count; });
      return ranked;
    }

    function nextBuys(kept, ctx) {
      var remain = room(kept, ctx);
      if (remain <= 0) return [];
      var rows = [], units = legal(kept, ctx, remain).filter(function (unit) { return admissible(unit, kept, ctx); });
      for (var i = 0; i < units.length; i++) {
        var trial = kept.concat([{ id: units[i].id, star: 1, items: [] }]);
        var assessment = assessAction(kept, { type: "add", id: units[i].id, star: 1, candidateId: "add:" + units[i].id }, ctx);
        if (assessment.status === "blocked" || assessment.status === "not_recommended") continue;
        assessment.preferenceMatch = TFTAssess.chasePreference(units[i].cost, ctx.level);
        var row = { id: units[i].id, delta: assessment.score.mid, reasons: reasons(kept, trial, ctx), assessment: assessment };
        var fit = looseFitOf(ctx, units[i]);
        if (fit && fit.matchedItems && fit.matchedItems.length) {
          row.matchedItems = fit.matchedItems.slice();
          row.itemFitBonus = fit.bonus || 0;
        }
        rows.push(row);
      }
      return orderNextRows(rows, ctx).slice(0, 6);
    }

    function starUps(kept, ctx) {
      var found = classify(kept, ctx), primaryId = found.carry[0] && found.carry[0].id, tankId = found.tank[0] && found.tank[0].id;
      var rows = [], base = evaluate(kept, ctx, null).total;
      for (var i = 0; i < kept.length; i++) {
        var entry = kept[i], unit = byId[entry.id];
        if (entry.star >= 3 || (entry.star === 2 && unit.cost >= 4)) continue;
        var trial = kept.map(function (e, idx) { var c = copyEntry(e); if (idx === i) c.star = e.star + 1; return c; });
        var why = reasons(kept, trial, ctx), delta = evaluate(trial, ctx, null).total - base;
        var eligible = entry.id === primaryId || entry.id === tankId || investmentOf(entry) > 0 || ["carry", "carry2", "tank"].indexOf(entry.mark) >= 0;
        var priority = delta + (why.length ? 28 : 0) + (eligible ? 36 : 0);
        if (ctx.mode === "reroll" && unit.grantsUnit) priority += 24;
        if (entry.mark === "bot" && !why.length) continue;
        var row = { id: entry.id, from: entry.star, to: entry.star + 1, delta: delta, priority: priority, reasons: why };
        row.assessment = assessAction(kept, { type: "starUp", id: entry.id, from: entry.star, to: entry.star + 1, auto: true, candidateId: "starUp:" + entry.id }, ctx);
        row.assessment.preferenceMatch = TFTAssess.chasePreference(unit.cost, ctx.level);
        if (row.assessment.status !== "blocked") rows.push(row);
      }
      return orderedAssessmentRows(rows).slice(0, 3);
    }

    function sameBucket(a, b) {
      if (isTankRole(a)) return isTankRole(b);
      return !isTankRole(b) && b.roleGroup === a.roleGroup;
    }

    function damageOk(a, b) {
      return a.damageType === b.damageType || a.damageType === "hybrid" || b.damageType === "hybrid";
    }

    // Puts inn into slot i with out's items, mark and position. Emblems native to inn are discarded.
    // Returns null when the result breaks item rules or population.
    function replacement(kept, i, inn, star, ctx) {
      var out = kept[i];
      var dropped = [];
      var items = [];
      out.items.forEach(function (itemId) {
        var info = itemOf(itemId);
        if (info && info.kind === "emblem" && info.trait && inn.traits.indexOf(info.trait) >= 0) dropped.push(itemId);
        else items.push(itemId);
      });
      if (itemsProblem(inn.id, items)) return null;
      var mark = out.mark || "", prof = ctx.profile || defaultProf;
      var compatibility = mark && prof.units && prof.units[inn.id] && prof.units[inn.id].markCompatibility && prof.units[inn.id].markCompatibility[mark];
      var entry = {
        id: inn.id,
        star: star,
        mark: compatibility === "compatible" ? mark : "",
        position: out.position ? { row: out.position.row, col: out.position.col } : null,
        items: items
      };
      var board = kept.map(function (e, idx) { return idx === i ? entry : copyEntry(e); });
      var looseAfter = (ctx.looseItems || []).slice();
      if (slotsOf(board) > capacity(board, Object.assign({}, ctx, { looseItems: looseAfter }))) return null;
      return { board: board, entry: entry, dropped: dropped, items: items, looseAfter: looseAfter };
    }

    function replaceRow(kept, i, inn, rep, ctx, star, extra) {
      var out = kept[i];
      var names = rep.dropped.map(function (id) { return itemOf(id).name; });
      var text = inn.display + " " + star + "★ 替换 " + byId[out.id].display + " " + out.star + "★";
      text += star === 1 ? "，现在可换" : "，等到 2 星再换";
      if (names.length) text += "；原有纹章「" + names.join("、") + "」与新单位羁绊重复，已丢弃";
      return Object.assign({
        out: out.id,
        inn: inn.id,
        requiredStars: star,
        requiredLevel: ctx.level,
        board: rep.board,
        looseItems: rep.looseAfter,
        removes: [out.id],
        itemTransfers: [{ from: out.id, to: inn.id, items: rep.items }],
        adds: [{ id: inn.id, star: star, mark: rep.entry.mark }],
        traitChanges: traitChangesOf(kept, rep.board, ctx),
        reasons: reasons(kept, rep.board, ctx),
        text: text
      }, extra);
    }

    // A swap must keep every active trait level and either raise cost or lift the carry's native trait count.
    function swapHelps(kept, index, innUnit, ctx) {
      var found = classify(kept, ctx), outId = kept[index].id;
      var carryId = found.carry[0] ? found.carry[0].id : null, tankId = found.tank[0] ? found.tank[0].id : null;
      if (outId === carryId || outId === tankId) return false;
      var after = kept.map(function (e, idx) { return idx === index ? { id: innUnit.id, star: 1, items: e.items, mark: "" } : e; });
      function topNeed(trait, board) {
        var count = traitCount(trait, board, ctx).total, pris = prismaticOn(ctx, trait.id), top = 0;
        trait.breakpoints.forEach(function (bp) { if (count >= bp.need && enabledStyle(bp, pris) > 0) top = Math.max(top, bp.need); });
        return top;
      }
      for (var t = 0; t < data.traits.length; t++) {
        var trait = data.traits[t];
        if (trait.kind === "solo") continue;
        if (topNeed(trait, after) < topNeed(trait, kept)) return false;
      }
      if (innUnit.cost > byId[outId].cost) return true;
      if (!carryId) return false;
      return byId[carryId].traits.some(function (tid) {
        var native = traitById[tid];
        return !!native && traitCount(native, after, ctx).total > traitCount(native, kept, ctx).total;
      });
    }

    // Core upgrades: same shared trait, same role bucket, compatible damage, higher cost, legal now.
    // 1-star is immediate when its strength beats the outgoing unit; otherwise 2-star is offered as later.
    function coreUpgrades(kept, ctx) {
      var focus = ctx.focusId || null, rows = [];
      for (var i = 0; i < kept.length; i++) {
        var out = kept[i], outUnit = byId[out.id];
        if (out.id === focus || out.star === 3) continue;
        var without = kept.slice(0, i).concat(kept.slice(i + 1));
        var units = legal(without, ctx, 99);
        for (var u = 0; u < units.length; u++) {
          var inn = units[u];
          if (!sharesCore(inn, [out]) || !sameBucket(outUnit, inn) || !damageOk(outUnit, inn)) continue;
          for (var star = 1; star <= 2; star++) {
            if (star === 2 && out.star < 2) continue;
            var rep = replacement(kept, i, inn, star, ctx);
            if (!rep) continue;
            var candidateId = "swap:" + out.id + ">" + inn.id + "@" + star;
            var assessment = assessAction(kept, { type: "replace", out: out.id, in: inn.id, star: star, items: rep.items, candidateId: candidateId }, ctx);
            assessment.preferenceMatch = TFTAssess.chasePreference(inn.cost, ctx.level);
            if (assessment.status === "blocked" || !swapHelps(kept, i, inn, ctx)) continue;
            var shownRep = rep;
            if (star === 2 && !(ctx.benchCopies && (ctx.benchCopies[inn.id] || 0) >= 3)) {
              shownRep = replacement(kept, i, inn, 1, ctx) || rep;
            }
            var row = replaceRow(kept, i, inn, shownRep, ctx, star, {
              innCost: inn.cost, gain: assessment.score.mid, strength: { out: 0, inn: assessment.score.mid },
              outInv: investmentOfItems(out.items) + (out.mark === "carry" || out.mark === "tank" ? 4 : out.mark === "carry2" ? 2 : 0),
              assessment: assessment
            });
            rows.push(row);
          }
        }
      }
      rows = orderedAssessmentRows(rows);
      return rows.slice(0, 4);
    }

    // Full-board swaps: replacement that adds real trait value (delta > 1).
    function fullSwaps(kept, ctx) {
      var rows = [];
      for (var i = 0; i < kept.length; i++) {
        var outgoing = kept[i];
        if (outgoing.id === ctx.focusId || outgoing.star === 3) continue;
        var without = kept.slice(0, i).concat(kept.slice(i + 1));
        var units = legal(without, ctx, 99);
        for (var u = 0; u < units.length; u++) {
          var rep = replacement(kept, i, units[u], 1, ctx);
          if (!rep) continue;
          var candidateId = "fullSwap:" + outgoing.id + ">" + units[u].id;
          var assessment = assessAction(kept, { type: "replace", out: outgoing.id, in: units[u].id, star: 1, items: rep.items, candidateId: candidateId }, ctx);
          if (assessment.status === "blocked" || !swapHelps(kept, i, units[u], ctx)) continue;
          rows.push(replaceRow(kept, i, units[u], rep, ctx, 1, { delta: assessment.score.mid, assessment: assessment }));
        }
      }
      rows = orderedAssessmentRows(rows);
      var seen = {}, out = [];
      for (var r = 0; r < rows.length && out.length < 3; r++) {
        var key = rows[r].out + ">" + rows[r].inn;
        if (seen[key]) continue;
        seen[key] = 1; out.push(rows[r]);
      }
      return out;
    }

    function swaps(kept, ctx) {
      var core = coreUpgrades(kept, ctx);
      if (room(kept, ctx) > 0 || kept.length < 2) return orderedAssessmentRows(core);
      var tankReplacements = [];
      if (!kept.some(function (entry) { return qualifiedTankEntry(entry, ctx, ctx.profile || defaultProf); })) {
        var primary = classify(kept, ctx).carry[0], pairs = [];
        kept.forEach(function (out, index) {
          if (out.id === ctx.focusId || out.star === 3 || !isCarryRole(byId[out.id]) || (primary && out.id === primary.id)) return;
          var without = kept.filter(function (entry, i) { return i !== index; });
          legal(without, ctx, 99).forEach(function (tankUnit) {
            if (!realTank(tankUnit, ctx) || !(sharesCore(tankUnit, without) || sharesCore(tankUnit, [out]))) return;
            var rep = replacement(kept, index, tankUnit, 1, ctx);
            if (!rep) return;
            var candidateId = "tankSwap:" + out.id + ">" + tankUnit.id;
            var assessment = assessAction(kept, { type: "replace", out: out.id, in: tankUnit.id, star: 1, items: rep.items, candidateId: candidateId }, ctx);
            if (assessment.status === "blocked" || assessment.score.mid <= 0) return;
            var row = replaceRow(kept, index, tankUnit, rep, ctx, 1, { delta: assessment.score.mid, assessment: assessment });
            pairs.push(row);
          });
        });
        pairs = orderedAssessmentRows(pairs);
        var usedOut = {}, usedIn = {};
        for (var p = 0; p < pairs.length && tankReplacements.length < 2; p++) {
          if (usedOut[pairs[p].out] || usedIn[pairs[p].inn]) continue;
          usedOut[pairs[p].out] = true; usedIn[pairs[p].inn] = true; tankReplacements.push(pairs[p]);
        }
      }
      var seen = {}, merged = [], all = tankReplacements.concat(core, fullSwaps(kept, ctx));
      all = orderedAssessmentRows(all);
      for (var s = 0; s < all.length && merged.length < 4; s++) {
        var key = all[s].out + ">" + all[s].inn;
        if (seen[key]) continue;
        seen[key] = 1; merged.push(all[s]);
      }
      return merged;
    }

    function place(entries) {
      var cells = [];
      for (var r = 0; r < 4; r++) {
        cells[r] = [null, null, null, null, null, null, null];
      }
      var units = [];
      for (var i = 0; i < entries.length; i++) {
        var unit = byId[entries[i].id];
        if (!unit) continue;
        units.push({ unit: unit, star: entries[i].star });
      }
      var laneRank = { front: 0, assassin: 1, mid: 2, back: 3 };
      units.sort(function (a, b) {
        var lane = laneRank[a.unit.lane] - laneRank[b.unit.lane];
        if (lane) return lane;
        if (a.unit.lane === "back") return b.unit.cost - a.unit.cost;
        var ta = a.unit.stats.hp * (a.unit.stats.ar + a.unit.stats.mr);
        var tb = b.unit.stats.hp * (b.unit.stats.ar + b.unit.stats.mr);
        return tb - ta;
      });
      function spots(unit) {
        var rows = unit.lane === "back" ? [3, 2, 1, 0] : unit.lane === "mid" ? [1, 2, 0, 3] : [0, 1, 2, 3];
        var cols = unit.lane === "back" || unit.lane === "assassin" ? [0, 6, 1, 5, 2, 4, 3] : [3, 2, 4, 1, 5, 0, 6];
        var list = [];
        for (var ri = 0; ri < rows.length; ri++) {
          for (var ci = 0; ci < cols.length; ci++) list.push([rows[ri], cols[ci]]);
        }
        return list;
      }
      function occupy(row, col, payload) {
        cells[row][col] = payload;
      }
      units.forEach(function (entry) {
        var unit = entry.unit;
        var options = spots(unit);
        if (unit.slots >= 2) {
          var placed = false;
          for (var s = 0; s < options.length; s++) {
            var row = options[s][0];
            var col = options[s][1];
            if (col + 1 < 7 && !cells[row][col] && !cells[row][col + 1]) {
              occupy(row, col, { id: unit.id, star: entry.star });
              occupy(row, col + 1, { span: unit.id });
              placed = true;
              break;
            }
          }
          if (!placed) {
            for (var rr = 0; rr < 4 && !placed; rr++) {
              for (var cc = 0; cc < 6; cc++) {
                if (!cells[rr][cc] && !cells[rr][cc + 1]) {
                  occupy(rr, cc, { id: unit.id, star: entry.star });
                  occupy(rr, cc + 1, { span: unit.id });
                  placed = true;
                  break;
                }
              }
            }
          }
          return;
        }
        for (var p = 0; p < options.length; p++) {
          if (!cells[options[p][0]][options[p][1]]) {
            occupy(options[p][0], options[p][1], { id: unit.id, star: entry.star });
            break;
          }
        }
      });
      return cells;
    }

    function validPosition(p) {
      if (!p || typeof p !== "object") return null;
      if (!isInt(p.row) || !isInt(p.col) || p.row < 0 || p.row > 3 || p.col < 0 || p.col > 6) return null;
      return { row: p.row, col: p.col };
    }

    function knownItems(list, warnings) {
      var out = [];
      (list || []).forEach(function (id) {
        if (!itemOf(id)) {
          warnings.push("有一件不在装备表里的装备，已忽略");
          return;
        }
        out.push(id);
      });
      return out;
    }

    function normalize(input, ctx) {
      var warnings = [];
      var owned = [];
      var seen = {};
      (input || []).forEach(function (entry) {
        if (!entry || !byId[entry.id]) {
          warnings.push("有一个不在「" + ((data.meta && data.meta.name) || "当前赛季") + "」棋子表里的 id，已忽略");
          return;
        }
        if (seen[entry.id]) return;
        seen[entry.id] = 1;
        var mark = entry.mark || "";
        if (["carry", "carry2", "tank", "bot"].indexOf(mark) < 0) mark = "";
        owned.push({
          id: entry.id,
          star: clampStar(entry.star),
          mark: mark,
          position: validPosition(entry.position),
          items: knownItems(entry.items, warnings)
        });
      });
      (data.exclusive || []).forEach(function (group) {
        var present = group.filter(function (id) { return seen[id]; });
        if (present.length > 1) {
          warnings.push(present.map(function (id) { return byId[id].display; }).join("、") + " 互相排斥，同一局只能留一个");
        }
      });
      ctx.level = Math.max(1, Math.min(10, ctx.level | 0 || 8));
      if (ctx.allowLocked == null) ctx.allowLocked = true;
      ctx.extraSlots = ctx.extraSlots | 0;
      ctx.looseItems = knownItems(ctx.looseItems, warnings);
      return { owned: owned, warnings: warnings };
    }

    function recommend(input, ctx) {
      ctx = ctx || {};
      var norm = normalize(input, ctx);
      var owned = norm.owned;
      var fitted = owned.length && room(owned, ctx) < 0
        ? fit(owned, ctx)
        : { kept: owned.slice(), dropped: [], conflict: false };
      var kept = fitted.kept;
      ctx.anchor = buildAnchor(kept, ctx);
      var current = evaluate(owned, ctx, null);
      var plans = [];
      if (!owned.length) {
        plans = openings(ctx);
      } else if (room(kept, ctx) > 0) {
        var commits = committedTraits(kept, ctx);
        var specs = [{ beam: 8 }];
        if (commits[0]) specs.push({ focus: commits[0].trait.id, focusMul: 1.9, beam: 6, title: "顺着「" + commits[0].trait.name + "」" });
        if (commits[1]) specs.push({ focus: commits[1].trait.id, focusMul: 1.75, beam: 5, title: "转「" + commits[1].trait.name + "」" });
        for (var s = 0; s < specs.length; s++) {
          var filled = fill(kept, ctx, specs[s]);
          if (!filled.adds.length) continue;
          plans.push(materialize(kept, filled, ctx, specs[s].title));
        }
        plans = dedupePlans(plans);
      }
      else if (owned.length && !kept.some(function (entry) { return qualifiedTankEntry(entry, ctx, ctx.profile || defaultProf); })) {
        var tankSwaps = swaps(kept, ctx).filter(function (s) { return realTank(byId[s.inn], ctx); });
        if (tankSwaps.length) {
          var s1 = tankSwaps[0];
          var plan = {
            title: "补坦调整：换上「" + byId[s1.inn].display + "」",
            adds: [{ id: s1.inn, star: 1, mark: "", items: [] }],
            removes: [s1.out], board: s1.board.map(copyEntry),
            looseItems: (s1.looseItems || ctx.looseItems || []).slice(),
            itemTransfers: s1.itemTransfers || [], requiredStars: 1, requiredLevel: ctx.level,
            traitChanges: s1.traitChanges || traitChangesOf(kept, s1.board, ctx),
            reasons: s1.reasons && s1.reasons.length ? s1.reasons : reasons(kept, s1.board, ctx),
            traits: activeSummary(evaluate(s1.board, ctx, null)), slots: slotsOf(s1.board),
            score: evaluate(s1.board, ctx, null).total
          };
          plan.assessment = assessAction(kept, { type: "plan", afterBoard: plan.board, candidateId: "rebalance:" + s1.inn }, ctx);
          var primary = classify(kept, ctx).carry[0];
          var second = null, secondCtx = Object.assign({}, ctx, { looseItems: s1.looseItems || ctx.looseItems });
          for (var oi = 0; oi < s1.board.length; oi++) {
            var outgoing = s1.board[oi];
            if (outgoing.id === s1.out || outgoing.id === s1.inn || outgoing.id === ctx.focusId ||
                (primary && outgoing.id === primary.id) || investmentOf(outgoing) !== 0 || realTank(byId[outgoing.id], ctx)) continue;
            var without = s1.board.filter(function (e, index) { return index !== oi; });
            var candidates = legal(without, secondCtx, 99);
            for (var ti = 0; ti < candidates.length; ti++) {
              var tank2 = candidates[ti];
              if (!realTank(tank2, ctx) || tank2.id === s1.inn || !sharesCore(tank2, without)) continue;
              var rep2 = replacement(s1.board, oi, tank2, 1, secondCtx);
              if (!rep2) continue;
              var secondAssessment = assessAction(s1.board, { type: "replace", out: outgoing.id, in: tank2.id, star: 1, items: rep2.items, candidateId: "rebalance-second:" + outgoing.id + ">" + tank2.id }, secondCtx);
              var combinedAssessment = assessAction(kept, { type: "plan", afterBoard: rep2.board, candidateId: "rebalance:" + s1.inn + "+" + tank2.id }, ctx);
              if (secondAssessment.status === "blocked" || combinedAssessment.status === "blocked") continue;
              if (!second || combinedAssessment.score.mid > second.score) second = { out: outgoing.id, unit: tank2, rep: rep2, score: combinedAssessment.score.mid, assessment: combinedAssessment };
            }
          }
          if (second) {
            var board2 = second.rep.board.map(copyEntry), ev2 = evaluate(board2, ctx, null);
            var secondPlan = { title: "补坦调整：换上「" + byId[s1.inn].display + "、" + second.unit.display + "」",
              adds: [{ id: s1.inn, star: 1, mark: "", items: [] }, { id: second.unit.id, star: 1, mark: "", items: [] }],
              removes: [s1.out, second.out], board: board2, looseItems: second.rep.looseAfter.slice(),
              itemTransfers: (s1.itemTransfers || []).concat([{ from: second.out, to: second.unit.id, items: second.rep.items }]),
              requiredStars: 1, requiredLevel: ctx.level, traitChanges: traitChangesOf(kept, board2, ctx),
              reasons: reasons(kept, board2, ctx), traits: activeSummary(ev2), slots: slotsOf(board2), score: ev2.total,
              assessment: second.assessment };
            if (secondPlan.assessment.status !== "blocked") {
              var matched2 = collectPlanMatchedItems(secondPlan.adds, ctx);
              if (matched2) secondPlan.matchedItems = matched2;
              plans.push(secondPlan);
            }
          }
          if (plan.assessment.status !== "blocked") {
            var matchedPlan = collectPlanMatchedItems(plan.adds, ctx);
            if (matchedPlan) plan.matchedItems = matchedPlan;
            plans.push(plan);
          }
        }
      }
      var engine = enginePlans(owned.length ? kept : [], ctx)[0];
      if (engine) plans.push(engine);
      plans = dedupePlans(plans);
      plans.forEach(function (plan) {
        if (!plan.assessment) {
          var additions = (plan.adds || []).map(function (a) { return a.id; }).sort().join("+");
          plan.assessment = assessAction(kept, { type: "plan", afterBoard: plan.board, candidateId: "plan:" + additions + ":" + plan.title }, ctx);
        }
      });
      plans = orderedAssessmentRows(plans.filter(function (plan) { return plan.assessment.status !== "blocked" && plan.assessment.status !== "not_recommended"; })).slice(0, 3);
      var warnings = norm.warnings.slice();
      if (fitted.dropped.length) {
        warnings.unshift("人口超过 " + capacity(owned, ctx) + "，建议先下场 " + fitted.dropped.map(function (e) { return byId[e.id].display; }).join("、"));
      }
      if (fitted.conflict) {
        warnings.unshift("「围绕此卡」的棋子无法放入 " + capacity(owned, ctx) + " 人口，未自动删除任何棋子");
      }
      if (kept.filter(function (entry) { return isCarryRole(byId[entry.id]); }).length >= 3 &&
          !kept.some(function (entry) { return qualifiedTankEntry(entry, ctx, ctx.profile || defaultProf); })) {
        warnings.unshift("没有合格坦克，场上全是输出，装备不够分。先补一个前排坦克。");
      }
      var nextRows = owned.length ? nextBuys(kept, ctx) : [];
      var starRows = starUps(kept, ctx);
      var swapRows = swaps(kept, ctx);
      var suggested = {};
      plans.forEach(function (plan) {
        (plan.adds || []).forEach(function (add) { suggested[typeof add === "string" ? add : add.id] = true; });
      });
      nextRows.forEach(function (row) { suggested[row.id] = true; });
      swapRows.forEach(function (row) { suggested[row.inn] = true; });
      return {
        level: ctx.level,
        owned: owned,
        kept: kept,
        dropped: fitted.dropped,
        slots: { used: slotsOf(owned), max: capacity(owned, ctx) },
        warnings: warnings,
        traits: current.traits,
        placement: place(owned),
        labels: classify(owned, ctx).labels,
        next: nextRows,
        plans: plans,
        starUps: starRows,
        swaps: swapRows,
        odds: oddsView(ctx.level),
        holders: holderNotes(owned, ctx),
        keep: keepReport(owned),
        locks: lockNotes(owned, ctx, suggested)
      };
    }

    // Tracker: smallest number of 1-star adds that reaches the trait goal. Exact search, no beam.
    function track(input, ctx, options) {
      ctx = ctx || {};
      options = options || {};
      var norm = normalize(input, ctx);
      var owned = norm.owned;
      var cur = ctx.level;
      var maxLevel = Math.max(cur, Math.min(10, options.maxLevel || 10));
      var mode = ctx.mode || "auto";
      var nonSolo = data.traits.filter(function (t) { return t.kind !== "solo"; });
      var TR = nonSolo.length;
      var traitIdx = {};
      nonSolo.forEach(function (t, j) { traitIdx[t.id] = j; });
      var activeMin = nonSolo.map(function (t) {
        var pris = prismaticOn(ctx, t.id);
        var m = Infinity;
        t.breakpoints.forEach(function (bp) {
          if (enabledStyle(bp, pris) > 0 && bp.need < m) m = bp.need;
        });
        return m;
      });

      var locked = [];
      var targets = [];
      var traitTargets = options.traitTargets || {};
      Object.keys(traitTargets).forEach(function (tid) {
        var trait = traitById[tid];
        var need = traitTargets[tid];
        if (!trait || trait.kind === "solo" || !(need > 0)) return;
        var bp = trait.breakpoints.filter(function (b) { return b.need === need; })[0];
        if (!bp || enabledStyle(bp, prismaticOn(ctx, tid)) <= 0) {
          locked.push({ id: tid, need: need, reason: bp && bp.prismaticStyle ? "棱彩未开启" : "没有这个档位" });
          return;
        }
        targets.push({ j: traitIdx[tid], need: need, id: tid });
      });
      if (locked.length) {
        var lockedSnap = { done: true, visited: 0, plans: [], locked: locked, minimalProven: false, exhausted: false, cancelled: false };
        return { step: function () { return lockedSnap; }, cancel: function () { return lockedSnap; } };
      }

      function countsOf(board) {
        return nonSolo.map(function (t) { return traitCount(t, board, ctx).total; });
      }
      function countActive(counts) {
        var n = 0;
        for (var j = 0; j < TR; j++) if (counts[j] >= activeMin[j]) n++;
        return n;
      }
      function targetsOk(counts) {
        for (var t = 0; t < targets.length; t++) if (counts[targets[t].j] < targets[t].need) return false;
        return true;
      }

      var ownedCounts = countsOf(owned);
      var goal = options.targetTraitCount != null ? options.targetTraitCount : countActive(ownedCounts) + 1;
      goal = Math.min(goal, TR);

      var ownedIds = {};
      owned.forEach(function (e) { ownedIds[e.id] = 1; });
      var cands = data.units.filter(function (u) {
        if (ownedIds[u.id]) return false;
        if (isBanned(ctx, u.id)) return false;
        if (!ctx.allowLocked && isLocked(u)) return false;
        var info = unlockInfo(u);
        for (var L = cur; L <= maxLevel; L++) {
          if (info && info.level && L < info.level) continue;
          if (rollPct(L, u.cost) >= minRoll()) return true;
        }
        return false;
      });
      // Heuristic candidate ordering (preserves exact minimality while hitting valid leaves & tight bounds much earlier)
      cands.sort(function (a, b) {
        var scoreOf = function (u) {
          var s = 0, cnt = 0;
          for (var ti = 0; ti < u.traits.length; ti++) {
            var j = traitIdx[u.traits[ti]];
            if (j === undefined) continue;
            cnt++;
            var need = activeMin[j] - ownedCounts[j];
            if (need === 1) s += 8;
            else if (need === 2) s += 3;
            else if (ownedCounts[j] < activeMin[j] && activeMin[j] < Infinity) s += 1;
          }
          return s + cnt * 2;
        };
        return scoreOf(b) - scoreOf(a) || a.cost - b.cost || (a.id < b.id ? -1 : 1);
      });
      var n = cands.length;
      var hasT = cands.map(function (u) {
        var row = new Array(TR).fill(0);
        u.traits.forEach(function (t) { if (traitIdx[t] !== undefined) row[traitIdx[t]] = 1; });
        return row;
      });
      var candTraitCnt = hasT.map(function (row) {
        var c = 0;
        for (var j = 0; j < TR; j++) if (row[j]) c++;
        return c;
      });
      var suffix = [];
      for (var j = 0; j < TR; j++) {
        var col = new Array(n + 1).fill(0);
        for (var i = n - 1; i >= 0; i--) col[i] = col[i + 1] + hasT[i][j];
        suffix.push(col);
      }
      // Precompute suffix sorted max trait-count sums (exact admissible upper bound on trait increments from r picks)
      var kmax = Math.min(n, capacity(owned, { level: maxLevel, extraSlots: ctx.extraSlots, looseItems: ctx.looseItems }) - slotsOf(owned));
      var suffixCap = new Array(n + 1);
      var cnt3 = new Array(n + 1).fill(0);
      var cnt2 = new Array(n + 1).fill(0);
      var cnt1 = new Array(n + 1).fill(0);
      for (var ci = n - 1; ci >= 0; ci--) {
        cnt3[ci] = cnt3[ci + 1] + (candTraitCnt[ci] >= 3 ? 1 : 0);
        cnt2[ci] = cnt2[ci + 1] + (candTraitCnt[ci] === 2 ? 1 : 0);
        cnt1[ci] = cnt1[ci + 1] + (candTraitCnt[ci] === 1 ? 1 : 0);
      }
      for (var si = 0; si <= n; si++) {
        var arr = new Array(kmax + 1).fill(0);
        var c3 = cnt3[si], c2 = cnt2[si], c1 = cnt1[si];
        for (var r = 1; r <= kmax; r++) {
          var rem = r, bud = 0;
          var t3 = Math.min(rem, c3); bud += t3 * 3; rem -= t3;
          var t2 = Math.min(rem, c2); bud += t2 * 2; rem -= t2;
          var t1 = Math.min(rem, c1); bud += t1; rem -= t1;
          arr[r] = bud;
        }
        suffixCap[si] = arr;
      }

      var counts = ownedCounts.slice();
      var chosen = [];
      var found = [];
      var visited = 0;
      var cancelled = false;
      var finished = false;
      var minimalProven = false;
      var exhausted = false;

      function addCand(i, sign) {
        var row = hasT[i];
        for (var j2 = 0; j2 < TR; j2++) if (row[j2]) counts[j2] += sign;
      }

      var deficitScratch = new Array(TR);
      function bound(start, r) {
        var curActive = 0;
        var reachable = 0;
        var dLen = 0;
        for (var j3 = 0; j3 < TR; j3++) {
          var need = activeMin[j3];
          if (counts[j3] >= need) {
            curActive++;
            reachable++;
          } else {
            var def = need - counts[j3];
            if (def <= r && def <= suffix[j3][start]) {
              reachable++;
              deficitScratch[dLen++] = def;
            }
          }
        }
        if (reachable < goal) return false;
        var targetDefSum = 0;
        for (var t2 = 0; t2 < targets.length; t2++) {
          var tt = targets[t2];
          var tDef = tt.need - counts[tt.j];
          if (tDef > 0) {
            if (tDef > r || tDef > suffix[tt.j][start]) return false;
            targetDefSum += tDef;
          }
        }
        var maxBudget = suffixCap[start][r] || 0;
        if (targetDefSum > maxBudget) return false;
        var needNew = goal - curActive;
        if (needNew > 0) {
          // Exact admissible lower bound: sum of needNew smallest deficits must fit in maxBudget
          if (needNew > maxBudget) return false;
          // Insertion-select smallest needNew deficits (TR <= 35, ultra-fast zero-alloc)
          var minSum = 0;
          for (var a = 0; a < needNew; a++) {
            var bestIdx = a;
            for (var b = a + 1; b < dLen; b++) {
              if (deficitScratch[b] < deficitScratch[bestIdx]) bestIdx = b;
            }
            var tmp = deficitScratch[a];
            deficitScratch[a] = deficitScratch[bestIdx];
            deficitScratch[bestIdx] = tmp;
            minSum += deficitScratch[a];
            if (minSum > maxBudget) return false;
          }
        }
        return true;
      }

      function legalAt(unit, L, board) {
        var c = Object.assign({}, ctx, { level: L });
        if (!rollable(unit, c)) return false;
        if (!ctx.allowLocked && isLocked(unit)) return false;
        if (!hasKeys(unit, board)) return false;
        if (exclusiveBlocked(unit, boardIds(board))) return false;
        return true;
      }

      function addCost(unit, L) {
        var stage;
        if (L <= 5) stage = curveOf({ level: L, mode: mode }).ideal;
        else if (L <= 7) stage = 3;
        else if (L === 8) stage = 4;
        else stage = 5;
        if (mode === "reroll") stage = Math.min(3, stage);
        return -Math.log(rollPct(L, unit.cost) / 100) + 0.7 * Math.abs(unit.cost - stage);
      }

      // Orders one chosen set of adds: subset DP over (added subset, level). Returns best path or null.
      function orderLeaf(idxs) {
        var S = idxs.map(function (i) { return cands[i]; });
        var m = S.length;
        var full = (1 << m) - 1;
        var table = [];
        function pathKey(path) {
          return path.map(function (p) { return p.id + "@" + p.level; }).join(">");
        }
        function relax(mask, L, cost, path) {
          table[mask] = table[mask] || [];
          var old = table[mask][L];
          if (!old || cost < old.cost - 1e-9 || (Math.abs(cost - old.cost) <= 1e-9 && pathKey(path) < pathKey(old.path))) {
            table[mask][L] = { cost: cost, path: path };
          }
        }
        function boardOf(mask) {
          var b = owned.map(copyEntry);
          for (var q = 0; q < m; q++) if (mask & (1 << q)) b.push({ id: S[q].id, star: 1, mark: "" });
          return b;
        }
        relax(0, cur, 0, []);
        for (var mask = 0; mask <= full; mask++) {
          if (!table[mask]) continue;
          var boardM = null;
          for (var L = cur; L <= maxLevel; L++) {
            var st = table[mask][L];
            if (!st) continue;
            if (L < maxLevel) relax(mask, L + 1, st.cost, st.path);
            boardM = boardM || boardOf(mask);
            for (var q2 = 0; q2 < m; q2++) {
              if (mask & (1 << q2)) continue;
              var u = S[q2];
              if (!legalAt(u, L, boardM)) continue;
              var nb = boardM.concat([{ id: u.id, star: 1, mark: "" }]);
              if (slotsOf(nb) > capacity(nb, Object.assign({}, ctx, { level: L }))) continue;
              relax(mask | (1 << q2), L, st.cost + addCost(u, L), st.path.concat([{ id: u.id, level: L }]));
            }
          }
        }
        var fin = table[full];
        if (!fin) return null;
        var finishLevel = -1;
        for (var fl = cur; fl <= maxLevel; fl++) {
          if (fin[fl]) { finishLevel = fl; break; }
        }
        if (finishLevel < 0) return null;
        return { path: fin[finishLevel].path, cost: fin[finishLevel].cost, finishLevel: finishLevel, ids: S.map(function (u) { return u.id; }).sort() };
      }

      function buildPlan(res) {
        var path = res.path;
        var board = owned.map(copyEntry);
        var steps = [];
        var p = 0;
        while (p < path.length) {
          var lvl = path[p].level;
          var adds = [];
          while (p < path.length && path[p].level === lvl) {
            adds.push(path[p].id);
            board.push({ id: path[p].id, star: 1, mark: "", items: [] });
            p++;
          }
          var cts = countsOf(board);
          steps.push({
            level: lvl,
            adds: adds,
            board: board.map(copyEntry),
            activeTraitCount: countActive(cts),
            targetsMet: countActive(cts) >= goal && targetsOk(cts),
            odds: oddsView(lvl)
          });
        }
        var evCtx = Object.assign({}, ctx, { level: res.finishLevel });
        var ev = evaluate(board, evCtx, null);
        var trackAdds = path.map(function (x) { return { id: x.id, star: 1, mark: "", level: x.level }; });
        var trackPlan = {
          id: res.ids.join("|"),
          title: "最少新增 " + path.length + " 张",
          adds: trackAdds,
          board: board,
          looseItems: (ctx.looseItems || []).slice(),
          removes: [],
          itemTransfers: [],
          requiredStars: 1,
          requiredLevel: res.finishLevel,
          finishLevel: res.finishLevel,
          pathCost: res.cost,
          steps: steps,
          activeTraitCount: countActive(countsOf(board)),
          targetsMet: true,
          traitChanges: traitChangesOf(owned, board, ctx),
          traits: activeSummary(ev),
          slots: slotsOf(board),
          score: ev.total
        };
        var trackMatched = collectPlanMatchedItems(trackAdds, ctx);
        if (trackMatched) trackPlan.matchedItems = trackMatched;
        return trackPlan;
      }

      function cmpPlan(a, b) {
        if (a.finishLevel !== b.finishLevel) return a.finishLevel - b.finishLevel;
        if (Math.abs(a.pathCost - b.pathCost) > 1e-9) return a.pathCost - b.pathCost;
        if (Math.abs(a.score - b.score) > 1e-9) return b.score - a.score;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }

      function snapshot() {
        var top = found.slice().sort(cmpPlan).slice(0, 3);
        top.forEach(function (p) {
          var planCtx = Object.assign({}, ctx, { level: p.requiredLevel || ctx.level });
          p.assessment = assessAction(owned, { type: "plan", afterBoard: p.board, candidateId: "track:" + p.id }, planCtx);
        });
        return {
          done: finished,
          visited: visited,
          plans: top,
          locked: [],
          minimalProven: minimalProven,
          exhausted: exhausted,
          cancelled: cancelled
        };
      }

      function* rec(k, start) {
        visited++;
        yield;
        if (chosen.length === k) {
          if (countActive(counts) >= goal && targetsOk(counts)) {
            var res = orderLeaf(chosen.slice());
            if (res) found.push(buildPlan(res));
          }
          return;
        }
        var r = k - chosen.length;
        if (!bound(start, r)) return;
        for (var i2 = start; i2 <= n - r; i2++) {
          chosen.push(i2);
          addCand(i2, 1);
          yield* rec(k, i2 + 1);
          addCand(i2, -1);
          chosen.pop();
          if (cancelled) return;
        }
      }

      function* driver() {
        for (var k = 0; k <= kmax; k++) {
          found = [];
          yield* rec(k, 0);
          if (cancelled) return;
          if (found.length) {
            minimalProven = true;
            break;
          }
        }
        if (!minimalProven) exhausted = true;
        finished = true;
      }

      var gen = driver();
      return {
        step: function (maxNodes) {
          var budget = maxNodes > 0 ? maxNodes : 1000;
          var spent = 0;
          while (!finished && spent < budget) {
            gen.next();
            spent++;
          }
          return snapshot();
        },
        cancel: function () {
          if (!finished) {
            cancelled = true;
            finished = true;
            minimalProven = false;
          }
          return snapshot();
        }
      };
    }

    function scaled(base, star) {
      if (!base) return 0;
      return Math.round(base * Math.pow(1.8, star - 1));
    }

    return {
      data: data,
      byId: byId,
      traitById: traitById,
      itemById: itemById,
      styleName: STYLE_NAME,
      damageName: DAMAGE_NAME,
      slotsOf: slotsOf,
      capacity: capacity,
      effectiveTraits: effectiveTraits,
      evaluate: evaluate,
      place: place,
      recommend: recommend,
      assessCandidate: function (beforeBoard, action, context, profile) {
        if (!TFTAssess) throw new Error("assess.js must load before engine.js");
        return TFTAssess.assess(data, beforeBoard, action, context, profile);
      },
      track: track,
      scaled: scaled,
      rollPct: rollPct,
      rollable: function (unit, ctx) { return rollable(unit, ctx); },
      unlockInfo: unlockInfo
    };
  }

  function normalizeSet(raw) {
    if (!raw || !Array.isArray(raw.units) || !Array.isArray(raw.traits)) throw new Error("set.units/set.traits: expected arrays");
    var version = raw.schemaVersion != null ? raw.schemaVersion : raw.meta && raw.meta.schemaVersion;
    if (version != null && version !== 1 && version !== "1" && version !== 3 && version !== "3") throw new Error("schemaVersion: unknown version " + version);
    var seenIds = {};
    function uniqueRows(rows, path) {
      rows.forEach(function (row, index) {
        if (!row || typeof row.id !== "string" || !row.id) throw new Error(path + "[" + index + "].id: required");
        if (seenIds[path + ":" + row.id]) throw new Error(path + "[" + index + "].id: duplicate " + row.id);
        seenIds[path + ":" + row.id] = true;
      });
    }
    uniqueRows(raw.units, "units");
    uniqueRows(raw.traits, "traits");
    uniqueRows(raw.items || [], "items");
    var traitIds = {};
    raw.traits.forEach(function (t) { traitIds[t.id] = true; });
    var unitIds = {};
    raw.units.forEach(function (u) { unitIds[u.id] = true; });
    var itemIds = {};
    (raw.items || []).forEach(function (i) { itemIds[i.id] = true; });
    raw.units.forEach(function (u, i) {
      (u.traits || []).forEach(function (tid, j) {
        if (!traitIds[tid] && !(raw.traits || []).some(function (t) { return t.name === tid; })) throw new Error("units[" + i + "].traits[" + j + "]: dangling trait " + tid);
      });
    });
    (raw.items || []).forEach(function (it, i) {
      if (it.trait && !traitIds[it.trait] && !(raw.traits || []).some(function (t) { return t.name === it.trait; })) throw new Error("items[" + i + "].trait: dangling trait " + it.trait);
    });
    raw.units.forEach(function (u, i) {
      var unlock = u.unlock;
      var reqs = unlock && typeof unlock === "object" ? unlock.units || [] : u.unlockUnits || [];
      reqs.forEach(function (r, j) { if (!unitIds[r.id]) throw new Error("units[" + i + "].unlock.units[" + j + "].id: dangling unit " + r.id); });
    });
(raw.items || []).forEach(function (it, i) {
  (it.buildsFrom || []).forEach(function (id, j) {
    if (!itemIds[id]) throw new Error("items[" + i + "].buildsFrom[" + j + "]: dangling item " + id);
  });
});
    var traits = raw.traits.map(function (trait, index) {
      var id = String(trait.id || ("trait_" + index));
      return {
        id: id,
        name: trait.name || id,
        type: trait.type || "",
        kind: trait.kind || "class",
        countMode: trait.countMode || "units",
        desc: trait.desc || "",
        breakpoints: (trait.breakpoints || []).map(function (bp) {
          return {
            need: bp.need,
            style: bp.style || 0,
            prismaticStyle: bp.prismaticStyle || 0,
            text: bp.text || "",
            prismaticText: bp.prismaticText || ""
          };
        }),
        champions: trait.champions || [],
        prismatic: !!trait.prismatic,
        icon: trait.icon || ""
      };
    });
    var traitByName = {};
    traits.forEach(function (trait) {
      traitByName[trait.id] = trait;
      traitByName[trait.name] = trait;
    });
    var units = raw.units.map(function (unit, index) {
      var id = String(unit.id || ("unit_" + index));
      var unlock = unit.unlock;
      if (!unlock || typeof unlock === "string") {
        unlock = {
          text: typeof unit.unlock === "string" ? unit.unlock : (unit.unlockText || ""),
          level: unit.unlockLevel || 0,
          units: unit.unlockUnits || [],
          mode: unit.unlockUnitsMode || unit.unlockMode || "all"
        };
      }
      if (!unlock.text && !unlock.level && !(unlock.units && unlock.units.length)) unlock = null;
      var stats = unit.stats || {};
      var hp = stats.hp || 0;
      var ad = stats.ad || 0;
      return {
        id: id,
        name: unit.name || unit.display || id,
        nameEn: unit.nameEn || "",
        display: unit.display || unit.name || id,
        cost: unit.cost || 1,
        slots: unit.slots || 1,
        role: unit.role || "",
        roleRule: unit.roleRule || "",
        roleGroup: unit.roleGroup || "specialist",
        damageType: unit.damageType || "physical",
        lane: unit.lane || "mid",
        laneLabel: unit.laneLabel || LANE_NAME[unit.lane] || "",
        manaless: !!unit.manaless,
        stats: {
          hp: hp,
          ad: ad,
          ar: stats.ar || 0,
          mr: stats.mr || 0,
          as: stats.as || 0.7,
          range: stats.range || 1,
          mana: stats.mana || 0,
          manaStart: stats.manaStart || 0
        },
        dynamic: unit.dynamic != null ? !!unit.dynamic : !(hp && ad),
        ability: unit.ability || { name: "", text: "" },
        traits: unit.traits || [],
        traitNames: unit.traitNames || [],
        unlock: unlock,
        grantsUnit: !!unit.grantsUnit,
        icon: unit.icon || "",
        keywords: unit.keywords || ""
      };
    });
    units.forEach(function (unit) {
      unit.traits = unit.traits.map(function (tid) {
        return traitByName[tid] ? traitByName[tid].id : null;
      }).filter(Boolean);
      if (!unit.traitNames.length) {
        unit.traitNames = unit.traits.map(function (tid) { return traitByName[tid].name; });
      }
      if (!unit.laneLabel) unit.laneLabel = LANE_NAME[unit.lane] || "";
      if (!unit.keywords) {
        unit.keywords = [unit.display, unit.name, unit.nameEn, unit.role, unit.laneLabel].concat(unit.traitNames).join(" ").toLowerCase();
      }
    });
    traits.forEach(function (trait) {
      if (!trait.champions.length) {
        trait.champions = units.filter(function (unit) { return unit.traits.indexOf(trait.id) >= 0; }).map(function (unit) { return unit.id; });
      }
    });
    var items = (raw.items || []).map(function (item, index) {
      var id = String(item.id || ("item_" + index));
      return {
        id: id,
        name: item.name || id,
        kind: item.kind || "",
        text: item.text || "",
        tags: Array.isArray(item.tags) ? item.tags.slice() : [],
        trait: item.trait || "",
        buildsFrom: Array.isArray(item.buildsFrom) ? item.buildsFrom.slice() : [],
        icon: safeUrl(item.icon),
        iconRemote: safeUrl(item.iconRemote),
        slots: item.slots || 1,
        unique: !!item.unique,
        teamSize: item.teamSize || 0
      };
    });
    var meta = {};
    var rawMeta = raw.meta || { set: 0, name: "未命名赛季", template: 1 };
    Object.keys(rawMeta).forEach(function (key) { meta[key] = rawMeta[key]; });
    ["schemaVersion", "dataStatus", "source", "sourceUrl", "fetchedAt", "gamePatch", "rulesCoverage"].forEach(function (key) {
      if (rawMeta[key] != null) meta[key] = rawMeta[key];
    });
    if (meta.set === 19 && !meta.dataStatus) {
      meta.dataStatus = "mixed";
      meta.source = meta.source || "tftTest Set19 与 Data Dragon 16.23.1 混合数据，未验证 live。";
    }
    return {
      meta: meta,
      shopOdds: raw.shopOdds || null,
      exclusive: raw.exclusive || [],
      units: units,
      traits: traits,
      items: items
    };
  }

  return { create: create, normalizeSet: normalizeSet };
})();
