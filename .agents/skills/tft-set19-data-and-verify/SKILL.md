---
name: tft-set19-data-and-verify
description: >-
  Use when syncing TFT Set 19 static data (meta comps, Collab sets, opening encounters,
  trait reward tables, or Riot v2 Team Planner codes), debugging external TFT JSON feeds,
  or running local tests, builds, and headless browser verification in tft-set19 on Windows.
---

# TFT Set 19 数据源、协议与验证速查

## 1. 已验证可用的公开数据源（零 Cloudflare 挑战）
- **MetaTFT 热门阵容 JSON**（`scripts/sync-meta-comps.mjs`）：
  - `https://api-hc.metatft.com/tft-comps-api/comps_data` / `comps_stats`（PBE 阶段加 `?queue=pbe`，Set 19 上正式服后自动切 Live）。
- **MetaTFT 合奏 40 组 JSON**（`scripts/sync-season-data.mjs`）：
  - `https://api-hc.metatft.com/tft-stat-api/collab`（PBE 阶段 `?queue=pbe`）。
- **Riot 官方小队码映射源**：
  - 优先：`https://raw.communitydragon.org/{latest|pbe}/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json`（Set 19 正式服上线后优先取此表）。
  - 兜底：`https://data.metatft.com/lookups/TFTSet19_latest_en_us.json`（已与 Set 18 CommunityDragon 交叉验证 65/65 100% 一致，且 S19 94/94 唯一映射）。
  - **避坑**：`utils.iesdev.com` 的 PBE `units` JSON 曾出现男枪/狗头/铁男 `code` 全部撞车 `1097` 的脏数据，**禁止**将 `iesdev` 作为小队码权威源。
- **开局奇遇官方中文 + 概率**：
  - `https://utils.iesdev.com/static/json/tftTest/set19/zh_cn/encounters`
- **羁绊奖励表参考（服务端直出 HTML，无 CF）**：
  - `https://tftflow.com/tables/set19/{true-damage,hyperpop,8-bit,ionic-spark,gu-feng,illbeats,collab,shop-odds-pool-size-xp-table}`
- **已知不可用/不推荐的站点**：
  - `Mobalytics`（HTTP 403 Cloudflare Turnstile 拦截）、`OP.GG`（3.7MB Next.js HTML 解析脆弱）、`DataTFT`（纯前端 SPA 壳无开放静态 JSON）。

## 2. 端游官方小队规划器码协议（Riot v2）
- 格式：`02` + `10 × 3 位小写十六进制棋子码（空槽补 000）` + `TFTSet19`（共 40 字符）。
- 端游国服、外服、PBE 通用；**不兼容**《金铲铲之战》手游 `H4sIA...`（Gzip + Base64）格式。
- 巴伦占 2 人口但在规划器码中只占 1 槽；导入 10 棋子含巴伦时需设置 `level=10, extraSlots=1`。

## 3. 同步、测试与 Windows PowerShell 注意事项
1. 同步线上数据：`node scripts/sync-meta-comps.mjs; node scripts/sync-season-data.mjs`
2. 完整单测与构建：`npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
3. **PowerShell 5.1 避坑**：
   - 使用 `;` 与 `$LASTEXITCODE` 代替 `&&`。
   - 运行多行 Node 探测/截图脚本时，用单引号 here-string `@' ... '@ | node` 避免双引号转义报错。
4. 确认 Actions 链路：GitHub Actions 中用默认 `GITHUB_TOKEN` 推送不会触发 `on: push`，`deploy-pages.yml` 必须保留 `workflow_run: ["Sync Meta Comps"]` 串联。
