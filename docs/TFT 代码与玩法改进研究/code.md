# TFT 工作台代码审阅（只读）

审阅当前 `engine.js`、`app.js`、`board.js`、`styles.css`、`build_data.py`、template/schema、`index.html` 与测试源码。未改动项目、未运行测试或 git 命令。以下缺陷为静态代码可证实处；性能部分是复杂度风险，不是实测结论。

## 架构图纲

```text
index.html (classic script/file:// entry)
  ├─ data.js: SET19 static payload ─┐
  ├─ engine.js: TFT.normalizeSet → TFT.create → pure-ish recommendation API
  │      ├─ evaluate / traits / roles / score
  │      ├─ fill/beam search, plans, swaps/starUps
  │      └─ track(): incremental trait-target search task
  ├─ board.js: TFTBoard.apply/normalize (state transitions + validation)
  └─ app.js: DOM event delegation + localStorage + analysis/render loop
         ├─ recommendation result → planCard / swapCard / star-up presentation
         └─ styles.css: responsive board, library, trait and recommendation UI
build_data.py → static JSON + data.js + icons; template JSON/schema → custom season input
```

Sources: [index.html](file:///C:/Users/xegna/Documents/Workspace/tft-set19/index.html#L1-L8); [engine.js](file:///C:/Users/xegna/Documents/Workspace/tft-set19/engine.js#L6-L12); [board.js](file:///C:/Users/xegna/Documents/Workspace/tft-set19/board.js#L1-L8); [app.js](file:///C:/Users/xegna/Documents/Workspace/tft-set19/app.js#L253-L295); [build_data.py](file:///C:/Users/xegna/Documents/Workspace/tft-set19/build_data.py#L427-L436).

## 优先级改进建议

### P1 — 让替换评估能被用户核验，并统一安全门槛

- **承载者评分是启发式而非战斗强度，且启发规则彼此不同。** `carryScore`/`tankScore` 是 cost/stats/role 权重公式，非战斗模拟；分类器先按投资再按 carry/tank 分数，carry 在非reroll且两边都未三星时又插入 on-curve 优先（`engine.js:334-418`）。该自定义比较器的 on-curve 特判只适用于比较双方都低于三星，而一边三星时退回分数比较，因此不满足简单统一的全局排序关系，存在非传递比较的风险。`swaps()` 按投资升序选坦克替换出牌，`coreUpgrades()` 却按 outInv 降序排（`1263-1290`,`1228-1231`）。建议明确统一的顺序/决策优先级，不能从单位金币费用推导战斗力。
- `fullSwaps()` 只要求整板 `evaluate()` delta > 1，固定换入1星（`engine.js:1234-1260`）；整板启发式分数可能掩盖换掉高星单位/关键前排、拆羁绊档位或关键装备损失。`coreUpgrades()` 则按 bucketScore 比较并试算换入1/2星（`1192-1225`），但该分数仍非战斗模拟。统一替换硬门槛/风险字段：星级、关键职责、阈值断档、装备迁移。保留现有 `replacement()` 的 item compatibility、mark/position 继承与徽章退散件机制（`1144-1189`）。
- 坦克候选 `realTank()` 除必须是 `roleGroup==="tank"`，还要求 `cost >= curve.floor`（`engine.js:343-345`）；故即便低费用坦克已经3星，只要费用低于当前策略 floor，仍不被视作 realTank，可能触发缺坦判断/坦克重平衡（`1263-1290`）。建议以星级、持有投入/职责或明确用户角色优先，避免费用门槛覆盖高星既有 tank。替换卡片还缺 `reasons`，且 traitChanges 只报人数、不报档位效果变化（`903-913`,`app.js:706-713`）；补出牌星级、羁绊增损、装备处理与理由。

### P1 — 3星资格与用户给出的策略偏好单独建模

- `enginePlans()` 仅在 reroll 模式寻找 `grantsUnit && cost<=3` 引擎（`engine.js:975-995`）；`starUps()` 则对现有上场单位算下一星，没通用4/5费候选过滤，且空理由项目也可能回退显示（`1087-1133`）；UI只显示星级变化，不显示理由（`app.js:739-741`）。分离“自动追星资格”与“手动已拥有阵容状态”：自动追星过滤4/5费，现有高费单位仍保留可查看/分析；5级追1/2费、6级追2/3费、7级追3费仅为可配置偏好。当前数据没有bench副本数，不能推算离合星差几张，也不能把费用档 odds 当成单牌概率。

### P2 — 用户界面有少数可确认的呈现差异

- 已选中棋子的框**确为金色**：`--accent:#e0a04a`（`styles.css:11`），`.cell.selected::before` 使用该 token（`259-260`），无需按“非金色”改。棋子装备标记是统一 `var(--text)` 白色圆点（`app.js:526`; `styles.css:326-332`），只显示数量而非具体装备。三星以横排文本 `"★".repeat(star)` 呈现（`app.js:524`）；容器宽度随棋盘压缩而字体固定11px（`styles.css:216-228,292-303`），小尺寸下有拥挤/识别风险，值得采用更紧凑但仍横排的三星显示。
- **羁绊当前没有按铜/银/金/彩/棱彩档位着色。** `tierOf()` 返回最高已达档位的 `need`，`renderTraits()` 只给按钮添加 `on/unmet/target`（`app.js:388-395,454-466`）；CSS 只给 on 用同一白色底、unmet 灰色、target accent（`styles.css:191-194`），没有按 `bp.style`/`prismaticStyle` 分配铜银金彩棱彩颜色。建议由 breakpoint style 元数据生成语义 class/color，且区分已达、目标与棱彩开启。`planCard()` 显示 reasons，`swapCard()` 不显示，属于另一个可确认的信息一致性问题（`app.js:688-713`）。
### P2 — 控制计算重复，保留可渐进的主线程分片

- `evaluate()` 遍历全 traits、计数/排序，`holderPenalty()` 又做 `classify()`（`engine.js:677-729,455-475`）；候选评估和 beam 搜索重复调用 evaluate（`737-845`），fit/starUps/swaps 也对相近棋盘重算（`999-1047,1087-1133,1194-1309`）。这是重复工作风险，**没有 benchmark，不能声称卡顿或量化收益**。`app.analyze()` 同步跑 recommend；仅 ladder 的 track task 按约8ms/1000 nodes 分片并可取消（`app.js:285-320`）。先固定场景计时，再考虑单次分析内复用 board evaluation/classification、将 recommend 渐进接入 task API。JSON clone 与小列表 filter/sort 先不动（`app.js:283,603-624`; `board.js:10-11,341-363`）。

### P2 — 模块边界和数据兼容性

- 保持 classic scripts/IIFE 与 `TFTBoard.apply/normalize` action 边界，继续支持 `file://`；可渐进拆分 engine 为 set validation、evaluation/explanations、search/policy 内部模块，不需要 bundler/framework（`board.js:341-366`; `engine.js:1877-2000`）。schema 应要求唯一稳定 IDs、引用完整性并对导入给出定位诊断；当前 schema 缺少唯一性/引用检查（`set.schema.json:5-28,30-53,56-113`），runtime 对导入主要捕获异常（`app.js:1095-1105`）。
- 稳定 ID 是单位/羁绊/装备/存档引用基础。builder 将外部静态数据和手工规则写入数据文件（`build_data.py:21-27,590-614`）；schema meta 目前只描述 template/set/name/locale（`set.schema.json:8-15`）。项目 Set19 来源混合 `tftTest` 与 Data Dragon 16.23.1；Riot 文档明确宣布 **Set19.1 自2026-12-01起改用新 Unreal 数据管线**，并会改变发布时间、包含赛季、文件路径、标识符、schema、图片与移除 spritesheet 字段。[Riot TFT Data Dragon 文档](https://developer.riotgames.com/docs/tft)。将 `source/fetched/gamePatch/dataStatus/schemaVersion` 纳入 schema 和界面来源标记；在新管线切换后验证 ID、图像路径及字段迁移，不把旧测试源标作 live。
- 存档目前单一 `tft-board-v2` 键（`app.js:4,183-209`）；切换赛季时保留匹配 ID 的星级/职责但清位置和装备（`345-357`）。若用户要保留多个赛季工作区，按 set/custom-data identity 分区存档并提供版本迁移；这是明确功能选择而非已有多工作区。

## 已有好模式与证据

- `board.js` 集中动作验证：覆盖重叠格、双格棋子、物品槽数/唯一性/纹章重复和已具羁绊，提交错误时返回原状态（`board.js:34-75,92-108,341-363`）。
- replace pipeline 有实际保护：防重复单位、解锁 key、exclusive、商店可抽资格（`engine.js:737-748`）；继承 mark/position，处理 item incompatibility 与 loose emblem（`1144-1189`）。
- `track()` task 可 step/cancel，UI 通过 generation guard 丢弃陈旧结果并轮转执行（`app.js:285-320`）；正常推荐也可向此模式统一。
- 渲染对用户文本大多通过 `esc()` 进入 HTML（`app.js:31-35`），`safeUrl()` 限定 scheme（`engine.js:33-41`）；继续用 DOM textContent 或集中 escaping。
- 测试源码已有角色识别、坦克重平衡、core swap 物品/mark/站位迁移、三星低费不得以1星直接替换、minRoll、羁绊搜索最小性等小型行为测试（`test_engine.mjs:23-54,253-299,393-400`）。未运行测试，不能声称当前通过/失败。
