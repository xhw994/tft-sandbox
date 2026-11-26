/* Pure board operations for the TFT workbench. Classic script; exposes global TFTBoard. */
var TFTBoard = (function () {
  var ROWS = 4;
  var COLS = 7;
  var MAX_ITEM_SLOTS = 3;
  var MARKS = { "": true, carry: true, carry2: true, tank: true, bot: true };
  var SETTINGS = ["level", "extraSlots", "mode", "viewMode", "libraryTab", "traitTargets", "targetTraitCount", "allowLocked", "emblems", "prismatic", "focusId", "bannedIds", "unlockTargetId", "trackerMaxLevel"];
  var has = Object.prototype.hasOwnProperty;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isInt(v) { return typeof v === "number" && Math.floor(v) === v; }
  function isObj(v) { return !!v && typeof v === "object"; }
  function fail(state, error) { return { state: state, changed: false, error: error }; }
  function pos(p) { return { row: p.row, col: p.col }; }
  function samePos(a, b) { return !!a && !!b && a.row === b.row && a.col === b.col; }
  function validPos(p) {
    return isObj(p) && isInt(p.row) && isInt(p.col) && p.row >= 0 && p.row < ROWS && p.col >= 0 && p.col < COLS;
  }
  function unitOf(game, id) { return game.byId && has.call(game.byId, id) ? game.byId[id] : null; }
  function slotsOf(game, id) { var u = unitOf(game, id); return u && u.slots > 1 ? u.slots : 1; }
  function knownItem(game, id) {
    return typeof id === "string" && (!game.itemById || has.call(game.itemById, id));
  }
  function itemInfo(game, id) {
    var item = game.itemById && has.call(game.itemById, id) ? game.itemById[id] : null;
    if (!item) return { slots: 1, unique: false, kind: "", trait: "" };
    return { slots: item.slots || 1, unique: !!item.unique, kind: item.kind || "", trait: item.trait || "" };
  }
  function indexOf(board, id) {
    for (var i = 0; i < board.length; i++) if (board[i].id === id) return i;
    return -1;
  }
  // Index of the board entry (other than skip) covering a cell, or -1.
  function coverAt(game, board, row, col, skip) {
    for (var i = 0; i < board.length; i++) {
      var p = board[i].position;
      if (i === skip || !p || p.row !== row) continue;
      if (p.col === col || (p.col + 1 === col && slotsOf(game, board[i].id) > 1)) return i;
    }
    return -1;
  }
  function footprintFree(game, board, id, p, skip) {
    if (!validPos(p)) return false;
    var span = slotsOf(game, id);
    if (p.col + span - 1 >= COLS) return false;
    for (var k = 0; k < span; k++) if (coverAt(game, board, p.row, p.col + k, skip) >= 0) return false;
    return true;
  }

  // Item rules shared by equip, plan and normalize. Returns an error string or null.
  function checkItems(game, unitId, items) {
    var unit = unitOf(game, unitId);
    if (!unit) return "unknown unit " + unitId;
    var slots = 0;
    var seen = {};
    var emblems = {};
    var native = unit.traits || [];
    for (var i = 0; i < items.length; i++) {
      var id = items[i];
      if (!knownItem(game, id)) return "unknown item " + id;
      var info = itemInfo(game, id);
      slots += info.slots;
      if (info.unique) {
        if (seen[id]) return "unique item " + id + " already on " + unit.display;
        seen[id] = true;
      }
      if (info.kind === "emblem" && info.trait) {
        if (native.indexOf(info.trait) >= 0) return unit.display + " already has native trait " + info.trait;
        if (emblems[info.trait]) return "duplicate " + info.trait + " emblem on " + unit.display;
        emblems[info.trait] = true;
      }
    }
    if (slots > MAX_ITEM_SLOTS) return unit.display + " item slots exceed " + MAX_ITEM_SLOTS;
    return null;
  }

  function checkLoose(game, loose) {
    if (!Array.isArray(loose)) return "looseItems must be an array";
    for (var i = 0; i < loose.length; i++) {
      if (!knownItem(game, loose[i])) return "unknown loose item " + loose[i];
    }
    return null;
  }

  function badEntries(board) {
    if (!Array.isArray(board)) return "board must be an array";
    for (var i = 0; i < board.length; i++) if (!isObj(board[i])) return "invalid board entry";
    return null;
  }

  // Full validation of a board whose positions are already filled.
  function checkBoard(game, board) {
    var seen = {};
    for (var i = 0; i < board.length; i++) {
      var e = board[i];
      if (!unitOf(game, e.id)) return "unknown unit " + e.id;
      if (seen[e.id]) return "duplicate unit " + e.id;
      seen[e.id] = true;
      if (!isInt(e.star) || e.star < 1 || e.star > 3) return "invalid star for " + e.id;
      if (!MARKS.hasOwnProperty(e.mark || "")) return "invalid mark for " + e.id;
      if (!Array.isArray(e.items)) return "items must be an array for " + e.id;
      var itemErr = checkItems(game, e.id, e.items);
      if (itemErr) return itemErr;
      if (!validPos(e.position)) return "invalid position for " + e.id;
      if (!footprintFree(game, board, e.id, e.position, i)) return "footprint blocked for " + e.id;
    }
    return null;
  }

  // Gives every entry without a position a free cell: game.place() first, then row-major packing.
  function fillPositions(game, board) {
    var missing = [];
    for (var i = 0; i < board.length; i++) {
      if (board[i].position == null) missing.push(i);
      else if (!validPos(board[i].position)) return "invalid position for " + board[i].id;
    }
    if (!missing.length) return null;
    var grid = typeof game.place === "function"
      ? game.place(board.map(function (e) { return { id: e.id, star: e.star }; }))
      : null;
    for (var m = 0; m < missing.length; m++) {
      var idx = missing[m];
      var id = board[idx].id;
      var candidates = [];
      if (grid) {
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var cell = grid[r] && grid[r][c];
            if (cell && cell.id === id) candidates.push({ row: r, col: c });
          }
        }
      }
      for (var rr = 0; rr < ROWS; rr++) {
        for (var cc = 0; cc < COLS; cc++) candidates.push({ row: rr, col: cc });
      }
      var placed = null;
      for (var k = 0; k < candidates.length && !placed; k++) {
        if (footprintFree(game, board, id, candidates[k], idx)) placed = candidates[k];
      }
      if (!placed) return "no free cell for " + id;
      board[idx].position = placed;
    }
    return null;
  }

  function withDefaults(board) {
    board.forEach(function (e) {
      if (e.mark == null) e.mark = "";
      if (e.items == null) e.items = [];
      if (e.position === undefined) e.position = null;
    });
  }

  // Moves board[i] to target, swapping with a single-cell occupant. Mutates board; returns error or null.
  function placeEntry(game, board, i, target) {
    var e = board[i];
    if (!validPos(target)) return "invalid position";
    if (samePos(e.position, target)) return null;
    if (footprintFree(game, board, e.id, target, i)) {
      e.position = pos(target);
      return null;
    }
    var j = coverAt(game, board, target.row, target.col, i);
    if (j >= 0 && e.position && slotsOf(game, e.id) === 1 && slotsOf(game, board[j].id) === 1 && samePos(board[j].position, target)) {
      board[j].position = pos(e.position);
      e.position = pos(target);
      return null;
    }
    return "cell occupied or footprint blocked";
  }

  function addUnit(next, a, game) {
    if (!unitOf(game, a.id)) return "unknown unit " + a.id;
    if (!validPos(a.position)) return "invalid position";
    var i = indexOf(next.board, a.id);
    if (i >= 0) {
      var err = placeEntry(game, next.board, i, a.position);
      if (err) return err;
    } else {
      if (!footprintFree(game, next.board, a.id, a.position, -1)) return "cell occupied or footprint blocked";
      next.board.push({ id: a.id, star: 1, mark: "", position: pos(a.position), items: [] });
    }
    next.focusId = a.id;
    return null;
  }

  function moveUnit(next, a, game) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    return placeEntry(game, next.board, i, a.position);
  }

  function starUp(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    if (next.board[i].star < 3) next.board[i].star += 1;
    return null;
  }

  function setStar(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    if (!isInt(a.star) || a.star < 1 || a.star > 3) return "star must be 1-3";
    next.board[i].star = a.star;
    return null;
  }

  function setMark(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    if (typeof a.mark !== "string" || !MARKS.hasOwnProperty(a.mark)) return "invalid mark";
    next.board[i].mark = a.mark;
    return null;
  }

  function contextUnit(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    var e = next.board[i];
    if (e.items.length) e.items.pop();
    else if (e.star > 1) e.star -= 1;
    else {
      next.board.splice(i, 1);
      if (next.focusId === a.id) next.focusId = null;
    }
    return null;
  }

  function unequipItem(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    var items = next.board[i].items;
    if (!isInt(a.index) || a.index < 0 || items[a.index] !== a.itemId) return "stale item index";
    items.splice(a.index, 1);
    return null;
  }

  function equipItem(next, a, game) {
    var t = indexOf(next.board, a.id);
    if (t < 0) return "unit not on board";
    if (!knownItem(game, a.itemId)) return "unknown item " + a.itemId;
    var target = next.board[t];
    var src = a.source || { kind: "library" };
    if (src.kind === "unit") {
      var s = indexOf(next.board, src.unitId);
      if (s < 0) return "source unit not on board";
      if (!isInt(src.index) || next.board[s].items[src.index] !== a.itemId) return "stale source item";
      if (s === t) return null;
      next.board[s].items.splice(src.index, 1);
    } else if (src.kind === "loose") {
      if (!isInt(src.index) || next.looseItems[src.index] !== a.itemId) return "stale loose item";
      next.looseItems.splice(src.index, 1);
    } else if (src.kind !== "library") {
      return "unknown source " + src.kind;
    }
    var err = checkItems(game, target.id, target.items.concat([a.itemId]));
    if (err) return err;
    target.items.push(a.itemId);
    return null;
  }

  function removeUnit(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    next.board.splice(i, 1);
    if (next.focusId === a.id) next.focusId = null;
    return null;
  }

  function deleteLoose(next, a) {
    if (!isInt(a.index) || next.looseItems[a.index] !== a.itemId) return "stale loose item";
    next.looseItems.splice(a.index, 1);
    return null;
  }

  function addLoose(next, a, game) {
    if (!knownItem(game, a.itemId)) return "unknown item " + a.itemId;
    next.looseItems.push(a.itemId);
    return null;
  }

  function unequipToLoose(next, a) {
    var i = indexOf(next.board, a.id);
    if (i < 0) return "unit not on board";
    var items = next.board[i].items;
    if (!isInt(a.index) || a.index < 0 || items[a.index] !== a.itemId) return "stale item index";
    items.splice(a.index, 1);
    next.looseItems.push(a.itemId);
    return null;
  }

  function craftLoose(next, a, game) {
    if (!knownItem(game, a.resultItemId)) return "unknown item " + a.resultItemId;
    if (!isInt(a.idxA) || !isInt(a.idxB) || a.idxA === a.idxB) return "invalid component index";
    if (next.looseItems[a.idxA] !== a.compA || next.looseItems[a.idxB] !== a.compB) return "stale component index";
    var hi = Math.max(a.idxA, a.idxB);
    var lo = Math.min(a.idxA, a.idxB);
    next.looseItems.splice(hi, 1);
    next.looseItems.splice(lo, 1);
    if (a.targetId) {
      var ti = indexOf(next.board, a.targetId);
      if (ti >= 0 && !checkItems(game, a.targetId, next.board[ti].items.concat([a.resultItemId]))) {
        next.board[ti].items.push(a.resultItemId);
        return null;
      }
    }
    next.looseItems.push(a.resultItemId);
    return null;
  }

  function applyPlan(next, a, game) {
    var plan = a.plan;
    if (!isObj(plan) || !Array.isArray(plan.looseItems)) return "invalid plan";
    var bad = badEntries(plan.board);
    if (bad) return bad;
    var board = plan.board.map(function (e) {
      return {
        id: e.id,
        star: e.star,
        mark: e.mark || "",
        position: e.position == null ? null : { row: e.position.row, col: e.position.col },
        items: Array.isArray(e.items) ? e.items.slice() : []
      };
    });
    var err = fillPositions(game, board) || checkBoard(game, board) || checkLoose(game, plan.looseItems);
    if (err) return err;
    if (typeof plan.requiredLevel === "number") {
      if (!isInt(plan.requiredLevel) || plan.requiredLevel < 1 || plan.requiredLevel > 10) return "invalid requiredLevel";
      next.level = plan.requiredLevel;
    }
    next.board = board;
    next.looseItems = plan.looseItems.slice();
    if (next.focusId && indexOf(board, next.focusId) < 0) next.focusId = null;
    return null;
  }

  function updateSettings(next, a) {
    var s = a.settings;
    if (!isObj(s)) return "invalid settings";
    if (has.call(s, "level") && !(isInt(s.level) && s.level >= 1 && s.level <= 10)) return "invalid level";
    SETTINGS.forEach(function (key) { if (has.call(s, key)) next[key] = s[key]; });
    return null;
  }

  function reset(next) {
    next.board = [];
    next.looseItems = [];
    next.emblems = {};
    next.prismatic = {};
    next.traitTargets = {};
    next.targetTraitCount = 0;
    next.extraSlots = 0;
    next.focusId = null;
    next.bannedIds = {};
    next.unlockTargetId = null;
    return null;
  }

  var ACTIONS = {
    "add-unit": addUnit,
    "move-unit": moveUnit,
    "star-up": starUp,
    "set-star": setStar,
    "set-mark": setMark,
    "context-unit": contextUnit,
    "unequip-item": unequipItem,
    "unequip-to-loose": unequipToLoose,
    "equip-item": equipItem,
    "remove-unit": removeUnit,
    "add-loose": addLoose,
    "delete-loose": deleteLoose,
    "craft-loose": craftLoose,
    "apply-plan": applyPlan,
    "update-settings": updateSettings,
    "reset": reset
  };

  // action: {type, id?, position?, itemId?, index?, source?, plan?, star?, mark?, settings?}
  // unequip-item and delete-loose take the item's list position in `index`.
  function apply(state, action, game) {
    var fn = isObj(action) && has.call(ACTIONS, action.type) ? ACTIONS[action.type] : null;
    if (!fn) return fail(state, "unknown action " + (isObj(action) ? action.type : action));
    var next = clone(state);
    if (!Array.isArray(next.board)) next.board = [];
    if (!Array.isArray(next.looseItems)) next.looseItems = [];
    var error = fn(next, action, game);
    if (error) return fail(state, error);
    return { state: next, changed: !sameJSON(state, next), error: null };
  }

  // Validates a saved or imported state; fills missing positions. Returns {state,changed,error}.
  function normalize(state, game) {
    var next = clone(state);
    if (!Array.isArray(next.board)) next.board = [];
    if (next.looseItems == null) next.looseItems = [];
    var err = badEntries(next.board) || checkLoose(game, next.looseItems);
    if (!err) {
      withDefaults(next.board);
      err = fillPositions(game, next.board) || checkBoard(game, next.board);
    }
    if (err) return fail(state, err);
    return { state: next, changed: !sameJSON(state, next), error: null };
  }

  return { apply: apply, normalize: normalize };
})();
