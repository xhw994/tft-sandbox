import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), sandbox, { filename: "data.js" });
vm.runInContext(fs.readFileSync(path.join(root, "assess.js"), "utf8"), sandbox, { filename: "assess.js" });
vm.runInContext(fs.readFileSync(path.join(root, "engine.js"), "utf8"), sandbox, { filename: "engine.js" });
const data = sandbox.SET19;
const game = sandbox.TFT.create(data);
const lines = [];
function log(line) { lines.push(line); }

function assert(cond, msg) {
  if (!cond) {
    fs.writeFileSync(path.join(root, "test_out.txt"), lines.join("\n") + "\nFAIL " + msg, "utf8");
    throw new Error(msg);
  }
}

assert(data.units.length === 94, "unit count " + data.units.length);
assert(data.traits.some((t) => t.id === "DA_KDA19" && t.countMode === "stars"), "kda stars");
assert(data.units.filter((u) => u.slots === 2).map((u) => u.id).join() === "DA_BaronNashor19", "baron slots");
assert(new Set(data.units.map((u) => u.display)).size === 94, "display names unique");
const carryBoard = [
  "DA_Yone19", "DA_Katarina19", "DA_Kennen19", "DA_Alune19",
  "DA_Yuumi19", "DA_Lucian19", "DA_Ezreal19", "DA_Jhin19"
].map((id) => ({ id, star: id === "DA_Yone19" ? 2 : 1, items: [] }));
const carryLabels = game.recommend(carryBoard, { level: 8 }).labels;
assert(Object.values(carryLabels).filter((label) => label === "carry").length === 1, "one deterministic primary carry label");
const explicitCarry = carryBoard.map((entry) => ({ ...entry, mark: entry.id === "DA_Yone19" ? "carry" : "" }));
assert(game.recommend(explicitCarry, { level: 8 }).labels.DA_Yone19 === "carry", "explicit carry mark wins displayed label");
const botBoard = carryBoard.map((entry) => ({ ...entry, mark: entry.id === "DA_Yone19" ? "bot" : "" }));
assert(game.recommend(botBoard, { level: 8 }).labels.DA_Yone19 === "bot", "bot mark is excluded from automatic carry inference");
const action = { type: "add", id: "DA_Rakan19", star: 1 };
const plainBoard = [{ id: "DA_Yone19", star: 2, items: [] }];
const markedBoard = [{ id: "DA_Yone19", star: 2, items: [], mark: "carry" }];
const plainAssessment = game.assessCandidate(plainBoard, action, { level: 8 });
const markedAssessment = game.assessCandidate(markedBoard, action, { level: 8 });
assert(JSON.stringify(plainAssessment.score) === JSON.stringify(markedAssessment.score), "display labels do not change S");
const oneStarLabels = game.recommend(carryBoard.map((entry) => ({ ...entry, star: 1 })), { level: 8 }).labels;
assert(Object.keys(oneStarLabels).length === carryBoard.length, "all board units receive display labels");
const rebalance = game.recommend(carryBoard, { level: 8 });
assert(rebalance && rebalance.labels, "full board recommendations expose labels");
assert(rebalance.swaps.every((row) => row.assessment && row.assessment.score), "tank rebalance swaps carry CandidateAssessment");

const kda = data.traits.find((t) => t.id === "DA_KDA19");
const three = ["DA_Lillia19", "DA_Neeko19", "DA_Gragas19"].map((id) => ({ id, star: 1 }));
const ev = game.evaluate(three, { level: 8, emblems: {}, prismatic: {} }, null);
const row = ev.traits.find((t) => t.id === "DA_KDA19");
assert(row && row.count === 3 && row.best && row.best.need === 3, "kda 3 activates bronze");
const starred = [{ id: "DA_Lillia19", star: 2 }, { id: "DA_Neeko19", star: 1 }];
const ev2 = game.evaluate(starred, { level: 8, emblems: {}, prismatic: {} }, null);
assert(ev2.traits.find((t) => t.id === "DA_KDA19").count === 3, "kda counts stars");

const pris = game.evaluate(
  data.units.filter((u) => u.traits.includes("DA_KDA19")).map((u) => ({ id: u.id, star: 3 })),
  { level: 10, emblems: {}, prismatic: {} },
  null
).traits.find((t) => t.id === "DA_KDA19");
assert(pris.best.style < 5, "prismatic stays off");
const prisOn = game.evaluate(
  data.units.filter((u) => u.traits.includes("DA_KDA19")).map((u) => ({ id: u.id, star: 3 })),
  { level: 10, emblems: {}, prismatic: { DA_KDA19: true } },
  null
).traits.find((t) => t.id === "DA_KDA19");
assert(prisOn.best.style === 5, "prismatic turns on");

function names(board) {
  return board.map((e) => game.byId[e.id].display + e.star + "★").join("、");
}
function traitHits(plan, id) {
  return plan.board.filter((e) => game.byId[e.id].traits.includes(id)).length;
}

const t0 = Date.now();
const ionic = game.recommend(
  [
    { id: "DA_Elise19", star: 2 },
    { id: "DA_Yunara19", star: 2 },
    { id: "DA_Annie19", star: 1 },
    { id: "DA_Lux19", star: 1 }
  ],
  { level: 8, mode: "auto", allowLocked: true }
);
log("ionic ms " + (Date.now() - t0));
log("next " + ionic.next.map((n) => game.byId[n.id].display + " | " + n.reasons.join(" / ")).join(" || "));
ionic.plans.forEach((plan) => log("PLAN " + plan.title + " | " + names(plan.adds) + " | " + plan.traits.join(" · ") + " | " + plan.reasons.join(" / ")));
assert(ionic.plans.length > 0 && ionic.plans.every((plan) => plan.assessment && plan.assessment.score), "plans carry CandidateAssessment");
assert(ionic.next.every((row) => row.assessment && row.assessment.score), "next buys carry CandidateAssessment");
assert(ionic.swaps.every((row) => row.assessment && row.assessment.score), "swaps carry CandidateAssessment");
assert(ionic.starUps.every((row) => row.assessment && row.assessment.score), "star-ups carry CandidateAssessment");
assert(ionic.plans[0].slots <= 8, "slots");
assert(new Set(ionic.plans[0].board.map((e) => e.id)).size === ionic.plans[0].board.length, "unique");
function tooRare(board, level) {
  return board.filter((e) => game.rollPct(level, game.byId[e.id].cost) < 5).map((e) => game.byId[e.id].display + game.byId[e.id].cost);
}
assert(tooRare(ionic.plans[0].adds, 8).length === 0, "lv8 rare " + tooRare(ionic.plans[0].adds, 8).join(","));
assert(data.shopOdds.byLevel["7"]["5"] === 1, "lv7 5-cost odds");

const hyper = game.recommend(
  [{ id: "DA_Ziggs19", star: 2 }, { id: "DA_Kobuko19", star: 2 }],
  { level: 6, mode: "reroll", allowLocked: true }
);
log("HYPER next " + hyper.next.map((n) => game.byId[n.id].display).join(","));
log("HYPER plans " + hyper.plans.map((p) => p.title + " [" + names(p.adds) + "]").join(" || "));
const hyperPlan = hyper.plans.find((plan) => plan.board.filter((e) => game.byId[e.id].traits.includes("DA_GlitterBomb19")).length >= 4) || hyper.plans[0];
const hyperCount = hyperPlan.board.filter((e) => game.byId[e.id].traits.includes("DA_GlitterBomb19")).length;
assert(hyperCount >= 4, "hyper count " + hyperCount + " " + hyper.plans.map((p) => p.title).join("|"));
assert(!hyper.plans.some((plan) => plan.adds.some((add) => game.byId[add.id].cost >= 5)), "lv6 should not add 5-cost");
assert(hyper.plans.some((plan) => plan.board.some((e) => e.id === "DA_SeraphineIndie19")), "seraphine is a reroll core");

const clash = game.recommend(
  [{ id: "DA_AkaliKDA19", star: 1 }, { id: "DA_Akali_TrueDamage19", star: 1 }],
  { level: 8, mode: "auto", allowLocked: true }
);
assert(clash.warnings.some((w) => w.includes("阿卡丽")), "akali warning");
const akaliPlan = clash.plans[0];
if (akaliPlan) {
  const ids = akaliPlan.board.map((e) => e.id);
  assert(!(ids.includes("DA_AkaliKDA19") && ids.includes("DA_Akali_TrueDamage19") && akaliPlan.adds.some((a) => a.id.startsWith("DA_Akali"))), "should not add the other akali");
}

const emptyT = Date.now();
const empty = game.recommend([], { level: 8, mode: "auto", allowLocked: true });
log("empty ms " + (Date.now() - emptyT));
empty.plans.forEach((plan) => {
  log("OPEN " + plan.title + " slots " + plan.slots + " | " + names(plan.board));
  assert(plan.slots === 8, plan.title + " slots " + plan.slots);
  assert(new Set(plan.board.map((e) => e.id)).size === plan.board.length, "dup in opening");
  assert(tooRare(plan.adds, 8).length === 0, plan.title + " rare " + tooRare(plan.adds, 8).join(","));
});
assert(empty.plans.length >= 2, "openings");

const low = game.recommend([{ id: "DA_Elise19", star: 2 }], { level: 4, mode: "auto", allowLocked: true });
const lowAdds = low.next.concat(low.plans.flatMap((plan) => plan.adds));
assert(lowAdds.every((row) => game.byId[row.id].cost <= 3), "lv4 high cost " + lowAdds.map((row) => game.byId[row.id].display + game.byId[row.id].cost).join(","));

const behind = game.recommend([{ id: "DA_Yunara19", star: 1 }], { level: 7, mode: "auto", allowLocked: true });
assert(behind.holders.notes.some((note) => note.role === "carry" && note.status === "behind"), "lv7 1-cost carry behind");
const carry3 = data.units.find((unit) => unit.cost === 3 && unit.lane === "back" && (unit.roleGroup === "caster" || unit.roleGroup === "marksman") && !unit.unlock);
assert(carry3, "3-cost carry fixture");
const oneStar = game.recommend([{ id: carry3.id, star: 1 }], { level: 7, mode: "auto", allowLocked: true });
const carryNote = oneStar.holders.notes.find((note) => note.id === carry3.id && note.role === "carry");
assert(carryNote && carryNote.status === "behind" && carryNote.upgrades.length === 0, "lv7 1-star 3-cost is behind, star it: " + (carryNote && carryNote.text));
assert(carryNote.text.includes("先升到 2 星"), carryNote.text);
assert(oneStar.starUps.some((row) => row.id === carry3.id && row.to === 2), "list the 3-cost star-up");

const tib = data.units.find((unit) => unit.id === "DA_Tibbers19");
const aph = data.units.find((unit) => unit.id === "DA_Aphelios19");
const sera = data.units.find((unit) => unit.id === "DA_SeraphineIndie19");
assert(tib.unlock.units.some((req) => req.id === "DA_Annie19" && req.star === 2), "tibbers needs annie");
assert(aph.unlock.mode === "any" && aph.unlock.units.length === 2, "aphelios either key");
assert(sera.grantsUnit === true, "seraphine grants a unit");
const keptAnnie = game.recommend([{ id: "DA_Annie19", star: 1 }], { level: 6, mode: "auto", allowLocked: true });
assert(keptAnnie.keep.some((row) => row.id === "DA_Annie19" && row.label.includes("提伯斯")), "keep annie");

const sample = sandbox.TFT.normalizeSet(JSON.parse(fs.readFileSync(path.join(root, "template/set.template.json"), "utf8")));
const sampleGame = sandbox.TFT.create(sample);
const sampleRec = sampleGame.recommend([], { level: 4, mode: "reroll", allowLocked: true });
assert(sampleRec.plans.some((plan) => plan.board.some((entry) => entry.id === "demo_engine")), "template engine");
assert(!sampleRec.plans.some((plan) => plan.adds.some((entry) => entry.id === "demo_locked")), "locked 4-cost stays out at level 4");

const over = game.recommend(
  ["DA_Elise19", "DA_Yunara19", "DA_Annie19", "DA_Lux19", "DA_Gwen19", "DA_Jinx19", "DA_Taric19", "DA_Zoe19", "DA_Sett19"].map((id) => ({ id, star: 1 })),
  { level: 7, mode: "auto", allowLocked: true }
);
log("OVER drop " + over.dropped.map((e) => game.byId[e.id].display).join(","));
assert(over.dropped.length >= 1, "overcap drops");
assert(game.slotsOf(over.kept) <= 7, "kept fits");

const cells = game.place([{ id: "DA_BaronNashor19", star: 1 }, { id: "DA_Ahri19", star: 2 }]);
let baron = 0;
let ahri = 0;
cells.flat().forEach((cell) => {
  if (!cell) return;
  if (cell.id === "DA_BaronNashor19" || cell.span === "DA_BaronNashor19") baron++;
  if (cell.id === "DA_Ahri19") ahri++;
});
assert(baron === 2 && ahri === 1, "placement baron " + baron + " ahri " + ahri);

const slice = sandbox.TFT.create(sandbox.TFT.normalizeSet({
  meta: { name: "slice" },
  traits: [{ id: "T_A", name: "A", breakpoints: [{ need: 2, style: 1, text: "A2" }] }],
  units: [
    { id: "u1", display: "U1", cost: 5, slots: 1, traits: ["T_A"], roleGroup: "fighter", lane: "front", stats: { hp: 900, ad: 60, as: 0.8 } },
    { id: "u2", display: "U2", cost: 1, slots: 1, traits: [], roleGroup: "specialist", lane: "mid" }
  ],
  items: [
    { id: "crown", name: "皇冠", kind: "crown", teamSize: 2, slots: 1, icon: "javascript:alert(1)" },
    { id: "crownBig", name: "大皇冠", kind: "crown", teamSize: 30, slots: 1 },
    { id: "emb", name: "纹章", kind: "emblem", trait: "T_A", slots: 1 }
  ]
}));
assert(slice.itemById.crown.icon === "", "unsafe item icon dropped");
assert(slice.itemById.emb.trait === "T_A", "emblem trait kept");
assert(slice.capacity([], { level: 7 }) === 7, "bare capacity is level");
assert(slice.capacity([{ id: "u2", star: 1, items: ["crown"] }], { level: 7 }) === 9, "worn crown adds teamSize");
assert(slice.capacity([], { level: 7, looseItems: ["crown"] }) === 9, "loose crown adds teamSize");
assert(slice.capacity([], { level: 7, extraSlots: 1 }) === 8, "extra slots add");
assert(slice.capacity([], { level: 10, looseItems: ["crownBig"] }) === 28, "capacity capped at 28");
const wornEmb = slice.evaluate([{ id: "u2", star: 1, items: ["emb"] }], { level: 7, emblems: {}, prismatic: {} }, null);
assert(wornEmb.traits.find((t) => t.id === "T_A").count === 1, "worn emblem counts once");
const benchEmb = slice.evaluate([{ id: "u2", star: 1, items: ["emb"] }], { level: 7, emblems: { T_A: 1 }, prismatic: {} }, null);
assert(benchEmb.traits.find((t) => t.id === "T_A").count === 2, "bench emblem adds to worn one");
const nativeEmb = slice.evaluate([{ id: "u1", star: 1, items: ["emb"] }], { level: 7, emblems: {}, prismatic: {} }, null);
assert(nativeEmb.traits.find((t) => t.id === "T_A").count === 1, "emblem on native trait does not double");
const kept = slice.recommend([{ id: "u2", star: 1, mark: "carry", position: { row: 1, col: 2 }, items: ["emb"] }], { level: 7 });
assert(kept.owned[0].items[0] === "emb" && kept.owned[0].position.col === 2 && kept.owned[0].mark === "carry", "normalize keeps items, position, mark");

// --- behavioral tests on small synthetic sets
const UN = (id, cost, traits, extra) => Object.assign({ id: id, display: id, cost: cost, slots: 1, traits: traits, roleGroup: "fighter", lane: "front", stats: { hp: 600, ad: 50, as: 0.7, ar: 30, mr: 30 } }, extra || {});
const TRT = (id, need, extra) => Object.assign({ id: id, name: id, breakpoints: [{ need: need, style: 1, text: id + need }] }, extra || {});
const SYN = (units, traits, items, extra) => sandbox.TFT.create(sandbox.TFT.normalizeSet(Object.assign({ meta: { name: "syn" }, units: units, traits: traits, items: items || [] }, extra || {})));
const ctx5 = () => ({ level: 5, mode: "auto", allowLocked: true, prismatic: {}, emblems: {} });
const cnt = (rows, id) => { const r = rows.find((t) => t.id === id); return r ? r.count : 0; };
const drive = (t) => { let s = t.step(1000); let guard = 0; while (!s.done && guard++ < 10000) s = t.step(1000); return s; };
function combos(list, k) { if (k === 0) return [[]]; if (list.length < k) return []; const head = list[0]; const rest = list.slice(1); return combos(rest, k - 1).map((c) => [head].concat(c)).concat(combos(rest, k)); }
function perms(list) { if (list.length <= 1) return [list]; return list.flatMap((x, i) => perms(list.filter((_, j) => j !== i)).map((p) => [x].concat(p))); }
const investedCarry = SYN([
  UN("F", 4, [], { roleGroup: "fighter" }),
  UN("C", 3, [], { roleGroup: "caster", lane: "back" })
], [TRT("T", 1)], [{ id: "bf", name: "basic", kind: "basic" }]);
const investmentBoard = (items) => [
  { id: "F", star: 2, items: [] }, { id: "C", star: 1, items }
];
const noInvestment = investedCarry.recommend(investmentBoard([]), { level: 8 }).labels;
assert(Object.keys(noInvestment).length === 2, "unmarked role labels are display-only");
const withInvestment = investedCarry.recommend(investmentBoard(["bf"]), { level: 8 }).labels;
assert(Object.keys(withInvestment).length === 2, "equipped items do not create a power-score bucket");

const cap7 = SYN([UN("c1", 1, []), UN("c2", 1, []), UN("c3", 1, []), UN("c4", 1, []), UN("c5", 1, []), UN("c6", 1, []), UN("c7", 1, []), UN("c8", 1, []), UN("H5", 5, ["T1"])], [TRT("T1", 1)]);
const ov = cap7.recommend(["H5", "c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) => ({ id: id, star: 1 })), { level: 7, focusId: "H5", mode: "auto" });
assert(ov.owned.some((e) => e.id === "H5"), "5-cost still owned at level 7");
assert(!ov.dropped.some((e) => e.id === "H5") && ov.kept.some((e) => e.id === "H5"), "focus 5-cost never dropped by fit");
assert(ov.dropped.length === 1 && ov.slots.max === 7, "overflow drops one unit, cap 7: dropped " + ov.dropped.length);
const low7 = cap7.recommend([{ id: "c1", star: 1 }], { level: 7, mode: "auto" });
assert(!low7.next.some((n) => n.id === "H5") && !low7.plans.some((p) => p.adds.some((a) => a.id === "H5")), "5-cost not recommended at level 7");

const cr = SYN([UN("c1", 1, []), UN("H5", 5, ["T1"])], [TRT("T1", 1)], [{ id: "crown", name: "皇冠", kind: "crown", teamSize: 1 }]);
assert(cr.capacity([{ id: "c1", star: 1, items: ["crown"] }], { level: 6 }) === 7, "crown on unit adds teamSize");
assert(cr.capacity([{ id: "c1", star: 1, items: [] }], { level: 6, looseItems: ["crown"] }) === 7, "loose crown adds teamSize");
assert(cr.capacity([{ id: "c1", star: 1, items: [] }], { level: 6, looseItems: [] }) === 6, "without crown capacity is level");
assert(cr.rollPct(6, 5) === 0 && !cr.rollable(cr.byId.H5, { level: 6 }), "5-cost still not rollable at level 6");

const cv = SYN([UN("X1", 3, [], { roleGroup: "caster", lane: "back" }), UN("X2", 3, [], { roleGroup: "caster", lane: "back" }), UN("n1", 1, [])], [TRT("T1", 1)], [{ id: "bf", name: "bf", kind: "component" }, { id: "rod", name: "rod", kind: "component" }]);
const cvA = cv.recommend([{ id: "X1", star: 1, items: ["bf", "rod"] }, { id: "X2", star: 1, items: [] }], { level: 8 });
assert(Object.keys(cvA.labels).length === 2, "itemized role labels are display-only");
const cvB = cv.recommend([{ id: "X1", star: 1, items: ["bf", "rod"] }, { id: "X2", star: 1, items: [], mark: "carry" }], { level: 8 });
assert(cvB.labels.X2 === "carry", "explicit mark overrides investment: " + JSON.stringify(cvB.labels));

const sw = SYN([UN("L", 1, ["T1"], { roleGroup: "caster" }), UN("O", 1, []), UN("H", 3, ["T1"], { roleGroup: "caster" }), UN("M", 3, ["T1"], { roleGroup: "caster", damageType: "magic" }), UN("R5", 5, ["T1"], { roleGroup: "caster" })], [TRT("T1", 1)], [{ id: "bf", name: "bf", kind: "component" }, { id: "rod", name: "rod", kind: "component" }]);
const swR = sw.recommend([{ id: "L", star: 1, mark: "carry", position: { row: 1, col: 2 }, items: ["bf", "rod"] }, { id: "O", star: 1, items: [] }], { level: 8 });
assert(!swR.swaps.some((s) => s.out === "L" && s.inn === "H"), "equal evidence does not promote higher cost alone");
assert(!swR.swaps.some((s) => s.inn === "M"), "different damage type absent");
assert(!swR.swaps.some((s) => s.inn === "R5"), "unit below minRoll absent");
const carryDuo = SYN([UN("MK", 2, [], { roleGroup: "marksman", lane: "back" }), UN("CS", 3, [], { roleGroup: "caster", lane: "back" })], [], [{ id: "n1", name: "n1", kind: "normal" }, { id: "n2", name: "n2", kind: "normal" }]);
const duo1 = carryDuo.recommend([{ id: "MK", star: 1, items: ["n1", "n2"] }, { id: "CS", star: 1, items: [] }], { level: 8 }).labels;
assert(duo1.CS === "carry", "higher cost caster is carry over itemized marksman at 1 star: " + JSON.stringify(duo1));
const duo2 = carryDuo.recommend([{ id: "MK", star: 1, items: ["n1", "n2"] }, { id: "CS", star: 2, items: [] }], { level: 8 }).labels;
assert(duo2.CS === "carry", "higher cost caster is carry over itemized marksman at 2 star: " + JSON.stringify(duo2));
const starFit = SYN([UN("G2", 2, ["A"], { roleGroup: "marksman", lane: "back" }), UN("N5", 5, [], { roleGroup: "caster", lane: "back" }), UN("P", 1, ["A"])], [TRT("A", 2)]);
const starFitLabels = starFit.recommend([{ id: "G2", star: 2 }, { id: "N5", star: 1 }, { id: "P", star: 1 }], { level: 8 }).labels;
assert(starFitLabels.G2 === "carry" && starFitLabels.N5 !== "carry", "2-star low cost beats 1-star 5-cost without traits: " + JSON.stringify(starFitLabels));
const wide = SYN([UN("W", 5, ["A", "B"], { roleGroup: "caster", lane: "back" }), UN("Z", 5, ["C"], { roleGroup: "caster", lane: "back" }), UN("pA", 1, ["A"]), UN("pB", 1, ["B"]), UN("pC", 1, ["C"]), UN("M3", 3, ["A"], { roleGroup: "marksman", lane: "back" })], [TRT("A", 2, { breakpoints: [{ need: 2, style: 3, text: "A" }] }), TRT("B", 2, { breakpoints: [{ need: 2, style: 2, text: "B" }] }), TRT("C", 2, { breakpoints: [{ need: 2, style: 1, text: "C" }] })]);
const wide1 = wide.recommend(["W", "Z", "pA", "pB", "pC"].map((id) => ({ id, star: 1 })), { level: 8 }).labels;
assert(wide1.W === "carry", "wider activated traits win: " + JSON.stringify(wide1));
const wide2 = wide.recommend([{ id: "W", star: 2 }, { id: "M3", star: 2 }, { id: "Z", star: 1 }, { id: "pA", star: 1 }, { id: "pB", star: 1 }, { id: "pC", star: 1 }], { level: 8 }).labels;
assert(wide2.W === "carry", "2-star wide unit beats narrower 2-star unit: " + JSON.stringify(wide2));
const inactive = SYN([UN("M3", 3, ["A"], { roleGroup: "marksman", lane: "back" }), UN("W", 5, ["A"], { roleGroup: "caster", lane: "back" }), UN("ASH", 2, ["D"], { roleGroup: "marksman", lane: "back" }), UN("pA", 1, ["A"])], [TRT("A", 2), TRT("D", 3)]);
const inactiveLabels = inactive.recommend([{ id: "M3", star: 2 }, { id: "W", star: 1 }, { id: "ASH", star: 1 }, { id: "pA", star: 1 }], { level: 8 }).labels;
assert(inactiveLabels.M3 === "carry" && inactiveLabels.ASH !== "carry" && inactiveLabels.ASH !== "carry2", "inactive trait does not qualify carry2: " + JSON.stringify(inactiveLabels));
const tankFit = SYN([UN("ZAC", 4, ["A"], { roleGroup: "tank", lane: "front" }), UN("OFF", 3, [], { roleGroup: "tank", lane: "front" }), UN("pA", 1, ["A"])], [TRT("A", 2)]);
const tankFitLabels = tankFit.recommend([{ id: "ZAC", star: 1 }, { id: "OFF", star: 2 }, { id: "pA", star: 1 }], { level: 8 }).labels;
assert(tankFitLabels.ZAC === "tank", "on-trait 1-star tank beats off-trait 2-star tank: " + JSON.stringify(tankFitLabels));
const lockFit = SYN([UN("LK", 5, ["A"], { unlock: { text: "k", level: 0, units: [{ id: "K1", star: 2 }], mode: "all" } }), UN("K1", 1, ["A"]), UN("pA", 2, ["A"]), UN("pB", 2, ["A"])], [TRT("A", 2)]);
const lockBoard = [{ id: "pA", star: 1 }, { id: "pB", star: 1 }];
const lockHidden = lockFit.recommend(lockBoard, { level: 6 });
assert(!lockHidden.locks.some((x) => x.text.includes("LK")), "unrollable locked unit has no reminder");
assert(!lockHidden.plans.some((p) => (p.adds || []).some((a) => (typeof a === "string" ? a : a.id) === "LK")) &&
  !lockHidden.next.some((x) => x.id === "LK") && !lockHidden.swaps.some((x) => x.inn === "LK"),
  "unrollable locked unit is absent from suggestions");
function suggestedIds(result) {
  const ids = {};
  result.plans.forEach((p) => (p.adds || []).forEach((a) => { ids[typeof a === "string" ? a : a.id] = true; }));
  result.next.forEach((x) => { ids[x.id] = true; });
  result.swaps.forEach((x) => { ids[x.inn] = true; });
  return ids;
}
const lockHiddenIds = suggestedIds(lockHidden);
assert(lockHidden.locks.every((x) => lockHiddenIds[x.id]), "every level-6 lock reminder is a suggested id");
const lockSuggestedSet = SYN([UN("pA", 1, ["A"]), UN("pB", 1, ["A"]), UN("K1", 1, ["A"]), UN("LK", 4, ["A"], { unlock: { text: "k", level: 0, units: [{ id: "K1", star: 2 }], mode: "all" } })], [TRT("A", 2)]);
const lockSuggested = lockSuggestedSet.recommend([{ id: "pA", star: 1 }, { id: "pB", star: 1 }], { level: 8 });
const lockSuggestedIds = suggestedIds(lockSuggested);
assert(!lockSuggestedIds.LK, "key-missing locked unit is not suggested");
assert(!lockSuggested.locks.some((x) => x.text.includes("LK")), "key-missing locked unit has no reminder");
assert(lockSuggested.locks.every((x) => lockSuggestedIds[x.id]), "every level-8 lock reminder is a suggested id");
const realNames = ["格雷福斯", "奈德丽", "塔莉垭", "艾希", "扎克", "辛德拉", "努努和威朗普", "雷克顿", "塔里克"];
const realUnits = realNames.map((name) => data.units.find((u) => u.display === name || (name === "格雷福斯" && u.display === "Graves")));
assert(realUnits.every(Boolean), "real-board expected all SET19 test units");
if (realUnits.every(Boolean)) {
  const realBoard = realUnits.map((u, i) => ({ id: u.id, star: i === 0 ? 2 : 1, items: [] }));
  const realLabels = game.recommend(realBoard, { level: 8 }).labels;
  const graves = realUnits[0];
  if (["marksman", "caster", "assassin", "fighter"].includes(graves.roleGroup) || (graves.roleGroup === "specialist" && graves.lane === "back")) assert(realLabels[graves.id] === "carry", "real Graves carry: " + JSON.stringify(realLabels));
  else log("Real-board roleGroup 格雷福斯: " + graves.roleGroup);
  const ashe = realUnits[3], nidalee = realUnits[1], zac = realUnits[4];
  assert(realLabels[ashe.id] !== "carry" && realLabels[ashe.id] !== "carry2", "real Ashe not carry: " + JSON.stringify(realLabels));
  assert(realLabels[nidalee.id] !== "carry", "real Nidalee not carry: " + JSON.stringify(realLabels));
  if (zac.roleGroup === "tank") assert(realLabels[zac.id] === "tank", "real Zac tank: " + JSON.stringify(realLabels));
  else log("Real-board roleGroup 扎克: " + zac.roleGroup);
  log("Real-board labels: " + JSON.stringify(realLabels));
}
const swapTraits = SYN([UN("K", 3, ["C"], { roleGroup: "caster", lane: "back" }), UN("S", 1, ["T"]), UN("F4", 4, []), UN("F4C", 4, ["C"]), UN("f1", 1, []), UN("f2", 1, []), UN("f3", 1, []), UN("f4", 1, []), UN("f5", 1, []), UN("f6", 1, [])], [TRT("T", 1), TRT("C", 1)]);
const swapBoard = [{ id: "K", star: 1, items: [] }, { id: "S", star: 1, items: [] }, ...["f1", "f2", "f3", "f4", "f5", "f6"].map((id) => ({ id: id, star: 1, items: [] }))];
const trFull = swapTraits.recommend(swapBoard, { level: 8 });
assert(!trFull.swaps.some((s) => s.out === "S" && s.inn === "F4"), "swap that drops the only T member is refused");
const cFull = swapTraits.recommend(swapBoard, { level: 8 });
assert(cFull.swaps.some((s) => s.out === "f1" && s.inn === "F4C"), "swap that adds carry trait C is allowed");
const roleFix = SYN([
  UN("F", 4, ["T1"], { roleGroup: "fighter", lane: "front" }),
  UN("M", 4, ["T1"], { roleGroup: "marksman", lane: "back" }),
  UN("T", 1, ["T1"], { roleGroup: "tank", lane: "front" })
], [TRT("T1", 1)]);
const roleA = roleFix.recommend([{ id: "F", star: 1 }, { id: "M", star: 1 }], { level: 8 });
assert(roleA.labels.F !== "tank" && (roleA.labels.M === "carry" || roleA.labels.F === "carry" || roleA.labels.F === "carry2"), "front fighter is not tank and fighter/marksman carries: " + JSON.stringify(roleA.labels));
assert(roleA.holders.notes.some((note) => note.role === "tank" && note.status === "missing") || !Object.values(roleA.labels).includes("tank"), "no inferred front-fighter tank");
const tankProfile = sandbox.TFTAssess.defaultProfile(roleFix.data);
tankProfile.units.T.frontline = { byStar: { "1": { lo: .7, mid: .8, hi: .9 }, "3": { lo: .85, mid: .9, hi: .95 } } };
const roleB = roleFix.recommend([{ id: "F", star: 1 }, { id: "T", star: 1 }, { id: "M", star: 1 }], { level: 8, profile: tankProfile });
assert(roleB.labels.T === "tank", "low-cost tank with frontline evidence is included: " + JSON.stringify(roleB.labels));
const tank3 = roleFix.recommend([{ id: "T", star: 3 }], { level: 8, profile: tankProfile });
assert(tank3.labels.T === "tank", "low-cost 3-star tank is recognized");

const tankSwapSet = SYN([
  UN("P", 4, ["T1"], { roleGroup: "marksman", lane: "back" }),
  UN("F", 4, ["T1"], { roleGroup: "fighter", lane: "front" }),
  UN("E1", 2, ["T1"], { roleGroup: "marksman", lane: "back" }),
  UN("E2", 2, ["T1"], { roleGroup: "marksman", lane: "back" }),
  UN("T1a", 1, ["T1"], { roleGroup: "tank", lane: "front" }),
  UN("T1b", 1, ["T1"], { roleGroup: "tank", lane: "front" }),
  UN("T1c", 1, ["T1"], { roleGroup: "tank", lane: "front" }),
  UN("T1d", 1, ["T1"], { roleGroup: "tank", lane: "front" }),
  UN("K", 4, ["T1"], { roleGroup: "tank", lane: "front" })
], [TRT("T1", 1)]);
const tankSwap = tankSwapSet.recommend(["P", "F", "E1", "E2", "T1a", "T1b", "T1c", "T1d"].map((id) => ({ id, star: 1 })), { level: 8 });
assert(tankSwap.swaps.every((row) => row.assessment), "tank rebalance candidates share the assessment gate");
assert(tankSwap.plans.every((plan) => plan.assessment), "tank rebalance plans are assessed");
const st = SYN([UN("L", 1, ["T1"], { roleGroup: "caster", lane: "back", stats: { hp: 600, ad: 50, as: 0.7, ar: 30, mr: 30 } }), UN("O", 1, []), UN("H", 3, ["T1"], { roleGroup: "caster", lane: "back", stats: { hp: 600, ad: 34, as: 0.7, ar: 30, mr: 30 } })], [TRT("T1", 1)]);
const stR = st.recommend([{ id: "L", star: 3 }, { id: "O", star: 1 }], { level: 8 }).swaps.filter((s) => s.out === "L");
assert(stR.every((s) => s.requiredStars >= 3), "3-star units are never auto-replaced with lower stars");
const starSet = SYN([UN("c1", 1, []), UN("c3", 3, []), UN("c4", 4, []), UN("c5", 5, [])], []);
const starRec = starSet.recommend([{ id: "c1", star: 2 }, { id: "c3", star: 2 }, { id: "c4", star: 2 }, { id: "c5", star: 1 }], { level: 8 });
assert(starRec.starUps.some((row) => row.id === "c1" && row.to === 3) && starRec.starUps.some((row) => row.id === "c3" && row.to === 3), "costs 1-3 may be auto-chased to 3-star");
assert(!starRec.starUps.some((row) => row.id === "c4" && row.to === 3), "4-cost excluded from auto 3-star chase");
assert(starRec.starUps.some((row) => row.id === "c5" && row.to === 2), "5-cost may be auto-chased to 2-star");

const em = SYN([UN("A1", 1, []), UN("A2", 1, ["T1"]), UN("P1", 1, ["PT"]), UN("P2", 1, ["PT"]), UN("P3", 1, ["PT"])], [TRT("T1", 1), TRT("KS", 3, { countMode: "stars" }), { id: "PT", name: "PT", breakpoints: [{ need: 2, style: 0, prismaticStyle: 5, text: "", prismaticText: "棱" }] }], [{ id: "eT1", name: "纹章T1", kind: "emblem", trait: "T1" }, { id: "eKS", name: "纹章KS", kind: "emblem", trait: "KS" }]);
const emCtx = () => ({ level: 7, emblems: {}, prismatic: {} });
assert(cnt(em.evaluate([{ id: "A1", star: 1, items: ["eT1"] }], emCtx(), null).traits, "T1") === 1, "worn emblem adds 1");
assert(cnt(em.evaluate([{ id: "A2", star: 1, items: ["eT1"] }], emCtx(), null).traits, "T1") === 1, "native plus emblem does not add 2");
assert(cnt(em.evaluate([{ id: "A1", star: 2, items: ["eKS"] }], emCtx(), null).traits, "KS") === 2, "stars-mode emblem on 2-star adds 2");
const pOff = em.evaluate([{ id: "P1", star: 1 }, { id: "P2", star: 1 }, { id: "P3", star: 1 }], emCtx(), null).traits.find((t) => t.id === "PT");
assert(!pOff || !pOff.best || pOff.best.style !== 5, "style 5 inactive without prismatic");
const pOn = em.evaluate([{ id: "P1", star: 1 }, { id: "P2", star: 1 }, { id: "P3", star: 1 }], { level: 7, emblems: {}, prismatic: { PT: true } }, null).traits.find((t) => t.id === "PT");
assert(pOn && pOn.best && pOn.best.style === 5, "style 5 active with prismatic");

const g1 = SYN([UN("P", 1, ["T1"]), UN("X", 1, ["T2", "T3"]), UN("Y2", 1, ["T2"]), UN("Z", 1, ["T3"])], [TRT("T1", 1), TRT("T2", 1), TRT("T3", 1)]);
const s1 = drive(g1.track([{ id: "P", star: 1 }], ctx5(), { targetTraitCount: 3 }));
assert(s1.plans[0].adds.length === 1 && s1.plans[0].adds[0].id === "X", "one two-trait unit beats two-unit path: " + s1.plans.map((p) => p.id).join(" / "));

const g2 = SYN([UN("Q", 1, ["C"]), UN("R1", 1, ["C"]), UN("R2", 1, ["C"]), UN("S", 1, ["D"])], [TRT("C", 3), TRT("D", 1)]);
const bridgeTraits = (ids) => g2.evaluate(ids.map((id) => ({ id: id, star: 1 })), { level: 5, emblems: {}, prismatic: {} }, null).traitPart;
assert(bridgeTraits(["Q", "R1"]) > bridgeTraits(["Q"]) && g2.evaluate([{ id: "Q", star: 1 }, { id: "R1", star: 1 }], { level: 5, emblems: {}, prismatic: {} }, null).traits.find((t) => t.id === "C").best === null, "partial C progress adds value without activating");
const s2 = drive(g2.track([{ id: "Q", star: 1 }], ctx5(), { traitTargets: { C: 3 } }));
assert(s2.plans[0].adds.map((a) => a.id).sort().join() === "R1,R2", "two-unit bridge found: " + s2.plans.map((p) => p.id).join(" / "));

const g3 = SYN([UN("P", 1, ["A"]), UN("X", 1, ["B"]), UN("Y", 1, ["A"])], [TRT("A", 1), TRT("B", 1)]);
const s3 = drive(g3.track([{ id: "P", star: 1 }, { id: "X", star: 1 }], ctx5(), { targetTraitCount: 2 }));
assert(s3.plans[0].adds.length === 0 && s3.minimalProven === true, "already met returns zero adds");

const g4 = SYN([UN("P", 1, ["A"]), UN("X", 1, ["B"]), UN("Z", 1, ["C"]), UN("V", 1, ["C"])], [TRT("A", 1), TRT("B", 1), TRT("C", 1)], [], { exclusive: [["X", "Z"]] });
const s4 = drive(g4.track([{ id: "P", star: 1 }], ctx5(), { targetTraitCount: 3 }));
assert(s4.plans.length > 0 && s4.plans[0].id === "V|X" && s4.plans.every((p) => !(p.id.split("|").includes("X") && p.id.split("|").includes("Z"))), "exclusive pair never together: " + s4.plans.map((p) => p.id).join(" / "));

const g5 = SYN([UN("KEY", 1, ["C"]), UN("Kx", 1, ["B"], { unlock: { text: "", level: 0, units: [{ id: "KEY", star: 1 }], mode: "all" } })], [TRT("B", 1), TRT("C", 1)]);
const s5 = drive(g5.track([], ctx5(), { traitTargets: { B: 1 } }));
assert(s5.plans.length > 0 && s5.plans[0].adds.map((a) => a.id).join(">") === "KEY>Kx", "key unit only after key: " + s5.plans.map((p) => p.id).join(" / "));

const g6 = SYN([UN("F1", 1, []), UN("F2", 1, []), UN("F3", 1, []), UN("F4", 1, []), UN("BIG", 1, ["A"], { slots: 2 })], [TRT("A", 1)]);
const s6 = drive(g6.track([{ id: "F1", star: 1 }, { id: "F2", star: 1 }, { id: "F3", star: 1 }, { id: "F4", star: 1 }], ctx5(), { traitTargets: { A: 1 } }));
assert(s6.plans[0].adds.length === 1 && s6.plans[0].adds[0].id === "BIG" && s6.plans[0].adds[0].level === 6, "two-slot unit waits for level 6");

const g7 = SYN([UN("KS1", 1, ["KS"], { unlock: { text: "", level: 6, units: [], mode: "all" } }), UN("S2", 1, ["KS"])], [TRT("KS", 3, { countMode: "stars" })]);
const s7 = drive(g7.track([{ id: "S2", star: 2 }], ctx5(), { traitTargets: { KS: 3 } }));
assert(s7.plans[0].adds.length === 1 && s7.plans[0].adds[0].id === "KS1" && s7.plans[0].adds[0].level === 6, "stars trait add waits for legal level: " + s7.plans.map((p) => p.id).join(" / "));

const g8 = SYN([UN("X2", 2, ["B"]), UN("Y3", 3, ["B"])], [TRT("B", 1)]);
const s8 = drive(g8.track([], ctx5(), { targetTraitCount: 1 }));
assert(s8.plans.length === 2 && s8.plans[0].pathCost <= s8.plans[1].pathCost, "same count and finish: lower path cost first");

const g9 = SYN([UN("F1", 1, []), UN("F2", 1, []), UN("F3", 1, []), UN("F4", 1, []), UN("F5", 1, []), UN("X", 1, ["B"])], [TRT("B", 1)]);
const s9 = drive(g9.track([{ id: "F1", star: 1 }, { id: "F2", star: 1 }, { id: "F3", star: 1 }, { id: "F4", star: 1 }, { id: "F5", star: 1 }], ctx5(), { traitTargets: { B: 1 } }));
assert(s9.plans[0].adds.length === 1 && s9.plans[0].adds[0].level === 6, "sixth unit waits for level 6");
assert(s9.plans[0].steps.every((st2) => !st2.adds.includes("X") || st2.level === 6), "no level-5 step adds the sixth unit");

const g10 = SYN([UN("A1", 1, ["T"]), UN("A2", 1, ["T"]), UN("A3", 1, ["T"]), UN("A4", 1, ["T"]), UN("A5", 1, ["T"]), UN("A6", 1, ["T"]), UN("A7", 1, ["T"]), UN("A8", 1, ["T"])], [TRT("T", 1, { breakpoints: [{ need: 1, style: 1, text: "T1" }, { need: 3, style: 2, text: "T3" }] })]);
const t10 = g10.track([], ctx5(), { traitTargets: { T: 3 } });
const p10 = t10.step(1);
assert(!p10.done, "one node does not finish the search");
const c10 = t10.cancel();
assert(c10.cancelled && c10.minimalProven === false && c10.exhausted === false, "cancel does not claim minimality or exhaustion");

function bruteTrack(set, start, cur, goal) {
  const traitList = set.data.traits.filter((t) => t.kind !== "solo");
  const minNeed = (t) => Math.min(...t.breakpoints.filter((b) => b.style > 0).map((b) => b.need));
  const countOf = (board, t) => board.reduce((s, e) => (set.byId[e.id].traits.includes(t.id) ? s + (t.countMode === "stars" ? e.star : 1) : s), 0);
  const goalOk = (board) => traitList.filter((t) => countOf(board, t) >= minNeed(t)).length >= goal;
  function legal(unit, L, board) {
    if (!set.rollable(unit, { level: L })) return false;
    const u = unit.unlock;
    if (u && u.units && u.units.length && !u.units.every((r) => board.some((e) => e.id === r.id && e.star >= (r.star || 1)))) return false;
    if (set.data.exclusive.some((g) => g.includes(unit.id) && board.some((e) => g.includes(e.id)))) return false;
    const nb = board.concat([{ id: unit.id, star: 1 }]);
    return set.slotsOf(nb) <= set.capacity(nb, { level: L });
  }
  function best(perm, i, board, prevL) {
    if (i === perm.length) return goalOk(board) ? prevL : Infinity;
    let out = Infinity;
    for (let L = prevL; L <= 10; L++) {
      if (legal(perm[i], L, board)) out = Math.min(out, best(perm, i + 1, board.concat([{ id: perm[i].id, star: 1 }]), L));
    }
    return out;
  }
  const cands = set.data.units.filter((u) => !start.some((e) => e.id === u.id));
  for (let k = 0; k <= cands.length; k++) {
    const hits = [];
    for (const combo of combos(cands, k)) {
      let f = Infinity;
      for (const perm of perms(combo)) f = Math.min(f, best(perm, 0, start, cur));
      if (f < Infinity) hits.push({ id: combo.map((u) => u.id).sort().join("|"), finish: f });
    }
    if (hits.length) {
      const fin = Math.min(...hits.map((h) => h.finish));
      return { k: k, finish: fin, ids: hits.filter((h) => h.finish === fin).map((h) => h.id) };
    }
  }
  return null;
}
const g11 = SYN([UN("A", 1, ["T1"]), UN("B", 1, ["T1"]), UN("C", 2, ["T2"]), UN("D", 3, ["T2", "T3"]), UN("E", 1, ["T3"], { unlock: { text: "", level: 0, units: [{ id: "C", star: 1 }], mode: "all" } }), UN("F", 4, ["T3"], { slots: 2 }), UN("G", 5, ["T2"], { unlock: { text: "", level: 7, units: [], mode: "all" } }), UN("H", 1, ["T1"])], [TRT("T1", 1), TRT("T2", 1), TRT("T3", 2)], [], { exclusive: [["A", "B"]] });
const want = bruteTrack(g11, [], 5, 3);
const s11 = drive(g11.track([], ctx5(), { targetTraitCount: 3 }));
assert(want && s11.minimalProven === true, "brute found a plan and track proved minimal");
assert(s11.plans[0].adds.length === want.k, "minimum add count " + s11.plans[0].adds.length + " vs brute " + want.k);
assert(s11.plans[0].finishLevel === want.finish, "best finish level " + s11.plans[0].finishLevel + " vs brute " + want.finish);
assert(s11.plans.every((p) => want.ids.includes(p.id)), "ranked plans are brute-optimal: " + s11.plans.map((p) => p.id).join(" / ") + " vs " + want.ids.join(" / "));
assert(s11.plans.every((p, i, arr) => i === 0 || arr[i - 1].finishLevel <= p.finishLevel), "plans ranked by finish level");

log("kda breakpoints " + kda.breakpoints.map((b) => b.need + ":" + b.style + "/" + b.prismaticStyle).join(" "));
log("OK");
console.log("OK");
