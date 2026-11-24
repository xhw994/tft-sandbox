# TFT Set 19 阵容工作台 — UI 重构与极轻量 Repaint 实现规格书 (`IMPL`)

> 本文档是 `C:\Users\xegna\Documents\Workspace\tft-set19` 全面 UI 重构与引擎增量扩展的**唯一实现契约**。所有模块文件名、导出签名、DOM ID、CSS 类名、脏位掩码及交互硬规则均在此锁死，可供多 Agent 并行开发或后续小模型独立维护。

---

## 1. 工程结构与零破坏边界

### 1.1 保持不变的资产与兼容约束
- `data.js`、`data/set19.json`、`unit_focus.js`、`assess.js`、`icons/`、`build_data.py`：**完全不改**。
- `test_board.mjs`、`test_assess.mjs`、`test_engine.mjs`：**必须保持 100% 通过**。
- 存档键 `tft-board-v3:*` 保持向后兼容；旧存档的 `saved.emblems` 在加载时自动转换为对应真实纹章装备并入 `state.looseItems`，同时清空 `state.emblems = {}`。
- 主题偏好独立存储于 `localStorage["tft-ui-theme"]`（`"dark"` | `"light"`，默认 `"dark"`）。

### 1.2 目录清单
```text
tft-set19/
├─ package.json                   [NEW] 仅 devDependency: vite
├─ vite.config.js                 [NEW] IIFE 单文件打包 + 复制静态运行资产到 dist/（兼容 file://）
├─ index.html                     [MODIFY] Vite 入口 + 防闪烁主题脚本 + 渐进 Web 字体 + 原生 Popover 骨架
├─ 启动.bat                        [MODIFY] 打开 dist\index.html
├─ board.js                       [MODIFY] 新增 add-loose / unequip-to-loose 与新 SETTINGS 字段
├─ engine.js                      [MODIFY] 支持可选 ctx.bannedIds 与 ctx.looseItemFit
├─ test_new_features.mjs          [NEW] 覆盖新动作、bannedIds、8维装备亲和与解锁规划单元测试
└─ src/
   ├─ main.js                     [NEW] 装配各池与事件委托、快捷键 (/ / Esc / 1-3 / Del)
   ├─ state/
   │  └─ store.js                 [NEW] 脏位掩码调度、双帧异步分析、虚影 diff、禁用倒计时状态机、存档
   ├─ logic/
   │  ├─ item-affinity.js         [NEW] 4 职责 × AD/AP (8 维) 装备亲和引擎 + 主C/主坦自动归属
   │  └─ unlock-planner.js        [NEW] 解锁目标虚拟棋盘构筑、前置解锁卡提取、史密奇 N 羁绊小型追踪
   ├─ ui/
   │  ├─ header.js                [NEW] 顶栏命令条（等级/人口/单一玩法 Dropdown/含未解锁/设定 Popover）
   │  ├─ traits-pool.js           [NEW] 常驻羁绊池 + 六边形金属档位徽章 + 禁用/静态棱彩开关
   │  ├─ equip-bench.js           [NEW] 左栏固定 2 行 6×2「已有装备」池 + 「+ 纹章 ▾」22 件真实纹章快选
   │  ├─ board-pool.js            [NEW] 常驻 28 格六边形棋盘池 + 2 格纳什男爵 + 虚影层 + 选中操作栏
   │  ├─ library-pool.js          [NEW] 常驻 94 棋子 / 147 装备池 + O(1) 在场角标 + hidden 极速筛选
   │  ├─ advisor.js               [NEW] 右栏策略顾问（解锁目标区/方案/替换/下一步购买/升星/天梯/禁用回收条）
   │  └─ drag-and-popover.js      [NEW] GPU translate3d 拖拽引擎（含拖出删除）+ 原生 Top-Layer Popover 详情卡
   └─ styles/
      ├─ tokens.css               [NEW] OKLCH + light-dark() 双主题、1/2/3/4/5/7 费色阶、静态棱彩
      ├─ layout.css               [NEW] 全屏三区布局、统一 42px .pane-head、CSS Containment
      ├─ components.css           [NEW] 步进器、按钮、原生 Popover + Anchor Positioning + @starting-style
      ├─ board.css                [NEW] 双层无裁切六边形、星级/职责/核心标、虚影、Inspector Dock
      └─ armory-advisor.css       [NEW] 棋子库、左栏已有装备区、右栏策略卡片、禁用倒计时与左滑抽离动效
```
> 全部构建与验收通过后删除旧版 `app.js` 与 `styles.css`。

---

## 2. 底层最小兼容扩展契约

### 2.1 `board.js` 扩展
1. `SETTINGS` 白名单新增：`"bannedIds"`, `"unlockTargetId"`, `"trackerMaxLevel"`。
2. `reset(next)` 同步重置：`next.bannedIds = {}; next.unlockTargetId = null;`。
3. 新增动作 `add-loose`：
   - 参数：`{ type: "add-loose", itemId }`
   - 校验 `knownItem(game, a.itemId)`，成功后 `next.looseItems.push(a.itemId)`。
4. 新增动作 `unequip-to-loose`：
   - 参数：`{ type: "unequip-to-loose", id, itemId, index }`
   - 校验单位在场且 `items[a.index] === a.itemId`，从 `items.splice(a.index, 1)` 并 `next.looseItems.push(a.itemId)`。
5. 保持 `equip-item`（含 `source.kind === "loose"`）、`delete-loose`、`context-unit`、`apply-plan` 等原有动作语义完全不变。

### 2.2 `engine.js` 扩展
1. `isBanned(ctx, unitId)`：`return !!(ctx && ctx.bannedIds && ctx.bannedIds[unitId]);`
2. 在 `legal(board, ctx, remain)` 中加入：`if (isBanned(ctx, unit.id)) continue;`
3. 在 `suggest(role, board, ctx)` 中加入：`if (isBanned(ctx, unit.id)) continue;`
4. 在 `track(input, ctx, options)` 的 `cands` 过滤中加入：`if (isBanned(ctx, u.id)) return false;`
5. **可选 `ctx.looseItemFit` 钩子（默认未传时零影响）**：
   - `ctx.looseItemFit` 为对象 `{ scoreUnit: function(unit) { return { bonus: number, matchedItems: string[] }; } }`（其中 `bonus` 控制在 `0 ~ 14` 之间）。
   - 在 `shortlist()` 中：每个候选 `unit` 的排序增量 `delta` 可叠加 `fit.bonus * 0.6`（不改写 `evaluate()` 纯评分，仅辅助进入候选并提升排序）。
   - 在 `nextBuys()` 中：对每条候选 `row` 调用 `ctx.looseItemFit.scoreUnit(unit)`，若 `matchedItems.length > 0`，挂载 `row.matchedItems = fit.matchedItems` 与 `row.itemFitBonus = fit.bonus`，并在排序中给予合理加权。
   - 在 `materialize()` / `plans` 中：收集新增棋子匹配的 `matchedItems` 汇总到 `plan.matchedItems`（去重数组，供 UI 展示 `契合备战装：无尽之刃`）。

---

## 3. 纯逻辑模块契约 (`src/logic/`)

### 3.1 `src/logic/item-affinity.js`
导出函数：
- `classifyItem(item)` → `{ category, damage, needsMana, isEmblem, isCrown, isThief, weight }`
  - `category`: `"tank" | "fighter" | "carry" | "utility" | "emblem" | "crown" | "thief" | "basic"`
  - `damage`: `"physical" | "magic" | "hybrid" | "any"`
  - 分类优先级：
    1. `item.kind === "emblem"` → `category: "emblem"`
    2. `item.teamSize > 0` 或 `item.kind === "spatula"` → `category: "crown"`
    3. `tags` 含 `ThiefsGloves` → `category: "thief"`
    4. 静态精确覆盖表（覆盖全部 33 件 `artifact`、战士装 `Bloodthirster / TitansResolve / SteraksGage / EdgeOfNight / HandOfJustice / Crownguard`、功能装 `SunfireCape / Morellonomicon / RedBuff / IonicSpark / Evenshroud / LastWhisper / VoidStaff` 及光明版前缀/后缀自动剥离匹配）；
    5. 通用 Riot `tags` 规则：`Category.Tank` → `tank`；`Category.Attack && Category.Magic` → `carry/hybrid`；`Category.Attack` → `carry/physical`；`Category.Magic` → `carry/magic`；`Provides.Resource.Mana` → `needsMana: true`；`Item.Support` → `utility/any`；`Item.Burn` → `utility`。
- `itemUnitScore(item, unit)` → `0..100`
  - 若 `item.kind === "emblem"`：若 `unit.traits.includes(item.trait)` 返回 `0`，否则返回 `65`；
  - 若 `needsMana && unit.manaless`：大幅降权至 `10`；
  - `tank` 装对 `roleGroup === "tank"` 给 `90`，对 `fighter` 给 `55`，对后排给 `5`；
  - `fighter` 装按 `physical/magic/hybrid` 匹配 `fighter/assassin` 给 `88`（同属性）/ `45`（异属性），对 `tank` 给 `45`，对后排给 `25`；
  - `carry` 装按 `physical/magic/hybrid` 匹配 `marksman/caster/assassin/fighter`：同属性主输出给 `92`，`hybrid` 给 `80`，异属性仅给 `18`，对 `tank` 给 `10`；
  - `utility` 装按属性与近/远战匹配给 `65~78`；
  - `thief` 对无装弈子给 `60`，`basic` 散件按属性减半给 `35~50`。
- `resolveLooseItems(board, looseItems, game, labels)`
  - 返回：
    ```js
    {
      assignments: [ // 与 looseItems 一一对应
        { index, itemId, badgeKind: "carry"|"tank"|"emblem"|"rec"|"crown", badgeText: "C"|"坦"|"纹"|"荐"|"冠", targetId: string|null, hint: string }
      ],
      virtualBoard,    // board 的深拷贝，已把归属给主C/主坦的 looseItems 虚拟穿戴（不改真实 state）
      unassigned,      // [{ index, itemId }] 未归属主C/主坦且非冠冕/非纹章的剩余装备
      looseEmblems,    // { [traitId]: count } 未穿戴纹章自动折算为引擎 emblems 计数
      looseItemFit: { scoreUnit(unit) { return { bonus, matchedItems }; } }
    }
    ```
  - 归属规则：
    1. `crown` 标 `"冠"`；
    2. `emblem` 统计进 `looseEmblems[item.trait] += 1`，同时找场上一个不带该原生羁绊且 `<3` 槽的弈子（优先挂件/副坦）作为点击一键穿戴目标，标 `"纹"`；
    3. 其余装备先检查当前主C（`labels[e.id] === "carry"`）剩余槽位与 `itemUnitScore(item, unit) >= 62` → 归属主C 标 `"C"`；
    4. 否则检查主坦（`labels[e.id] === "tank"`）剩余槽位与 `itemUnitScore(item, unit) >= 62` → 归属主坦 标 `"坦"`；
    5. 仍未归属 → 放入 `unassigned`，标 `"荐"`，通过 `looseItemFit.scoreUnit(candUnit)` 为 `itemUnitScore >= 68` 的候选弈子加分（每件匹配 `+4.5`，上限 `12`）并返回 `matchedItems`（装备 ID 数组）。

### 3.2 `src/logic/unlock-planner.js`
导出函数：
- `parseUnlockMeta(unit, game)`
  - 解析 `unit.unlock`：`minLevel`、`reqUnits` (`[{id, star}]`)、`mode` (`"all"|"any"`)、正则解析 `reqTraitCount`（匹配 `/激活\s*(\d+)\s*个.*?非单人羁绊/`，覆盖 史密奇 `8` 条非单人羁绊 @ 9 级）、解析文本中提及的目标羁绊 ID 列表 `reqTraitIds`。
- `buildUnlockContext(state, game, baseBoard, baseCtx)`
  - 若 `!state.unlockTargetId` 或单位不存在，返回 `{ active: false }`；
  - 判断目标是否已在 `baseBoard`；
  - 提取 `prereqActions`：遍历 `meta.reqUnits`，若场上无该弈子则 `{ id, needStar, currentStar: 0, onBoard: false, action: "add", reason }`；若星级不足则 `{ id, needStar, currentStar, onBoard: true, action: "star", reason }`；
  - 构造 `virtualBoard` & `virtualCtx`：若目标不在场上，则把 `{ id: target.id, star: 1, mark: "", items: [], position: null }` 放入 `virtualBoard`（只读副本），`virtualCtx.level = Math.max(baseCtx.level, meta.minLevel || 0)`，并设 `virtualCtx.focusId = target.id`；
  - 若 `meta.reqTraitCount > 0`，标记 `needsMiniTrack: true, miniTrackGoal: meta.reqTraitCount, miniTrackMaxLevel: Math.max(baseCtx.level, meta.minLevel || 9)`，供 `store.js` 直接复用 `game.track()` 分片搜索解锁路线。

---

## 4. 极致轻量 Repaint 架构与 `store.js` 契约

### 4.1 脏位掩码常量 (`DIRTY_*`)
```js
export const DIRTY_HEADER     = 1 << 0;
export const DIRTY_POP        = 1 << 1;
export const DIRTY_TRAITS     = 1 << 2;
export const DIRTY_EQUIP      = 1 << 3;
export const DIRTY_BOARD      = 1 << 4;
export const DIRTY_INSPECTOR  = 1 << 5;
export const DIRTY_LIB_STATE  = 1 << 6;
export const DIRTY_LIB_FILTER = 1 << 7;
export const DIRTY_RECS       = 1 << 8;
export const DIRTY_NOTICE     = 1 << 9;
export const DIRTY_ALL        = 0x3FF;
```

### 4.2 动作 → 最小脏位映射（严格执行，禁止全量重刷）
- `selectUnit(id)`：`DIRTY_BOARD | DIRTY_INSPECTOR`（仅切 2 格 class，不触发 `analyze()`）
- `move-unit`：`DIRTY_BOARD | DIRTY_INSPECTOR`（仅补丁 2 格，不触发 `analyze()`）
- `togglePreview(spec)`：`DIRTY_BOARD | DIRTY_RECS`（仅补丁预览差异格与按钮态，不触发 `analyze()`）
- `setFilter(patch)`：`DIRTY_LIB_FILTER`（纯切换常驻节点 `el.hidden`，0 节点分配）
- `setTheme(t)`：仅改 `document.documentElement.dataset.theme = t` + 写 `localStorage` + 仅更新主题分段按钮高亮（0 主文档重排）
- `star-up / set-star`：帧 1 同步 `DIRTY_BOARD | DIRTY_INSPECTOR`（若影响星数羁绊如 K/DA 则加 `DIRTY_TRAITS`）；帧 2 异步 `analyze()` → `DIRTY_RECS`
- `equip-item / unequip-item / add-loose / delete-loose / unequip-to-loose`：帧 1 同步 `DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_EQUIP | DIRTY_TRAITS | DIRTY_POP`；帧 2 异步 `analyze()` → `DIRTY_RECS | DIRTY_EQUIP`
- `add-unit / remove-unit / context-unit / apply-plan / reset`：帧 1 同步 `DIRTY_BOARD | DIRTY_INSPECTOR | DIRTY_POP | DIRTY_TRAITS | DIRTY_EQUIP | DIRTY_LIB_STATE`；帧 2 异步 `analyze()` → `DIRTY_RECS | DIRTY_BOARD (自动职责标) | DIRTY_EQUIP`

### 4.3 双帧非阻塞分析管线
- `scheduleAnalyze()` 递增 `ui.gen`，取消旧 `tracker` 与旧 `unlockTracker`，挂一个 `requestAnimationFrame(() => setTimeout(() => runAnalysis(gen), 0))`。
- 帧 1 已完成肉眼可见的棋盘/选中栏/装备/羁绊修补（`< 1ms`）；帧 2 计算 `resolveLooseItems` + `buildUnlockContext` + `game.recommend()`（以及在天梯/史密奇解锁时启动分片 `game.track()`），完成后校验 `gen === ui.gen` 再触发 `DIRTY_RECS` 局部更新。

### 4.4 右键禁用 1.2s 撤销状态机
- `ui.pendingBans`: `Map<unitId, { timerId, phase: "grace" | "sliding", startedAt }>`
- `startBan(unitId)`：
  1. 若已在 `pendingBans` 中，调用 `cancelBan(unitId)` 立刻复原；
  2. 否则写入 `pendingBans`，局部给右栏匹配 `[data-ban-unit="${unitId}"]` 节点加上 `.is-banning`（呈现暗红删除线、`[撤销]` 按钮与 `1200ms` 纯 GPU `scaleX(0)` 进度条）；
  3. `1200ms` 后切换为 `.is-sliding-out`（`220ms` `transform: translateX(-28px); opacity: 0`）；
  4. `220ms` 后提交 `state.bannedIds[unitId] = true`，删除 `pendingBans` 记录并调用 `scheduleAnalyze()`。
- `unbanUnit(unitId)` / `clearBans()`：立刻从 `state.bannedIds` 删除并异步重算。

---

## 5. HTML 固定 ID 契约 (`index.html`)

| 区域 | 必须存在的固定 ID / 属性 |
| :--- | :--- |
| **顶栏** | `#season-set-pill`, `#season-name`, `#save-state`, `#btn-level-dec`, `#val-level`, `#btn-level-inc`, `#btn-extra-dec`, `#val-extra`, `#btn-extra-inc`, `#btn-mode-trigger` (`popovertarget="mode-menu"`), `#mode-label`, `#mode-menu` (`popover="auto"`), `#btn-allow-locked`, `#btn-settings-trigger` (`popovertarget="settings-menu"`), `#settings-menu` (`popover="auto"`), `#theme-seg`, `#btn-import`, `#btn-export`, `#btn-bundled`, `#btn-demo`, `#btn-clear`, `#import-file`, `#notice-bar` |
| **左栏** | `#active-trait-count`, `#btn-goal-dec`, `#val-goal`, `#btn-goal-inc`, `#traits-list`, `#btn-emblem-quick` (`popovertarget="emblem-menu"`), `#emblem-menu` (`popover="auto"`), `#equip-bench-grid` (`data-drop="equip-bench"`) |
| **中栏** | `#pop-ratio`, `#pop-sub`, `#preview-banner`, `#preview-banner-text`, `#btn-preview-apply`, `#btn-preview-exit`, `#hex-board`, `#inspector-dock`, `#tab-units`, `#tab-items`, `#search-q`, `#btn-search-clear`, `#cost-filters`, `#kind-filters`, `#role-filter`, `#trait-filter`, `#library-units-grid`, `#library-items-grid` |
| **右栏** | `#advisor-title`, `#advisor-sub`, `#advisor-body` |
| **顶层浮层** | `#rich-tip` (`popover="manual"`), `#drag-ghost` |

---

## 6. 视觉与交互硬规则清单（验收标准）

1. **三栏顶头严格统一 `--pane-head-h: 42px`**，横向分割线无锯齿。
2. **双主题 OKLCH + `light-dark()`**：默认暗黑深曜石，在 `设定 ▾` 中可切明亮战术白图；白色羁绊剪影在浅色主题下通过 `:root[data-theme="light"] { --trait-micro-filter: brightness(0) opacity(0.70); }` 清晰可见。
3. **无卡片套娃**：全屏结构分割线布局；全站锁定单一主强调色「锻金铜」；形状仅六边形 + `4/6/10px` 工业倒角；补齐 **7 费棱彩玫瑰金** 与 **2 格纳什男爵** 八角胶囊。
4. **双层无裁切六边形**：`.hex-chrome` 在 `clip-path` 外部渲染 1★/2★/3★（三角排布）、`主C/副C/主坦` 角标、`核心` 标与底部 3 格装备图标，零裁切。
5. **静默禁用态 & 静态棱彩**：未激活棱彩开关呈虚线灰 Disabled 态，激活为静态虹彩，**彻底禁止 `@keyframes bp-prism` 流动动画**。
6. **左栏极简**：仅 `羁绊`（全余高）+ `已有装备`（固定 2 行 6×2 `max-height: 77px` 内部滚动，含 `+ 纹章 ▾` 添加 22 件真实纹章，无全局虚拟纹章区）。
7. **顶栏与 Tab 极简**：`人口` 纯显 `0 / 1 / 2`（无 `+0`）；棋子/装备 Tab 不显示 `94 / 147`；解锁目标区仅标一次 `将以上场构筑`，不重复文案。
8. **棋盘交互**：左键单击选中、双击或选中栏直切星级、右键逐级卸装→降星→移出；装备右键或拖出有效区松手删除（幽灵显示 `松手删除`）。
9. **极致构建产物**：`npm run build` 产出 `dist/`（IIFE + 复制全部运行资产），直接打开 `file:///.../dist/index.html` 零报错。
