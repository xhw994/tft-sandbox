#!/usr/bin/env node
/**
 * Independent Season Mechanics & Reference Tables Sync script (Set 19: 棱彩音乐盛典).
 * Keeps seasonal data cleanly decoupled from core engine.js / assess.js:
 *   1. Fetches all 40 official Set 19 Collab (合奏) groups + live match stats from MetaTFT
 *      (prefers live TFTSet19 when launched, falls back to ?queue=pbe while on PBE).
 *   2. Fetches official zh_cn Opening Encounters + probabilities from iesdev (with offline fallback).
 *   3. Bundles localized Patch 19.1e trait reward & reference tables (True Damage / Hyperpop /
 *      8-Bit / Ionic Spark / Gu Feng / Illbeats / Heartsteel / Collab Orbs / Shop Odds & Pool).
 * Writes offline-friendly static season_data.js (window.SEASON_DATA).
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
  return { data: sandbox.SET19, game: sandbox.TFT.create(sandbox.SET19) };
}

async function fetchJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "TFT-Sandbox-SeasonSync/1.0" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCollabFeed(targetSet) {
  const candidates = [
    { queue: "live", url: "https://api-hc.metatft.com/tft-stat-api/collab" },
    { queue: "pbe", url: "https://api-hc.metatft.com/tft-stat-api/collab?queue=pbe" }
  ];
  for (const c of candidates) {
    try {
      const json = await fetchJson(c.url);
      const setCode = json?.tft_set || "";
      if (setCode === targetSet && Array.isArray(json.groups) && json.groups.length >= 20) {
        return { queue: c.queue, json };
      }
    } catch (err) {
      console.warn(`[sync-season] collab ${c.queue} check failed:`, err.message);
    }
  }
  throw new Error(`No MetaTFT Collab feed serving ${targetSet}`);
}

async function fetchEncounters() {
  try {
    const rows = await fetchJson("https://utils.iesdev.com/static/json/tftTest/set19/zh_cn/encounters");
    if (Array.isArray(rows) && rows.length >= 10) {
      return rows
        .map((r) => ({
          id: r.apiName || "",
          name: String(r.name || "").trim(),
          chance: Math.round((Number(r.chance) || 0) * 1000) / 10,
          desc: String(r.description || "")
            .replace(/<TFTCurveTable[^/]*\/>/gi, "特定")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim()
        }))
        .sort((a, b) => b.chance - a.chance || a.name.localeCompare(b.name, "zh-CN"));
    }
  } catch (err) {
    console.warn("[sync-season] encounters fetch failed, keeping fallback:", err.message);
  }
  return [];
}

function buildLocalizedTables(encounters) {
  return {
    patch: "19.1e",
    trueDamage: {
      summary: "备战阶段可随时切换唱片【A面 / B面】。每过 4 个玩家回合，可选择将【珠光贵气】兑换为战利品，或继续打榜冲刺更高档位。",
      sides: [
        {
          side: "A面 · 连胜打榜",
          accent: "good",
          rule: "真实伤害弈子造成额外真实伤害；击杀与获胜均可赚取珠光贵气（输掉不会扣层数，最稳妥）。",
          tiers: [
            "(3) +18% 真实伤害；击杀 +2 / 胜场 +15 珠光贵气",
            "(5) +30% 真实伤害；击杀 +4 / 胜场 +20 珠光贵气",
            "(棱彩 · KNOW MY NAME) +99% 真实伤害，珠光贵气获取翻倍"
          ]
        },
        {
          side: "B面 · 连败收菜",
          accent: "warn",
          rule: "输掉玩家对战固定 +20 珠光贵气，每次连败额外 +4（24/28/32/36…）；注意：B面意外获胜会扣除 20% 珠光贵气！",
          tiers: [
            "(3) 连败高额叠加珠光贵气",
            "(5) 每回合战后回复 2 点小小英雄生命值并获得 +2 经验",
            "(棱彩 · GIANTS) +99% 真实伤害，击杀掉落金币"
          ]
        }
      ],
      cashouts: [
        {
          bling: 0,
          value: "约 1 金",
          tier: "基础",
          drops: [
            { pct: "50%", reward: "装备拆卸器 ×1" },
            { pct: "50%", reward: "装备重铸器 ×1" }
          ]
        },
        {
          bling: 30,
          value: "约 2 金",
          tier: "铜",
          drops: [
            { pct: "33%", reward: "金币 ×2" },
            { pct: "33%", reward: "随机 2 费弈子 ×1" },
            { pct: "33%", reward: "奇亚娜 ×1" }
          ]
        },
        {
          bling: 60,
          value: "约 5 金",
          tier: "铜",
          drops: [
            { pct: "33%", reward: "随机 2 费 + 随机 3 费弈子" },
            { pct: "33%", reward: "金币 ×5" },
            { pct: "33%", reward: "次级英雄复制器 ×1" }
          ]
        },
        {
          bling: 100,
          value: "约 8 金",
          tier: "银",
          drops: [
            { pct: "25%", reward: "基础散件 ×1" },
            { pct: "25%", reward: "金币 ×9" },
            { pct: "25%", reward: "随机 3 费弈子 ×3" },
            { pct: "25%", reward: "金币 ×3 + 3 费真实伤害弈子 ×2" }
          ]
        },
        {
          bling: 150,
          value: "约 12 金",
          tier: "银",
          drops: [
            { pct: "25%", reward: "金币 ×6 + 随机 3 费弈子 ×2" },
            { pct: "25%", reward: "金币 ×5 + 次级英雄复制器 ×1" },
            { pct: "25%", reward: "基础散件 ×1 + 金币 ×4" },
            { pct: "25%", reward: "奇亚娜 + 艾克 + 随机散件 ×1" }
          ]
        },
        {
          bling: 225,
          value: "约 18 金",
          tier: "金",
          drops: [
            { pct: "25%", reward: "随机纹章 ×1 + 金币 ×2" },
            { pct: "25%", reward: "基础散件 ×1 + 随机 4 费弈子 + 金币 ×4" },
            { pct: "25%", reward: "随机散件 ×2" },
            { pct: "25%", reward: "随机散件 ×1 + 金币 ×12" }
          ]
        },
        {
          bling: 300,
          value: "约 26 金",
          tier: "金",
          drops: [
            { pct: "25%", reward: "不重复散件 ×2 + 金币 ×10" },
            { pct: "25%", reward: "随机 4 费弈子 ×2 + 散件 ×1 + 金币 ×1" },
            { pct: "25%", reward: "随机成装 ×1 + 金币 ×10 + 重铸器 ×1" },
            { pct: "25%", reward: "真实伤害纹章 ×1 + 散件 ×1 + 金币 ×2" }
          ]
        },
        {
          bling: 400,
          value: "约 40 金",
          tier: "金",
          drops: [
            { pct: "20%", reward: "不重复散件 ×4 + 金币 ×8" },
            { pct: "20%", reward: "随机 4 费 ×2 + 幸运装备宝箱 + 随机成装" },
            { pct: "20%", reward: "金铲铲 + 金锅锅 + 金币 ×15" },
            { pct: "20%", reward: "真实伤害纹章 + 不重复散件 ×2 + 不重复 5 费 ×2" },
            { pct: "20%", reward: "神器锻造器 + 随机成装 + 金币 ×4" }
          ]
        },
        {
          bling: 500,
          value: "约 65 金",
          tier: "彩",
          drops: [
            { pct: "25%", reward: "金币 ×45 + 光明幸运装备宝箱 ×1" },
            { pct: "25%", reward: "金铲铲冠冕 + 金币 ×10 + 光明幸运装备宝箱" },
            { pct: "25%", reward: "随机 5 费 ×2 + 光明幸运宝箱 + 光明装 ×1 + 重铸器" },
            { pct: "25%", reward: "成装锻造器 ×2 + 金币 ×8 + 光明幸运装备宝箱" }
          ]
        },
        {
          bling: 600,
          value: "约 100 金",
          tier: "彩",
          drops: [
            { pct: "25%", reward: "金铲铲冠冕 + 金币 ×25 + 幸运宝箱 + 光明幸运宝箱 + 拆卸器" },
            { pct: "25%", reward: "随机 2 星 5 费 + 金币 ×10 + 光明幸运宝箱 + 成装 ×3 + 拆卸器" },
            { pct: "25%", reward: "亚索 + 永恩 + 光明血手 + 正义 + 水银 + 金币 ×20 + 拆卸器 ×2" },
            { pct: "25%", reward: "阿卡丽 + 光明无尽 + 成装锻造器 ×2 + 金币 ×30 + 拆卸器" }
          ]
        },
        {
          bling: 800,
          value: "约 200 金",
          tier: "彩",
          drops: [
            { pct: "33%", reward: "努努 + 连指手套 + 飞升护符 + 冠冕 ×2 + 光明幸运宝箱 ×2 + 金币 ×50" },
            { pct: "33%", reward: "不重复光明装 ×5 + 黄金拆卸器 + 拆卸器 ×5 + 金币 ×30 + 2 星 5 费" },
            { pct: "33%", reward: "蔚 + 阿卡丽 + 光明无尽/正义/夜刃 + 冠冕 + 金币 ×45" }
          ]
        },
        {
          bling: 1000,
          value: "约 500 金",
          tier: "彩",
          drops: [
            { pct: "50%", reward: "金币 ×100 + 英雄复制器 ×8 + 光明装 ×3 + 战术冠冕/披风/盾牌 ×1" },
            { pct: "50%", reward: "随机 3 星 5 费弈子 + 战术冠冕系 ×1 + 光明蓝霸符" }
          ]
        }
      ]
    },

    hyperpop: {
      summary: "每个独特【高能流行】弈子按星级提供基础热度，每次参与击杀额外 +1 热度，最后乘以羁绊倍率；达到每一档即自动领奖。",
      formulaRows: [
        { star: "1★ 弈子", t2: 3, t3: 4, t4: 7, t5: 9 },
        { star: "2★ 弈子", t2: 6, t3: 9, t4: 15, t5: 18 },
        { star: "3★ 弈子", t2: 12, t3: 18, t4: 30, t5: 36 },
        { star: "4★ 弈子", t2: 40, t3: 60, t4: 100, t5: 120 }
      ],
      multipliers: [
        "(2) 100 生命 · 10% 攻速 · ×1.0 热度",
        "(3) 150 生命 · 15% 攻速 · ×1.5 热度",
        "(4) 200 生命 · 20% 攻速 · ×2.5 热度",
        "(5) 350 生命 · 33% 攻速 · ×3.0 热度"
      ],
      milestones: [
        { hype: 5, reward: "金币 ×1", tier: "基础" },
        { hype: 15, reward: "微型英雄复制器 ×1（仅限低费）", tier: "基础" },
        { hype: 50, reward: "金币 ×2", tier: "基础" },
        { hype: 100, reward: "金币 ×3", tier: "铜" },
        { hype: 200, reward: "微型英雄复制器 ×1 + 金币 ×1", tier: "铜" },
        { hype: 350, reward: "12.5% 等概率：伊莉丝 / 瑟提 / 佐伊 / 芸阿娜 / 雷克顿×2 / 俄洛伊×2 / 卢锡安×2 / 卡尔萨斯×2", tier: "铜" },
        { hype: 450, reward: "金币 ×2 + 装备拆卸器 ×2", tier: "银" },
        { hype: 600, reward: "次级英雄复制器 ×1", tier: "银" },
        { hype: 750, reward: "不重复基础散件 ×1", tier: "银" },
        { hype: 900, reward: "金币 ×9", tier: "银" },
        { hype: 1050, reward: "20% 等概率 4 费：阿狸 / 盖伦 / 霞 / 洛克 / 希瓦娜", tier: "金" },
        { hype: 1300, reward: "金币 ×3 + 基础装备锻造器 ×1", tier: "金" },
        { hype: 1600, reward: "上述指定 4 费 ×1 + 随机 5 费 ×1", tier: "金" },
        { hype: 2050, reward: "复制一件同款散件", tier: "金" },
        { hype: 2400, reward: "20% 等概率职业纹章：法师 / 编舞师 / 主唱 / 制作人 / 迅击鼓手", tier: "金" },
        { hype: 2650, reward: "随机 5 费弈子 ×2", tier: "彩" },
        { hype: 2900, reward: "神器锻造器 ×1", tier: "彩" },
        { hype: 3300, reward: "金币 ×50", tier: "彩" },
        { hype: 3750, reward: "【高能流行光明终章】（全员装备升级光明）+ 金币 ×80 + 冠冕 ×2", tier: "彩" }
      ]
    },

    eightBit: {
      summary: "厄运小姐在场时，全队在玩家对战造成的总伤害计入高分榜，其中【厄运小姐】自身伤害按 ×3 倍计入；每破一档即领奖。",
      milestones: [
        { score: "50,000", reward: "金币 ×4", tier: "铜" },
        { score: "80,000", reward: "次级英雄复制器 ×1 + 金币 ×4", tier: "铜" },
        { score: "125,000", reward: "随机 5 费弈子 ×1 + 随机 4 费弈子 ×1", tier: "银" },
        { score: "175,000", reward: "窃贼手套 ×1", tier: "银" },
        { score: "275,000", reward: "不重复成装 ×1 + 装备重铸器 ×2", tier: "金" },
        { score: "500,000", reward: "神器锻造器 ×1", tier: "金" },
        { score: "700,000", reward: "光明朔极之矛 + 光明无尽 + 光明锐利之刃 + 黄金拆卸器", tier: "彩" },
        { score: "1,000,000", reward: "英雄复制器 ×9（直接三星五费！）", tier: "彩" }
      ]
    },

    otherTraits: {
      ionicSpark: {
        title: "离子火花 · 粉丝应援与 7 离子礼物",
        summary: "(3) +100生命，每4秒粉丝信回血2%+7%攻速；(5) +225生命，个性化礼物+22%双攻/属性；(7) +400生命，每 2 场玩家对战送 5 金币 + 1 个永久应援符咒（4 选 1 等概率）：",
        charms: [
          { name: "活力符咒", pct: "25%", effect: "+12% 攻击速度" },
          { name: "热情符咒", pct: "25%", effect: "+15% 法术强度" },
          { name: "欢乐符咒", pct: "25%", effect: "+15% 最大生命值" },
          { name: "无畏符咒", pct: "25%", effect: "+15% 攻击力" }
        ]
      },
      guFeng: {
        title: "国风 · 随等级缩放 & 4 国风双卷轴（11 级解锁）",
        summary: "(2) 每级 +2% 双攻与 +2 双抗（10级为 20%/20，11级 22%/22）；(3) 每级再 +2% 属性；(4) 二选一专属卷轴：",
        scrolls: [
          { name: "天祈卷轴（稳健）", effect: "装备后每场战斗随机变为 1 件推荐成装。" },
          { name: "巨兽卷轴（高风险冲 11 级）", effect: "拿取当回合立即获得【20% 当前生命值】等额经验；此后每胜 +4 经验；10 级赢 5 场解锁 11 级！代价：一旦遭遇 2 连败直接淘汰出局（输→赢→输安全）。" }
        ]
      },
      illbeats: {
        title: "大触打击乐 · 分贝混音器数值与击杀掉钱",
        summary: "(2) 10 分贝 / (3) 15 分贝 / (4) 18 分贝且混音效果增强 65%。非大触友军享 50% 效果。未分配分贝开战时按【生命→攻击→法强→掉钱】顺序自动拉满至 10。",
        dbRows: [
          { db: 1, hp: "1.8% / 2.97%", ad: "3.5% / 5.78%", ap: "3.2% / 5.28%", goldPct: "2% / 3.3%" },
          { db: 3, hp: "5.2% / 8.58%", ad: "10.2% / 16.83%", ap: "9.4% / 15.51%", goldPct: "6% / 9.9%" },
          { db: 5, hp: "8.4% / 13.86%", ad: "16.2% / 26.73%", ap: "14.9% / 24.59%", goldPct: "9.5% / 15.68%" },
          { db: 7, hp: "11.6% / 19.14%", ad: "21.5% / 35.48%", ap: "19.7% / 32.51%", goldPct: "12.5% / 20.63%" },
          { db: 10, hp: "16% / 26.4%", ad: "28% / 46.2%", ap: "26% / 42.9%", goldPct: "16% / 26.4%" }
        ],
        goldByStage: [
          { stage: "1–3 阶段", gold: "1 金" },
          { stage: "4–5 阶段", gold: "2 金" },
          { stage: "6 阶段", gold: "3 金" },
          { stage: "7 阶段", gold: "4 金" },
          { stage: "8–9 阶段", gold: "6 金" }
        ]
      },
      heartsteel: {
        title: "心之钢 · 成员全队光环增益速查",
        summary: "(1) 成员上场即提供全队光环；(3) 选 1 个【本命】强化技能；(5) 选第 2 个【本命】；(7) 心之钢成员额外享 120% 已激活加成。",
        members: [
          { who: "瑟提", bonus: "+75 生命值" },
          { who: "凯隐", bonus: "+7% 攻击力" },
          { who: "伊泽瑞尔", bonus: "+10% 暴击率" },
          { who: "奎桑提", bonus: "+8 护甲与魔抗" },
          { who: "拉露恩", bonus: "+7% 法术强度" },
          { who: "永恩", bonus: "+5% 全能吸血" },
          { who: "厄斐琉斯", bonus: "+6% 攻击速度" },
          { who: "心之钢纹章", bonus: "+3% 伤害减免" },
          { who: "娑娜（切心之钢）", bonus: "+5% 治疗与护盾" }
        ]
      },
      collabLoot: {
        title: "合奏 · 每 7 次灵感法球掉落概率（按阶段）",
        summary: "合奏弈子造成或受到 8 次伤害触发灵感（单局每人限 1 次，总计数跨回合保留）；(3) +12% 双攻 / (5) +22% 双攻。每累计 7 次灵感，下回合掉落合奏弈子法球：",
        stages: [
          { stage: "2 阶段", avgVal: "1.92 金", drops: "1费×1 (18%) · 1费×2 (40%) · 2费×1 (32%) · 3费×1 (10%)" },
          { stage: "3 阶段", avgVal: "2.76 金", drops: "1费×2 (10%) · 2费×1 (15%) · 2费+1费 (30%) · 3费×1 (44%) · 4费×1 (1%)" },
          { stage: "4 阶段", avgVal: "3.20 金", drops: "2费+1费 (28%) · 3费×1 (53%) · 2费×2 (10%) · 3费+1费 (4%) · 4费×1 (4%) · 5费×1 (1%)" },
          { stage: "5 阶段+", avgVal: "4.11 金", drops: "2费×2 (29%) · 3费+1费 (35%) · 4费×1 (25%) · 3费+2费 (5%) · 4费+1费 (4%) · 5费×1 (2%)" }
        ]
      }
    },

    encounters,

    economy: {
      shopOdds: [
        { lvl: 1, c1: 100, c2: 0, c3: 0, c4: 0, c5: 0 },
        { lvl: 2, c1: 100, c2: 0, c3: 0, c4: 0, c5: 0 },
        { lvl: 3, c1: 75, c2: 25, c3: 0, c4: 0, c5: 0 },
        { lvl: 4, c1: 55, c2: 30, c3: 15, c4: 0, c5: 0 },
        { lvl: 5, c1: 45, c2: 33, c3: 20, c4: 2, c5: 0 },
        { lvl: 6, c1: 30, c2: 40, c3: 25, c4: 5, c5: 0 },
        { lvl: 7, c1: 16, c2: 30, c3: 43, c4: 10, c5: 1 },
        { lvl: 8, c1: 15, c2: 20, c3: 32, c4: 30, c5: 3 },
        { lvl: 9, c1: 10, c2: 17, c3: 25, c4: 33, c5: 15 },
        { lvl: 10, c1: 5, c2: 10, c3: 20, c4: 40, c5: 25 },
        { lvl: 11, c1: 1, c2: 2, c3: 12, c4: 50, c5: 35, note: "4 国风巨兽卷轴" }
      ],
      poolSizes: [
        { cost: 1, copies: 30, unique: 15, total: 450 },
        { cost: 2, copies: 25, unique: 18, total: 450 },
        { cost: 3, copies: 18, unique: 16, total: 288 },
        { cost: 4, copies: 10, unique: 22, total: 220 },
        { cost: 5, copies: 9, unique: 19, total: 171 },
        { cost: 7, copies: 9, unique: 4, total: 36, note: "解锁专属（不进常规商店概率）" }
      ],
      levelXp: [
        { from: "1 → 2", xp: 2 },
        { from: "2 → 3", xp: 2 },
        { from: "3 → 4", xp: 6 },
        { from: "4 → 5", xp: 10 },
        { from: "5 → 6", xp: 20 },
        { from: "6 → 7", xp: 36 },
        { from: "7 → 8", xp: 60 },
        { from: "8 → 9", xp: 68 },
        { from: "9 → 10", xp: 68 }
      ]
    }
  };
}

async function main() {
  const { data, game } = loadGame();
  const targetSet = `TFTSet${data.meta?.set || 19}`;

  const localByLower = new Map(data.units.map((u) => [u.id.toLowerCase(), u.id]));
  const aliases = {
    da_19_ahri: "DA_Ahri19",
    da_seraphine19_indie: "DA_SeraphineIndie19",
    da_akali19_kda: "DA_AkaliKDA19",
    da_akali19_truedamage: "DA_Akali_TrueDamage19"
  };
  const normUnit = (raw) => {
    const k = String(raw || "").trim().toLowerCase();
    return localByLower.get(k) || aliases[k] || null;
  };

  console.log(`[sync-season] Fetching MetaTFT ${targetSet} Collab groups & zh_cn encounters...`);
  const [collabFeed, encounters] = await Promise.all([
    fetchCollabFeed(targetSet),
    fetchEncounters()
  ]);

  const rawGroups = collabFeed.json.groups || [];
  const groups = [];
  for (let i = 0; i < rawGroups.length; i++) {
    const g = rawGroups[i];
    const units = (g.units || [])
      .map(normUnit)
      .filter((id, idx, arr) => id && arr.indexOf(id) === idx)
      .sort((a, b) => (game.byId[a].cost - game.byId[b].cost) || a.localeCompare(b));
    if (units.length < 4) continue;

    // Compute natural shared traits (count >= 2) within this Collab group
    const tCount = new Map();
    for (const uid of units) {
      for (const tid of game.byId[uid].traits || []) {
        const t = game.traitById[tid];
        if (!t || t.kind === "solo" || tid === "DA_Collab19") continue;
        tCount.set(tid, (tCount.get(tid) || 0) + 1);
      }
    }
    const sharedTraits = [...tCount.entries()]
      .filter(([, cnt]) => cnt >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, count]) => ({ id, name: game.traitById[id].name, count }));

    const bp3Raw = (g.breakpoints || []).find((b) => b.min_units === 3) || null;
    const bp5Raw = (g.breakpoints || []).find((b) => b.min_units === 5) || null;
    const fmtBp = (b) => {
      if (!b || !b.count) return null;
      return {
        avg: Math.round((Number(b.avg) || 0) * 100) / 100,
        top4: Math.round(((Number(b.top_4s) || 0) / b.count) * 1000) / 10,
        win: Math.round(((Number(b.wins) || 0) / b.count) * 1000) / 10,
        count: b.count
      };
    };

    groups.push({
      id: `C${String(i + 1).padStart(2, "0")}`,
      key: g.collab_group || "",
      units,
      sharedTraits,
      games: g.count || 0,
      activeAvg: g.active && g.active.avg ? Math.round(g.active.avg * 100) / 100 : null,
      activeGames: g.active && g.active.count ? g.active.count : 0,
      bp3: fmtBp(bp3Raw),
      bp5: fmtBp(bp5Raw)
    });
  }

  // Sort deterministically by activeAvg asc so IDs / default order highlight strongest groups first
  groups.sort((a, b) => (a.activeAvg ?? 9) - (b.activeAvg ?? 9) || a.key.localeCompare(b.key));
  groups.forEach((g, idx) => { g.id = `C${String(idx + 1).padStart(2, "0")}`; });

  const outObj = {
    schemaVersion: 1,
    set: data.meta?.set || 19,
    updatedAt: new Date().toISOString().slice(0, 10),
    collab: {
      source: `MetaTFT (${collabFeed.queue.toUpperCase()})`,
      constantUnit: "DA_Sona19",
      groupCount: groups.length,
      groups
    },
    tables: buildLocalizedTables(encounters)
  };

  const jsContent =
    "// Auto-generated by scripts/sync-season-data.mjs (Set 19 Collab sets & reference tables).\n" +
    "// Decoupled from core engine.js; safe for offline file:// and static hosting.\n" +
    "window.SEASON_DATA = " + JSON.stringify(outObj, null, 2) + ";\n";

  fs.writeFileSync(path.join(root, "season_data.js"), jsContent, "utf8");
  console.log(`[sync-season] Wrote ${groups.length} Collab groups (${collabFeed.queue.toUpperCase()}) + ${encounters.length} zh_cn encounters + Set 19 reward tables to season_data.js`);
}

main().catch((err) => {
  console.error("[sync-season] FAILED:", err);
  process.exit(1);
});
