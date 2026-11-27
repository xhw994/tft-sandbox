import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  classifyItem,
  itemUnitScore,
  resolveLooseItems,
  findEmblemItemForTrait,
  computeCraftSuggestions
} from "./src/logic/item-affinity.js";
import { aliasesForUnit, aliasesForItem } from "./src/logic/search-aliases.js";
import {
  saveCurrentComp,
  listSavedComps,
  togglePinSavedComp,
  removeSavedComp,
  exportSavedCompsJson,
  importSavedCompsJson
} from "./src/logic/saved-comps.js";
import {
  parseUnlockMeta,
  buildUnlockContext
} from "./src/logic/unlock-planner.js";
import { planBoardReorg } from "./src/logic/reorg-planner.js";
import {
  encodeShareCode,
  buildShareUrl,
  buildShareText,
  decodeShareInput,
  encodeOfficialTeamCode,
  decodeOfficialTeamCode,
  extractOfficialTeamCode
} from "./src/logic/share-codec.js";
import { SET19_PLANNER_CODES } from "./src/logic/team-planner-code.js";
import {
  getCollabPoolIds,
  filterCollabGroups,
  suggestDiscriminatingUnits,
  scoreGroupsFromDetections
} from "./src/logic/collab-matcher.js";
import {
  sampleInnerPatch,
  extractPatchDescriptor,
  segmentScreenshotBoxes,
  matchDescriptorsToUnits
} from "./src/logic/avatar-ocr.js";
import { createStore } from "./src/state/store.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), sandbox, { filename: "data.js" });
vm.runInContext(fs.readFileSync(path.join(root, "assess.js"), "utf8"), sandbox, { filename: "assess.js" });
vm.runInContext(fs.readFileSync(path.join(root, "engine.js"), "utf8"), sandbox, { filename: "engine.js" });
vm.runInContext(fs.readFileSync(path.join(root, "board.js"), "utf8"), sandbox, { filename: "board.js" });

const data = sandbox.SET19;
const game = sandbox.TFT.create(data);
const TB = sandbox.TFTBoard;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    console.error("FAIL", name);
    throw err;
  }
}

function freshState(overrides = {}) {
  return {
    level: 8,
    extraSlots: 0,
    mode: "auto",
    viewMode: "normal",
    libraryTab: "units",
    traitTargets: {},
    targetTraitCount: null,
    allowLocked: true,
    emblems: {},
    prismatic: {},
    focusId: null,
    bannedIds: {},
    unlockTargetId: null,
    trackerMaxLevel: 9,
    board: [],
    looseItems: [],
    ...overrides
  };
}

// ============================================================================
// 1. board.js tests: add-loose, unequip-to-loose, SETTINGS, reset
// ============================================================================
test("board: add-loose validates itemId and pushes to looseItems", () => {
  const s0 = freshState();
  const bad = TB.apply(s0, { type: "add-loose", itemId: "NO_SUCH_ITEM" }, game);
  assert.ok(bad.error);
  assert.equal(bad.changed, false);

  const r1 = TB.apply(s0, { type: "add-loose", itemId: "DA_InfinityEdge" }, game);
  assert.equal(r1.error, null);
  assert.equal(r1.changed, true);
  assert.deepEqual(plain(r1.state.looseItems), ["DA_InfinityEdge"]);
});

test("board: unequip-to-loose moves unit item to looseItems with stale-index guard", () => {
  let s = freshState();
  s = TB.apply(s, { type: "add-unit", id: "DA_Jinx19", position: { row: 3, col: 0 } }, game).state;
  s = TB.apply(s, { type: "equip-item", id: "DA_Jinx19", itemId: "DA_InfinityEdge", source: { kind: "library" } }, game).state;
  s = TB.apply(s, { type: "equip-item", id: "DA_Jinx19", itemId: "DA_LastWhisper", source: { kind: "library" } }, game).state;

  const stale = TB.apply(s, { type: "unequip-to-loose", id: "DA_Jinx19", itemId: "DA_LastWhisper", index: 0 }, game);
  assert.ok(stale.error);
  assert.equal(stale.changed, false);

  const missingUnit = TB.apply(s, { type: "unequip-to-loose", id: "DA_Annie19", itemId: "DA_InfinityEdge", index: 0 }, game);
  assert.ok(missingUnit.error);

  const ok = TB.apply(s, { type: "unequip-to-loose", id: "DA_Jinx19", itemId: "DA_InfinityEdge", index: 0 }, game);
  assert.equal(ok.error, null);
  assert.deepEqual(plain(ok.state.board[0].items), ["DA_LastWhisper"]);
  assert.deepEqual(plain(ok.state.looseItems), ["DA_InfinityEdge"]);
});

test("board: SETTINGS supports bannedIds, unlockTargetId, trackerMaxLevel and reset clears them", () => {
  let s = freshState();
  const upd = TB.apply(s, {
    type: "update-settings",
    settings: {
      bannedIds: { DA_Zoe19: true },
      unlockTargetId: "DA_Tibbers19",
      trackerMaxLevel: 10
    }
  }, game);
  assert.equal(upd.error, null);
  assert.deepEqual(plain(upd.state.bannedIds), { DA_Zoe19: true });
  assert.equal(upd.state.unlockTargetId, "DA_Tibbers19");
  assert.equal(upd.state.trackerMaxLevel, 10);

  const rst = TB.apply(upd.state, { type: "reset" }, game);
  assert.equal(rst.error, null);
  assert.deepEqual(plain(rst.state.bannedIds), {});
  assert.equal(rst.state.unlockTargetId, null);
  assert.equal(rst.state.trackerMaxLevel, 10);
});

// ============================================================================
// 2. engine.js tests: ctx.bannedIds in recommend() & track()
// ============================================================================
test("engine: ctx.bannedIds excludes banned units in recommend() and suggest()", () => {
  const board = [
    { id: "DA_Jinx19", star: 2, items: [] },
    { id: "DA_Lux19", star: 1, items: [] }
  ];
  const baseRec = game.recommend(board, { level: 8, allowLocked: true });
  const candIds = new Set([
    ...baseRec.next.map((r) => r.id),
    ...baseRec.plans.flatMap((p) => (p.adds || []).map((a) => a.id))
  ]);
  assert.ok(candIds.size > 0, "baseline has recommendations");

  const bannedIds = {};
  for (const id of candIds) bannedIds[id] = true;

  const bannedRec = game.recommend(board, { level: 8, allowLocked: true, bannedIds });
  const afterIds = new Set([
    ...bannedRec.next.map((r) => r.id),
    ...bannedRec.plans.flatMap((p) => (p.adds || []).map((a) => a.id)),
    ...bannedRec.swaps.map((s) => s.inn),
    ...(bannedRec.holders.notes.flatMap((n) => n.upgrades || []))
  ]);
  for (const id of candIds) {
    assert.equal(afterIds.has(id), false, `banned unit ${id} should not appear in recommend`);
  }
});

test("engine: ctx.bannedIds excludes banned units in track()", () => {
  const board = [{ id: "DA_Annie19", star: 1, items: [] }];
  const t1 = game.track(board, { level: 6, allowLocked: true }, { targetTraitCount: 3 });
  let s1 = t1.step(2000);
  while (!s1.done) s1 = t1.step(2000);
  assert.ok(s1.plans.length > 0);
  const firstAdd = s1.plans[0].adds[0].id;

  const t2 = game.track(board, { level: 6, allowLocked: true, bannedIds: { [firstAdd]: true } }, { targetTraitCount: 3 });
  let s2 = t2.step(2000);
  while (!s2.done) s2 = t2.step(2000);
  for (const plan of s2.plans) {
    assert.equal(plan.adds.some((a) => a.id === firstAdd), false, `banned ${firstAdd} excluded from track`);
  }
});

// ============================================================================
// 3. item-affinity.js tests: 8-dim classification, manaless, 33 artifacts, loose resolve
// ============================================================================
test("item-affinity: 8-dim classification for AD carry, AP carry, Tank, Fighter, Utility, Radiant", () => {
  const ie = classifyItem(game.itemById.DA_InfinityEdge);
  assert.equal(ie.category, "carry");
  assert.equal(ie.damage, "physical");

  const ieRad = classifyItem(game.itemById.DA_InfinityEdgeRadiant);
  assert.equal(ieRad.category, "carry");
  assert.equal(ieRad.damage, "physical");
  assert.ok(ieRad.weight > ie.weight);

  const dcap = classifyItem(game.itemById.DA_RabadonsDeathcap);
  assert.equal(dcap.category, "carry");
  assert.equal(dcap.damage, "magic");

  const warmogs = classifyItem(game.itemById.DA_WarmogsArmor);
  assert.equal(warmogs.category, "tank");
  assert.equal(warmogs.damage, "any");

  const bt = classifyItem(game.itemById.DA_Bloodthirster);
  assert.equal(bt.category, "fighter");
  assert.equal(bt.damage, "physical");

  const titans = classifyItem(game.itemById.DA_TitansResolve);
  assert.equal(titans.category, "fighter");
  assert.equal(titans.damage, "hybrid");

  const crownguardRad = classifyItem(game.itemById.DA_CrownguardRadiant);
  assert.equal(crownguardRad.category, "fighter");
  assert.equal(crownguardRad.damage, "magic");

  const sunfire = classifyItem(game.itemById.DA_SunfireCape);
  assert.equal(sunfire.category, "utility");

  const blue = classifyItem(game.itemById.DA_BlueBuff);
  assert.equal(blue.category, "carry");
  assert.equal(blue.damage, "magic");
  assert.equal(blue.needsMana, true);
});

test("item-affinity: all 33 Set 19 artifacts are mapped accurately", () => {
  const artifacts = data.items.filter((i) => i.kind === "artifact");
  assert.equal(artifacts.length, 33);
  for (const art of artifacts) {
    const c = classifyItem(art);
    assert.ok(["tank", "fighter", "carry", "utility"].includes(c.category), `${art.id} unexpected category ${c.category}`);
    assert.ok(["physical", "magic", "hybrid", "any"].includes(c.damage), `${art.id} unexpected damage ${c.damage}`);
  }
  assert.equal(classifyItem(game.itemById.DA_Artifact_Manazane).needsMana, true);
  assert.equal(classifyItem(game.itemById.DA_Artifact_LightshieldCrest).category, "tank");
  assert.equal(classifyItem(game.itemById.DA_Artifact_TitanicHydra).category, "fighter");
  assert.equal(classifyItem(game.itemById.DA_Artifact_SnipersFocus).category, "carry");
  assert.equal(classifyItem(game.itemById.DA_Item_Artifact_TalismanOfAscension).category, "tank");
});

test("item-affinity: manaless units (Kennen, Olaf) penalized on mana items", () => {
  const kennen = game.byId.DA_Kennen19;
  const olaf = game.byId.DA_Olaf19;
  assert.equal(kennen.manaless, true);
  assert.equal(olaf.manaless, true);

  assert.equal(itemUnitScore(game.itemById.DA_BlueBuff, kennen), 10);
  assert.equal(itemUnitScore(game.itemById.DA_ProtectorsVow, kennen), 10);
  assert.equal(itemUnitScore(game.itemById.DA_Artifact_Manazane, kennen), 10);
  assert.equal(itemUnitScore(game.itemById.DA_SpearOfShojin, olaf), 10);
  assert.equal(itemUnitScore(game.itemById.DA_HandOfJustice, olaf), 10);

  // Non-mana tank item scores 90 on Kennen/Olaf
  assert.equal(itemUnitScore(game.itemById.DA_WarmogsArmor, kennen), 90);
  assert.equal(itemUnitScore(game.itemById.DA_WarmogsArmor, olaf), 90);
});

test("item-affinity: AD/AP/Tank/Fighter role scoring & carry/tank mismatch penalties", () => {
  const jinx = game.byId.DA_Jinx19; // physical marksman
  const ahri = game.byId.DA_Ahri19; // magic caster
  const taric = game.byId.DA_Taric19; // tank
  const yone = game.byId.DA_Yone19; // physical fighter

  assert.equal(itemUnitScore(game.itemById.DA_InfinityEdge, jinx), 92);
  assert.equal(itemUnitScore(game.itemById.DA_InfinityEdge, ahri), 18);
  assert.equal(itemUnitScore(game.itemById.DA_InfinityEdge, taric), 10);

  assert.equal(itemUnitScore(game.itemById.DA_RabadonsDeathcap, ahri), 92);
  assert.equal(itemUnitScore(game.itemById.DA_RabadonsDeathcap, jinx), 18);

  assert.equal(itemUnitScore(game.itemById.DA_WarmogsArmor, taric), 90);
  assert.equal(itemUnitScore(game.itemById.DA_WarmogsArmor, jinx), 5);

  assert.equal(itemUnitScore(game.itemById.DA_Bloodthirster, yone), 88);
  assert.equal(itemUnitScore(game.itemById.DA_TitansResolve, yone), 88);
});

test("item-affinity: resolveLooseItems assigns carry/tank/crown/emblem without double-counting emblems", () => {
  const board = [
    { id: "DA_Jinx19", star: 2, mark: "carry", items: [], position: { row: 3, col: 0 } },
    { id: "DA_Taric19", star: 2, mark: "tank", items: [], position: { row: 0, col: 3 } },
    { id: "DA_Annie19", star: 1, mark: "bot", items: [], position: { row: 3, col: 6 } }
  ];
  const labels = {
    DA_Jinx19: "carry",
    DA_Taric19: "tank",
    DA_Annie19: "bot"
  };
  const loose = [
    "DA_InfinityEdge",      // -> carry (C)
    "DA_WarmogsArmor",      // -> tank (坦)
    "DA_KDA19_Emblem",      // -> emblem (纹), targetId = DA_Annie19 (bot, non-KDA)
    "DA_TacticiansCrown",   // -> crown (冠)
    "DA_RabadonsDeathcap"   // -> unassigned (荐) since primary carry Jinx is physical!
  ];

  const res = resolveLooseItems(board, loose, game, labels);
  assert.equal(res.assignments.length, 5);
  assert.deepEqual(res.assignments[0].badgeKind, "carry");
  assert.equal(res.assignments[0].badgeText, "C");
  assert.equal(res.assignments[0].targetId, "DA_Jinx19");

  assert.equal(res.assignments[1].badgeKind, "tank");
  assert.equal(res.assignments[1].badgeText, "坦");
  assert.equal(res.assignments[1].targetId, "DA_Taric19");

  assert.equal(res.assignments[2].badgeKind, "emblem");
  assert.equal(res.assignments[2].badgeText, "纹");
  assert.equal(res.assignments[2].targetId, "DA_Annie19");

  assert.equal(res.assignments[3].badgeKind, "crown");
  assert.equal(res.assignments[3].badgeText, "冠");
  assert.equal(res.assignments[3].targetId, null);

  assert.equal(res.assignments[4].badgeKind, "rec");
  assert.equal(res.assignments[4].badgeText, "荐");
  assert.equal(res.assignments[4].targetId, null);

  // Input board must remain untouched
  assert.deepEqual(board[0].items, []);
  assert.deepEqual(board[1].items, []);

  // virtualBoard has carry/tank items, NOT emblem
  assert.deepEqual(res.virtualBoard[0].items, ["DA_InfinityEdge"]);
  assert.deepEqual(res.virtualBoard[1].items, ["DA_WarmogsArmor"]);
  assert.deepEqual(res.virtualBoard[2].items, []);

  // Emblem counted once in looseEmblems, NOT double-counted in engine.evaluate()
  assert.deepEqual(res.looseEmblems, { DA_KDA19: 1 });
  const ev = game.evaluate(res.virtualBoard, { level: 8, emblems: res.looseEmblems, prismatic: {} }, null);
  const kda = ev.traits.find((t) => t.id === "DA_KDA19");
  assert.equal(kda.count, 1, "loose K/DA emblem should count exactly once");

  // Unassigned AP item boosts AP caster via looseItemFit
  const ahriFit = res.looseItemFit.scoreUnit(game.byId.DA_Ahri19);
  assert.equal(ahriFit.bonus, 4.5);
  assert.deepEqual(ahriFit.matchedItems, ["DA_RabadonsDeathcap"]);
  const jinxFit = res.looseItemFit.scoreUnit(game.byId.DA_Jinx19);
  assert.equal(jinxFit.bonus, 0);
  assert.deepEqual(jinxFit.matchedItems, []);
});

test("item-affinity + engine: unassigned IE boosts AD carry in nextBuys & plan.matchedItems", () => {
  // Board has tank only (no primary carry yet), so unassigned IE stays in unassigned -> boosts AD carries
  const board = [{ id: "DA_Taric19", star: 2, mark: "tank", items: [] }];
  const loose = ["DA_InfinityEdge", "DA_GiantSlayer"];
  const res = resolveLooseItems(board, loose, game, { DA_Taric19: "tank" });
  assert.equal(res.unassigned.length, 2);

  const rec = game.recommend(res.virtualBoard, {
    level: 8,
    allowLocked: true,
    looseItems: loose,
    looseItemFit: res.looseItemFit
  });

  const adBuy = rec.next.find((r) => r.matchedItems && r.matchedItems.includes("DA_InfinityEdge"));
  assert.ok(adBuy, "nextBuys should include an AD unit matching DA_InfinityEdge");
  assert.ok(adBuy.itemFitBonus >= 4.5);

  const planWithMatch = rec.plans.find((p) => Array.isArray(p.matchedItems) && p.matchedItems.length > 0);
  assert.ok(planWithMatch, "plans should aggregate matchedItems onto plan.matchedItems");
});

test("item-affinity: findEmblemItemForTrait finds matching emblem or null", () => {
  const kdaEmb = findEmblemItemForTrait(game, "DA_KDA19");
  assert.ok(kdaEmb);
  assert.equal(kdaEmb.id, "DA_KDA19_Emblem");
  assert.equal(findEmblemItemForTrait(game, "NON_EXISTENT"), null);
});

// ============================================================================
// 4. unlock-planner.js tests
// ============================================================================
test("unlock-planner: inactive when unlockTargetId is missing or invalid", () => {
  assert.deepEqual(buildUnlockContext(freshState(), game, [], { level: 8 }), { active: false });
  assert.deepEqual(buildUnlockContext(freshState({ unlockTargetId: "BAD_ID" }), game, [], { level: 8 }), { active: false });
});

test("unlock-planner: Tibbers requires Annie 2* (add -> star -> satisfied) and builds virtualBoard", () => {
  const meta = parseUnlockMeta(game.byId.DA_Tibbers19, game);
  assert.equal(meta.reqUnits.length, 1);
  assert.equal(meta.reqUnits[0].id, "DA_Annie19");
  assert.equal(meta.reqUnits[0].star, 2);

  // Annie absent -> action: add
  const ctx1 = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Tibbers19" }),
    game,
    [{ id: "DA_Lux19", star: 1, items: [] }],
    { level: 6 }
  );
  assert.equal(ctx1.active, true);
  assert.equal(ctx1.alreadyOnBoard, false);
  assert.equal(ctx1.prereqActions.length, 1);
  assert.equal(ctx1.prereqActions[0].id, "DA_Annie19");
  assert.equal(ctx1.prereqActions[0].action, "add");
  assert.equal(ctx1.prereqActions[0].needStar, 2);
  assert.equal(ctx1.virtualBoard.some((e) => e.id === "DA_Tibbers19"), true);
  assert.equal(ctx1.virtualCtx.focusId, "DA_Tibbers19");
  assert.equal(ctx1.needsMiniTrack, false);

  // Annie 1* on board -> action: star
  const ctx2 = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Tibbers19" }),
    game,
    [{ id: "DA_Annie19", star: 1, items: [] }],
    { level: 6 }
  );
  assert.equal(ctx2.prereqActions.length, 1);
  assert.equal(ctx2.prereqActions[0].action, "star");
  assert.equal(ctx2.prereqActions[0].onBoard, true);

  // Annie 2* on board -> prereq satisfied
  const ctx3 = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Tibbers19" }),
    game,
    [{ id: "DA_Annie19", star: 2, items: [] }],
    { level: 6 }
  );
  assert.equal(ctx3.prereqActions.length, 0);
});

test("unlock-planner: Kobuko requires Ziggs 2*", () => {
  const ctx = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Kobuko19" }),
    game,
    [{ id: "DA_Ziggs19", star: 1, items: [] }],
    { level: 5 }
  );
  assert.equal(ctx.active, true);
  assert.equal(ctx.prereqActions.length, 1);
  assert.equal(ctx.prereqActions[0].id, "DA_Ziggs19");
  assert.equal(ctx.prereqActions[0].needStar, 2);
  assert.equal(ctx.prereqActions[0].action, "star");
});

test("unlock-planner: Aphelios mode=any satisfied when either key is 2*", () => {
  const ctx = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Aphelios19" }),
    game,
    [{ id: "DA_Yone19", star: 2, items: [] }],
    { level: 8 }
  );
  assert.equal(ctx.meta.mode, "any");
  assert.equal(ctx.prereqActions.length, 0);
});

test("unlock-planner: Smeech parses 8 non-solo traits and enables mini-track at level 9", () => {
  const meta = parseUnlockMeta(game.byId.DA_Smeech19, game);
  assert.equal(meta.minLevel, 9);
  assert.equal(meta.reqTraitCount, 8);

  const ctx = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Smeech19" }),
    game,
    [{ id: "DA_Jinx19", star: 2, items: [] }],
    { level: 7 }
  );
  assert.equal(ctx.active, true);
  assert.equal(ctx.needsMiniTrack, true);
  assert.equal(ctx.miniTrackGoal, 8);
  assert.equal(ctx.miniTrackMaxLevel, 9);
  assert.equal(ctx.virtualCtx.level, 9);
  assert.equal(ctx.virtualCtx.focusId, "DA_Smeech19");
});

test("unlock-planner: Zac parses trait names in 【...】 and full board cleanly adjusts extraSlots", () => {
  const meta = parseUnlockMeta(game.byId.DA_Zac19, game);
  assert.deepEqual(meta.reqTraitIds, ["DA_OceanSong19", "DA_Juggernaut19"]);

  const fullBoard = [
    "DA_Elise19", "DA_Yunara19", "DA_Annie19", "DA_Lux19",
    "DA_Jinx19", "DA_Taric19", "DA_Zoe19"
  ].map((id) => ({ id, star: 1, items: [] }));

  const ctx = buildUnlockContext(
    freshState({ unlockTargetId: "DA_Zac19" }),
    game,
    fullBoard,
    { level: 7, extraSlots: 0 }
  );
  assert.equal(ctx.virtualBoard.length, 8);
  assert.ok(ctx.virtualCtx.extraSlots >= 1);
  assert.ok(game.capacity(ctx.virtualBoard, ctx.virtualCtx) >= game.slotsOf(ctx.virtualBoard));
});

test("engine: Lv9 3-star 3-cost Malzahar (27g) is ok, while 3-star 1-cost (9g) stays behind", () => {
  const recMalz = game.recommend(
    [
      { id: "DA_Malzahar19", star: 3, items: [] },
      { id: "DA_DrMundo19", star: 2, items: [] },
      { id: "DA_Lux19", star: 2, items: [] }
    ],
    { level: 9, mode: "auto", allowLocked: true }
  );
  const carryNote = recMalz.holders.notes.find((n) => n.role === "carry" && n.id === "DA_Malzahar19");
  assert.ok(carryNote, "Malzahar should be inferred carry");
  assert.equal(carryNote.status, "ok", "3-star 3-cost (27g) should be ok at Lv9, got: " + carryNote.status);
  assert.ok(carryNote.text.includes("价值 27 金"), "note mentions 27g value: " + carryNote.text);

  const rec1Cost = game.recommend(
    [{ id: "DA_Yunara19", star: 3, items: [] }],
    { level: 9, mode: "auto", allowLocked: true }
  );
  const lowNote = rec1Cost.holders.notes.find((n) => n.role === "carry" && n.id === "DA_Yunara19");
  assert.equal(lowNote.status, "behind", "3-star 1-cost (9g) stays behind at Lv9");
});

test("engine: 2-star 5-cost Mundo promotes to main tank over 1-star 3-cost Ekko (even with Ekko traits)", () => {
  const board = [
    { id: "DA_Malzahar19", star: 3, items: [] },
    { id: "DA_Ekko19", star: 1, items: [] },
    { id: "DA_Leona19", star: 1, items: [] },
    { id: "DA_DrMundo19", star: 2, items: [] },
    { id: "DA_Alune19", star: 2, items: [] },
    { id: "DA_Lux19", star: 1, items: [] },
    { id: "DA_Neeko19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 9, mode: "auto", allowLocked: true });
  assert.equal(rec.labels.DA_DrMundo19, "tank", "2-star Mundo must be main tank: " + JSON.stringify(rec.labels));
  assert.notEqual(rec.labels.DA_Ekko19, "tank", "1-star Ekko should not block 2-star Mundo");
});

test("engine: 3-item 2-star 4-cost tank retains main tank over naked 2-star 5-cost Mundo", () => {
  const board = [
    { id: "DA_Malzahar19", star: 3, items: [] },
    { id: "DA_Braum19", star: 2, items: ["DA_WarmogsArmor", "DA_GargoyleStoneplate", "DA_DragonsClaw"] },
    { id: "DA_DrMundo19", star: 2, items: [] }
  ];
  const rec = game.recommend(board, { level: 9, mode: "auto", allowLocked: true });
  assert.equal(rec.labels.DA_Braum19, "tank", "3-item 2-star 4-cost tank retains main tank: " + JSON.stringify(rec.labels));
});

test("track: requireBoardRelatedLocked filters unrelated locked units and allows related ones", () => {
  const board = [
    { id: "DA_Elise19", star: 2, items: [] },
    { id: "DA_Yunara19", star: 2, items: [] },
    { id: "DA_Annie19", star: 2, items: [] }
  ];
  const task = game.track(
    board,
    { level: 8, mode: "auto", allowLocked: true, emblems: {}, prismatic: {} },
    { targetTraitCount: 6, maxLevel: 9, requireBoardRelatedLocked: true }
  );
  let snap = task.step(25000);
  assert.ok(snap.plans.length > 0, "should find ladder plans with board-related locked filter");
  const unrelated = new Set([
    "DA_Samira19", "DA_Alune19", "DA_Tristana19", "DA_Lulu19", "DA_Ashe19",
    "DA_Kayle19", "DA_Zac19", "DA_Vayne19", "DA_Kobuko19", "DA_Aphelios19",
    "DA_Wukong19", "DA_LeeSin19", "DA_Janna19", "DA_Smeech19"
  ]);
  for (const p of snap.plans) {
    for (const a of p.adds) {
      assert.ok(!unrelated.has(a.id), "unrelated locked unit should not appear in ladder: " + a.id);
    }
  }

  // Explicitly targeting Ionic Spark 7 on this Annie-2* board SHOULD allow related Tibbers/Jinx
  const taskRel = game.track(
    board,
    { level: 8, mode: "auto", allowLocked: true, emblems: {}, prismatic: {} },
    { traitTargets: { DA_IonicSpark19: 7 }, targetTraitCount: 1, maxLevel: 8, requireBoardRelatedLocked: true }
  );
  let snapRel = taskRel.step(20000);
  while (!snapRel.done) snapRel = taskRel.step(20000);
  assert.ok(snapRel.plans.length > 0, "Ionic Spark 7 should succeed using board-related Tibbers/Jinx");
});

test("reorg-planner: reorganizes full 8/8 board toward target traits while protecting starred/itemized cores", () => {
  const board = [
    { id: "DA_Elise19", star: 2, items: ["DA_WarmogsArmor", "DA_GargoyleStoneplate"] },
    { id: "DA_Yunara19", star: 2, items: ["DA_GuinsoosRageblade", "DA_InfinityEdge"] },
    { id: "DA_Annie19", star: 2, items: [] },
    { id: "DA_Lux19", star: 2, items: [] },
    { id: "DA_Olaf19", star: 1, items: [] },
    { id: "DA_Kayn19", star: 1, items: [] },
    { id: "DA_Braum19", star: 1, items: [] },
    { id: "DA_Bard19", star: 1, items: [] }
  ];
  const res = planBoardReorg(
    board,
    { level: 8, extraSlots: 0, emblems: {}, prismatic: {}, looseItems: [], bannedIds: {}, allowLocked: true, focusId: "DA_Yunara19" },
    game,
    { traitTargets: { DA_IonicSpark19: 7, DA_Bodyguard19: 2 } }
  );
  assert.equal(res.status, "ok", "should find Lv8 reorg plan: " + res.status);
  assert.ok(res.plans.length >= 1, "at least 1 reorg plan");
  const top = res.plans[0];
  assert.ok(top.slots <= 8, "fits within Lv8 cap");
  assert.ok(top.removes.length > 0 && top.adds.length > 0, "swaps fillers for target units");
  const finalIds = new Set(top.board.map((e) => e.id));
  assert.ok(finalIds.has("DA_Yunara19") && finalIds.has("DA_Elise19") && finalIds.has("DA_Annie19") && finalIds.has("DA_Lux19"), "keeps 2* itemized Ionic Spark core");
  const ev = game.evaluate(top.board, { level: 8, emblems: {}, prismatic: {} }, null);
  const ionic = ev.traits.find((t) => t.id === "DA_IonicSpark19");
  const bg = ev.traits.find((t) => t.id === "DA_Bodyguard19");
  assert.ok(ionic && ionic.count >= 7, "meets Ionic Spark 7: " + (ionic && ionic.count));
  assert.ok(bg && bg.count >= 2, "meets Bodyguard 2: " + (bg && bg.count));
});

test("reorg-planner: handles no-targets, already-met, blocked prismatic, and need-level lookahead", () => {
  const baseBoard = [
    { id: "DA_Elise19", star: 2, items: [] },
    { id: "DA_Yunara19", star: 2, items: [] },
    { id: "DA_Annie19", star: 2, items: [] }
  ];
  const noT = planBoardReorg(baseBoard, { level: 8 }, game, { traitTargets: {} });
  assert.equal(noT.status, "no-targets");
  assert.ok(noT.quickSuggestions.length > 0, "suggests quick target presets from current board");

  const met = planBoardReorg(baseBoard, { level: 8 }, game, { traitTargets: { DA_IonicSpark19: 3 } });
  assert.equal(met.status, "already-met");

  const blk = planBoardReorg(baseBoard, { level: 8, prismatic: {} }, game, { traitTargets: { DA_IonicSpark19: 10 } });
  assert.equal(blk.status, "blocked");
  assert.equal(blk.blockedTargets[0].id, "DA_IonicSpark19");

  const needLvl = planBoardReorg(baseBoard, { level: 6, allowLocked: true }, game, { traitTargets: { DA_IonicSpark19: 7 } });
  assert.equal(needLvl.status, "need-level", "Lv6 cannot fit 7 Ionic Spark units without leveling: " + needLvl.status);
  assert.ok(needLvl.minLevel >= 7 && needLvl.plans.length > 0, "lookahead finds plan at minLevel >= 7");
});

test("board: reset clears targetTraitCount and extraSlots cleanly", () => {
  const s0 = freshState({ level: 9, extraSlots: 2, targetTraitCount: 7, traitTargets: { DA_IonicSpark19: 7 } });
  const r = TB.apply(s0, { type: "reset" }, game);
  assert.equal(r.error, null);
  assert.equal(r.state.extraSlots, 0);
  assert.equal(r.state.targetTraitCount, 0);
  assert.deepEqual(plain(r.state.traitTargets), {});
});

test("engine: classify() continuous carryRank picks 5-cost Taliyah over 1-cost Zoe on 1* Lv10 Ocean Song board", () => {
  const board = [
    "DA_Zoe19", "DA_Ashe19", "DA_Zac19", "DA_Rell19", "DA_Renekton19",
    "DA_Nunu19", "DA_Graves19", "DA_Taliyah19", "DA_Syndra19", "DA_Mel19"
  ].map((id) => ({ id, star: 1, items: [] }));
  const rec = game.recommend(board, { level: 10, allowLocked: true });
  assert.equal(rec.labels.DA_Taliyah19, "carry", "5-cost Taliyah should be inferred carry, got: " + JSON.stringify(rec.labels));
  assert.notEqual(rec.labels.DA_Zoe19, "carry", "1-cost Zoe should not beat 5-cost Taliyah");
});

test("share-codec: encodes and decodes plain text code, chat-wrapped text, and URL hash with full fidelity", () => {
  const state = freshState({
    level: 9,
    extraSlots: 1,
    mode: "fast8",
    allowLocked: false,
    focusId: "DA_Jinx19",
    unlockTargetId: "DA_Tibbers19",
    board: [
      { id: "DA_Jinx19", star: 2, mark: "carry", position: { row: 3, col: 0 }, items: ["DA_InfinityEdge", "DA_LastWhisper"] },
      { id: "DA_Shyvana19", star: 2, mark: "tank", position: { row: 0, col: 3 }, items: ["DA_WarmogsArmor"] }
    ],
    looseItems: ["DA_IonicSpark19_Emblem"],
    emblems: { DA_IonicSpark19: 1 },
    prismatic: { DA_IonicSpark19: true },
    traitTargets: { DA_IonicSpark19: 7 },
    bannedIds: { DA_Zoe19: true },
    targetTraitCount: 6
  });

  const code = encodeShareCode(state, game);
  assert.ok(code.startsWith("TFT19:"), "code starts with TFT19:");

  const dec1 = decodeShareInput(code, game);
  assert.equal(dec1.error, null);
  assert.equal(dec1.state.level, 9);
  assert.equal(dec1.state.extraSlots, 1);
  assert.equal(dec1.state.mode, "fast8");
  assert.equal(dec1.state.allowLocked, false);
  assert.equal(dec1.state.focusId, "DA_Jinx19");
  assert.equal(dec1.state.unlockTargetId, "DA_Tibbers19");
  assert.equal(dec1.state.board.length, 2);
  assert.deepEqual(dec1.state.board[0].items, ["DA_InfinityEdge", "DA_LastWhisper"]);
  assert.deepEqual(dec1.state.looseItems, ["DA_IonicSpark19_Emblem"]);
  assert.deepEqual(dec1.state.prismatic, { DA_IonicSpark19: true });
  assert.deepEqual(dec1.state.traitTargets, { DA_IonicSpark19: 7 });
  assert.deepEqual(dec1.state.bannedIds, { DA_Zoe19: true });

  // Chat-wrapped plain text share works seamlessly
  const chatText = buildShareText(state, game, { system: { primaryTraits: [{ name: "离子火花" }], archetypeLabel: "垂直高羁绊" } });
  assert.ok(chatText.includes("云顶沙盘") && chatText.includes("TFT19:"));
  const dec2 = decodeShareInput(`兄弟帮我看看这盘怎么转：\n${chatText}\n在线等！`, game);
  assert.equal(dec2.error, null);
  assert.equal(dec2.state.board.length, 2);
  assert.equal(dec2.state.focusId, "DA_Jinx19");

  // Full URL hash link works seamlessly
  const url = buildShareUrl(state, game, "https://xhw994.github.io/tft-sandbox/");
  assert.ok(url.includes("#s=TFT19:"));
  const dec3 = decodeShareInput(url, game);
  assert.equal(dec3.error, null);
  assert.equal(dec3.state.level, 9);

  // Invalid / garbled input rejected cleanly
  assert.ok(decodeShareInput("hello world", game).error);
  assert.ok(decodeShareInput("TFT19:not-valid-base64!!!", game).error);
});

test("store: Undo/Redo stack tracks edits, reset, and share-code import cleanly", () => {
  globalThis.SET19 = data;
  globalThis.TFT = sandbox.TFT;
  globalThis.TFTBoard = sandbox.TFTBoard;
  globalThis.TFTAssess = sandbox.TFTAssess;

  const store = createStore();
  store.init();
  assert.equal(store.canUndo(), false);

  store.act({ type: "add-unit", id: "DA_Elise19", position: { row: 0, col: 2 } });
  assert.equal(store.getState().board.length, 1);
  assert.equal(store.canUndo(), true);

  store.act({ type: "set-star", id: "DA_Elise19", star: 2 });
  assert.equal(store.getState().board[0].star, 2);

  assert.equal(store.undo(), true);
  assert.equal(store.getState().board[0].star, 1);
  assert.equal(store.canRedo(), true);

  assert.equal(store.redo(), true);
  assert.equal(store.getState().board[0].star, 2);

  const code = store.getShareCode();
  store.resetAll();
  assert.equal(store.getState().board.length, 0);

  // Ctrl+Z undo restores pre-reset state too
  assert.equal(store.undo(), true);
  assert.equal(store.getState().board.length, 1);

  // Import share code is also undoable
  store.resetAll();
  const imp = store.importShareText(code);
  assert.equal(imp.ok, true);
  assert.equal(store.getState().board.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(store.getState().board.length, 0);
});

test("store: addFirstFree auto-places non-drag adds into optimal lane hexes (back carry row 3, front tank row 0)", () => {
  globalThis.SET19 = data;
  globalThis.TFT = sandbox.TFT;
  globalThis.TFTBoard = sandbox.TFTBoard;
  globalThis.TFTAssess = sandbox.TFTAssess;

  const store = createStore();
  store.init();
  store.resetAll();

  // Backline marksman Jinx should auto-place into back corner (row 3, col 0)
  assert.equal(store.addFirstFree("DA_Jinx19"), true);
  const jinx = store.getState().board.find((e) => e.id === "DA_Jinx19");
  assert.equal(jinx.position.row, 3, "backline carry auto-places to row 3");
  assert.equal(jinx.position.col, 0, "backline carry auto-places to corner col 0");

  // Frontline tank Shyvana should auto-place into front center (row 0, col 3)
  assert.equal(store.addFirstFree("DA_Shyvana19"), true);
  const shyv = store.getState().board.find((e) => e.id === "DA_Shyvana19");
  assert.equal(shyv.position.row, 0, "frontline tank auto-places to row 0");
  assert.equal(shyv.position.col, 3, "frontline tank auto-places to centered col 3");
});

test("item-affinity + board: computeCraftSuggestions & craft-loose atomically craft and equip with Ctrl+Z undo", () => {
  globalThis.SET19 = data;
  globalThis.TFT = sandbox.TFT;
  globalThis.TFTBoard = sandbox.TFTBoard;
  globalThis.TFTAssess = sandbox.TFTAssess;

  const store = createStore();
  store.init();
  store.resetAll();
  store.addFirstFree("DA_Jinx19");
  store.addFirstFree("DA_Shyvana19");
  store.addLooseItem("DA_Component_BFSword");
  store.addLooseItem("DA_Component_RecurveBow");
  store.addLooseItem("DA_Component_ChainVest");
  store.addLooseItem("DA_Component_GiantsBelt");

  const suggestions = computeCraftSuggestions(
    store.getState().board,
    store.getState().looseItems,
    game,
    { DA_Jinx19: "carry", DA_Shyvana19: "tank" }
  );
  assert.ok(suggestions.length >= 1, "should suggest craftable recipes from 4 components");
  const top = suggestions[0];
  assert.ok(top.targetId === "DA_Jinx19" || top.targetId === "DA_Shyvana19", "targets carry or tank");

  assert.equal(store.craftLoose(top.idxA, top.idxB, top.compA, top.compB, top.resultItemId, top.targetId), true);
  assert.equal(store.getState().looseItems.length, 2, "consumes 2 components from looseItems");
  const holder = store.getState().board.find((e) => e.id === top.targetId);
  assert.ok(holder.items.includes(top.resultItemId), "equips crafted item onto target holder");

  // Undo restores components and removes crafted item cleanly
  assert.equal(store.undo(), true);
  assert.equal(store.getState().looseItems.length, 4);
  assert.equal(store.getState().board.find((e) => e.id === top.targetId).items.length, 0);
});

test("search-aliases: matches Pinyin initials & authentic Chinese LoL/TFT nicknames for units, traits, and items", () => {
  assert.ok(aliasesForUnit(game.byId.DA_Malzahar19, game).includes("mzh"));
  assert.ok(aliasesForUnit(game.byId.DA_Malzahar19, game).includes("蚂蚱"));
  assert.ok(aliasesForUnit(game.byId.DA_Nasus19, game).includes("狗头"));
  assert.ok(aliasesForUnit(game.byId.DA_BaronNashor19, game).includes("大龙"));
  assert.ok(aliasesForUnit(game.byId.DA_Elise19, game).includes("蜘蛛"));
  assert.ok(aliasesForUnit(game.byId.DA_Elise19, game).includes("lzhh"));
  assert.ok(aliasesForItem(game.itemById.DA_GuinsoosRageblade).includes("羊刀"));
  assert.ok(aliasesForItem(game.itemById.DA_GuinsoosRageblade).includes("yd"));
});

test("saved-comps + meta_comps.js: saved lineup CRUD/backup & live-synced Set 19 meta templates validate cleanly", () => {
  // Mock localStorage in Node test realm
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  const st = freshState({
    level: 8,
    board: [{ id: "DA_Elise19", star: 2, position: { row: 0, col: 3 }, items: [] }]
  });
  const saved = saveCurrentComp(st, game, null, { name: "测试离子火花", category: "meta" });
  assert.equal(listSavedComps().length, 1);
  togglePinSavedComp(saved.id);
  assert.equal(listSavedComps()[0].pinned, true);
  const backup = exportSavedCompsJson();
  removeSavedComp(saved.id);
  assert.equal(listSavedComps().length, 0);
  const imp = importSavedCompsJson(backup);
  assert.equal(imp.ok, true);
  assert.equal(imp.added, 1);
  assert.equal(listSavedComps().length, 1);

  // Verify meta_comps.js loads cleanly and maps to real Set 19 unit IDs
  const metaSandbox = { window: {} };
  vm.createContext(metaSandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "meta_comps.js"), "utf8"), metaSandbox);
  const mc = metaSandbox.window.META_COMPS;
  assert.ok(mc && Array.isArray(mc.comps) && mc.comps.length >= 10, "meta_comps.js has >= 10 synced Set 19 comps");
  for (const c of mc.comps) {
    assert.ok(c.units.length >= 5, `comp ${c.title} has >= 5 units`);
    for (const u of c.units) assert.ok(game.byId[u.id], `valid unit id ${u.id}`);
  }
  if (mc.plannerCodes) {
    assert.equal(Object.keys(mc.plannerCodes).length, 94, "synced plannerCodes covers all 94 units");
  }
});

test("team-planner-code: all 94 Set 19 units have unique valid 3-hex Riot v2 codes", () => {
  const seenHex = new Set();
  assert.equal(data.units.length, 94);
  for (const u of data.units) {
    const hex = SET19_PLANNER_CODES[u.id];
    assert.ok(hex && /^[0-9a-f]{3}$/.test(hex), `unit ${u.id} has 3-char hex code, got ${hex}`);
    assert.notEqual(hex, "000");
    assert.equal(seenHex.has(hex), false, `duplicate hex ${hex} on ${u.id}`);
    seenHex.add(hex);
  }
  assert.equal(seenHex.size, 94);
  // Regression guard against iesdev PBE duplicate bug on Graves/Nasus/Mordekaiser
  assert.equal(SET19_PLANNER_CODES.DA_Graves19, "449");
  assert.equal(SET19_PLANNER_CODES.DA_Nasus19, "44a");
  assert.equal(SET19_PLANNER_CODES.DA_Mordekaiser19, "44b");
});

test("team-planner-code + unified import: round-trip Riot v2 code, chat extraction, truncation, Baron slots, and undo", () => {
  const lineup = [
    { id: "DA_Ahri19", star: 2, mark: "carry", items: ["DA_BlueBuff"] },
    { id: "DA_AkaliKDA19", star: 2, items: [] },
    { id: "DA_Shyvana19", star: 2, mark: "tank", items: ["DA_WarmogsArmor"] },
    { id: "DA_Jinx19", star: 2, items: [] }
  ];
  const enc = encodeOfficialTeamCode(lineup, game);
  assert.equal(enc.error, null);
  assert.equal(enc.count, 4);
  assert.equal(enc.truncated, 0);
  assert.match(enc.code, /^02[0-9a-f]{30}TFTSet19$/);
  assert.equal(enc.code.length, 40);
  assert.equal(enc.code, "023e93ec429409000000000000000000TFTSet19");

  // Case-insensitive decode + guide text extraction via unified decodeShareInput
  const wrapped = `【攻略推荐】直接复制到云顶客户端小队规划器：${enc.code.toUpperCase()} 上分必备！`;
  assert.equal(extractOfficialTeamCode(wrapped), enc.code.toUpperCase());
  const dec = decodeShareInput(wrapped, game);
  assert.equal(dec.error, null);
  assert.equal(dec.format, "official");
  assert.deepEqual(dec.state.board.map((e) => e.id), ["DA_Ahri19", "DA_AkaliKDA19", "DA_Shyvana19", "DA_Jinx19"]);

  // Wrong set rejection & external format hints
  const wrongSet = decodeShareInput("023e93ec429409000000000000000000TFTSet18", game);
  assert.ok(wrongSet.error && wrongSet.error.includes("S18") && wrongSet.error.includes("S19"));
  const jcc = decodeShareInput("【阵容码】##测试##H4sIAAAAAAAAA1234567890==##", game);
  assert.ok(jcc.error && jcc.error.includes("金铲铲"));
  const v1 = decodeShareInput("010102030405060708090aTFTSet13", game);
  assert.ok(v1.error && v1.error.includes("01"));

  // >10 units priority truncation keeps marked carry/tank + Baron + 9 others handles 11 slots
  const twelve = [
    { id: "DA_Zoe19", star: 1, items: [] },
    { id: "DA_Annie19", star: 1, items: [] },
    { id: "DA_Ahri19", star: 2, mark: "carry", items: ["DA_BlueBuff", "DA_RabadonsDeathcap"] },
    { id: "DA_Shyvana19", star: 2, mark: "tank", items: ["DA_WarmogsArmor"] },
    { id: "DA_BaronNashor19", star: 1, items: [] },
    { id: "DA_Jinx19", star: 2, items: ["DA_InfinityEdge"] },
    { id: "DA_Taliyah19", star: 2, items: [] },
    { id: "DA_Sona19", star: 2, items: [] },
    { id: "DA_DrMundo19", star: 2, items: [] },
    { id: "DA_Taric19", star: 2, items: [] },
    { id: "DA_Mel19", star: 2, items: [] },
    { id: "DA_Mordekaiser19", star: 2, items: [] }
  ];
  const trunc = encodeOfficialTeamCode(twelve, game);
  assert.equal(trunc.count, 10);
  assert.equal(trunc.truncated, 2);
  const decTrunc = decodeOfficialTeamCode(trunc.code, game);
  assert.equal(decTrunc.error, null);
  const decIds = decTrunc.state.board.map((e) => e.id);
  assert.ok(decIds.includes("DA_Ahri19") && decIds.includes("DA_Shyvana19") && decIds.includes("DA_BaronNashor19"));
  // 10 units including 2-slot Baron => 11 board slots => level 10 + extraSlots 1
  assert.equal(decTrunc.state.level, 10);
  assert.equal(decTrunc.state.extraSlots, 1);

  // Store unified import auto-places units tactically & supports Ctrl+Z undo
  globalThis.SET19 = data;
  globalThis.TFT = sandbox.TFT;
  globalThis.TFTBoard = sandbox.TFTBoard;
  globalThis.TFTAssess = sandbox.TFTAssess;
  const store = createStore();
  store.init();
  store.resetAll();
  const imp = store.importShareText(wrapped);
  assert.equal(imp.ok, true);
  assert.equal(imp.format, "official");
  assert.equal(store.getState().board.length, 4);
  const importedShyv = store.getState().board.find((e) => e.id === "DA_Shyvana19");
  const importedJinx = store.getState().board.find((e) => e.id === "DA_Jinx19");
  assert.ok(importedShyv.position && importedShyv.position.row <= 1, "tank placed in front row");
  assert.ok(importedJinx.position && importedJinx.position.row >= 2, "marksman placed in back row");
  assert.equal(store.getOfficialTeamCode().code, enc.code);
  assert.equal(store.undo(), true);
  assert.equal(store.getState().board.length, 0);
});

test("season_data.js + collab-matcher: 40 Set 19 Collab groups, subset/exclude filter, hints, and reward tables validate", () => {
  const sSandbox = { window: {} };
  vm.createContext(sSandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "season_data.js"), "utf8"), sSandbox);
  const sd = sSandbox.window.SEASON_DATA;

  assert.equal(sd.set, 19);
  assert.equal(sd.collab.groups.length, 40, "40 Set 19 Collab groups synced");
  const pool = getCollabPoolIds(sd.collab.groups, game);
  assert.equal(pool.length, 55, "55 distinct Collab pool units");
  for (const uid of pool) assert.ok(game.byId[uid], `valid Collab unit ${uid}`);

  // Exact subset filtering narrows cleanly to the target group
  const target = sd.collab.groups[0];
  const filtered = filterCollabGroups(sd.collab.groups, target.units.slice(0, 3), [], "avg");
  assert.ok(filtered.length >= 1 && filtered.some((g) => g.id === target.id));
  const exact = filterCollabGroups(sd.collab.groups, target.units, [], "avg");
  assert.equal(exact.length, 1);
  assert.equal(exact[0].id, target.id);

  // Exclusion filter removes groups containing excluded unit
  const excl = filterCollabGroups(sd.collab.groups, [], [target.units[0]], "avg");
  assert.equal(excl.some((g) => g.units.includes(target.units[0])), false);

  // Discriminating suggestions narrow multi-group candidate sets
  const singleUnitMatches = filterCollabGroups(sd.collab.groups, [target.units[0]], [], "avg");
  if (singleUnitMatches.length > 1) {
    const hints = suggestDiscriminatingUnits(singleUnitMatches, [target.units[0]], 5);
    assert.ok(hints.length > 0 && hints.every((h) => h.id !== target.units[0]));
  }

  // Cheat sheet tables completeness
  assert.equal(sd.tables.trueDamage.cashouts.length, 12, "12 True Damage Bling cashout tiers");
  assert.equal(sd.tables.hyperpop.milestones.length, 19, "19 Hyperpop Hype milestones");
  assert.equal(sd.tables.eightBit.milestones.length, 8, "8 Eight-Bit high score tiers");
  assert.ok(sd.tables.encounters.length >= 20, "official zh_cn encounters loaded");
  assert.equal(sd.tables.economy.shopOdds.length, 11, "11 levels of shop odds including Lv11 Gu Feng");
});

test("avatar-ocr + bitmask DP: segments tooltip portrait strip & locks exact Collab group under noise and border colors", () => {
  const sSandbox = { window: {} };
  vm.createContext(sSandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "season_data.js"), "utf8"), sSandbox);
  const groups = sSandbox.window.SEASON_DATA.collab.groups;
  const pool = getCollabPoolIds(groups, game);

  // Deterministic synthetic 32x32 portrait generator per unit (unique color patterns + features)
  function synthPortrait(seedIdx, size, brightShift = 0, borderColor = null) {
    const buf = new Uint8ClampedArray(size * size * 4);
    const h1 = (seedIdx * 67 + 19) % 210 + 30;
    const h2 = (seedIdx * 113 + 73) % 210 + 30;
    const h3 = (seedIdx * 179 + 41) % 210 + 30;
    const cx = 0.25 + ((seedIdx * 29) % 50) / 100;
    const cy = 0.25 + ((seedIdx * 43) % 50) / 100;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4;
        const isBorder = borderColor && (x < 3 || y < 3 || x >= size - 3 || y >= size - 3);
        if (isBorder) {
          buf[o] = borderColor[0]; buf[o + 1] = borderColor[1]; buf[o + 2] = borderColor[2]; buf[o + 3] = 255;
          continue;
        }
        const nx = x / size;
        const ny = y / size;
        const dist = Math.hypot(nx - cx, ny - cy);
        const wave = Math.sin((nx * 5 + seedIdx) * 1.3) * 28;
        const r = dist < 0.32 ? h1 : (ny < 0.5 ? h2 : h3);
        const g = dist < 0.32 ? h2 : (nx < 0.5 ? h3 : h1);
        const b = dist < 0.32 ? h3 : Math.min(255, Math.max(0, h1 + wave));
        buf[o] = Math.max(0, Math.min(255, Math.round(r + brightShift)));
        buf[o + 1] = Math.max(0, Math.min(255, Math.round(g + brightShift)));
        buf[o + 2] = Math.max(0, Math.min(255, Math.round(b + brightShift)));
        buf[o + 3] = 255;
      }
    }
    return buf;
  }

  const refMap = new Map();
  pool.forEach((uid, idx) => {
    const p = synthPortrait(idx + 1, 32, 0, null);
    refMap.set(uid, [extractPatchDescriptor(sampleInnerPatch(p, 32, 32, null, 0.08))]);
  });

  // Synthesize an in-game tooltip screenshot: dark background + dim header text band + 5 bordered portraits
  const targetGroup = groups.find((g) => g.units.length === 5);
  const W = 280, H = 140;
  const img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    img[i * 4] = 16; img[i * 4 + 1] = 20; img[i * 4 + 2] = 28; img[i * 4 + 3] = 255;
  }
  // Simulated monochrome tooltip text lines at top (y=10..55)
  for (let y = 14; y < 50; y += 12) {
    for (let x = 16; x < 240; x++) {
      if ((x + y) % 5 < 3) {
        const o = (y * W + x) * 4;
        img[o] = 185; img[o + 1] = 188; img[o + 2] = 192;
      }
    }
  }
  // Paste the 5 Collab unit portraits in a row (y=72..116, 44x44 with gold cost border & +18 brightness shift)
  const tileSize = 44, gap = 8, startX = 14, startY = 72;
  targetGroup.units.forEach((uid, i) => {
    const pIdx = pool.indexOf(uid) + 1;
    const tile = synthPortrait(pIdx, tileSize, 18, [224, 169, 76]);
    const ox = startX + i * (tileSize + gap);
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const so = (y * tileSize + x) * 4;
        const doff = ((startY + y) * W + (ox + x)) * 4;
        img[doff] = tile[so]; img[doff + 1] = tile[so + 1]; img[doff + 2] = tile[so + 2]; img[doff + 3] = 255;
      }
    }
  });

  const boxes = segmentScreenshotBoxes(img, W, H);
  assert.equal(boxes.length, 5, "segments exactly 5 portrait boxes inside tooltip screenshot");
  const qDescs = boxes.map((b) => extractPatchDescriptor(sampleInnerPatch(img, W, H, b, 0.12)));
  const { tileScores } = matchDescriptorsToUnits(qDescs, refMap);
  const ranked = scoreGroupsFromDetections(groups, tileScores);
  assert.equal(ranked[0].group.id, targetGroup.id, "bitmask DP locks exact Collab group #1");
  assert.ok(ranked[0].meanSim > 0.75, "high mean visual similarity: " + ranked[0].meanSim);
  assert.ok(ranked[0].totalScore - ranked[1].totalScore > 0.1, "clear separation from runner-up");
});

console.log(`All ${passed} new feature tests passed!`);
