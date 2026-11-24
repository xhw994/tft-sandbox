# -*- coding: utf-8 -*-
"""Download TFT Set 19 (棱彩音乐盛典) zh_cn static data and write data/set19.json + data.js."""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UNIT_ICON_DIR = ROOT / "icons" / "units"
TRAIT_ICON_DIR = ROOT / "icons" / "traits"
ITEM_ICON_DIR = ROOT / "icons" / "items"
DDRAGON_ITEMS = "https://ddragon.leagueoflegends.com/cdn/16.23.1/data/zh_CN/tft-item.json"
DDRAGON_IMG = "https://ddragon.leagueoflegends.com/cdn/16.23.1/img"
BLITZ_ITEMS = "https://blitz-cdn.blitz.gg/blitz/tft/items/set19"
WEARABLE_KINDS = ("basic", "normal", "radiant", "artifact", "support", "emblem", "spatula")
ITEM_KIND_ORDER = [*WEARABLE_KINDS, "misc"]
BASE = "https://utils.iesdev.com/static/json/tftTest/set19"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

TOKENS = [
    ("%i:scaleCritMult%", "暴击伤害"),
    ("%i:scaleCrit%", "暴击"),
    ("%i:TFTManaRegen%", "回蓝"),
    ("%i:scaleArmor%", "护甲"),
    ("%i:scaleHealth%", "生命"),
    ("%i:scaleMana%", "法力"),
    ("%i:scaleAD%", "攻击"),
    ("%i:scaleAP%", "法强"),
    ("%i:scaleAS%", "攻速"),
    ("%i:scaleDA%", "增伤"),
    ("%i:scaleDR%", "减伤"),
    ("%i:scaleMR%", "魔抗"),
    ("%i:scaleSV%", "全能吸血"),
]

# Baron is the only Set 19 unit that occupies two board slots.
TWO_SLOT = {"DA_BaronNashor19"}

# The two Akalis cannot be unlocked in the same game.
EXCLUSIVE = [["DA_AkaliKDA19", "DA_Akali_TrueDamage19"]]

# Long-standing 1–5 cost shop table. Level 7 five-cost is 1%.
# Costs at or above minRoll percent are the only ones recommendations may add.
# Seven-cost units are not in this shop.
SHOP_ODDS = {
    "minRoll": 5,
    "note": "1到5费商店概率，单位是百分比。7级5费为1%。低于 minRoll 不推荐。7费不在普通商店。",
    "byLevel": {
        "1": {"1": 100, "2": 0, "3": 0, "4": 0, "5": 0},
        "2": {"1": 100, "2": 0, "3": 0, "4": 0, "5": 0},
        "3": {"1": 75, "2": 25, "3": 0, "4": 0, "5": 0},
        "4": {"1": 55, "2": 30, "3": 15, "4": 0, "5": 0},
        "5": {"1": 45, "2": 33, "3": 20, "4": 2, "5": 0},
        "6": {"1": 30, "2": 40, "3": 25, "4": 5, "5": 0},
        "7": {"1": 19, "2": 30, "3": 35, "4": 15, "5": 1},
        "8": {"1": 18, "2": 25, "3": 32, "4": 22, "5": 3},
        "9": {"1": 10, "2": 15, "3": 25, "4": 30, "5": 20},
        "10": {"1": 5, "2": 10, "3": 20, "4": 40, "5": 25},
    },
}

GRANT_UNIT = re.compile(r"提供一名随机弈子|提供一个随机弈子|获得一名随机弈子|每回合获得一次刷新|免费刷新")

# PBE zh_cn still ships these tooltips in English. Numbers are copied from that text.
ABILITY_ZH = {
    "DA_Kayn19": "冲刺并横扫，对一条2格直线上的敌人造成攻击法强130/200/315物理伤害。\n\n心之钢升级：生命值降至70%时化为暗影刺客，短暂无法被选取，并在本场战斗剩余时间内造成35%额外魔法伤害。",
    "DA_Sett19": "被动：从所有来源获得的最大生命值提高30%。\n\n主动：治疗法强生命228/238/248。对目标打击两次，每次造成生命49物理伤害。\n\n心之钢升级：每4秒治疗4%最大生命值，并按已损失生命值最多提高到100%。",
    "DA_Ezreal19": "发射一枚标记目标的飞弹，再发射第二发火光引爆。爆炸对目标造成攻击法强240/360/545物理伤害，并对1格内的敌人造成攻击法强79.2/118.8/179.85物理伤害。\n\n心之钢升级：引爆伤害提高25%。每第3次施放改为命中2格半径内的敌人。",
    "DA_Gragas19": "狂欢5秒，每秒回复生命法强75/80/87生命值，并且攻击造成生命法强117/137/157额外魔法伤害。\n\n每有一个3星K/DA队友，两项效果提高15%。",
    "DA_RenataGlasc19": "向目标发射一段旋律，施加2层毒素。毒素在15秒内造成法强160/240/580魔法伤害。另外对附近2名敌人各施加1层毒素，优先未中毒的敌人。\n\n施加毒素时使敌人沉醉3秒；若其星级低于烈娜塔，则延长到9秒。\n\n沉醉的敌人会为古典乐弈子提供加成。",
    "DA_Jax19": "猛击当前目标，造成法强200/300/480魔法伤害，并治疗造成伤害的20%。在本场战斗剩余时间内获得15%攻击速度。\n\n电子舞曲升级：向最近的2名敌人发射光束，造成法强50/75/115魔法伤害，每穿过一名敌人伤害都会降低（降低幅度数据缺失）。",
    "DA_KSante19": "获得法强550/650/800护盾，持续4秒。冲锋并推开目标，将目标和沿途敌人击晕1.25秒，然后摔击，造成攻击150/225/360物理伤害。冲锋后嘲讽附近敌人。\n\n心之钢升级：获得护甲和魔抗（原文写成2525，疑似25与25粘连），攻击造成护甲魔抗50/75/120额外物理伤害。",
    "DA_Alune19": "对目标降下聚光灯，造成法强315/475/2250魔法伤害。其2格内的所有敌人分摊法强340/510/2500魔法伤害。如果目标死亡，溢出伤害分摊给最近的2名敌人。\n\n心之钢升级：向目标发射5道冲击，每道造成法强30/45/72魔法伤害。",
    "DA_Yone19": "被动：这个技能按攻击力和法术强度中较高的一项缩放。攻击造成攻击55/82/123物理伤害。\n\n主动：对目标和最多2名附近敌人快速打击10次，每次造成攻击35/55/400物理伤害。连击结束后发出一记大斩击，对目标造成攻击175/265/1500物理伤害。\n\n心之钢升级：额外打击2次，并无视25%护甲。",
    "DA_Yorick19": "演奏一段独奏，回复生命法强544/629/2104生命值，并制造一个2格区域，每秒对其中的敌人造成法强25/40/1250魔法伤害。最后一个音符对区域内的敌人造成法强100/150/2400伤害，并使其减速20%，持续4秒。\n\n减速：降低攻击速度。",
    "DA_Jinx19": "按攻速向附近敌人连续发射飞弹（发射次数没有写进数据），每发造成攻击法强49/74/330物理伤害。",
    "DA_Aphelios19": "被动：每4次攻击获得1个环刃，最多15个。每装备1个环刃，攻击造成攻击7/10/200额外物理伤害。集满15个后，获得30%攻击力并获得无限距离。\n\n主动：向最近的3名敌人发射箭矢，造成攻击法强340/510/3300物理伤害，然后分裂成16支，对穿过的敌人造成攻击法强51/76.5/3300物理伤害。获得75%攻击速度，持续4秒。\n\n心之钢升级：战斗开始时已装备5个环刃。",
    "DA_TwistedFate19": "被动：战斗开始时，商店里每有一个弈子就抽一张牌。如果本回合刷新过商店，按抽到的牌获得战利品。\n\n一对或两张相同：1金币\n三张相同：随机弈子\n四张相同：散件\n五张相同：神秘宝箱\n\n主动：接下来的5次攻击获得100%攻击速度，并改为卡牌，对目标造成法强100/150/2000魔法伤害，对附近2名敌人造成法强30/45/1000魔法伤害。",
    "DA_Vi19": "召唤2只巨型全息拳头。获得法强300/400/500护盾，持续2秒，并给附近2名友军法强125/165/215护盾。猛击目标5次，每次对目标造成攻击130/200/1000物理伤害，并对2格内的其他敌人造成攻击35/55/400伤害。\n\n电子舞曲升级：额外猛击1次，并治疗此技能造成伤害的15%。",
    "DA_Sona19": "被动：不会普攻。每3秒获得31/31/101法力，对最近的3名敌人造成法强120/180/1000魔法伤害，并让2名友军获得法强40/65/9999护盾，持续3秒。娑娜不可阻挡。\n\n主动：放出横贯战场的音波，对所有敌人分摊造成法强1500/2400/9999999魔法伤害并击晕2秒。友军分摊获得法强250/450/99999护盾，持续5秒。",
}

TRAIT_DESC_ZH = {
    "DA_GlitterBomb19": "高能流行弈子获得生命值和攻击速度。玩家对战结束后，按星级获得3/6/12/40热度，每击败一名敌人额外获得1热度。\n\n每达到一个新的热度等级就获得奖励。羁绊档位越高，获得的热度越多。",
    "DA_Collab19": "合奏弈子在造成或受到伤害8次后获得灵感，从而获得攻击力和法术强度。\n\n玩家对战中每获得7次灵感，获得合奏弈子的复制体。\n\n每局游戏都会有不同的一组弈子获得【合奏】羁绊。",
}

TRAIT_EFFECT_ZH = {
    "DA_MissFortune19_UniqueTrait": "记录队伍造成的总伤害，厄运小姐造成的伤害按三倍计入。打破最高分时获得一份奖励。\n\n高分档：50000、80000、125000、175000、275000、500000、700000、1000000。",
    "DA_Alistar19_UniqueTrait": "战斗开始时：如果你最强的阿利斯塔拥有超过500额外生命值，他获得15%耐久。",
    "DA_DrMundo19_UniqueTrait": "立刻获得一份唱片合约，之后每4回合再获得一份。签约弈子获得5%伤害增幅，他们的击杀为蒙多医生永久提供25生命值。\n\n签约艺人被出售或下场时，唱片合约会归还。",
    "DA_Teemo19_UniqueTrait": "每当一名高能流行弈子造成2500伤害或承受2500伤害，额外储存1点高能流行热度。",
    "DA_Janna19_UniqueTrait": "战斗开始时：你最强的迦娜放出一道向前的龙卷风，将路径上的敌人击飞1.25/1.75/99秒。",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def clean(value: str) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n", text)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    for src, dst in TOKENS:
        text = text.replace(src, dst)
    text = text.replace("5% increased Healing/Shielding", "治疗和护盾效果提高5%")
    text = text.replace("\r", "")
    text = re.sub(r"Next Delivery:.*", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def apply_english_names(text: str, names: list[str]) -> str:
    for eng, zh in names:
        if not eng or eng == zh:
            continue
        text = re.sub(rf"(?<![A-Za-z]){re.escape(eng)}(?![A-Za-z])", zh, text)
    text = re.sub(r"(?<![A-Za-z])Emblem(?![A-Za-z])", "纹章", text)
    return text


def damage_type(role_id: str) -> str:
    rid = role_id or ""
    if "Hybrid" in rid:
        return "hybrid"
    if "Magic" in rid:
        return "magic"
    return "physical"


def parse_unlock(text: str, by_name: dict[str, str]) -> dict | None:
    text = (text or "").strip()
    if not text:
        return None
    level_match = re.search(r"需求等级\s*(\d+)", text)
    found: list[str] = []
    for bracket in re.findall(r"【([^】]+)】", text):
        uid = by_name.get(bracket)
        if uid and uid not in found:
            found.append(uid)
    star_match = re.search(r"([23])星【", text)
    star = int(star_match.group(1)) if star_match else 1
    mode = "any" if "或" in text and len(found) > 1 else "all"
    return {
        "text": text,
        "level": int(level_match.group(1)) if level_match else 0,
        "units": [{"id": uid, "star": star} for uid in found],
        "mode": mode,
    }


def grants_unit(unit: dict, trait_lookup: dict[str, dict]) -> bool:
    blob = unit["ability"]["text"] or ""
    for tid in unit["traits"]:
        trait = trait_lookup.get(tid)
        if not trait:
            continue
        personal = trait["kind"] == "solo" or trait["champions"] == [unit["id"]]
        if not personal:
            continue
        blob += "\n" + (trait.get("desc") or "")
        for bp in trait["breakpoints"]:
            blob += "\n" + (bp.get("text") or "") + "\n" + (bp.get("prismaticText") or "")
    return bool(GRANT_UNIT.search(blob))


def role_parts(role_id: str) -> tuple[str, str]:
    rid = role_id or ""
    if "Assassin" in rid:
        group = "assassin"
    elif "Tank" in rid:
        group = "tank"
    elif "Fighter" in rid:
        group = "fighter"
    elif "Marksman" in rid:
        group = "marksman"
    elif "Caster" in rid:
        group = "caster"
    else:
        group = "specialist"
    return group, "Manaless" in rid


def lane_of(group: str, attack_range: int) -> str:
    if group == "assassin":
        return "assassin"
    if attack_range >= 4:
        return "back"
    if attack_range <= 1 or group == "tank":
        return "front"
    return "mid"


def merge_breakpoints(bonuses: list[dict]) -> list[dict]:
    groups: dict[int, list[dict]] = {}
    order: list[int] = []
    for bonus in bonuses:
        need = int(bonus.get("needed") or 0)
        if need <= 0:
            continue
        if need not in groups:
            groups[need] = []
            order.append(need)
        groups[need].append(bonus)
    merged = []
    for need in order:
        rows = groups[need]
        base = [row for row in rows if int(row.get("style") or 0) < 5]
        pris = [row for row in rows if int(row.get("style") or 0) >= 5]
        style = max((int(row.get("style") or 0) for row in base), default=0)
        text = "\n".join(bit for bit in (clean(row.get("effect") or "") for row in base) if bit)
        ptext = "\n".join(bit for bit in (clean(row.get("effect") or "") for row in pris) if bit)
        merged.append(
            {
                "need": need,
                "style": style,
                "prismaticStyle": 5 if pris else 0,
                "text": text,
                "prismaticText": ptext,
            }
        )
    return merged


# Pointy hex used by the board and the library. object-fit:cover on the 256x152
# banners crops the sides; this stores the horizontal anchor that keeps the face
# in that window. YuNet handles painted faces, and units it misses fall back to
# the busiest spot in the upper body of the banner.
HEX_H_OVER_W = 1.1547
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"


def focus_percent(fx: float, iw: int, ih: int) -> int:
    visible = (ih / iw) / HEX_H_OVER_W
    if visible >= 1:
        return 50
    left = min(max(fx - visible / 2, 0.0), 1 - visible)
    return int(round(left / (1 - visible) * 100))


def write_unit_focus() -> None:
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("unit focus skipped: cv2 or numpy is not installed")
        return
    icons = sorted(UNIT_ICON_DIR.glob("*.webp"))
    if not icons:
        print("unit focus skipped: no unit icons")
        return
    model = ROOT / ".cache" / "face_detection_yunet_2023mar.onnx"
    if not model.exists() or model.stat().st_size < 1000:
        model.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(YUNET_URL, model)
    det = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.5, 0.3, 5000)
    focus: dict[str, int] = {}
    faces = 0
    for path in icons:
        im = cv2.imread(str(path))
        if im is None:
            continue
        height, width = im.shape[:2]
        found = None
        for scale in (2, 3, 1):
            big = cv2.resize(im, (width * scale, height * scale))
            det.setInputSize((big.shape[1], big.shape[0]))
            _, detected = det.detect(big)
            if detected is None:
                continue
            detected = sorted(detected, key=lambda row: -float(row[-1]))
            box_w, box_h = float(detected[0][2]), float(detected[0][3])
            if box_w / scale < 12 or box_h / scale < 12:
                continue
            found = ((float(detected[0][0]) + box_w / 2) / scale / width, float(detected[0][-1]))
            if found[1] >= 0.75:
                break
        if found:
            fx = found[0]
            faces += 1
        else:
            gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
            mag = cv2.magnitude(
                cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3),
                cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3),
            )
            top = mag[: int(height * 0.75)]
            column = np.convolve(top.mean(axis=0), np.ones(17) / 17, mode="same")
            fx = float(np.argmax(column)) / width
        focus[path.stem] = focus_percent(fx, width, height)
    body = json.dumps(focus, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "unit_focus.js").write_text("var UNIT_FOCUS = " + body + ";\n", encoding="utf-8")
    print(f"unit focus {len(focus)} faces {faces} fallback {len(focus) - faces}")


def save_icon(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 40:
        return True
    try:
        data = fetch(url)
    except Exception:
        return False
    if len(data) < 40:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True


def item_wearable(rec: dict) -> bool:
    kind = rec.get("kind") or ""
    tags = rec.get("tags") or []
    if kind in WEARABLE_KINDS:
        return True
    # Selectors, quest markers and the Heavenscale curse are not equipped by players.
    if kind != "misc" or "Item.Equippable.CantBeCombined" in tags or "Item.Equippable.RemovedOnBench" in tags:
        return False
    if any(tag.endswith(("PrismaticQuestItem", "DangerousItem")) for tag in tags):
        return False
    return any(tag.startswith("Item.Equippable.Item.") for tag in tags)


def item_record(key: str, rec: dict, zh, trait_ids: set[str]) -> dict:
    tags = rec.get("tags") or []
    raw = rec.get("description") or ""
    trait = rec.get("trait") or ""
    return {
        "id": key,
        "name": rec.get("name") or "",
        "kind": rec.get("kind") or "",
        "text": zh(raw),
        "tags": tags,
        "trait": trait if trait in trait_ids else "",
        "buildsFrom": rec.get("buildsFrom") or [],
        "icon": "",
        "iconRemote": "",
        "slots": 3 if "Item.Equippable.Item.ThiefsGloves" in tags else 1,
        "unique": bool(re.search(r"唯一\s*-", raw)) or any(tag.endswith("Unique") for tag in tags),
        "teamSize": 1 if "Item.Equippable.Item.Tacticians" in tags else 0,
    }


def build_items(items_raw: dict, zh, trait_ids: set[str]) -> list[dict]:
    rows = [item_record(key, rec, zh, trait_ids) for key, rec in items_raw.items() if item_wearable(rec)]
    rows.sort(key=lambda item: (ITEM_KIND_ORDER.index(item["kind"]), item["name"]))
    return rows


def valid_image(data: bytes, mime: str) -> str:
    kind = mime.split(";")[0].strip().lower()
    if kind == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if kind == "image/webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    raise ValueError(f"not a png or webp body ({kind or 'no type'}, {len(data)} bytes)")


def fetch_raw(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def fetch_item_icon(item_id: str, sources: list[tuple[str, str]]) -> tuple[str, str, list[str]]:
    errors: list[str] = []
    for url, label in sources:
        try:
            data, mime = fetch_raw(url)
            ext = valid_image(data, mime)
        except Exception as exc:
            errors.append(f"{label} {url}: {exc}")
            continue
        ITEM_ICON_DIR.mkdir(parents=True, exist_ok=True)
        (ITEM_ICON_DIR / f"{item_id}{ext}").write_bytes(data)
        return f"icons/items/{item_id}{ext}", label, errors
    return "", "", errors


def attach_item_icons(items: list[dict], manifest: dict[str, dict]) -> None:
    jobs = []
    for item in items:
        sources = []
        entry = manifest.get(item["id"])
        if entry and entry.get("image"):
            img = entry["image"]
            item["iconRemote"] = f"{DDRAGON_IMG}/{img['group']}/{img['full']}"
            sources.append((item["iconRemote"], "official"))
        sources.append((f"{BLITZ_ITEMS}/{item['id']}.webp", "blitz"))
        jobs.append((item, sources))
    counts: Counter = Counter()
    failed = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch_item_icon, item["id"], sources): item for item, sources in jobs}
        for fut in as_completed(futures):
            item = futures[fut]
            icon, label, errors = fut.result()
            item["icon"] = icon
            counts[label or "none"] += 1
            if not icon:
                failed.append((item["id"], errors))
            elif errors:
                print(f"  fallback {item['id']} -> {label}: {errors}")
    remote = sum(1 for item in items if item["iconRemote"])
    print(f"items {len(items)} local official {counts['official']} blitz {counts['blitz']} none {counts['none']} iconRemote {remote}")
    for item_id, errors in failed:
        print("  FAILED", item_id, errors)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    print("fetch units/traits/roles/unlocks")
    units_raw = json.loads(fetch(f"{BASE}/zh_cn/units"))
    traits_raw = json.loads(fetch(f"{BASE}/zh_cn/traits"))
    roles_raw = json.loads(fetch(f"{BASE}/zh_cn/champion-roles"))
    unlocks_raw = json.loads(fetch(f"{BASE}/zh_cn/unlockables"))
    units_en = json.loads(fetch(f"{BASE}/en_us/units"))
    items_raw = json.loads(fetch(f"{BASE}/zh_cn/items"))
    manifest = {entry["id"]: entry for entry in json.loads(fetch(DDRAGON_ITEMS))["data"].values()}

    shop = {key: unit for key, unit in units_raw.items() if "HeroAugment" not in key}
    if len(shop) != 94:
        print(f"warning: expected 94 shop units, got {len(shop)}")

    names = [(units_en[key]["name"], unit["name"]) for key, unit in shop.items() if key in units_en]
    names.sort(key=lambda pair: len(pair[0]), reverse=True)

    def zh(text: str) -> str:
        return apply_english_names(clean(text), names)

    trait_name = {key: trait["name"] for key, trait in traits_raw.items()}
    name_counts = Counter(unit["name"] for unit in shop.values())
    lane_label = {"front": "前排", "mid": "中排", "back": "后排", "assassin": "切入"}

    units = []
    missing_traits = []
    for key, unit in shop.items():
        offense = unit["stats"]["offense"]
        defense = unit["stats"]["defense"]
        ability = unit["ability"]
        group, manaless = role_parts(unit.get("role") or "")
        attack_range = int(offense.get("range") or 1)
        lane = lane_of(group, attack_range)
        trait_ids = [*(unit.get("origin") or []), *(unit.get("class") or [])]
        trait_ids = [tid for tid in trait_ids if tid]
        for tid in trait_ids:
            if tid not in traits_raw:
                missing_traits.append((key, tid))
        role_meta = roles_raw.get(unit.get("role") or "", {})
        display = unit["name"]
        if name_counts[unit["name"]] > 1:
            origin = (unit.get("origin") or [""])[0]
            display = f"{unit['name']}·{trait_name.get(origin, origin)}"
        hp = int(defense.get("health") or 0)
        ad = int(offense.get("damage") or 0)
        unlock_raw = unlocks_raw.get(key)
        units.append(
            {
                "id": key,
                "name": unit["name"],
                "nameEn": (units_en.get(key) or {}).get("name") or "",
                "display": display,
                "cost": int(unit["cost"]),
                "slots": 2 if key in TWO_SLOT else 1,
                "role": role_meta.get("name") or "",
                "roleRule": clean(role_meta.get("description") or ""),
                "roleGroup": group,
                "damageType": damage_type(unit.get("role") or ""),
                "lane": lane,
                "laneLabel": lane_label[lane],
                "manaless": manaless,
                "stats": {
                    "hp": hp,
                    "ad": ad,
                    "ar": int(defense.get("armor") or 0),
                    "mr": int(defense.get("magicResist") or 0),
                    "as": offense.get("attackSpeed") or 0,
                    "range": attack_range,
                    "mana": int(ability.get("manaCost") or 0),
                    "manaStart": int(ability.get("manaStart") or 0),
                },
                "dynamic": hp == 0 or ad == 0,
                "ability": {"name": ability.get("name") or "", "text": zh(ability.get("description") or "")},
                "traits": trait_ids,
                "unlockText": zh(unlock_raw["description"]) if unlock_raw else "",
                "grantsUnit": False,
                "icon": f"icons/units/{key}.webp",
            }
        )

    if missing_traits:
        print("missing traits", missing_traits[:8])

    champs_of = defaultdict(list)
    for unit in units:
        for tid in unit["traits"]:
            champs_of[tid].append(unit["id"])

    traits = []
    for key, trait in traits_raw.items():
        bps = merge_breakpoints(trait.get("bonuses") or [])
        champs = champs_of.get(key) or []
        if not bps or not champs:
            continue
        for bp in bps:
            bp["text"] = zh(bp["text"])
            bp["prismaticText"] = zh(bp["prismaticText"])
        max_need = max(bp["need"] for bp in bps)
        kind = "solo" if max_need <= 1 else ("band" if trait.get("type") == "origin" else "class")
        desc = zh(trait.get("description") or "")
        # Headcount is the default. K/DA is the exception: it says 总星级 and its
        # 21 breakpoint is above the eight-member roster. Rock mentions star level
        # only as idol power, while its 7 breakpoint matches seven units.
        raw_desc = trait.get("description") or ""
        count_mode = "stars" if ("总星级" in raw_desc and max_need > len(champs)) else "units"
        traits.append(
            {
                "id": key,
                "name": trait["name"],
                "type": trait.get("type") or "",
                "kind": kind,
                "countMode": count_mode,
                "desc": desc,
                "breakpoints": bps,
                "champions": sorted(champs, key=lambda uid: next(u["cost"] for u in units if u["id"] == uid)),
                "prismatic": any(bp["prismaticStyle"] for bp in bps),
                "icon": f"icons/traits/{key}.webp",
            }
        )

    kind_order = {"band": 0, "class": 1, "solo": 2}
    traits.sort(key=lambda t: (kind_order[t["kind"]], t["name"]))
    units.sort(key=lambda u: (u["cost"], u["display"]))

    for unit in units:
        if unit["id"] in ABILITY_ZH:
            unit["ability"]["text"] = ABILITY_ZH[unit["id"]]
    for trait in traits:
        if trait["id"] in TRAIT_DESC_ZH:
            trait["desc"] = TRAIT_DESC_ZH[trait["id"]]
        if trait["id"] in TRAIT_EFFECT_ZH:
            trait["breakpoints"][0]["text"] = TRAIT_EFFECT_ZH[trait["id"]]

    items = build_items(items_raw, zh, {trait["id"] for trait in traits})
    attach_item_icons(items, manifest)

    trait_lookup = {t["id"]: t for t in traits}
    by_name: dict[str, str] = {}
    ambiguous: set[str] = set()
    for unit in units:
        for label in (unit["name"], unit["display"]):
            if label in by_name and by_name[label] != unit["id"]:
                ambiguous.add(label)
            else:
                by_name[label] = unit["id"]
    for label in ambiguous:
        by_name.pop(label, None)

    for unit in units:
        labels = [trait_lookup[tid]["name"] for tid in unit["traits"] if tid in trait_lookup]
        unit["traitNames"] = labels
        parsed = parse_unlock(unit.pop("unlockText"), by_name)
        if parsed:
            parsed["units"] = [req for req in parsed["units"] if req["id"] != unit["id"]]
            if not parsed["text"] and not parsed["level"] and not parsed["units"]:
                parsed = None
        unit["unlock"] = parsed
        unit["grantsUnit"] = grants_unit(unit, trait_lookup)
        unit["keywords"] = " ".join(
            [unit["display"], unit["name"], unit["nameEn"], unit["role"], unit["laneLabel"], *labels]
        ).lower()

    payload = {
        "meta": {
            "template": 1,
            "schemaVersion": 3,
            "set": 19,
            "name": "棱彩音乐盛典",
            "locale": "zh_cn",
            "dataStatus": "mixed",
            "source": "tftTest Set19 与 Data Dragon 16.23.1 混合数据，未验证 live。",
            "sourceUrl": BASE + "/zh_cn/",
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "gamePatch": "Data Dragon 16.23.1",
            "rulesCoverage": "未验证 live；静态数据集",
            "units": len(units),
            "traits": len(traits),
            "unlocks": sum(1 for u in units if u["unlock"]),
            "items": len(items),
        },
        "shopOdds": SHOP_ODDS,
        "exclusive": EXCLUSIVE,
        "units": units,
        "traits": traits,
        "items": items,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    raw_json = raw_json.replace("<", "\\u003c")
    (DATA_DIR / "set19.json").write_text(raw_json, encoding="utf-8")
    (ROOT / "data.js").write_text("var SET19 = " + raw_json + ";\n", encoding="utf-8")

    jobs = []
    # DA_Yone19's Blitz centered art is a hat logo; the local webp is a hand-set portrait.
    for unit in units:
        if unit["id"] == "DA_Yone19":
            continue
        jobs.append((f"https://blitz-cdn.blitz.gg/blitz/centered-tft/set19/{unit['id']}.webp", UNIT_ICON_DIR / f"{unit['id']}.webp"))
    for trait in traits:
        jobs.append((f"https://blitz-cdn.blitz.gg/blitz/tft/traits/light/{trait['id']}.webp", TRAIT_ICON_DIR / f"{trait['id']}.webp"))

    ok = 0
    failed = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(save_icon, url, dest): dest.name for url, dest in jobs}
        for fut in as_completed(futures):
            if fut.result():
                ok += 1
            else:
                failed.append(futures[fut])
    print(f"units {len(units)} traits {len(traits)} unlocks {payload['meta']['unlocks']}")
    print(f"icons {ok}/{len(jobs)} failed {failed[:12]}")
    write_unit_focus()
    star_traits = [t["name"] for t in traits if t["countMode"] == "stars"]
    print("star traits", star_traits)
    print("two-slot", [u["display"] for u in units if u["slots"] == 2])
    print("grants", [u["display"] for u in units if u["grantsUnit"]])
    keyed = [u for u in units if u["unlock"] and u["unlock"]["units"]]
    print("unlock units", len(keyed))
    for unit in keyed:
        req = ",".join(f"{item['id']}@{item['star']}" for item in unit["unlock"]["units"])
        print(f"  {unit['display']} {unit['unlock']['mode']} L{unit['unlock']['level']} {req}")


if __name__ == "__main__":
    main()
