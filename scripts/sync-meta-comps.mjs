#!/usr/bin/env node
/**
 * Fully-automated Meta Comps Sync script for TFT Sandbox (云顶沙盘).
 * Fetches structured JSON from MetaTFT's public comps API (Zero Cloudflare / Zero scraping),
 * prefers live TFTSet19 when available and falls back to PBE TFTSet19 while on PBE.
 * Maps unit/trait/item IDs against local data.js and classifies playstyle via engine.js,
 * writing static offline-friendly meta_comps.js.
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadGame() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), sandbox, { filename: "data.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "assess.js"), "utf8"), sandbox, { filename: "assess.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "engine.js"), "utf8"), sandbox, { filename: "engine.js" });
  const data = sandbox.SET19;
  const game = sandbox.TFT.create(data);
  return { data, game };
}

function buildIdNormalizers(data) {
  const unitMap = new Map();
  const traitMap = new Map();
  const itemMap = new Map();

  for (const u of data.units) {
    unitMap.set(u.id, u.id);
    unitMap.set(u.id.toLowerCase(), u.id);
    const bare = u.id.replace(/^DA_/i, "").replace(/19$/i, "").replace(/_/g, "").toLowerCase();
    unitMap.set(bare, u.id);
  }
  // Known MetaTFT naming aliases for Set 19
  unitMap.set("da_seraphine19_indie", "DA_SeraphineIndie19");
  unitMap.set("seraphine19indie", "DA_SeraphineIndie19");
  unitMap.set("da_akali19_kda", "DA_AkaliKDA19");
  unitMap.set("da_akali19_truedamage", "DA_Akali_TrueDamage19");

  for (const t of data.traits) {
    traitMap.set(t.id, t.id);
    traitMap.set(t.id.toLowerCase(), t.id);
  }
  for (const it of data.items) {
    itemMap.set(it.id, it.id);
    itemMap.set(it.id.toLowerCase(), it.id);
    const short = it.id.replace(/^DA_/i, "").replace(/^Item_/i, "").toLowerCase();
    if (!itemMap.has(short)) itemMap.set(short, it.id);
  }

  return {
    unit(raw) {
      if (!raw) return null;
      const k = String(raw).trim();
      if (unitMap.has(k)) return unitMap.get(k);
      if (unitMap.has(k.toLowerCase())) return unitMap.get(k.toLowerCase());
      const bare = k.replace(/^(DA_|TFT19_)/i, "").replace(/19$/i, "").replace(/_/g, "").toLowerCase();
      return unitMap.get(bare) || null;
    },
    trait(raw) {
      if (!raw) return null;
      const k = String(raw).trim().replace(/_\d+$/, "");
      return traitMap.get(k) || traitMap.get(k.toLowerCase()) || null;
    },
    item(raw) {
      if (!raw) return null;
      const k = String(raw).trim();
      if (itemMap.has(k)) return itemMap.get(k);
      if (itemMap.has(k.toLowerCase())) return itemMap.get(k.toLowerCase());
      const short = k.replace(/^(DA_|TFT_Item_)/i, "").toLowerCase();
      return itemMap.get(short) || null;
    }
  };
}

async function fetchJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "TFT-Sandbox-MetaSync/1.0" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMetaTFT(targetSet) {
  const candidates = [
    { queue: "live", dataUrl: "https://api-hc.metatft.com/tft-comps-api/comps_data", statsUrl: "https://api-hc.metatft.com/tft-comps-api/comps_stats" },
    { queue: "pbe", dataUrl: "https://api-hc.metatft.com/tft-comps-api/comps_data?queue=pbe", statsUrl: "https://api-hc.metatft.com/tft-comps-api/comps_stats?queue=pbe" }
  ];
  for (const c of candidates) {
    try {
      const data = await fetchJson(c.dataUrl);
      const setCode = data?.results?.data?.tft_set || "";
      if (setCode === targetSet) {
        const stats = await fetchJson(c.statsUrl);
        return { queue: c.queue, setCode, data, stats };
      }
    } catch (err) {
      console.warn(`[sync-meta] ${c.queue} check failed:`, err.message);
    }
  }
  throw new Error(`No MetaTFT feed currently serving ${targetSet}`);
}

function tierOf(avg, top4Rate) {
  if (avg <= 3.95 && top4Rate >= 0.56) return "S";
  if (avg <= 4.30 && top4Rate >= 0.50) return "A";
  return "B";
}

function tempoLabel(levelling, archetype) {
  const lv = String(levelling || "").toLowerCase();
  if (lv.includes("slow roll 5") || lv.includes("lvl 5")) return "5级慢D追三";
  if (lv.includes("slow roll 6") || lv.includes("lvl 6")) return "6级慢D追三";
  if (lv.includes("slow roll 7") || lv.includes("lvl 7")) return "7级慢D追三";
  if (lv.includes("fast 9") || lv.includes("lvl 9")) return "速9成型";
  if (lv.includes("fast 8") || lv.includes("lvl 8")) return "8级运营";
  if (archetype === "reroll") return "低费追三";
  if (archetype === "fast_high") return "速8/9运营";
  return "标准8级";
}

function levelFromTempo(levelling, unitCount, archetype) {
  const lv = String(levelling || "").toLowerCase();
  if (lv.includes("5")) return Math.max(6, unitCount);
  if (lv.includes("6")) return Math.max(6, unitCount);
  if (lv.includes("7")) return Math.max(7, unitCount);
  if (lv.includes("9")) return Math.max(9, unitCount);
  if (archetype === "reroll") return Math.max(7, Math.min(8, unitCount));
  return Math.max(8, Math.min(10, unitCount));
}

async function fetchPlannerCodes(targetSet, data) {
  const localByLower = new Map();
  for (const u of data.units) {
    localByLower.set(u.id.toLowerCase(), u.id);
  }
  // Known official/MetaTFT character_id aliases -> local data.js IDs
  const aliases = {
    da_19_ahri: "DA_Ahri19",
    da_seraphine19_indie: "DA_SeraphineIndie19",
    da_akali19_kda: "DA_AkaliKDA19",
    da_akali19_truedamage: "DA_Akali_TrueDamage19"
  };

  function resolveLocalId(keys) {
    for (const k of keys) {
      if (!k) continue;
      const low = String(k).toLowerCase();
      if (localByLower.has(low)) return localByLower.get(low);
      if (aliases[low]) return aliases[low];
    }
    return null;
  }

  function toHex3(val) {
    if (typeof val === "number" && Number.isInteger(val) && val > 0 && val <= 0xfff) {
      return val.toString(16).padStart(3, "0");
    }
    if (typeof val === "string") {
      const clean = val.trim().toLowerCase().replace(/^0x/, "");
      if (/^[0-9a-f]{1,3}$/.test(clean)) {
        const n = parseInt(clean, 16);
        if (n > 0 && n <= 0xfff) return n.toString(16).padStart(3, "0");
      }
    }
    return "";
  }

  // 1. Prefer Riot official CommunityDragon teamplanner JSON (live first, then pbe)
  for (const branch of ["latest", "pbe"]) {
    try {
      const tp = await fetchJson(`https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json`);
      const rows = tp && Array.isArray(tp[targetSet]) ? tp[targetSet] : null;
      if (rows && rows.length) {
        const out = {};
        for (const r of rows) {
          const uid = resolveLocalId([r.character_id]);
          const hex = toHex3(r.team_planner_code);
          if (uid && hex) out[uid] = hex;
        }
        if (Object.keys(out).length >= Math.floor(data.units.length * 0.9)) {
          const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
          return { source: `CDragon (${branch})`, codes: sorted };
        }
      }
    } catch (err) {
      console.warn(`[sync-meta] CDragon ${branch} teamplanner check failed:`, err.message);
    }
  }

  // 2. Fallback to MetaTFT client-manifest lookup JSON (already verified 100% identical to CDragon)
  try {
    const lookup = await fetchJson(`https://data.metatft.com/lookups/${targetSet}_latest_en_us.json`);
    const out = {};
    for (const u of (lookup && lookup.units) || []) {
      const hex = toHex3(u.code);
      if (!hex) continue;
      const uid = resolveLocalId([u.apiName, u.characterName, ...(u.assetNames || [])]);
      if (uid) out[uid] = hex;
    }
    if (Object.keys(out).length >= Math.floor(data.units.length * 0.9)) {
      const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
      return { source: `MetaTFT Lookup (${lookup?._metadata?.patch || "latest"})`, codes: sorted };
    }
  } catch (err) {
    console.warn(`[sync-meta] MetaTFT lookup planner codes failed:`, err.message);
  }

  return null;
}

async function main() {
  const { data, game } = loadGame();
  const norm = buildIdNormalizers(data);
  const targetSet = `TFTSet${data.meta?.set || 19}`;

  console.log(`[sync-meta] Fetching MetaTFT ${targetSet}...`);
  const feed = await fetchMetaTFT(targetSet);
  const details = feed.data?.results?.data?.cluster_details || {};
  const statsRows = feed.stats?.results || [];

  const totalGames = (statsRows.find((r) => r.cluster === "")?.places?.[0]) || 0;
  const statsByCluster = new Map();
  for (const row of statsRows) {
    if (!row.cluster || !Array.isArray(row.places) || row.places.length < 8) continue;
    const places = row.places.slice(0, 8);
    const games = places.reduce((a, b) => a + b, 0);
    if (games < 500) continue;
    let weighted = 0;
    for (let p = 0; p < 8; p++) weighted += places[p] * (p + 1);
    const avg = weighted / games;
    const top4 = (places[0] + places[1] + places[2] + places[3]) / games;
    const win = places[0] / games;
    statsByCluster.set(String(row.cluster), { games, avg, top4, win });
  }

  const rawComps = [];
  for (const [cid, cluster] of Object.entries(details)) {
    const stat = statsByCluster.get(String(cid));
    if (!stat) continue;
    const rawUnits = String(cluster.units_string || "").split(",").map((s) => s.trim()).filter(Boolean);
    const unitIds = [];
    const seen = new Set();
    for (const ru of rawUnits) {
      const uid = norm.unit(ru);
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        unitIds.push(uid);
      }
    }
    if (unitIds.length < 5) continue;

    // Stars from MetaTFT 3-star list (only cost <= 3)
    const starSet = new Set((cluster.stars || []).map((s) => norm.unit(s)).filter(Boolean));
    // Core item builds per unit (top 2-3 units with highest sample count)
    const itemsByUnit = new Map();
    const builds = Array.isArray(cluster.builds) ? cluster.builds.slice().sort((a, b) => (b.count || 0) - (a.count || 0)) : [];
    let equippedUnits = 0;
    for (const b of builds) {
      if (equippedUnits >= 3) break;
      const uid = norm.unit(b.unit);
      if (!uid || !seen.has(uid) || itemsByUnit.has(uid)) continue;
      const mapped = (b.buildName || []).map((it) => norm.item(it)).filter((id) => {
        if (!id || !game.itemById[id]) return false;
        const info = game.itemById[id];
        if (info.kind === "emblem" && info.trait && game.byId[uid].traits.includes(info.trait)) return false;
        return true;
      }).slice(0, 3);
      if (mapped.length) {
        itemsByUnit.set(uid, mapped);
        equippedUnits++;
      }
    }

    const boardEntries = unitIds.map((id) => {
      const u = game.byId[id];
      const star = starSet.has(id) && u.cost <= 3 ? 3 : (u.cost <= 4 ? 2 : 1);
      return { id, star, items: itemsByUnit.get(id) || [] };
    });

    const slots = game.slotsOf(boardEntries);
    const estLevel = Math.max(slots, levelFromTempo(cluster.levelling, slots, "auto"));
    const lvStr = String(cluster.levelling || "").toLowerCase();
    const isRerollHint = lvStr.includes("roll") ||
      boardEntries.filter((e) => e.star === 3 && game.byId[e.id].cost <= 3).length >= 2;
    const mode = isRerollHint ? "reroll" : (lvStr.includes("fast 9") ? "fast8" : "auto");
    const sys = game.analyzeSystem(boardEntries, { level: estLevel, mode, allowLocked: true, emblems: {}, prismatic: {} });
    const ev = game.evaluate(boardEntries, { level: estLevel, mode, emblems: {}, prismatic: {} }, null);

    // Active non-solo traits for display & "设为目标羁绊"
    const activeTraits = ev.traits
      .filter((t) => t.kind !== "solo" && t.best && t.best.style > 0)
      .slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name, count: t.count, need: t.best.need, style: t.best.style }));

    // Build localized Chinese comp title from primary traits + main carry/name tokens
    const titleParts = [];
    const nameTokens = Array.isArray(cluster.name) ? cluster.name : [];
    for (const tok of nameTokens.slice(0, 2)) {
      if (tok.type === "trait") {
        const tid = norm.trait(tok.name);
        if (tid && game.traitById[tid]) {
          const at = activeTraits.find((x) => x.id === tid);
          titleParts.push((at ? `${at.need}` : "") + game.traitById[tid].name);
        }
      } else if (tok.type === "unit") {
        const uid = norm.unit(tok.name);
        if (uid && game.byId[uid]) titleParts.push(game.byId[uid].display);
      }
    }
    const title = titleParts.length >= 2
      ? titleParts.join(" ")
      : ((activeTraits[0] ? `${activeTraits[0].need}${activeTraits[0].name}` : "热门体系") + " " +
        (boardEntries.find((e) => itemsByUnit.has(e.id)) ? game.byId[boardEntries.find((e) => itemsByUnit.has(e.id)).id].display : game.byId[unitIds[0]].display));

    // Target traits for 1-click "设为目标羁绊" (top 1-2 core traits)
    const traitTargets = {};
    if (activeTraits[0]) traitTargets[activeTraits[0].id] = activeTraits[0].need;
    if (activeTraits[1] && (sys.archetype === "flex_web" || activeTraits[1].need >= 3)) {
      traitTargets[activeTraits[1].id] = activeTraits[1].need;
    }

    // Sort display units: carriers with items first, then cost desc
    const sortedBoard = boardEntries.slice().sort((a, b) => {
      const ia = a.items.length ? 1 : 0;
      const ib = b.items.length ? 1 : 0;
      if (ia !== ib) return ib - ia;
      return (game.byId[b.id].cost || 1) - (game.byId[a.id].cost || 1) || b.star - a.star;
    });

    const tier = tierOf(stat.avg, stat.top4);
    const rankScore = (5.0 - stat.avg) * 2.2 + stat.top4 * 3.0 + Math.log10(Math.max(100, stat.games)) * 0.35;

    rawComps.push({
      id: `mt_${cid}`,
      title,
      tier,
      archetype: sys.archetype === "open" ? "vertical" : sys.archetype,
      archetypeLabel: sys.archetypeLabel,
      tempo: tempoLabel(cluster.levelling, sys.archetype),
      level: estLevel,
      mode,
      avgPlace: Math.round(stat.avg * 100) / 100,
      top4Rate: Math.round(stat.top4 * 1000) / 10,
      winRate: Math.round(stat.win * 1000) / 10,
      games: stat.games,
      units: sortedBoard,
      traits: activeTraits,
      traitTargets,
      _rankScore: rankScore
    });
  }

  // Dedupe near-identical titles and keep Top 20 strongest & most representative comps
  rawComps.sort((a, b) => b._rankScore - a._rankScore);
  const seenTitles = new Set();
  const comps = [];
  for (const c of rawComps) {
    if (seenTitles.has(c.title)) continue;
    seenTitles.add(c.title);
    delete c._rankScore;
    comps.push(c);
    if (comps.length >= 20) break;
  }

  const plannerInfo = await fetchPlannerCodes(targetSet, data);
  const outObj = {
    schemaVersion: 1,
    set: data.meta?.set || 19,
    source: `MetaTFT (${feed.queue.toUpperCase()})`,
    sourceUrl: "https://www.metatft.com/comps",
    updatedAt: new Date().toISOString().slice(0, 10),
    sampleGames: totalGames,
    ...(plannerInfo ? { plannerCodesSource: plannerInfo.source, plannerCodes: plannerInfo.codes } : {}),
    comps
  };

  const jsContent =
    "// Auto-generated by scripts/sync-meta-comps.mjs from MetaTFT public JSON API.\n" +
    "// Safe to load offline (file://) and on static hosting (GitHub Pages / EdgeOne).\n" +
    "window.META_COMPS = " + JSON.stringify(outObj, null, 2) + ";\n";

  const outPath = path.join(root, "meta_comps.js");
  fs.writeFileSync(outPath, jsContent, "utf8");
  console.log(`[sync-meta] Wrote ${comps.length} Set ${outObj.set} meta comps (${totalGames.toLocaleString()} matches, source=${outObj.source}) to meta_comps.js`);
  comps.slice(0, 8).forEach((c, i) => {
    console.log(`  #${i + 1} [${c.tier}] ${c.title} (${c.archetypeLabel} · ${c.tempo}) avg=${c.avgPlace} top4=${c.top4Rate}% units=${c.units.map((u) => game.byId[u.id].display).join("/")}`);
  });
}

main().catch((err) => {
  console.error("[sync-meta] ERROR:", err);
  process.exit(1);
});
