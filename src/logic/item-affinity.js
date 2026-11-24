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
