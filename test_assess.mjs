import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
vm.createContext(sandbox);
for (const file of ["data.js", "assess.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
function assert(ok, message) { if (!ok) throw new Error(message); }
const data = { meta: { set: 99 }, units: ["A", "B", "U", "roleOnly"].map((id) => ({ id, cost: 1, roleGroup: "marksman", traits: [], items: [] })), traits: [], items: [] };
const profile = sandbox.TFTAssess.defaultProfile(data);
profile.units.A.damage = { lo: .8, mid: .8, hi: .8, confidence: "verified", byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
profile.units.B.damage = { lo: .5, mid: .5, hi: .5, confidence: "verified", byStar: { "1": { lo: .5, mid: .5, hi: .5 } } };
profile.units.A.frontline = { lo: .8, mid: .8, hi: .8, byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
profile.units.B.frontline = { lo: .7, mid: .7, hi: .7, byStar: { "1": { lo: .7, mid: .7, hi: .7 } } };
profile.units.B.damage.byStar["2"] = { lo: .8, mid: .8, hi: .8 };
profile.units.B.frontline.byStar["2"] = { lo: .7, mid: .7, hi: .7 };
profile.units.roleOnly.damage = { unknown: true };
profile.units.roleOnly.frontline = { unknown: true };
const game = sandbox.TFT.create(data);
const noop = game.assessCandidate([{ id: "A", star: 1 }], { type: "noop" }, { level: 8 }, profile);
assert(noop.score.lo === 0 && noop.score.mid === 0 && noop.score.hi === 0, "no-op exact zero");
const add = game.assessCandidate([{ id: "A", star: 1 }], { type: "add", id: "B", star: 1 }, { level: 8 }, profile);
assert(Math.abs(add.contributions.find((x) => x.bucket === "damage").delta.mid - 0.175) < 1e-12, "damage top2 marginal");
const missing = game.assessCandidate([], { type: "add", id: "roleOnly" }, { level: 8 }, profile);
assert(missing.status === "unknown", "missing evidence and roleGroup cannot be now");
assert(sandbox.TFTAssess.qFor({ id: "roleOnly", roleGroup: "tank" }, 1, "frontline", profile, data).confidence === "unknown", "roleGroup is not numeric evidence");
assert(profile.units.A.markCompatibility.bot === "compatible" && profile.units.roleOnly.markCompatibility.tank === "incompatible", "profile roles and marks are explicit");
const itemsData = Object.assign({}, data, { items: [{ id: "emblem", kind: "emblem", trait: "T" }, { id: "known", kind: "completed" }, { id: "unknown1", kind: "completed" }, { id: "unknown2", kind: "completed" }] });
const itemProfile = sandbox.TFTAssess.defaultProfile(itemsData);
itemProfile.units.A.damage = { byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
itemProfile.itemEffects.known = { damage: { lo: .1, mid: .1, hi: .1 } };
const plainQ = sandbox.TFTAssess.qFor({ id: "A", items: [] }, 1, "damage", itemProfile, itemsData);
const emblemQ = sandbox.TFTAssess.qFor({ id: "A", items: ["emblem"] }, 1, "damage", itemProfile, itemsData);
const recognizedQ = sandbox.TFTAssess.qFor({ id: "A", items: ["known"] }, 1, "damage", itemProfile, itemsData);
const unknownItemsQ = sandbox.TFTAssess.qFor({ id: "A", items: ["unknown1", "unknown2"] }, 1, "damage", itemProfile, itemsData);
assert(plainQ.lo === .8 && emblemQ.lo === .8 && recognizedQ.lo === .9, "no item delta, structural item, and recognized item");
assert(Math.abs(unknownItemsQ.lo - .7) < 1e-12 && unknownItemsQ.mid === .8 && Math.abs(unknownItemsQ.hi - .9) < 1e-12, "one unknown-item interval per unit-role");
assert(sandbox.TFTAssess.sortAssessments([{ candidateId: "b", status: "now", score: { lo: 3, mid: 3 }, risks: [] }, { candidateId: "a", status: "now", score: { lo: 3, mid: 3 }, risks: [] }], {}).map((x) => x.candidateId).join() === "a,b", "assessment sorting deterministic");
const preferred = sandbox.TFTAssess.resolveEffects(data, { effects: [
  { effectId: "same", scopeKey: "x", owner: "traits", mechanism: "damage", source: "unverified-extraction", lo: .1, mid: .1, hi: .1 },
  { effectId: "same", scopeKey: "x", owner: "damage", mechanism: "damage", source: "confirmed-structured", lo: .2, mid: .2, hi: .2 }
] });
assert(preferred.length === 1 && preferred[0].owner === "damage" && preferred[0].lo === .2, "canonical owner and source priority dedupe");
const conflict = sandbox.TFTAssess.resolveEffects(data, { effects: [
  { effectId: "conflict", scopeKey: "x", source: "confirmed-structured", lo: .2, mid: .2, hi: .2 },
  { effectId: "conflict", scopeKey: "x", source: "confirmed-structured", lo: .4, mid: .4, hi: .4 }
] });
assert(conflict.length === 1 && conflict[0].unknown === true, "same-priority numeric conflict unknown");
const utilityProfile = sandbox.TFTAssess.defaultProfile(data);
utilityProfile.effects = [{ effectId: "cc", sourceId: "A", owner: "utility", channel: "control", stackGroup: "stun", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .2, mid: .2, hi: .2 }];
utilityProfile.units.A.damage = { unknown: true };
utilityProfile.units.A.frontline = { unknown: true };
const utilityAdd = sandbox.TFTAssess.assess(data, [], { type: "add", id: "A" }, { level: 8 }, utilityProfile);
assert(Math.abs(utilityAdd.contributions.find((x) => x.bucket === "utility").delta.mid - .2 * 4 / 15) < 1e-12, "utility weights and combat effect");
utilityProfile.effects[0].starInvariant = false;
const scoreData = {
  meta: { set: 88 },
  units: [
    { id: "old", cost: 1, traits: [], roleGroup: "specialist" },
    { id: "new", cost: 5, traits: ["T"], roleGroup: "specialist" }
  ],
  traits: [{ id: "T", resolution: "cumulative", breakpoints: [{ need: 1, effects: ["trait-power"], style: 1 }], effects: [{ effectId: "trait-power", owner: "traits", starInvariant: true, lo: .8, mid: .8, hi: .8 }] }]
};
const scoreProfile = sandbox.TFTAssess.defaultProfile(scoreData);
scoreProfile.units.old.damage = { byStar: { "1": { lo: .4, mid: .4, hi: .4 } } };
scoreProfile.units.old.frontline = { byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
scoreProfile.units.new.damage = { byStar: { "1": { lo: .6, mid: .6, hi: .6 } } };
scoreProfile.units.new.frontline = { byStar: { "1": { lo: .7, mid: .7, hi: .7 } } };
const example = sandbox.TFTAssess.assess(scoreData, [{ id: "old", star: 1 }], { type: "replace", out: "old", in: "new", star: 1 }, { level: 1, capacity: 1 }, scoreProfile);
assert(Math.abs(example.contributions.find((x) => x.bucket === "frontline").delta.mid + .1) < 1e-12, "frontline example delta");
assert(Math.abs(example.contributions.find((x) => x.bucket === "damage").delta.mid - .2) < 1e-12, "damage example delta");
assert(Math.abs(example.contributions.find((x) => x.bucket === "traits").delta.mid - .2) < 1e-12, "traits example delta " + JSON.stringify(example.contributions.find((x) => x.bucket === "traits")));
assert(Math.abs(example.score.mid - 8) < 1e-12, "numeric +8 example");
const routedData = Object.assign({}, scoreData, { traits: [{ id: "T", resolution: "cumulative", breakpoints: [{ need: 1, effects: ["trait-damage"], style: 1 }], effects: [{ effectId: "trait-damage", owner: "damage", starInvariant: true, lo: .2, mid: .2, hi: .2 }] }] });
const routedProfile = sandbox.TFTAssess.defaultProfile(routedData);
routedProfile.units.old.damage = scoreProfile.units.old.damage;
routedProfile.units.old.frontline = scoreProfile.units.old.frontline;
routedProfile.units.new.damage = scoreProfile.units.new.damage;
routedProfile.units.new.frontline = scoreProfile.units.new.frontline;
const routed = sandbox.TFTAssess.assess(routedData, [{ id: "old", star: 1 }], { type: "replace", out: "old", in: "new", star: 1 }, { level: 1, capacity: 1 }, routedProfile);
assert(Math.abs(routed.contributions.find((x) => x.bucket === "traits").delta.mid) < 1e-12 && routed.contributions.find((x) => x.bucket === "damage").delta.mid > .2, "damage-owned trait effect routes only to damage");
const progressData = { units: [{ id: "p0", traits: [], roleGroup: "specialist" }, { id: "p1", traits: ["P"], roleGroup: "specialist" }], traits: [{ id: "P", breakpoints: [{ need: 2, style: 1 }] }] };
const progressProfile = sandbox.TFTAssess.defaultProfile(progressData);
const progress = sandbox.TFTAssess.assess(progressData, [{ id: "p0", star: 1 }], { type: "replace", out: "p0", in: "p1", star: 1 }, { level: 1, capacity: 1 }, progressProfile);
assert(progress.contributions.find((x) => x.bucket === "traits").delta.mid === 0 && progress.contributions.find((x) => x.bucket === "traits").futureOnly, "next-breakpoint progress display-only");
const starUnknown = sandbox.TFTAssess.assess(data, [], { type: "add", id: "A" }, { level: 8 }, utilityProfile);
assert(starUnknown.status === "unknown", "utility does not inherit role star factor");
const unknown = sandbox.TFTAssess.unknown();
assert(unknown.lo === 0 && unknown.mid === .5 && unknown.hi === 1 && unknown.confidence === "unknown", "unknown interval");
const blocked = game.assessCandidate([{ id: "A", star: 3 }], { type: "replace", out: "A", in: "B", star: 1 }, { level: 8 }, profile);
assert(blocked.status === "blocked", "3-star lower-star replacement blocked");
const focusBlocked = game.assessCandidate([{ id: "A", star: 1 }], { type: "replace", out: "A", in: "B", star: 1 }, { level: 8, focusId: "A" }, profile);
assert(focusBlocked.status === "blocked" && focusBlocked.blockers.some((x) => x.indexOf("focusId") >= 0), "focus gate");
const twoStar = game.assessCandidate([{ id: "A", star: 1 }], { type: "replace", out: "A", in: "B", star: 2 }, { level: 8 }, profile);
assert(twoStar.status === "conditional" && twoStar.materialization.added.length === 0, "2-star target without copies is conditional and not owned " + JSON.stringify({ status: twoStar.status, conditions: twoStar.conditions, score: twoStar.score, added: twoStar.materialization.added, blockers: twoStar.blockers }));
const chaseTwo = game.assessCandidate([{ id: "B", star: 1 }], { type: "starUp", id: "B", to: 2 }, { level: 8 }, profile);
assert(chaseTwo.status !== "blocked", "2-star chase allowed at higher cost");
const corr = sandbox.TFTAssess.featureDelta(
  [{ sourceId: "A", lo: .8, mid: .8, hi: .8, confidence: "verified" }, { sourceId: "U", lo: 0, mid: .5, hi: 1, confidence: "unknown" }],
  [{ sourceId: "A", lo: .8, mid: .8, hi: .8, confidence: "verified" }, { sourceId: "U", lo: 0, mid: .5, hi: 1, confidence: "unknown" }, { sourceId: "B", lo: .5, mid: .5, hi: .5, confidence: "verified" }],
  1, 2
);
assert(Math.abs(corr.delta.lo) < 1e-12 && Math.abs(corr.delta.mid) < 1e-12 && Math.abs(corr.delta.hi - .175) < 1e-12 && !corr.dependencyUncertain, "shared unknown correlated top2");
const independent = sandbox.TFTAssess.featureDelta([{ sourceId: "U1", lo: 0, mid: .5, hi: 1, confidence: "unknown" }], [{ sourceId: "U2", lo: 0, mid: .5, hi: 1, confidence: "unknown" }], 1, 2);
assert(independent.dependencyUncertain && independent.delta.lo === -1 && independent.delta.hi === 1, "distinct unknowns use wide bound");
assert(sandbox.TFTAssess.chasePreference(1, 5) === 1 && sandbox.TFTAssess.chasePreference(5, 8) === 0 && sandbox.TFTAssess.chasePreference(3, 4) === 0, "chase preference levels");
function throwsWith(raw, part) {
  let message = "";
  try { sandbox.TFT.normalizeSet(raw); } catch (e) { message = e.message; }
  assert(message.includes(part), "diagnostic includes " + part + ": " + message);
}
throwsWith({ units: [{ id: "A", traits: [] }, { id: "A", traits: [] }], traits: [], items: [] }, "units[1].id");
throwsWith({ units: [{ id: "A", traits: ["missing"] }], traits: [], items: [] }, "units[0].traits[0]");
throwsWith({ schemaVersion: 99, units: [], traits: [], items: [] }, "schemaVersion");
const mixed = sandbox.TFT.normalizeSet({ meta: { set: 19 }, units: [], traits: [], items: [] }).meta;
assert(mixed.dataStatus === "mixed" && mixed.source.includes("未验证 live"), "Set 19 provenance defaults to mixed");
const noRowProfile = sandbox.TFTAssess.defaultProfile(data);
delete noRowProfile.units.roleOnly;
const noRow = sandbox.TFTAssess.qFor({ id: "roleOnly", roleGroup: "tank", items: [] }, 1, "frontline", noRowProfile, data);
assert(noRow.lo === 0 && noRow.mid === .5 && noRow.hi === 1 && noRow.confidence === "unknown", "missing profile row ignores roleGroup");
assert(sandbox.TFTAssess.assess(data, [], { type: "add", id: "roleOnly" }, { level: 8 }, noRowProfile).status === "unknown", "unknown evidence cannot be now");
const lowPriorData = { units: [{ id: "lp", roleGroup: "marksman", cost: 1, traits: [] }], traits: [], items: [] };
const lowPriorProfile = sandbox.TFTAssess.defaultProfile(lowPriorData);
assert(sandbox.TFTAssess.assess(lowPriorData, [], { type: "add", id: "lp" }, { level: 8 }, lowPriorProfile).status !== "unknown", "low-confidence role prior is not unknown evidence");
const guardedUnit = { id: "A", items: [] };
Object.defineProperties(guardedUnit, { roleGroup: { get() { throw new Error("roleGroup read"); } }, cost: { get() { throw new Error("cost read"); } }, stats: { get() { throw new Error("stats read"); } }, ability: { get() { throw new Error("ability read"); } } });
assert(sandbox.TFTAssess.qFor(guardedUnit, 1, "damage", profile, data).mid === .8, "qFor reads only profile evidence");
const damageFourth = sandbox.TFTAssess.featureDelta(
  [{ sourceId: "a", lo: .8, mid: .8, hi: .8 }, { sourceId: "b", lo: .5, mid: .5, hi: .5 }],
  [{ sourceId: "a", lo: .8, mid: .8, hi: .8 }, { sourceId: "b", lo: .5, mid: .5, hi: .5 }, { sourceId: "c", lo: .4, mid: .4, hi: .4 }], 1, 2);
assert(damageFourth.delta.lo === 0 && damageFourth.delta.mid === 0 && damageFourth.delta.hi === 0, "third damage source adds no coverage");
const frontFourth = sandbox.TFTAssess.featureDelta(
  [{ sourceId: "a", lo: .8, mid: .8, hi: .8 }, { sourceId: "b", lo: .6, mid: .6, hi: .6 }, { sourceId: "c", lo: .4, mid: .4, hi: .4 }],
  [{ sourceId: "a", lo: .8, mid: .8, hi: .8 }, { sourceId: "b", lo: .6, mid: .6, hi: .6 }, { sourceId: "c", lo: .4, mid: .4, hi: .4 }, { sourceId: "d", lo: .3, mid: .3, hi: .3 }], 1, 3);
assert(frontFourth.delta.lo === 0 && frontFourth.delta.mid === 0 && frontFourth.delta.hi === 0, "fourth frontline source adds no coverage");
const crownData = Object.assign({}, itemsData, { items: itemsData.items.concat([{ id: "crown", kind: "crown", teamSize: 1 }]) });
const crownProfile = sandbox.TFTAssess.defaultProfile(crownData);
crownProfile.units.A.damage = { byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
assert(sandbox.TFTAssess.qFor({ id: "A", items: ["crown"] }, 1, "damage", crownProfile, crownData).lo === .8, "structural crown does not add unknown item delta");
const itemRouteProfile = sandbox.TFTAssess.defaultProfile(itemsData);
itemRouteProfile.units.A.damage = { byStar: { "1": { lo: .8, mid: .8, hi: .8 } } };
itemRouteProfile.effects = [{ effectId: "item-damage", itemId: "known", owner: "damage", starInvariant: true, lo: .1, mid: .1, hi: .1 }];
assert(sandbox.TFTAssess.qFor({ id: "A", items: ["known"] }, 1, "damage", itemRouteProfile, itemsData).lo === .9, "profile effect item routes through canonical damage owner");
const utilityData = { units: ["u1", "u2", "u3", "u4"].map((id) => ({ id, cost: 1, roleGroup: "specialist", traits: [] })), traits: [], items: [] };
const utilityTop = sandbox.TFTAssess.defaultProfile(utilityData);
utilityTop.effects = [
  { effectId: "c1", sourceId: "u1", owner: "utility", channel: "control", stackGroup: "same", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .4, mid: .4, hi: .4 },
  { effectId: "c2", sourceId: "u1", owner: "utility", channel: "control", stackGroup: "same", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .3, mid: .3, hi: .3 },
  { effectId: "c3", sourceId: "u2", owner: "utility", channel: "control", stackGroup: "s2", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .2, mid: .2, hi: .2 },
  { effectId: "c4", sourceId: "u3", owner: "utility", channel: "control", stackGroup: "s3", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .1, mid: .1, hi: .1 },
  { effectId: "c5", sourceId: "u4", owner: "utility", channel: "control", stackGroup: "s4", target: "enemy", condition: "combat", stacking: "exclusive", starInvariant: true, lo: .05, mid: .05, hi: .05 }
];
const control3 = sandbox.TFTAssess.assess(utilityData, [], { type: "plan", afterBoard: ["u1", "u2", "u3"].map((id) => ({ id, star: 1 })) }, { level: 8 }, utilityTop);
const control4 = sandbox.TFTAssess.assess(utilityData, [], { type: "plan", afterBoard: ["u1", "u2", "u3", "u4"].map((id) => ({ id, star: 1 })) }, { level: 8 }, utilityTop);
assert(Math.abs(control3.contributions.find((x) => x.bucket === "utility").after.mid - .525 * 4 / 15) < 1e-12, "control exclusive max and top3 coefficients");
assert(control4.contributions.find((x) => x.bucket === "utility").delta.mid === control3.contributions.find((x) => x.bucket === "utility").delta.mid, "fourth control source has no marginal coverage");
const additiveProfile = sandbox.TFTAssess.defaultProfile(utilityData);
additiveProfile.effects = [{ effectId: "add", sourceId: "u1", owner: "utility", channel: "teamSupport", stacking: "additive", starInvariant: true, lo: .2, mid: .2, hi: .2 }];
const additiveUnknown = sandbox.TFTAssess.assess(utilityData, [], { type: "add", id: "u1" }, { level: 8 }, additiveProfile);
assert(additiveUnknown.status === "unknown", "additive utility without stackCap is unknown: " + JSON.stringify({ status: additiveUnknown.status, blockers: additiveUnknown.blockers, score: additiveUnknown.score, utility: additiveUnknown.contributions.find((x) => x.bucket === "utility") }));
const snapshotData = { units: [
  { id: "DA_Rell19", cost: 5, roleGroup: "tank", traits: ["solo"] },
  { id: "DA_TwistedFate19", cost: 5, roleGroup: "specialist", traits: [] },
  { id: "DA_Nunu19", cost: 5, roleGroup: "specialist", traits: [] }
], traits: [{ id: "solo", champions: ["DA_Rell19"], breakpoints: [] }], items: [] };
const snapshotProfile = sandbox.TFTAssess.defaultProfile(snapshotData);
assert(snapshotProfile.units.DA_Nunu19.review.control === "verified-absent" && snapshotProfile.units.DA_Rell19.review.exclusiveMountState, "snapshot review records");
assert(snapshotProfile.units.DA_TwistedFate19.review.shopDependency && !snapshotProfile.units.DA_Nunu19.effects, "TF shop flag and no Nunu fabricated effects");
snapshotProfile.units.DA_TwistedFate19.damage = { byStar: { "1": { lo: .2, mid: .2, hi: .2 } } };
snapshotProfile.units.DA_TwistedFate19.frontline = { byStar: { "1": { lo: .2, mid: .2, hi: .2 } } };
const tf = sandbox.TFTAssess.assess(snapshotData, [], { type: "add", id: "DA_TwistedFate19" }, { level: 8 }, snapshotProfile);
assert(tf.status === "conditional" && tf.conditions.some((x) => x.includes("商店/刷新")) && tf.contributions.find((x) => x.bucket === "utility").delta.mid === 0, "TF shop state is conditional, not combat utility");
const rellData = { units: [{ id: "DA_Rell19", cost: 5, roleGroup: "tank", traits: [] }], traits: [], items: [] };
const rellProfile = sandbox.TFTAssess.defaultProfile(rellData);
rellProfile.units.DA_Rell19.frontline = { byStar: { "1": { lo: .2, mid: .2, hi: .2 } } };
rellProfile.effects = [
  { effectId: "mounted-shield-wave", sourceId: "DA_Rell19", owner: "frontline", mechanism: "shield-wave", source: "confirmed-structured", starInvariant: true, lo: .1, mid: .1, hi: .1 },
  { effectId: "unmounted-shield-wave", sourceId: "DA_Rell19", owner: "frontline", mechanism: "shield-wave", source: "confirmed-structured", starInvariant: true, lo: .3, mid: .3, hi: .3 }
];
rellProfile.effects = sandbox.TFTAssess.resolveEffects(rellData, rellProfile);
const rellQ = sandbox.TFTAssess.qFor({ id: "DA_Rell19", items: [] }, 1, "frontline", rellProfile, rellData);
assert(Math.abs(rellQ.mid - .5) < 1e-12, "Rell mounted/unmounted shield-wave deduplicates to one max effect: " + JSON.stringify(rellQ));
const nunuEffects = sandbox.TFTAssess.defaultProfile(snapshotData).units.DA_Nunu19.review;
assert(["control", "survivability", "enemyDebuff", "teamSupport"].every((key) => nunuEffects[key] === "verified-absent"), "Nunu has no tooltip-derived control/healcut/team-shield");
const costData = { units: [{ id: "low", cost: 1, roleGroup: "marksman", traits: [] }, { id: "high", cost: 5, roleGroup: "marksman", traits: [] }], traits: [], items: [] };
const costProfile = sandbox.TFTAssess.defaultProfile(costData);
["low", "high"].forEach((id) => { costProfile.units[id].damage = { byStar: { "1": { lo: .8, mid: .8, hi: .8 } } }; costProfile.units[id].frontline = { byStar: { "1": { lo: .4, mid: .4, hi: .4 } } }; });
const lowCostScore = sandbox.TFTAssess.assess(costData, [], { type: "add", id: "low" }, { level: 8 }, costProfile).score;
const highCostScore = sandbox.TFTAssess.assess(costData, [], { type: "add", id: "high" }, { level: 8 }, costProfile).score;
assert(JSON.stringify(lowCostScore) === JSON.stringify(highCostScore), "same verified evidence scores identically across costs");
const starData = { units: [1, 3, 4, 5].map((cost) => ({ id: "c" + cost, cost, roleGroup: "specialist", traits: [] })), traits: [], items: [] };
const starProfile = sandbox.TFTAssess.defaultProfile(starData);
starData.units.forEach((u) => { starProfile.units[u.id].damage = { byStar: { "1": { lo: .5, mid: .5, hi: .5 }, "2": { lo: .7, mid: .7, hi: .7 }, "3": { lo: .9, mid: .9, hi: .9 } } }; starProfile.units[u.id].frontline = { byStar: { "1": { lo: .5, mid: .5, hi: .5 }, "2": { lo: .7, mid: .7, hi: .7 }, "3": { lo: .9, mid: .9, hi: .9 } } }; });
assert(sandbox.TFTAssess.assess(starData, [{ id: "c4", star: 2 }], { type: "starUp", id: "c4", to: 3, auto: true }, { level: 8 }, starProfile).status === "blocked", "4-cost auto 3-star is blocked");
assert(sandbox.TFTAssess.assess(starData, [{ id: "c5", star: 2 }], { type: "starUp", id: "c5", to: 3, auto: true }, { level: 8 }, starProfile).status === "blocked", "5-cost auto 3-star is blocked");
assert(sandbox.TFTAssess.assess(starData, [{ id: "c1", star: 2 }], { type: "starUp", id: "c1", to: 3, auto: true }, { level: 8 }, starProfile).status !== "blocked", "1-cost auto 3-star is legal");
assert(sandbox.TFTAssess.assess(starData, [{ id: "c3", star: 2 }], { type: "starUp", id: "c3", to: 3, auto: true }, { level: 8 }, starProfile).status !== "blocked", "3-cost auto 3-star is legal");
assert(sandbox.TFTAssess.assess(starData, [{ id: "c4", star: 1 }], { type: "starUp", id: "c4", to: 2, auto: true }, { level: 8 }, starProfile).status !== "blocked" && sandbox.TFTAssess.assess(starData, [{ id: "c5", star: 1 }], { type: "starUp", id: "c5", to: 2, auto: true }, { level: 8 }, starProfile).status !== "blocked", "cost 4/5 auto 2-star allowed");
assert(sandbox.TFTAssess.assess(starData, [{ id: "c5", star: 3 }], { type: "replace", out: "c5", in: "c1", star: 1 }, { level: 8 }, starProfile).status === "blocked", "manual high-cost 3-star protected from lower-star replacement");
const twoToOne = sandbox.TFTAssess.assess(starData, [{ id: "c1", star: 2 }], { type: "replace", out: "c1", in: "c3", star: 1 }, { level: 8 }, starProfile);
assert(twoToOne.status !== "now", "2-star to 1-star replacement is never now");
const revisionA = game.assessCandidate([{ id: "A", star: 1 }], { type: "noop" }, { level: 8 }, profile);
const revisionB = game.assessCandidate([{ id: "B", star: 1 }], { type: "noop" }, { level: 8 }, profile);
assert(revisionA.inputRevision !== revisionB.inputRevision, "inputRevision changes with board identity");
assert(sandbox.TFTAssess.chasePreference(1, 5) === 1 && sandbox.TFTAssess.chasePreference(2, 5) === 1 && sandbox.TFTAssess.chasePreference(3, 5) === 0 && sandbox.TFTAssess.chasePreference(2, 6) === 1 && sandbox.TFTAssess.chasePreference(3, 6) === 1 && sandbox.TFTAssess.chasePreference(3, 7) === 1 && sandbox.TFTAssess.chasePreference(3, 8) === 0 && sandbox.TFTAssess.chasePreference(3, 4) === 0, "exact chase preferences");
console.log("OK");
