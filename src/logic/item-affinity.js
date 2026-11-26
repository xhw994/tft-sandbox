/* 8-dimensional (4 role x AD/AP) item affinity and loose item resolution for TFT Set 19. */

const OVERRIDE_TABLE = {
  // --- 33 Set 19 Artifacts ---
  Artifact_InfinityForce: { category: "fighter", damage: "hybrid", needsMana: false },
  Artifact_ZhonyasParadox: { category: "carry", damage: "magic", needsMana: false },
  Artifact_LightshieldCrest: { category: "tank", damage: "any", needsMana: false },
  Artifact_LudensTempest: { category: "carry", damage: "magic", needsMana: false },
  Artifact_MogulsMail: { category: "tank", damage: "any", needsMana: false },
  Artifact_SilvermereDawn: { category: "fighter", damage: "physical", needsMana: false },
  Artifact_TitanicHydra: { category: "fighter", damage: "physical", needsMana: false },
  Artifact_LichBane: { category: "carry", damage: "magic", needsMana: true },
  Artifact_CappaJuice: { category: "carry", damage: "hybrid", needsMana: false },
  Artifact_HellfireHatchet: { category: "fighter", damage: "physical", needsMana: false },
  Artifact_GamblersBlade: { category: "carry", damage: "physical", needsMana: false },
  Artifact_SeekersArmguard: { category: "fighter", damage: "magic", needsMana: false },
  Artifact_StatikkShiv: { category: "carry", damage: "magic", needsMana: false },
  Artifact_WitsEnd: { category: "fighter", damage: "magic", needsMana: false },
  Artifact_BlightingJewel: { category: "utility", damage: "magic", needsMana: true, lanePref: "back" },
  Artifact_DeathsDefiance: { category: "fighter", damage: "physical", needsMana: false },
  Artifact_EternalPact: { category: "carry", damage: "magic", needsMana: true },
  Artifact_SnipersFocus: { category: "carry", damage: "hybrid", needsMana: false, lanePref: "back" },
  Artifact_RapidFireCannon: { category: "carry", damage: "physical", needsMana: false },
  Artifact_Hullcrusher: { category: "tank", damage: "any", needsMana: false },
  Artifact_ForbiddenIdol: { category: "tank", damage: "any", needsMana: false },
  Artifact_NavoriFlickerblade: { category: "carry", damage: "hybrid", needsMana: false },
  Artifact_VoidGauntlet: { category: "tank", damage: "any", needsMana: false },
  Artifact_HorizonFocus: { category: "utility", damage: "any", needsMana: false, lanePref: "front" },
  Artifact_Mittens: { category: "fighter", damage: "physical", needsMana: false },
  Artifact_GoldCollector: { category: "carry", damage: "physical", needsMana: false },
  Artifact_TheIndomitable: { category: "tank", damage: "any", needsMana: false },
  Artifact_TalismanOfAscension: { category: "tank", damage: "any", needsMana: false },
  Artifact_Manazane: { category: "carry", damage: "magic", needsMana: true },
  Artifact_Fishbones: { category: "carry", damage: "physical", needsMana: false },
  Artifact_AegisOfDusk: { category: "tank", damage: "any", needsMana: false },
  Artifact_AegisOfDawn: { category: "tank", damage: "any", needsMana: false },
  Artifact_Dawncore: { category: "carry", damage: "magic", needsMana: true },

  // --- Craftable Fighter Items (+ Radiant via suffix strip) ---
  Bloodthirster: { category: "fighter", damage: "physical", needsMana: false },
  TitansResolve: { category: "fighter", damage: "hybrid", needsMana: false },
  SteraksGage: { category: "fighter", damage: "physical", needsMana: false },
  EdgeOfNight: { category: "fighter", damage: "physical", needsMana: false },
  HandOfJustice: { category: "fighter", damage: "hybrid", needsMana: true },
  Crownguard: { category: "fighter", damage: "magic", needsMana: false },

  // --- Craftable Utility & Support Items (+ Radiant via suffix strip) ---
  SunfireCape: { category: "utility", damage: "any", needsMana: false, lanePref: "front" },
  Morellonomicon: { category: "utility", damage: "magic", needsMana: false, lanePref: "back" },
  RedBuff: { category: "utility", damage: "physical", needsMana: false, lanePref: "back" },
  IonicSpark: { category: "utility", damage: "magic", needsMana: false, lanePref: "front" },
  Evenshroud: { category: "utility", damage: "physical", needsMana: false, lanePref: "front" },
  LastWhisper: { category: "utility", damage: "physical", needsMana: false, lanePref: "back" },
  VoidStaff: { category: "utility", damage: "magic", needsMana: true, lanePref: "back" },
  AdaptiveHelm: { category: "utility", damage: "magic", needsMana: true },
  RanduinsOmen: { category: "utility", damage: "any", needsMana: false, lanePref: "front" },
  ZZRotPortal: { category: "utility", damage: "any", needsMana: false, lanePref: "front" },
  ZekesHerald: { category: "utility", damage: "physical", needsMana: false, lanePref: "back" },
  ChaliceOfPower: { category: "utility", damage: "magic", needsMana: true, lanePref: "back" },

  // --- Basic Components ---
  Component_BFSword: { category: "basic", damage: "physical", needsMana: false },
  Component_RecurveBow: { category: "basic", damage: "physical", needsMana: false },
  Component_NeedlesslyLargeRod: { category: "basic", damage: "magic", needsMana: false },
  Component_TearOfTheGoddess: { category: "basic", damage: "magic", needsMana: true },
  Component_SparringGloves: { category: "basic", damage: "hybrid", needsMana: false },
  Component_ChainVest: { category: "basic", damage: "any", needsMana: false },
  Component_NegatronCloak: { category: "basic", damage: "any", needsMana: false },
  Component_GiantsBelt: { category: "basic", damage: "any", needsMana: false },
  Component_Spatula: { category: "basic", damage: "any", needsMana: false },
  Component_FryingPan: { category: "basic", damage: "any", needsMana: false }
};

function normalizeItemKey(id) {
  if (typeof id !== "string") return "";
  return id
    .replace(/^(?:DA_Item_|DA_|TFT\d*_Item_|Radiant_)/i, "")
    .replace(/(?:_?Radiant)$/i, "");
}

function hasTag(tags, needle) {
  if (!Array.isArray(tags)) return false;
  for (let i = 0; i < tags.length; i++) {
    if (typeof tags[i] === "string" && tags[i].indexOf(needle) >= 0) return true;
  }
  return false;
}

function weightOf(item, category) {
  if (!item) return 0.5;
  if (category === "basic") return 0.5;
  if (item.kind === "radiant") return 1.2;
  return 1;
}

function classifyDetailed(item) {
  if (!item) {
    return {
      category: "basic",
      damage: "any",
      needsMana: false,
      isEmblem: false,
      isCrown: false,
      isThief: false,
      weight: 0.5,
      lanePref: null
    };
  }

  const tags = item.tags || [];
  const tagNeedsMana = hasTag(tags, "Provides.Resource.Mana");

  if (item.kind === "emblem") {
    return {
      category: "emblem",
      damage: "any",
      needsMana: false,
      isEmblem: true,
      isCrown: false,
      isThief: false,
      weight: 1,
      lanePref: null
    };
  }

  if ((item.teamSize && item.teamSize > 0) || item.kind === "spatula") {
    return {
      category: "crown",
      damage: "any",
      needsMana: false,
      isEmblem: false,
      isCrown: true,
      isThief: false,
      weight: 1,
      lanePref: null
    };
  }

  if (hasTag(tags, "ThiefsGloves")) {
    return {
      category: "thief",
      damage: "any",
      needsMana: false,
      isEmblem: false,
      isCrown: false,
      isThief: true,
      weight: 1,
      lanePref: null
    };
  }

  const key = normalizeItemKey(item.id);
  const exact = Object.prototype.hasOwnProperty.call(OVERRIDE_TABLE, key) ? OVERRIDE_TABLE[key] : null;
  if (exact) {
    return {
      category: exact.category,
      damage: exact.damage,
      needsMana: !!(exact.needsMana || tagNeedsMana),
      isEmblem: false,
      isCrown: false,
      isThief: false,
      weight: weightOf(item, exact.category),
      lanePref: exact.lanePref || null
    };
  }

  if (item.kind === "basic") {
    return {
      category: "basic",
      damage: tagNeedsMana ? "magic" : "any",
      needsMana: tagNeedsMana,
      isEmblem: false,
      isCrown: false,
      isThief: false,
      weight: 0.5,
      lanePref: null
    };
  }

  const hasAtk = hasTag(tags, "Category.Attack");
  const hasMag = hasTag(tags, "Category.Magic");
  const hasTank = hasTag(tags, "Category.Tank");
  const hasSupport = hasTag(tags, "Item.Support");
  const hasBurn = hasTag(tags, "Item.Burn");

  let category = "utility";
  let damage = "any";
  let lanePref = null;

  if (hasTank && !hasAtk && !hasMag) {
    category = "tank";
    damage = "any";
  } else if (hasAtk && hasMag) {
    category = "carry";
    damage = "hybrid";
  } else if (hasAtk) {
    category = hasBurn ? "utility" : "carry";
    damage = "physical";
    if (hasBurn) lanePref = "back";
  } else if (hasMag) {
    category = hasBurn ? "utility" : "carry";
    damage = "magic";
    if (hasBurn) lanePref = "back";
  } else if (hasSupport || hasBurn) {
    category = "utility";
    damage = "any";
  }

  return {
    category,
    damage,
    needsMana: tagNeedsMana,
    isEmblem: false,
    isCrown: false,
    isThief: false,
    weight: weightOf(item, category),
    lanePref
  };
}

export function classifyItem(item) {
  const d = classifyDetailed(item);
  return {
    category: d.category,
    damage: d.damage,
    needsMana: d.needsMana,
    isEmblem: d.isEmblem,
    isCrown: d.isCrown,
    isThief: d.isThief,
    weight: d.weight
  };
}

function dmgAffinity(itemDmg, unitDmg) {
  if (itemDmg === "any") return "any";
  if (itemDmg === "hybrid") return "hybrid";
  if (unitDmg === "hybrid" || itemDmg === unitDmg) return "match";
  return "mismatch";
}

export function itemUnitScore(item, unit) {
  if (!item || !unit) return 0;
  const info = classifyDetailed(item);

  if (info.isEmblem) {
    const traits = Array.isArray(unit.traits) ? unit.traits : [];
    return traits.indexOf(item.trait) >= 0 ? 0 : 65;
  }

  if (info.isCrown) return 0;

  const isManaless = Boolean(unit.manaless || (unit.stats && unit.stats.mana === 0));
  if (info.needsMana && isManaless) return 10;

  const role = unit.roleGroup || "fighter";
  const lane = unit.lane || "front";
  const unitDmg = unit.damageType || "physical";
  const dmg = dmgAffinity(info.damage, unitDmg);

  const isFrontSpecialist = role === "specialist" && lane === "front";
  const isBackSpecialist = role === "specialist" && lane === "back";

  if (info.category === "thief") {
    return Array.isArray(unit.items) && unit.items.length > 0 ? 0 : 60;
  }

  if (info.category === "tank") {
    if (role === "tank") return 90;
    if (role === "fighter" || isFrontSpecialist) return 55;
    return 5;
  }

  if (info.category === "fighter") {
    if (role === "fighter" || role === "assassin" || isFrontSpecialist) {
      return dmg === "mismatch" ? 45 : 88;
    }
    if (role === "tank") return 45;
    return 25;
  }

  if (info.category === "carry") {
    if (role === "marksman" || role === "caster" || role === "assassin" || role === "fighter" || isBackSpecialist) {
      if (dmg === "match" || dmg === "any") {
        if (info.lanePref === "back" && lane === "front") return 60;
        return 92;
      }
      if (dmg === "hybrid") {
        if (info.lanePref === "back" && lane === "front") return 55;
        return 80;
      }
      return 18;
    }
    return 10;
  }

  if (info.category === "utility") {
    if (info.lanePref === "front") {
      if (role === "tank" || role === "fighter" || lane === "front" || isFrontSpecialist) {
        return dmg === "mismatch" ? 68 : 78;
      }
      return 25;
    }
    if (info.lanePref === "back") {
      if (role === "marksman" || role === "caster" || isBackSpecialist) {
        if (dmg === "match" || dmg === "any") return 76;
        if (dmg === "hybrid") return 70;
        return 25;
      }
      if (role === "fighter" || role === "assassin") {
        if (dmg === "match" || dmg === "any") return 68;
        if (dmg === "hybrid") return 66;
        return 25;
      }
      return 25;
    }
    if (dmg === "mismatch") return 40;
    return 72;
  }

  // basic components (35~50 for matching roles, halved)
  if (info.damage === "any") {
    return (role === "tank" || role === "fighter" || isFrontSpecialist) ? 48 : 35;
  }
  if (info.damage === "hybrid") {
    return role === "tank" ? 36 : 48;
  }
  if (dmg === "match") {
    return role === "tank" ? 35 : 50;
  }
  return 20;
}

function itemSlots(game, itemId) {
  const it = game && game.itemById ? game.itemById[itemId] : null;
  return it && it.slots ? it.slots : 1;
}

function usedItemSlots(game, items) {
  let sum = 0;
  for (let i = 0; i < (items || []).length; i++) sum += itemSlots(game, items[i]);
  return sum;
}

function canHoldItem(entry, item, game, extraEmblemSlots, extraEmblemTraits) {
  if (!entry || !item) return false;
  const unit = game && game.byId ? game.byId[entry.id] : null;
  if (!unit) return false;
  const held = entry.items || [];
  const needSlots = item.slots || 1;
  const extraSlots = extraEmblemSlots ? (extraEmblemSlots[entry.id] || 0) : 0;
  if (usedItemSlots(game, held) + extraSlots + needSlots > 3) return false;
  if (item.unique && held.indexOf(item.id) >= 0) return false;
  if (item.kind === "emblem" && item.trait) {
    if (Array.isArray(unit.traits) && unit.traits.indexOf(item.trait) >= 0) return false;
    for (let i = 0; i < held.length; i++) {
      const h = game.itemById ? game.itemById[held[i]] : null;
      if (h && h.kind === "emblem" && h.trait === item.trait) return false;
    }
    if (extraEmblemTraits && extraEmblemTraits[entry.id] && extraEmblemTraits[entry.id][item.trait]) {
      return false;
    }
  }
  return true;
}

function pickEmblemTarget(virtualBoard, item, game, labels, extraEmblemSlots, extraEmblemTraits) {
  const rankOf = (id, entry) => {
    const lbl = labels ? labels[id] : entry.mark;
    if (lbl === "bot") return 0;
    if (lbl === "tank2") return 1;
    if (lbl === "tank") return 2;
    if (lbl === "carry2") return 3;
    if (lbl === "carry") return 4;
    return 1;
  };
  let best = null;
  let bestRank = 99;
  let bestUsed = 99;
  for (let i = 0; i < virtualBoard.length; i++) {
    const entry = virtualBoard[i];
    if (!canHoldItem(entry, item, game, extraEmblemSlots, extraEmblemTraits)) continue;
    const r = rankOf(entry.id, entry);
    const used = usedItemSlots(game, entry.items) + (extraEmblemSlots[entry.id] || 0);
    if (r < bestRank || (r === bestRank && used < bestUsed)) {
      best = entry;
      bestRank = r;
      bestUsed = used;
    }
  }
  if (!best) return null;
  extraEmblemSlots[best.id] = (extraEmblemSlots[best.id] || 0) + (item.slots || 1);
  if (item.trait) {
    extraEmblemTraits[best.id] = extraEmblemTraits[best.id] || {};
    extraEmblemTraits[best.id][item.trait] = true;
  }
  return best.id;
}

export function resolveLooseItems(board, looseItems, game, labels) {
  const virtualBoard = (board || []).map((e) => ({
    id: e.id,
    star: e.star || 1,
    mark: e.mark || "",
    position: e.position ? { row: e.position.row, col: e.position.col } : null,
    items: Array.isArray(e.items) ? e.items.slice() : []
  }));

  const findLabeled = (role) => {
    if (labels) {
      return virtualBoard.find((e) => labels[e.id] === role) || null;
    }
    return virtualBoard.find((e) => e.mark === role) || null;
  };

  const carryEntry = findLabeled("carry");
  const tankEntry = findLabeled("tank");
  const carryUnit = carryEntry && game && game.byId ? game.byId[carryEntry.id] : null;
  const tankUnit = tankEntry && game && game.byId ? game.byId[tankEntry.id] : null;

  const assignments = [];
  const unassigned = [];
  const looseEmblems = {};
  const extraEmblemSlots = {};
  const extraEmblemTraits = {};

  const list = Array.isArray(looseItems) ? looseItems : [];
  for (let index = 0; index < list.length; index++) {
    const itemId = list[index];
    const item = game && game.itemById ? game.itemById[itemId] : null;
    if (!item) {
      unassigned.push({ index, itemId });
      assignments.push({
        index,
        itemId,
        badgeKind: "rec",
        badgeText: "荐",
        targetId: null,
        hint: "待分配推荐装备"
      });
      continue;
    }

    const info = classifyDetailed(item);

    if (info.isCrown) {
      assignments.push({
        index,
        itemId,
        badgeKind: "crown",
        badgeText: "冠",
        targetId: null,
        hint: "备战席即生效：+" + (item.teamSize || 1) + " 人口"
      });
      continue;
    }

    if (info.isEmblem) {
      if (item.trait) {
        looseEmblems[item.trait] = (looseEmblems[item.trait] || 0) + 1;
      }
      const targetId = pickEmblemTarget(virtualBoard, item, game, labels, extraEmblemSlots, extraEmblemTraits);
      const targetUnit = targetId && game && game.byId ? game.byId[targetId] : null;
      assignments.push({
        index,
        itemId,
        badgeKind: "emblem",
        badgeText: "纹",
        targetId,
        hint: targetUnit
          ? "备战席已计入羁绊；点击装备给「" + targetUnit.display + "」"
          : "备战席已计入羁绊"
      });
      continue;
    }

    if (carryEntry && carryUnit && canHoldItem(carryEntry, item, game) && itemUnitScore(item, carryUnit) >= 62) {
      carryEntry.items.push(itemId);
      assignments.push({
        index,
        itemId,
        badgeKind: "carry",
        badgeText: "C",
        targetId: carryEntry.id,
        hint: "点击装备给主C「" + carryUnit.display + "」"
      });
      continue;
    }

    if (tankEntry && tankUnit && canHoldItem(tankEntry, item, game) && itemUnitScore(item, tankUnit) >= 62) {
      tankEntry.items.push(itemId);
      assignments.push({
        index,
        itemId,
        badgeKind: "tank",
        badgeText: "坦",
        targetId: tankEntry.id,
        hint: "点击装备给主坦「" + tankUnit.display + "」"
      });
      continue;
    }

    unassigned.push({ index, itemId });
    assignments.push({
      index,
      itemId,
      badgeKind: "rec",
      badgeText: "荐",
      targetId: null,
      hint: "待分配推荐装备"
    });
  }

  const looseItemFit = {
    scoreUnit(unit) {
      if (!unit || !unassigned.length) return { bonus: 0, matchedItems: [] };
      let bonus = 0;
      const matchedItems = [];
      for (let i = 0; i < unassigned.length; i++) {
        const itemId = unassigned[i].itemId;
        const item = game && game.itemById ? game.itemById[itemId] : null;
        if (!item) continue;
        if (itemUnitScore(item, unit) >= 68) {
          bonus += 4.5;
          matchedItems.push(itemId);
        }
      }
      if (bonus > 12) bonus = 12;
      return { bonus, matchedItems };
    }
  };

  return {
    assignments,
    virtualBoard,
    unassigned,
    looseEmblems,
    looseItemFit
  };
}

export function findEmblemItemForTrait(game, traitId) {
  if (!game || !traitId) return null;
  const items = game.data && Array.isArray(game.data.items)
    ? game.data.items
    : (game.itemById ? Object.values(game.itemById) : []);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && it.kind === "emblem" && it.trait === traitId) return it;
  }
  return null;
}

const ROLE_CN = { carry: "主C", carry2: "副C", tank: "主坦", tank2: "副坦" };

/**
 * Computes top component crafting recipes from basic components currently in looseItems,
 * ranked by 8-dim affinity to open item slots on current carry/tank holders (or board emblem/crown value).
 */
export function computeCraftSuggestions(board, looseItems, game, labels) {
  if (!game || !Array.isArray(looseItems) || looseItems.length < 2) return [];
  const itemById = game.itemById || {};
  const byId = game.byId || {};
  const allItems = (game.data && Array.isArray(game.data.items)) ? game.data.items : Object.values(itemById);

  // Build recipe lookup map keyed by sorted pair "compA|compB"
  const recipeMap = new Map();
  for (let i = 0; i < allItems.length; i++) {
    const it = allItems[i];
    if (!it || !Array.isArray(it.buildsFrom) || it.buildsFrom.length !== 2) continue;
    const pair = [it.buildsFrom[0], it.buildsFrom[1]].sort().join("|");
    if (!recipeMap.has(pair)) recipeMap.set(pair, it);
  }
  if (!recipeMap.size) return [];

  // Collect basic component indices in looseItems
  const comps = [];
  for (let i = 0; i < looseItems.length; i++) {
    const it = itemById[looseItems[i]];
    if (it && it.kind === "basic") comps.push({ idx: i, id: it.id, item: it });
  }
  if (comps.length < 2) return [];

  // Identify board holders with free item slots
  const holders = [];
  const boardTraitCounts = {};
  (board || []).forEach((e) => {
    const u = byId[e.id];
    if (!u) return;
    (u.traits || []).forEach((tid) => { boardTraitCounts[tid] = (boardTraitCounts[tid] || 0) + 1; });
    const role = (e.mark && e.mark !== "bot") ? e.mark : (labels && labels[e.id]) || "";
    const usedSlots = (e.items || []).reduce((acc, id) => acc + ((itemById[id] && itemById[id].slots) || 1), 0);
    if (usedSlots < 3) {
      holders.push({ entry: e, unit: u, role, usedSlots });
    }
  });

  const seenResults = new Set();
  const candidates = [];

  for (let a = 0; a < comps.length; a++) {
    for (let b = a + 1; b < comps.length; b++) {
      const pairKey = [comps[a].id, comps[b].id].sort().join("|");
      const result = recipeMap.get(pairKey);
      if (!result || seenResults.has(result.id)) continue;
      seenResults.add(result.id);

      let bestTarget = null;
      let bestScore = 0;
      let bestRoleText = "";

      if (result.teamSize > 0) {
        bestScore = 115;
        bestRoleText = "+1 人口";
      } else if (result.kind === "emblem" && result.trait) {
        const cnt = boardTraitCounts[result.trait] || 0;
        bestScore = cnt >= 2 ? 96 + cnt * 4 : cnt === 1 ? 74 : 42;
        const tr = game.traitById && game.traitById[result.trait];
        bestRoleText = tr ? `${tr.name} +1` : "转职纹章";
        // Find non-native holder if possible
        const carrier = holders.find((h) => !h.unit.traits.includes(result.trait) && !(h.entry.items || []).some((id) => itemById[id] && itemById[id].trait === result.trait));
        if (carrier) bestTarget = carrier;
      } else {
        const needSlots = result.slots || 1;
        for (let h = 0; h < holders.length; h++) {
          const holder = holders[h];
          if (holder.usedSlots + needSlots > 3) continue;
          if (result.unique && (holder.entry.items || []).includes(result.id)) continue;
          const base = itemUnitScore(result, holder.unit);
          if (base < 58) continue;
          const roleBoost = holder.role === "carry" ? 18 : holder.role === "tank" ? 16 : holder.role === "carry2" ? 8 : 0;
          const total = base + roleBoost + (holder.unit.cost || 1) * 1.2 + (holder.entry.star || 1) * 2;
          if (total > bestScore) {
            bestScore = total;
            bestTarget = holder;
            bestRoleText = (ROLE_CN[holder.role] ? ROLE_CN[holder.role] + " " : "") + (holder.unit.display || holder.unit.name);
          }
        }
        // Fallback when board is empty or full of items: recommend versatile core items
        if (!bestTarget) {
          const info = classifyDetailed(result);
          bestScore = info.category === "carry" || info.category === "tank" ? 55 : 48;
          bestRoleText = info.category === "tank" ? "通用前排" : info.category === "carry" ? "通用输出" : "通用功能";
        }
      }

      candidates.push({
        resultItemId: result.id,
        resultItem: result,
        idxA: comps[a].idx,
        idxB: comps[b].idx,
        compA: comps[a].id,
        compB: comps[b].id,
        targetId: bestTarget ? bestTarget.entry.id : null,
        targetLabel: bestRoleText,
        score: bestScore
      });
    }
  }

  candidates.sort((x, y) => y.score - x.score || x.resultItemId.localeCompare(y.resultItemId));
  return candidates.slice(0, 2);
}
