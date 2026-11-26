/**
 * Official Riot TFT Team Planner Code (v2) encoder & decoder.
 *
 * Verified Riot v2 format:
 *   "02" + 10 * 3-char lowercase hex champion code (empty slots padded with "000") + "TFTSet19"
 *   Example (40 chars): 023e93ec3ed000000000000000000000TFTSet19
 *
 * Works natively in both CN LoL TFT client (国服端游小队规划器) and global/PBE TFT clients.
 * Static Set 19 map covers all 94 shop units (cross-verified against Riot client manifest);
 * automatically prefers runtime overrides in window.META_COMPS.plannerCodes if synced later.
 */

export const TEAM_PLANNER_VERSION = "02";
export const TEAM_PLANNER_SLOTS = 10;
export const TEAM_PLANNER_HEX_LEN = 3;

// Authoritative Set 19 (棱彩音乐盛典) 94-unit team_planner_code map (12-bit hex)
export const SET19_PLANNER_CODES = Object.freeze({
  DA_Ahri19: "3e9",
  DA_Akali_TrueDamage19: "3ea",
  DA_AkaliKDA19: "3ec",
  DA_Alistar19: "3ed",
  DA_Alune19: "3ee",
  DA_Amumu19: "3ef",
  DA_Annie19: "3f0",
  DA_Aphelios19: "3f1",
  DA_Ashe19: "3f2",
  DA_Aurora19: "3f3",
  DA_Bard19: "3f4",
  DA_BaronNashor19: "3f5",
  DA_Braum19: "3f6",
  DA_Briar19: "3f7",
  DA_Camille19: "3f8",
  DA_Draven19: "3fa",
  DA_DrMundo19: "3fb",
  DA_Ekko19: "3fc",
  DA_Elise19: "3fd",
  DA_Evelynn19: "3fe",
  DA_Ezreal19: "3ff",
  DA_Galio19: "400",
  DA_Garen19: "401",
  DA_Gnar19: "402",
  DA_Gragas19: "403",
  DA_Graves19: "449",
  DA_Gwen19: "404",
  DA_Illaoi19: "405",
  DA_Janna19: "406",
  DA_Jax19: "407",
  DA_Jhin19: "408",
  DA_Jinx19: "409",
  DA_Kaisa19: "40a",
  DA_Karthus19: "40b",
  DA_Katarina19: "40c",
  DA_Kayle19: "40d",
  DA_Kayn19: "40e",
  DA_Kennen19: "40f",
  DA_Kobuko19: "410",
  DA_KSante19: "411",
  DA_LeeSin19: "44f",
  DA_Leona19: "412",
  DA_Lillia19: "413",
  DA_Locke19: "414",
  DA_Lucian19: "415",
  DA_Lulu19: "416",
  DA_Lux19: "417",
  DA_Malzahar19: "418",
  DA_Mel19: "419",
  DA_MissFortune19: "41a",
  DA_Mordekaiser19: "44b",
  DA_Nasus19: "44a",
  DA_Neeko19: "41c",
  DA_Nidalee19: "41d",
  DA_Nunu19: "41e",
  DA_Olaf19: "447",
  DA_Pyke19: "420",
  DA_Qiyana19: "421",
  DA_Rakan19: "448",
  DA_Rell19: "422",
  DA_RenataGlasc19: "423",
  DA_Renekton19: "424",
  DA_Samira19: "425",
  DA_Senna19: "426",
  DA_SeraphineIndie19: "427",
  DA_Sett19: "428",
  DA_Shyvana19: "429",
  DA_Smeech19: "42a",
  DA_Sona19: "42c",
  DA_Swain19: "42d",
  DA_Syndra19: "42e",
  DA_Taliyah19: "42f",
  DA_Taric19: "430",
  DA_Teemo19: "431",
  DA_Thresh19: "432",
  DA_Tibbers19: "433",
  DA_Tristana19: "434",
  DA_TwistedFate19: "435",
  DA_Varus19: "436",
  DA_Vayne19: "437",
  DA_Vi19: "438",
  DA_Viego19: "439",
  DA_Vladimir19: "43a",
  DA_Wukong19: "43b",
  DA_Xayah19: "43c",
  DA_Yasuo19: "43d",
  DA_Yone19: "43e",
  DA_Yorick19: "43f",
  DA_Yunara19: "440",
  DA_Yuumi19: "441",
  DA_Zac19: "442",
  DA_Zeri19: "443",
  DA_Ziggs19: "444",
  DA_Zoe19: "445"
});

const OFFICIAL_CODE_RE = /02([0-9a-f]{30})(TFTSet(\d+)(?:_Act\d+)?)/i;

function normalizeHexCode(raw) {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 0xfff) {
    return raw.toString(16).padStart(TEAM_PLANNER_HEX_LEN, "0");
  }
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase().replace(/^0x/, "");
    if (/^[0-9a-f]{1,3}$/.test(clean)) {
      const val = parseInt(clean, 16);
      if (val > 0 && val <= 0xfff) return val.toString(16).padStart(TEAM_PLANNER_HEX_LEN, "0");
    }
  }
  return "";
}

export function resolvePlannerCodeMaps(game) {
  const setNum = Number((game && game.data && game.data.meta && game.data.meta.set) || 19);
  const byId = (game && game.byId) || {};
  const idToHex = new Map();

  if (setNum === 19) {
    for (const [uid, hex] of Object.entries(SET19_PLANNER_CODES)) {
      if (!Object.keys(byId).length || byId[uid]) idToHex.set(uid, hex);
    }
  }

  // Prefer fresh synced plannerCodes from window.META_COMPS when matching the active set
  const metaComps = typeof globalThis !== "undefined" ? globalThis.META_COMPS : null;
  if (metaComps && Number(metaComps.set) === setNum && metaComps.plannerCodes && typeof metaComps.plannerCodes === "object") {
    for (const [uid, raw] of Object.entries(metaComps.plannerCodes)) {
      const hex = normalizeHexCode(raw);
      if (hex && (!Object.keys(byId).length || byId[uid])) idToHex.set(uid, hex);
    }
  }

  // Also honor explicit per-unit teamPlannerCode on custom imported sets
  const units = (game && game.data && Array.isArray(game.data.units)) ? game.data.units : [];
  for (const u of units) {
    const hex = normalizeHexCode(u && (u.teamPlannerCode ?? u.team_planner_code));
    if (hex) idToHex.set(u.id, hex);
  }

  const hexToId = new Map();
  for (const [uid, hex] of idToHex.entries()) {
    hexToId.set(hex, uid);
  }
  return { setNum, idToHex, hexToId };
}

export function extractOfficialTeamCode(raw) {
  if (!raw || typeof raw !== "string") return "";
  const m = raw.match(OFFICIAL_CODE_RE);
  return m ? m[0] : "";
}

function priorityScore(entry, game) {
  const u = (game && game.byId && game.byId[entry.id]) || {};
  let score = (Number(u.cost) || 1) * 10 + (Number(entry.star) || 1) * 4;
  if (entry.mark === "carry") score += 100;
  else if (entry.mark === "tank") score += 80;
  else if (entry.mark === "carry2") score += 60;
  if (Array.isArray(entry.items)) score += entry.items.length * 18;
  return score;
}

export function encodeOfficialTeamCode(boardOrUnits, game) {
  const { setNum, idToHex } = resolvePlannerCodeMaps(game);
  const list = Array.isArray(boardOrUnits) ? boardOrUnits : [];
  const seen = new Set();
  const eligible = [];
  const skipped = [];

  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const entry = typeof raw === "string" ? { id: raw, star: 1, mark: "", items: [] } : raw;
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const hex = idToHex.get(entry.id);
    if (!hex) {
      skipped.push(entry.id);
      continue;
    }
    eligible.push({ entry, hex, idx: i });
  }

  if (!eligible.length) {
    return {
      code: "",
      count: 0,
      truncated: 0,
      skipped,
      error: list.length ? "当前阵容中的弈子缺少官方小队码映射" : "当前棋盘为空，请先摆上弈子"
    };
  }

  let selected = eligible;
  let truncated = 0;
  if (eligible.length > TEAM_PLANNER_SLOTS) {
    truncated = eligible.length - TEAM_PLANNER_SLOTS;
    selected = eligible
      .slice()
      .sort((a, b) => priorityScore(b.entry, game) - priorityScore(a.entry, game) || a.idx - b.idx)
      .slice(0, TEAM_PLANNER_SLOTS)
      .sort((a, b) => a.idx - b.idx);
  }

  const slots = selected.map((x) => x.hex);
  while (slots.length < TEAM_PLANNER_SLOTS) slots.push("000");

  return {
    code: `${TEAM_PLANNER_VERSION}${slots.join("")}TFTSet${setNum}`,
    count: selected.length,
    truncated,
    skipped,
    error: null
  };
}

export function decodeOfficialTeamCode(raw, game) {
  if (!raw || typeof raw !== "string") {
    return { error: "未识别到有效的官方小队规划器代码", format: "official", state: null };
  }
  const m = raw.match(OFFICIAL_CODE_RE);
  if (!m) {
    return { error: "未识别到有效的官方小队规划器代码（应为 02...TFTSet19 格式）", format: "official", state: null };
  }

  const hexBody = m[1].toLowerCase();
  const setSuffix = m[2];
  const codeSetNum = Number(m[3]);
  const { setNum, hexToId } = resolvePlannerCodeMaps(game);

  if (Number.isFinite(codeSetNum) && codeSetNum !== setNum) {
    return {
      error: `该官方小队码属于 S${codeSetNum}（${setSuffix}），与当前 S${setNum} 赛季不匹配`,
      format: "official",
      state: null
    };
  }

  const byId = (game && game.byId) || {};
  const warnings = [];
  const seen = new Set();
  const board = [];

  for (let i = 0; i < TEAM_PLANNER_SLOTS; i++) {
    const slotHex = hexBody.slice(i * TEAM_PLANNER_HEX_LEN, (i + 1) * TEAM_PLANNER_HEX_LEN);
    if (slotHex === "000") continue;
    const uid = hexToId.get(slotHex);
    if (!uid || (Object.keys(byId).length && !byId[uid])) {
      warnings.push(`跳过未收录棋子码 ${slotHex}`);
      continue;
    }
    if (seen.has(uid)) continue;
    seen.add(uid);
    board.push({ id: uid, star: 1, mark: "", position: null, items: [] });
  }

  if (!board.length) {
    return {
      error: "官方小队码中未包含可识别的当前赛季棋子",
      format: "official",
      state: null
    };
  }

  const slotsNeeded = game && typeof game.slotsOf === "function"
    ? game.slotsOf(board)
    : board.length;
  const level = Math.max(8, Math.min(10, slotsNeeded));
  const extraSlots = Math.max(0, slotsNeeded - 10);

  return {
    error: null,
    format: "official",
    warnings,
    state: {
      level,
      extraSlots,
      mode: "auto",
      allowLocked: true,
      focusId: null,
      unlockTargetId: null,
      board,
      looseItems: [],
      emblems: {},
      prismatic: {},
      traitTargets: {},
      bannedIds: {},
      targetTraitCount: 0
    }
  };
}
