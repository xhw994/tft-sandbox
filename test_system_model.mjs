import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), sandbox, { filename: "data.js" });
vm.runInContext(fs.readFileSync(path.join(root, "assess.js"), "utf8"), sandbox, { filename: "assess.js" });
vm.runInContext(fs.readFileSync(path.join(root, "engine.js"), "utf8"), sandbox, { filename: "engine.js" });

const data = sandbox.SET19;
const game = sandbox.TFT.create(data);

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

function namesOf(ids) {
  return ids.map((id) => {
    const u = game.byId[id];
    return u ? `${u.display}${u.unlock ? "(锁)" : ""}` : id;
  }).join(", ");
}

function allSuggestedIds(rec) {
  const out = new Set();
  (rec.next || []).forEach((r) => out.add(r.id));
  (rec.plans || []).forEach((p) => (p.adds || []).forEach((a) => out.add(typeof a === "string" ? a : a.id)));
  (rec.swaps || []).forEach((s) => out.add(s.inn));
  return out;
}

// ============================================================================
// 10-Scenario Set 19 Meta Self-Test Benchmark (DataTFT & Mobalytics comps)
// Covers: Vertical High Traits, Multi-Trait Flex Web, Low-Cost Reroll,
//         In-System High-Cost Upgrades, Emblem Pivots, and Locked-Unit Gating.
// ============================================================================

test("1. Vertical Ionic Spark (4/8 Lv8): detects vertical Ionic Spark, tops in-system unlocked cores, blocks unrelated locked units", () => {
  const board = [
    { id: "DA_Elise19", star: 2, items: [] },
    { id: "DA_Yunara19", star: 2, items: ["DA_GuinsoosRageblade", "DA_InfinityEdge"] },
    { id: "DA_Annie19", star: 2, items: ["DA_WarmogsArmor"] },
    { id: "DA_Lux19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "vertical", "archetype: " + JSON.stringify(rec.system));
  assert.equal(rec.system.primaryIds[0], "DA_IonicSpark19", "primary should be Ionic Spark");

  const nextIds = rec.next.map((r) => r.id);
  const top3 = nextIds.slice(0, 3);
  const ionicNext = new Set(["DA_Shyvana19", "DA_Aurora19", "DA_Briar19", "DA_Jinx19", "DA_Tibbers19"]);
  assert.ok(top3.every((id) => ionicNext.has(id)), "top 3 nextBuys should all be Ionic Spark units, got: " + namesOf(nextIds));
  assert.equal(game.byId[nextIds[0]].unlock, null, "rank #1 should prefer unlocked Ionic Spark unit over locked ties, got: " + namesOf(nextIds));
  assert.equal(rec.next[0].systemTag, "体系核心");

  const all = allSuggestedIds(rec);
  for (const bad of ["DA_Ashe19", "DA_Kayle19", "DA_Vayne19", "DA_Thresh19", "DA_Zac19", "DA_Alune19", "DA_Samira19"]) {
    assert.equal(all.has(bad), false, `unrelated locked unit ${bad} leaked into Ionic Spark recommendations`);
  }
  assert.ok(rec.plans[0].board.filter((e) => game.byId[e.id].traits.includes("DA_IonicSpark19")).length >= 7,
    "top plan should push vertical 7 Ionic Spark: " + namesOf(rec.plans[0].adds.map((a) => a.id)));
});

test("2. Vertical Pentakill (4/8 Lv8): detects vertical Pentakill, ranks Viego & Kayle top 2, blocks unrelated Zac/Ashe", () => {
  const board = [
    { id: "DA_Olaf19", star: 2, items: [] },
    { id: "DA_Gnar19", star: 2, items: [] },
    { id: "DA_Karthus19", star: 1, items: [] },
    { id: "DA_Yorick19", star: 1, items: ["DA_WarmogsArmor"] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "vertical");
  assert.equal(rec.system.primaryIds[0], "DA_Pentakill19");

  const nextIds = rec.next.map((r) => r.id);
  assert.ok(nextIds.slice(0, 2).includes("DA_Viego19"), "Viego (unlocked Pentakill) must be top 2: " + namesOf(nextIds));
  assert.ok(nextIds.slice(0, 2).includes("DA_Kayle19"), "Kayle (board-related Pentakill 4/4) must be top 2: " + namesOf(nextIds));

  const all = allSuggestedIds(rec);
  for (const bad of ["DA_Zac19", "DA_Ashe19", "DA_Jinx19", "DA_Alune19", "DA_Thresh19"]) {
    assert.equal(all.has(bad), false, `unrelated locked unit ${bad} leaked into Pentakill`);
  }
});

test("3. Vertical K/DA (4/8 Lv8, 6* K/DA): detects vertical K/DA, ranks Leona/Gragas/Evelynn top 3, blocks unrelated Vayne/Ashe", () => {
  const board = [
    { id: "DA_Neeko19", star: 2, items: [] },
    { id: "DA_Lillia19", star: 2, items: [] },
    { id: "DA_Kaisa19", star: 1, items: ["DA_GuinsoosRageblade"] },
    { id: "DA_Ahri19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "vertical");
  assert.equal(rec.system.primaryIds[0], "DA_KDA19");

  const nextIds = rec.next.map((r) => r.id);
  const kdaRem = new Set(["DA_Leona19", "DA_Gragas19", "DA_Evelynn19"]);
  assert.ok(nextIds.slice(0, 3).every((id) => kdaRem.has(id)), "top 3 nextBuys should be remaining K/DA units (Leona/Gragas/Evelynn), got: " + namesOf(nextIds));
  assert.equal(nextIds[0], "DA_Leona19", "Leona (unlocked 4c tank, hits K/DA 7* + Bodyguard 2) should be #1, got: " + namesOf(nextIds));

  const all = allSuggestedIds(rec);
  for (const bad of ["DA_Vayne19", "DA_Ashe19", "DA_Jinx19", "DA_Kayle19", "DA_Zac19"]) {
    assert.equal(all.has(bad), false, `unrelated locked unit ${bad} leaked into K/DA`);
  }
});

test("4. Jazz Multi-Trait Flex Web (5/8 Lv8): detects flex_web, prioritizes multi-trait bridges, blocks unrelated locked units", () => {
  const board = [
    { id: "DA_Lucian19", star: 2, items: ["DA_InfinityEdge"] },
    { id: "DA_Bard19", star: 2, items: [] },
    { id: "DA_Galio19", star: 1, items: ["DA_WarmogsArmor"] },
    { id: "DA_Neeko19", star: 2, items: [] },
    { id: "DA_Ekko19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "flex_web", "archetype: " + JSON.stringify(rec.system));
  assert.ok(rec.system.primaryIds.includes("DA_Jazz19"), "Jazz should be primary: " + JSON.stringify(rec.system));

  const nextIds = rec.next.map((r) => r.id);
  const all = allSuggestedIds(rec);
  for (const bad of ["DA_Ashe19", "DA_Jinx19", "DA_Kayle19", "DA_Vayne19", "DA_Zac19", "DA_Thresh19"]) {
    assert.equal(all.has(bad), false, `unrelated locked unit ${bad} leaked into Jazz Flex`);
  }
  // Top flex picks should activate at least 1 trait (ideally 2 traits or bridge tags)
  const topBuy = rec.next[0];
  assert.ok(topBuy && topBuy.reasons.length > 0, "top Jazz Flex buy must advance/activate traits: " + JSON.stringify(topBuy));
  const bestPlanActiveTraits = rec.plans[0].traits.length;
  assert.ok(bestPlanActiveTraits >= 5, "Jazz Flex plan should build >= 5 active traits, got " + bestPlanActiveTraits + ": " + rec.plans[0].traits.join(", "));
});

test("5. Malzahar Prodigy (5/8 Lv8): detects Prodigy core (not low-cost Ionic Spark), prioritizes Alune & Ahri, blocks unrelated Yasuo", () => {
  const board = [
    { id: "DA_Neeko19", star: 2, items: [] },
    { id: "DA_Lux19", star: 2, items: [] },
    { id: "DA_Malzahar19", star: 3, items: ["DA_BlueBuff", "DA_RabadonsDeathcap"] },
    { id: "DA_Ekko19", star: 2, items: [] },
    { id: "DA_Leona19", star: 1, items: ["DA_WarmogsArmor"] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.primaryIds[0], "DA_Prodigy19", "Prodigy must be #1 primary: " + JSON.stringify(rec.system));

  const nextIds = rec.next.map((r) => r.id);
  assert.equal(nextIds[0], "DA_Alune19", "Alune (hits Prodigy 5 + Manager 2!) must be #1: " + namesOf(nextIds));
  assert.ok(!nextIds.slice(0, 3).includes("DA_Elise19") && !nextIds.slice(0, 3).includes("DA_Yunara19"),
    "1-cost Ionic Spark units must not crowd top 3 at Lv8 Malzahar Prodigy: " + namesOf(nextIds));
  assert.equal(allSuggestedIds(rec).has("DA_Yasuo19"), false, "Yasuo (needs 6* TD/Mosher, board only has 2* Ekko) must be blocked");
});

test("6. Hyperpop Reroll (3/6 Lv6): detects reroll, ranks Tristana #1 (Hyperpop 3->4), blocks unrelated Ashe/Vayne", () => {
  const board = [
    { id: "DA_Ziggs19", star: 2, items: ["DA_BlueBuff"] },
    { id: "DA_Kobuko19", star: 2, items: ["DA_WarmogsArmor"] },
    { id: "DA_Lulu19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 6, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "reroll", "archetype: " + JSON.stringify(rec.system));
  assert.equal(rec.system.primaryIds[0], "DA_GlitterBomb19");

  const nextIds = rec.next.map((r) => r.id);
  assert.equal(nextIds[0], "DA_Tristana19", "Tristana (Hyperpop 3->4) must be #1: " + namesOf(nextIds));
  assert.equal(allSuggestedIds(rec).has("DA_Ashe19"), false, "unrelated Ashe must not appear in Hyperpop");
});

test("7. Full-Board In-System High-Cost Upgrade Swaps (8/8 Lv8): prefers replacing low-cost unit with in-system 4-cost over off-system splash", () => {
  // 8/8 Lv8 Ionic Spark board holding 1-cost Elise + 1-cost Yunara + 2-cost filler; unlocked 4-cost Shyvana/Aurora available!
  const board = [
    { id: "DA_Elise19", star: 1, items: [] },
    { id: "DA_Yunara19", star: 2, items: ["DA_GuinsoosRageblade"] },
    { id: "DA_Annie19", star: 2, items: ["DA_WarmogsArmor", "DA_GargoyleStoneplate"], mark: "tank" },
    { id: "DA_Lux19", star: 2, items: [] },
    { id: "DA_Briar19", star: 2, items: [] },
    { id: "DA_Jinx19", star: 2, items: ["DA_InfinityEdge", "DA_LastWhisper"], mark: "carry" },
    { id: "DA_Neeko19", star: 1, items: [] },
    { id: "DA_Kennen19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.primaryIds[0], "DA_IonicSpark19");
  assert.ok(rec.swaps.length > 0, "full 8/8 board should offer upgrade swaps");
  const topSwap = rec.swaps[0];
  const inUnit = game.byId[topSwap.inn];
  const outUnit = game.byId[topSwap.out];
  assert.ok(inUnit.cost > outUnit.cost, `top swap should upgrade cost (${outUnit.display}${outUnit.cost} -> ${inUnit.display}${inUnit.cost})`);
  const ionicUpgrade = rec.swaps.slice(0, 2).some((s) => game.byId[s.inn].traits.includes("DA_IonicSpark19"));
  assert.ok(ionicUpgrade, "top 2 swaps should prioritize in-system Ionic Spark upgrade (Shyvana/Aurora/Tibbers), got: " +
    rec.swaps.map((s) => `${game.byId[s.out].display}->${game.byId[s.inn].display}(${s.systemTag})`).join(" | "));
});

test("8. Heartsteel Fast-8/9 (4/8 Lv8 fast8): detects fast_high, prioritizes 4-cost Heartsteel & related Alune", () => {
  const board = [
    { id: "DA_Sett19", star: 2, items: [] },
    { id: "DA_Ezreal19", star: 2, items: [] },
    { id: "DA_KSante19", star: 2, items: ["DA_WarmogsArmor"] },
    { id: "DA_Yone19", star: 2, items: ["DA_Bloodthirster", "DA_TitansResolve"] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "fast8", allowLocked: true });
  assert.equal(rec.system.archetype, "fast_high", "archetype: " + JSON.stringify(rec.system));
  assert.equal(rec.system.primaryIds[0], "DA_Heartsteel19");

  const nextIds = rec.next.map((r) => r.id);
  assert.ok(nextIds.slice(0, 2).includes("DA_Alune19"), "Alune (4c Heartsteel 4->5, board has 4 Heartsteel!) must be top 2: " + namesOf(nextIds));
  assert.equal(allSuggestedIds(rec).has("DA_Ashe19"), false, "unrelated Ashe blocked");
  assert.equal(allSuggestedIds(rec).has("DA_Jinx19"), false, "unrelated Jinx blocked");
});

test("9. Vertical Classical / Virtuosos (4/8 Lv8): detects Classical vertical, recommends Thresh/Samira, blocks unrelated locked", () => {
  const board = [
    { id: "DA_Katarina19", star: 2, items: [] },
    { id: "DA_Nasus19", star: 2, items: ["DA_WarmogsArmor"] },
    { id: "DA_RenataGlasc19", star: 1, items: [] },
    { id: "DA_Jhin19", star: 2, items: ["DA_InfinityEdge"] }
  ];
  const rec = game.recommend(board, { level: 8, mode: "auto", allowLocked: true });
  assert.equal(rec.system.archetype, "vertical");
  assert.equal(rec.system.primaryIds[0], "DA_Virtuosos19");

  const nextIds = rec.next.map((r) => r.id);
  const classRem = new Set(["DA_Thresh19", "DA_Samira19"]);
  assert.ok(nextIds.slice(0, 2).some((id) => classRem.has(id)), "Classical board should recommend Thresh/Samira in top 2: " + namesOf(nextIds));
  const all = allSuggestedIds(rec);
  for (const bad of ["DA_Ashe19", "DA_Jinx19", "DA_Kayle19", "DA_Vayne19", "DA_Zac19"]) {
    assert.equal(all.has(bad), false, `unrelated locked unit ${bad} leaked into Classical`);
  }
});

test("10. Emblem-Driven System Pivot (2/8 Lv8 + Pentakill Emblem): elevates Pentakill to primary & recommends Pentakill cores", () => {
  const board = [
    { id: "DA_Olaf19", star: 1, items: [] },
    { id: "DA_Annie19", star: 1, items: [] }
  ];
  const rec = game.recommend(board, {
    level: 8,
    mode: "auto",
    allowLocked: true,
    emblems: { DA_Pentakill19: 1 }
  });
  assert.equal(rec.system.primaryIds[0], "DA_Pentakill19", "Pentakill Emblem must elevate Pentakill to #1 primary: " + JSON.stringify(rec.system));
  const nextIds = rec.next.map((r) => r.id);
  const pentaUnits = new Set(["DA_Yorick19", "DA_Viego19", "DA_Karthus19", "DA_Gnar19", "DA_Kayle19"]);
  assert.ok(nextIds.slice(0, 3).filter((id) => pentaUnits.has(id)).length >= 2,
    "top 3 nextBuys should pivot strongly into Pentakill units, got: " + namesOf(nextIds));
});

console.log(`All ${passed} Set 19 meta system-model benchmarks passed!`);
