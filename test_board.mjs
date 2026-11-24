import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "engine.js"), "utf8"), sandbox, { filename: "engine.js" });
vm.runInContext(fs.readFileSync(path.join(root, "board.js"), "utf8"), sandbox, { filename: "board.js" });
const TB = sandbox.TFTBoard;

function unit(id, cost, traits, slots = 1) {
  return {
    id,
    name: id,
    display: id,
    cost,
    slots,
    role: "",
    roleGroup: "fighter",
    damageType: "physical",
    lane: "front",
    stats: { hp: 600, ad: 50, ar: 30, mr: 30, as: 0.7, range: 1, mana: 50 },
    traits
  };
}

const raw = {
  meta: { set: 99, name: "synthetic", template: 1 },
  traits: [
    { id: "Bruiser", name: "Bruiser", breakpoints: [{ need: 2 }] },
    { id: "Sniper", name: "Sniper", breakpoints: [{ need: 2 }] },
    { id: "Ogre", name: "Ogre", breakpoints: [{ need: 1 }] }
  ],
  units: [
    unit("ana", 1, ["Bruiser"]),
    unit("bo", 1, ["Bruiser"]),
    unit("cy", 2, ["Sniper"]),
    unit("dee", 3, ["Sniper"]),
    unit("mia", 1, ["Sniper"]),
    unit("hal", 1, ["Ogre"]),
    unit("baron", 4, ["Ogre"], 2)
  ]
};

const item = (id, kind, slots, extra = {}) => ({ id, kind, slots, unique: false, trait: "", ...extra });
const itemById = {
  bow: item("bow", "basic", 1),
  cloak: item("cloak", "basic", 1),
  gloves: item("gloves", "basic", 3),
  crown: item("crown", "artifact", 1, { unique: true }),
  emb_bruiser: item("emb_bruiser", "emblem", 1, { trait: "Bruiser" }),
  emb_bruiser2: item("emb_bruiser2", "emblem", 1, { trait: "Bruiser" }),
  emb_ogre: item("emb_ogre", "emblem", 1, { trait: "Ogre" })
};

const game = sandbox.TFT.create(sandbox.TFT.normalizeSet(raw));
game.itemById = itemById;

function fresh() {
  return {
    level: 7, mode: "auto", allowLocked: false, board: [], emblems: {}, prismatic: {},
    looseItems: [], viewMode: "normal", libraryTab: "units", traitTargets: {},
    targetTraitCount: null, extraSlots: 0, focusId: null, custom: { keep: 1 }
  };
}
const act = (s, action) => TB.apply(s, action, game);
const json = (v) => JSON.stringify(v);
function must(s, action) {
  const r = act(s, action);
  if (r.error) throw new Error(action.type + ": " + r.error);
  return r.state;
}
function mustFail(s, action) {
  const before = json(s);
  const r = act(s, action);
  if (!r.error) throw new Error(action.type + ": expected error");
  if (r.state !== s || r.changed !== false || json(s) !== before) throw new Error(action.type + ": failed action changed state");
  return r.error;
}
function eq(actual, expected, msg) {
  if (json(actual) !== json(expected)) throw new Error(msg + ": " + json(actual) + " !== " + json(expected));
}
function at(s, id) { return s.board.find((e) => e.id === id); }
function itemCount(s) { return s.board.reduce((n, e) => n + e.items.length, 0) + s.looseItems.length; }
function put(s, id, row, col) { return must(s, { type: "add-unit", id, position: { row, col } }); }
function equip(s, id, itemId) { return must(s, { type: "equip-item", id, itemId, source: { kind: "library" } }); }

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("add-unit creates one instance and moving it does not duplicate", () => {
  let s = put(fresh(), "ana", 0, 0);
  if (s.board.length !== 1 || s.focusId !== "ana") throw new Error("add/focus");
  s = put(s, "ana", 2, 4);
  if (s.board.length !== 1 || at(s, "ana").position.row !== 2 || at(s, "ana").position.col !== 4) throw new Error("re-add moves");
  mustFail(s, { type: "add-unit", id: "bo", position: { row: 2, col: 4 } });
});

test("drag move changes coordinates only, not star", () => {
  let s = put(fresh(), "dee", 0, 0);
  s = must(s, { type: "set-star", id: "dee", star: 3 });
  s = must(s, { type: "move-unit", id: "dee", position: { row: 1, col: 1 } });
  if (at(s, "dee").star !== 3 || json(at(s, "dee").position) !== json({ row: 1, col: 1 })) throw new Error("move star");
});

test("single-cell swap is atomic; blocked footprint changes nothing", () => {
  let s = put(put(fresh(), "ana", 0, 0), "bo", 0, 1);
  s = must(s, { type: "move-unit", id: "ana", position: { row: 0, col: 1 } });
  eq(at(s, "ana").position, { row: 0, col: 1 }, "ana swapped");
  eq(at(s, "bo").position, { row: 0, col: 0 }, "bo swapped");
  let t = put(s, "baron", 3, 5);
  mustFail(t, { type: "move-unit", id: "ana", position: { row: 3, col: 5 } });
});

test("Baron footprint: bounds, adjacency, no third unit covered", () => {
  let s = fresh();
  mustFail(s, { type: "add-unit", id: "baron", position: { row: 3, col: 6 } });
  s = put(s, "baron", 3, 5);
  mustFail(s, { type: "move-unit", id: "baron", position: { row: 0, col: 6 } });
  mustFail(s, { type: "move-unit", id: "baron", position: { row: 4, col: 0 } });
  s = put(s, "mia", 1, 3);
  let t = put(fresh(), "mia", 1, 3);
  t = must(t, { type: "add-unit", id: "baron", position: { row: 1, col: 1 } });
  eq(at(t, "baron").position, { row: 1, col: 1 }, "baron placed");
  mustFail(t, { type: "add-unit", id: "ana", position: { row: 1, col: 2 } });
  s = must(s, { type: "move-unit", id: "baron", position: { row: 3, col: 0 } });
  mustFail(s, { type: "add-unit", id: "ana", position: { row: 3, col: 1 } });
});

test("right-click sequence: items, then stars, then removal", () => {
  let s = put(fresh(), "dee", 0, 0);
  s = must(s, { type: "set-star", id: "dee", star: 3 });
  s = equip(s, "dee", "bow");
  s = equip(s, "dee", "cloak");
  const rc = { type: "context-unit", id: "dee" };
  s = must(s, rc); eq(at(s, "dee").items, ["bow"], "1 item left"); eq(s.looseItems, [], "removed item discarded");
  s = must(s, rc); eq(at(s, "dee").items, [], "0 items"); eq(s.looseItems, [], "discarded, not loose");
  s = must(s, rc); if (at(s, "dee").star !== 2) throw new Error("2 star");
  s = must(s, rc); if (at(s, "dee").star !== 1) throw new Error("1 star");
  s = must(s, rc); if (at(s, "dee")) throw new Error("removed");
  if (s.focusId !== null) throw new Error("focus cleared");
  eq(s.looseItems, [], "items discarded on removal"); if (itemCount(s) !== 0) throw new Error("no items left");
});

test("equip transfers conserve item count", () => {
  let s = put(put(fresh(), "ana", 0, 0), "bo", 0, 1);
  s = equip(s, "ana", "bow");
  if (itemCount(s) !== 1) throw new Error("count after library");
  s = must(s, { type: "equip-item", id: "bo", itemId: "bow", source: { kind: "unit", unitId: "ana", index: 0 } });
  eq(at(s, "ana").items, [], "ana emptied"); eq(at(s, "bo").items, ["bow"], "bo got bow");
  if (itemCount(s) !== 1) throw new Error("count after transfer");
  s = equip(s, "ana", "cloak");
  s = must(s, { type: "unequip-item", id: "ana", itemId: "cloak", index: 0 });
  eq(s.looseItems, [], "unequip discards");
  if (itemCount(s) !== 1) throw new Error("count after unequip");
  s = { ...s, looseItems: ["cloak"] };
  s = must(s, { type: "equip-item", id: "bo", itemId: "cloak", source: { kind: "loose", index: 0 } });
  eq(at(s, "bo").items, ["bow", "cloak"], "loose to unit");
  if (itemCount(s) !== 2 || s.looseItems.length !== 0) throw new Error("count after loose");
});

test("stale indexes never move a different item", () => {
  let s = put(put(fresh(), "ana", 0, 0), "bo", 0, 1);
  s = equip(s, "ana", "bow");
  s = equip(s, "ana", "cloak");
  mustFail(s, { type: "equip-item", id: "bo", itemId: "cloak", source: { kind: "unit", unitId: "ana", index: 0 } });
  mustFail(s, { type: "unequip-item", id: "ana", itemId: "cloak", index: 0 });
  mustFail(s, { type: "equip-item", id: "bo", itemId: "bow", source: { kind: "loose", index: 0 } });
  mustFail(s, { type: "delete-loose", itemId: "bow", index: 0 });
  s = must(s, { type: "equip-item", id: "bo", itemId: "cloak", source: { kind: "unit", unitId: "ana", index: 1 } });
  eq(at(s, "ana").items, ["bow"], "ana keeps bow"); eq(at(s, "bo").items, ["cloak"], "bo got cloak");
});

test("thief gloves take 3 slots and block other items", () => {
  let s = put(put(fresh(), "ana", 0, 0), "bo", 0, 1);
  s = equip(s, "ana", "gloves");
  mustFail(s, { type: "equip-item", id: "ana", itemId: "bow", source: { kind: "library" } });
  s = equip(s, "bo", "bow");
  mustFail(s, { type: "equip-item", id: "bo", itemId: "gloves", source: { kind: "library" } });
  s = put(fresh(), "cy", 1, 1);
  s = equip(s, "cy", "bow"); s = equip(s, "cy", "cloak");
  mustFail(s, { type: "equip-item", id: "cy", itemId: "gloves", source: { kind: "library" } });
});

test("unique items cannot duplicate on one unit", () => {
  let s = put(put(fresh(), "ana", 0, 0), "bo", 0, 1);
  s = equip(s, "ana", "crown");
  s = equip(s, "bo", "crown");
  mustFail(s, { type: "equip-item", id: "ana", itemId: "crown", source: { kind: "library" } });
});

test("emblems: native trait and duplicate-trait rejected", () => {
  let s = put(put(put(fresh(), "hal", 0, 0), "ana", 0, 1), "mia", 0, 2);
  mustFail(s, { type: "equip-item", id: "hal", itemId: "emb_ogre", source: { kind: "library" } });
  mustFail(s, { type: "equip-item", id: "ana", itemId: "emb_bruiser", source: { kind: "library" } });
  s = equip(s, "mia", "emb_bruiser");
  mustFail(s, { type: "equip-item", id: "mia", itemId: "emb_bruiser2", source: { kind: "library" } });
  s = equip(s, "mia", "emb_ogre");
  eq(at(s, "mia").items, ["emb_bruiser", "emb_ogre"], "mia emblems");
});

test("unequip discards; seeded loose item can be deleted; stale delete rejected", () => {
  let s = equip(put(fresh(), "ana", 0, 0), "ana", "crown");
  s = must(s, { type: "unequip-item", id: "ana", itemId: "crown", index: 0 });
  eq(s.looseItems, [], "unequip discards");
  eq(at(s, "ana").items, [], "ana no crown");
  s = { ...s, looseItems: ["crown"] };
  mustFail(s, { type: "delete-loose", itemId: "bow", index: 0 });
  s = must(s, { type: "delete-loose", itemId: "crown", index: 0 });
  eq(s.looseItems, [], "crown deleted");
});

test("star and mark validation; star-up caps at 3", () => {
  let s = put(fresh(), "ana", 0, 0);
  s = must(s, { type: "set-star", id: "ana", star: 3 });
  const capped = act(s, { type: "star-up", id: "ana" });
  if (capped.error || capped.changed || at(capped.state, "ana").star !== 3) throw new Error("star cap");
  mustFail(s, { type: "set-star", id: "ana", star: 4 });
  mustFail(s, { type: "set-mark", id: "ana", mark: "boss" });
  s = must(s, { type: "set-mark", id: "ana", mark: "carry" });
  if (at(s, "ana").mark !== "carry") throw new Error("mark");
});

test("apply-plan replaces atomically, fills positions, sets level", () => {
  const plan = {
    board: [
      { id: "ana", star: 2, mark: "carry", position: null, items: ["bow"] },
      { id: "bo", star: 1, mark: "", position: null, items: [] }
    ],
    looseItems: ["cloak"],
    requiredLevel: 6
  };
  let s = put(fresh(), "mia", 0, 0);
  s = must(s, { type: "apply-plan", plan });
  if (s.board.length !== 2 || s.level !== 6) throw new Error("plan applied");
  if (s.board.some((e) => !e.position)) throw new Error("positions filled");
  if (json(s.board[0].position) === json(s.board[1].position)) throw new Error("distinct cells");
  eq(s.looseItems, ["cloak"], "plan loose");
  if (at(s, "ana").star !== 2 || at(s, "ana").mark !== "carry") throw new Error("plan unit fields");
  if (s.focusId !== null) throw new Error("focus cleared when absent");
  const omittedItems = { board: [{ id: "ana", star: 1, mark: "", position: null }], looseItems: [] };
  const appliedOmittedItems = must(fresh(), { type: "apply-plan", plan: omittedItems });
  if (!Array.isArray(at(appliedOmittedItems, "ana").items) || at(appliedOmittedItems, "ana").items.length !== 0) throw new Error("omitted plan items default to empty array");
  const before = fresh();
  mustFail(before, { type: "apply-plan", plan: { board: [{ id: "ana", star: 1, mark: "", position: null, items: ["crown", "crown"] }], looseItems: [] } });
  mustFail(before, { type: "apply-plan", plan: { board: [{ id: "baron", star: 1, mark: "", position: { row: 0, col: 6 }, items: [] }], looseItems: [] } });
  mustFail(before, { type: "apply-plan", plan: { board: [{ id: "ana", star: 1, mark: "", position: null, items: ["gloves", "bow"] }], looseItems: [] } });
});

test("update-settings whitelists keys and keeps unknown keys; reset clears board", () => {
  let s = put(fresh(), "ana", 0, 0);
  s = must(s, { type: "update-settings", settings: { level: 8, extraSlots: 1, traitTargets: { Bruiser: 2 } } });
  if (s.level !== 8 || s.extraSlots !== 1 || s.traitTargets.Bruiser !== 2) throw new Error("settings");
  if (!s.custom || s.custom.keep !== 1) throw new Error("unknown key kept");
  mustFail(s, { type: "update-settings", settings: { level: 11 } });
  s = must(s, { type: "reset" });
  eq(s.board, [], "board cleared"); eq(s.looseItems, [], "loose cleared");
  eq(s.traitTargets, {}, "targets cleared"); if (s.focusId !== null || s.level !== 8) throw new Error("reset fields");
  if (s.custom.keep !== 1) throw new Error("unknown key kept on reset");
});

test("normalize fills missing positions and rejects bad data", () => {
  const s = fresh();
  s.board = [
    { id: "ana", star: 1, mark: "", position: null, items: [] },
    { id: "bo", star: 1, mark: "", position: null, items: [] }
  ];
  const r = TB.normalize(s, game);
  if (r.error) throw new Error(r.error);
  if (r.state.board.some((e) => !e.position) || json(r.state.board[0].position) === json(r.state.board[1].position)) throw new Error("fill");
  if (s.board[0].position !== null) throw new Error("original untouched");
  const badStar = fresh(); badStar.board = [{ id: "ana", star: 4, mark: "", position: null, items: [] }];
  if (!TB.normalize(badStar, game).error) throw new Error("star 4 accepted");
  const badMark = fresh(); badMark.board = [{ id: "ana", star: 1, mark: "boss", position: null, items: [] }];
  if (!TB.normalize(badMark, game).error) throw new Error("bad mark accepted");
  const badItem = fresh(); badItem.board = [{ id: "ana", star: 1, mark: "", position: null, items: ["nope"] }];
  if (!TB.normalize(badItem, game).error) throw new Error("bad item accepted");
});

test("unknown action is rejected without changing state", () => {
  const s = fresh();
  const r = TB.apply(s, { type: "teleport" }, game);
  if (!r.error || r.state !== s) throw new Error("unknown action");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (err) {
    failed++;
    console.log("FAIL " + name + "\n  " + err.message);
  }
}
console.log(failed ? failed + " failed of " + tests.length : "all " + tests.length + " board tests passed");
process.exitCode = failed ? 1 : 0;
