/**
 * LocalStorage persistence & backup helpers for "我的阵容收藏夹" (Saved Lineups).
 * Purely local, offline-first, interoperable with TFT19:... plain-text share codes.
 */
import { encodeShareCode } from "./share-codec.js";

const STORAGE_KEY = "tft-saved-comps-v1";
const MAX_SAVED = 60;

function readRaw() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(list) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    return true;
  } catch {
    return false;
  }
}

export function defaultCompName(state, game, rec) {
  const lvl = state && state.level ? state.level : 8;
  const sys = rec && rec.system;
  if (sys && Array.isArray(sys.primaryTraits) && sys.primaryTraits.length) {
    const tName = sys.primaryTraits.slice(0, 2).map((t) => t.name).join("·");
    return `${lvl}级 · ${tName}${sys.archetypeLabel && sys.archetype !== "open" ? " " + sys.archetypeLabel : ""}`;
  }
  const n = (state && state.board && state.board.length) || 0;
  return `${lvl}级 · ${n}弈子残局`;
}

export function listSavedComps() {
  const list = readRaw();
  return list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveCurrentComp(state, game, rec, opts) {
  const o = opts || {};
  const list = readRaw();
  const code = encodeShareCode(state, game);
  const name = (o.name && String(o.name).trim()) || defaultCompName(state, game, rec);
  const category = o.category === "review" ? "review" : "meta";
  const sys = rec && rec.system;
  const traits = (rec && Array.isArray(rec.traits) ? rec.traits : [])
    .filter((t) => t && t.kind !== "solo" && t.best && t.best.style > 0)
    .slice(0, 4)
    .map((t) => `${t.best.need}${t.name}`);

  const units = (state.board || []).slice(0, 10).map((e) => ({
    id: e.id,
    star: e.star || 1
  }));

  const entry = {
    id: "sc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    name,
    category,
    pinned: false,
    level: state.level || 8,
    archetypeLabel: (sys && sys.archetypeLabel && sys.archetype !== "open") ? sys.archetypeLabel : "",
    units,
    traits,
    code,
    updatedAt: Date.now()
  };

  list.unshift(entry);
  if (list.length > MAX_SAVED) list.length = MAX_SAVED;
  writeRaw(list);
  return entry;
}

export function removeSavedComp(id) {
  const list = readRaw().filter((c) => c.id !== id);
  writeRaw(list);
  return listSavedComps();
}

export function togglePinSavedComp(id) {
  const list = readRaw().map((c) => (c.id === id ? Object.assign({}, c, { pinned: !c.pinned }) : c));
  writeRaw(list);
  return listSavedComps();
}

export function exportSavedCompsJson() {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), comps: readRaw() }, null, 2);
}

export function importSavedCompsJson(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "备份文件 JSON 格式无效", added: 0 };
  }
  const incoming = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.comps) ? parsed.comps : null);
  if (!incoming) return { ok: false, error: "未在备份文件中找到收藏阵容列表", added: 0 };

  const existing = readRaw();
  const seenCodes = new Set(existing.map((c) => c.code));
  let added = 0;
  for (const item of incoming) {
    if (!item || typeof item.code !== "string" || !item.code.includes(":")) continue;
    if (seenCodes.has(item.code)) continue;
    seenCodes.add(item.code);
    existing.unshift({
      id: item.id || ("sc_" + Date.now().toString(36) + "_" + added),
      name: String(item.name || "导入阵容").slice(0, 60),
      category: item.category === "review" ? "review" : "meta",
      pinned: !!item.pinned,
      level: Number(item.level) || 8,
      archetypeLabel: String(item.archetypeLabel || ""),
      units: Array.isArray(item.units) ? item.units.slice(0, 12) : [],
      traits: Array.isArray(item.traits) ? item.traits.slice(0, 5) : [],
      code: item.code,
      updatedAt: Number(item.updatedAt) || Date.now()
    });
    added++;
  }
  if (existing.length > MAX_SAVED) existing.length = MAX_SAVED;
  writeRaw(existing);
  return { ok: true, error: null, added };
}
