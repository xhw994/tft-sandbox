/**
 * Pure-JS URL, Plain-Text Share Code, and Official Riot Team Planner Code codec.
 * Supports unified import of:
 *   - Sandbox plain-text share code: TFT19:<base64url>
 *   - Chat-wrapped plain text containing a TFT<n>:<base64url> token
 *   - Full share URL containing #s=TFT19:... or ?s=TFT19:...
 *   - Official Riot TFT Team Planner code (v2): 02<30 hex chars>TFTSet19 (raw or inside guide text)
 * Zero external dependencies; works identically in browser and Node.js.
 */
import {
  extractOfficialTeamCode,
  encodeOfficialTeamCode,
  decodeOfficialTeamCode
} from "./team-planner-code.js";

export { extractOfficialTeamCode, encodeOfficialTeamCode, decodeOfficialTeamCode };

const VALID_MODES = new Set(["auto", "reroll", "fast8"]);
const VALID_MARKS = new Set(["carry", "carry2", "tank", "bot"]);

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64url) {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(padded, "base64").toString("utf8");
}

function nonEmptyObj(obj) {
  return obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

export function encodeShareCode(state, game) {
  const setNum = (game && game.data && game.data.meta && game.data.meta.set) || 19;
  const payload = {
    v: 1,
    s: setNum,
    l: Math.max(1, Math.min(10, Number(state.level) || 8)),
    b: (state.board || []).map((e) => {
      const row = e.position && Number.isInteger(e.position.row) ? e.position.row : -1;
      const col = e.position && Number.isInteger(e.position.col) ? e.position.col : -1;
      const tuple = [e.id, Math.max(1, Math.min(3, Number(e.star) || 1)), row, col];
      const mark = e.mark && VALID_MARKS.has(e.mark) ? e.mark : "";
      const items = Array.isArray(e.items) && e.items.length ? e.items.slice(0, 3) : null;
      if (items) {
        tuple.push(mark, items);
      } else if (mark) {
        tuple.push(mark);
      }
      return tuple;
    })
  };

  if (state.extraSlots > 0) payload.x = state.extraSlots | 0;
  if (state.mode && state.mode !== "auto" && VALID_MODES.has(state.mode)) payload.m = state.mode;
  if (state.allowLocked === false) payload.k = 0;
  if (state.focusId) payload.f = state.focusId;
  if (state.unlockTargetId) payload.u = state.unlockTargetId;
  if (Array.isArray(state.looseItems) && state.looseItems.length) payload.i = state.looseItems.slice();
  if (nonEmptyObj(state.emblems)) {
    const em = {};
    Object.keys(state.emblems).forEach((k) => {
      if ((state.emblems[k] | 0) > 0) em[k] = state.emblems[k] | 0;
    });
    if (nonEmptyObj(em)) payload.e = em;
  }
  if (nonEmptyObj(state.prismatic)) {
    const pr = Object.keys(state.prismatic).filter((k) => state.prismatic[k]);
    if (pr.length) payload.p = pr;
  }
  if (nonEmptyObj(state.traitTargets)) {
    const tt = {};
    Object.keys(state.traitTargets).forEach((k) => {
      const n = Number(state.traitTargets[k]) || 0;
      if (n > 0) tt[k] = n;
    });
    if (nonEmptyObj(tt)) payload.t = tt;
  }
  if (nonEmptyObj(state.bannedIds)) {
    const bn = Object.keys(state.bannedIds).filter((k) => state.bannedIds[k]);
    if (bn.length) payload.n = bn;
  }
  if ((state.targetTraitCount | 0) > 0) payload.g = state.targetTraitCount | 0;

  return `TFT${setNum}:${toBase64Url(JSON.stringify(payload))}`;
}

export function buildShareUrl(state, game, baseHref) {
  const code = encodeShareCode(state, game);
  const href = baseHref || (typeof location !== "undefined" ? location.href.split("#")[0] : "");
  return `${href}#s=${code}`;
}

export function buildShareText(state, game, rec) {
  const code = encodeShareCode(state, game);
  const setNum = (game && game.data && game.data.meta && game.data.meta.set) || 19;
  const lvl = state.level || 8;
  const sys = rec && rec.system;
  const sysTitle = sys && sys.primaryTraits && sys.primaryTraits.length
    ? `${sys.primaryTraits.slice(0, 2).map((t) => t.name).join("·")} ${sys.archetypeLabel || ""}`.trim()
    : `${(state.board || []).length} 弈子`;
  const names = (state.board || []).slice(0, 10).map((e) => {
    const u = game && game.byId && game.byId[e.id];
    const label = u ? (u.display || u.name) : e.id;
    return e.star > 1 ? `${label}${e.star}★` : label;
  }).join(" / ");
  const header = `【云顶沙盘 S${setNum} · ${lvl}级 · ${sysTitle}】${names ? " " + names : ""}`;
  return `${header}\n${code}`;
}

export function extractSandboxToken(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/TFT\d*:[A-Za-z0-9_-]{8,}/);
  if (m) return m[0];
  const hashM = trimmed.match(/[#?&]s=(TFT\d*:[A-Za-z0-9_-]+)/);
  if (hashM) return hashM[1];
  return "";
}

export function extractShareToken(raw) {
  if (!raw || typeof raw !== "string") return "";
  const sandbox = extractSandboxToken(raw);
  if (sandbox) return sandbox;
  const official = extractOfficialTeamCode(raw);
  if (official) return official;
  const hashM = raw.trim().match(/[#?&]s=([A-Za-z0-9_:-]+)/);
  if (hashM) return hashM[1];
  return "";
}

export function decodeShareInput(raw, game) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { error: "请先粘贴沙盘分享码、链接或端游官方小队码", format: null, state: null };
  }

  // 1. Prefer full-fidelity sandbox snapshot code when present
  const sandboxToken = extractSandboxToken(raw);
  if (!sandboxToken) {
    // 2. Auto-detect official Riot TFT Team Planner v2 code (02...TFTSet19)
    const officialCode = extractOfficialTeamCode(raw);
    if (officialCode) {
      return decodeOfficialTeamCode(officialCode, game);
    }
    // Helpful diagnostics for incompatible external formats
    if (/H4sIA[A-Za-z0-9+/=_-]{8,}/.test(raw)) {
      return {
        error: "检测到金铲铲手游阵容码（H4sIA...），暂仅支持端游官方小队码（02...TFTSet19）与沙盘分享码（TFT19:...）",
        format: null,
        state: null
      };
    }
    if (/\b01[0-9a-f]{16,}TFTSet\d+/i.test(raw)) {
      return {
        error: "检测到旧版（01）小队码，S19 请使用客户端新版 02...TFTSet19 官方小队码",
        format: null,
        state: null
      };
    }
    return {
      error: "未识别到有效阵容码（支持沙盘码 TFT19:...、分享链接，或端游官方小队码 02...TFTSet19）",
      format: null,
      state: null
    };
  }

  const token = sandboxToken;
  const colonIdx = token.indexOf(":");
  if (colonIdx < 0) return { error: "分享码格式不正确", format: "sandbox", state: null };
  const b64 = token.slice(colonIdx + 1);

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(b64));
  } catch {
    return { error: "分享码已损坏或被截断，无法解析", format: "sandbox", state: null };
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1 || !Array.isArray(parsed.b)) {
    return { error: "不支持的分享码版本或内容为空", format: "sandbox", state: null };
  }

  const byId = (game && game.byId) || {};
  const itemById = (game && game.itemById) || {};
  const traitById = (game && game.traitById) || {};
  const warnings = [];
  const seenUnits = new Set();
  const board = [];

  for (let i = 0; i < parsed.b.length; i++) {
    const tup = parsed.b[i];
    if (!Array.isArray(tup) || typeof tup[0] !== "string") continue;
    const id = tup[0];
    if (!byId[id]) {
      warnings.push(`跳过未知棋子 ${id}`);
      continue;
    }
    if (seenUnits.has(id)) continue;
    seenUnits.add(id);
    const star = Math.max(1, Math.min(3, Number(tup[1]) || 1));
    const r = Number(tup[2]);
    const c = Number(tup[3]);
    const position = Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < 4 && c >= 0 && c < 7
      ? { row: r, col: c }
      : null;
    const mark = typeof tup[4] === "string" && VALID_MARKS.has(tup[4]) ? tup[4] : "";
    const items = Array.isArray(tup[5])
      ? tup[5].filter((it) => typeof it === "string" && !!itemById[it]).slice(0, 3)
      : [];
    board.push({ id, star, mark, position, items });
  }

  const looseItems = Array.isArray(parsed.i)
    ? parsed.i.filter((it) => typeof it === "string" && !!itemById[it])
    : [];

  const emblems = {};
  if (parsed.e && typeof parsed.e === "object") {
    Object.keys(parsed.e).forEach((tid) => {
      const cnt = Number(parsed.e[tid]) | 0;
      if (traitById[tid] && cnt > 0) emblems[tid] = cnt;
    });
  }

  const prismatic = {};
  if (Array.isArray(parsed.p)) {
    parsed.p.forEach((tid) => {
      if (traitById[tid]) prismatic[tid] = true;
    });
  }

  const traitTargets = {};
  if (parsed.t && typeof parsed.t === "object") {
    Object.keys(parsed.t).forEach((tid) => {
      const need = Number(parsed.t[tid]) || 0;
      if (traitById[tid] && need > 0) traitTargets[tid] = need;
    });
  }

  const bannedIds = {};
  if (Array.isArray(parsed.n)) {
    parsed.n.forEach((uid) => {
      if (byId[uid]) bannedIds[uid] = true;
    });
  }

  const focusId = typeof parsed.f === "string" && seenUnits.has(parsed.f) ? parsed.f : null;
  const unlockTargetId = typeof parsed.u === "string" && byId[parsed.u] && byId[parsed.u].unlock ? parsed.u : null;

  return {
    error: null,
    format: "sandbox",
    warnings,
    state: {
      level: Math.max(1, Math.min(10, Number(parsed.l) || 8)),
      extraSlots: Math.max(0, Math.min(10, Number(parsed.x) | 0)),
      mode: VALID_MODES.has(parsed.m) ? parsed.m : "auto",
      allowLocked: parsed.k !== 0,
      focusId,
      unlockTargetId,
      board,
      looseItems,
      emblems,
      prismatic,
      traitTargets,
      bannedIds,
      targetTraitCount: Math.max(0, Math.min(15, Number(parsed.g) | 0))
    }
  };
}
