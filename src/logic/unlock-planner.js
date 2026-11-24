/* Unlock target planning: metadata parsing, prerequisite actions, and virtual board context. */

export function parseUnlockMeta(unit, game) {
  if (!unit) return null;
  const raw = unit.unlock;
  if (!raw) {
    return {
      unit,
      text: "",
      minLevel: 0,
      reqUnits: [],
      mode: "all",
      reqTraitCount: 0,
      reqTraitIds: []
    };
  }

  const text = typeof raw === "string" ? raw : String(raw.text || "");
  let minLevel = typeof raw === "object" && raw.level ? Number(raw.level) || 0 : 0;
  if (!minLevel) {
    const lvlMatch = text.match(/需求等级\s*(\d+)/);
    if (lvlMatch) minLevel = parseInt(lvlMatch[1], 10) || 0;
  }

  const reqUnits = typeof raw === "object" && Array.isArray(raw.units)
    ? raw.units.map((r) => ({ id: r.id, star: r.star || 1 }))
    : [];
  const mode = typeof raw === "object" && raw.mode === "any" ? "any" : "all";

  let reqTraitCount = 0;
  const countMatch = text.match(/激活\s*(\d+)\s*个.*?非单人羁绊/);
  if (countMatch) {
    reqTraitCount = parseInt(countMatch[1], 10) || 0;
  }

  const traitNameMap = Object.create(null);
  const traits = (game && game.data && Array.isArray(game.data.traits)) ? game.data.traits : [];
  for (let i = 0; i < traits.length; i++) {
    if (traits[i] && traits[i].name) traitNameMap[traits[i].name] = traits[i].id;
  }

  const reqTraitIds = [];
  const seenTraits = Object.create(null);
  const bracketRe = /【([^】]+)】/g;
  let m;
  while ((m = bracketRe.exec(text)) !== null) {
    const tid = traitNameMap[m[1]];
    if (tid && !seenTraits[tid]) {
      seenTraits[tid] = true;
      reqTraitIds.push(tid);
    }
  }

  return {
    unit,
    text,
    minLevel,
    reqUnits,
    mode,
    reqTraitCount,
    reqTraitIds
  };
}

function cloneEntry(e) {
  return {
    id: e.id,
    star: e.star || 1,
    mark: e.mark || "",
    items: Array.isArray(e.items) ? e.items.slice() : [],
    position: e.position ? { row: e.position.row, col: e.position.col } : null
  };
}

export function buildUnlockContext(state, game, baseBoard, baseCtx) {
  if (!state || !state.unlockTargetId || !game || !game.byId || !game.byId[state.unlockTargetId]) {
    return { active: false };
  }

  const target = game.byId[state.unlockTargetId];
  const meta = parseUnlockMeta(target, game);
  const board = Array.isArray(baseBoard) ? baseBoard : [];
  const alreadyOnBoard = board.some((e) => e.id === target.id);

  const byBoardId = Object.create(null);
  for (let i = 0; i < board.length; i++) {
    byBoardId[board[i].id] = board[i];
  }

  const prereqActions = [];
  const anySatisfied = meta.mode === "any" && meta.reqUnits.some((req) => {
    const on = byBoardId[req.id];
    return on && (on.star || 1) >= (req.star || 1);
  });

  if (!anySatisfied) {
    for (let i = 0; i < meta.reqUnits.length; i++) {
      const req = meta.reqUnits[i];
      const entry = byBoardId[req.id] || null;
      const currentStar = entry ? (entry.star || 1) : 0;
      const onBoard = !!entry;
      const needStar = req.star || 1;
      if (onBoard && currentStar >= needStar) continue;
      const reqUnit = game.byId[req.id];
      const reqName = reqUnit ? reqUnit.display : req.id;
      const action = onBoard ? "star" : "add";
      const reason = onBoard
        ? "把「" + reqName + "」升到 " + needStar + " 星以解锁「" + target.display + "」"
        : "上场「" + reqName + "」" + (needStar > 1 ? "（需 " + needStar + " 星）" : "") + "以解锁「" + target.display + "」";
      prereqActions.push({
        id: req.id,
        needStar,
        currentStar,
        onBoard,
        action,
        reason
      });
    }
  }

  const virtualBoard = board.map(cloneEntry);
  if (!alreadyOnBoard) {
    virtualBoard.push({
      id: target.id,
      star: 1,
      mark: "",
      items: [],
      position: null
    });
  }

  const ctx = baseCtx || {};
  const virtualCtx = Object.assign({}, ctx, {
    level: Math.max(ctx.level || 8, meta.minLevel || 0),
    focusId: target.id
  });

  if (!alreadyOnBoard && typeof game.slotsOf === "function" && typeof game.capacity === "function") {
    const neededSlots = game.slotsOf(virtualBoard);
    const cap = game.capacity(virtualBoard, virtualCtx);
    if (neededSlots > cap) {
      virtualCtx.extraSlots = (virtualCtx.extraSlots || 0) + (neededSlots - cap);
    }
  }

  const needsMiniTrack = !alreadyOnBoard && meta.reqTraitCount > 0;
  const miniTrackGoal = meta.reqTraitCount || 0;
  const miniTrackMaxLevel = Math.max(ctx.level || 8, meta.minLevel || 9);

  return {
    active: true,
    target,
    meta,
    alreadyOnBoard,
    prereqActions,
    virtualBoard,
    virtualCtx,
    needsMiniTrack,
    miniTrackGoal,
    miniTrackMaxLevel
  };
}
