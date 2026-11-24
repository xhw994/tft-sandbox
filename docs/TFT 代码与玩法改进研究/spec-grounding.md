# 建议收益算法实现规格——代码/数据落点

只读 ground-truth，供实现规格作者使用；未改代码、未跑测试。

## 数据事实与五费例子（不等于强度结论）

- 当前 unit 记录可提供稳定 `id`、`cost`、`role/roleGroup`、`lane`、`traits`、`stats{hp,ad,ar,mr,as,range,mana,manaStart}`、`ability{name,text}`、`unlock*`、`slots`、`dynamic`；`normalizeSet()` 还可有 `star` 只存在于棋盘 entry，不是 unit 静态字段。数据范例见 `template/set.schema.json:78-111`、`template/set.template.json:32-95`；归一化入口 `engine.js:1877-1997`。棋盘 entry 有 `id,star,mark,position,items`（`engine.js:237-244,1401-1432`）。Item 有 id/kind/tags/trait/buildsFrom/slots/unique/teamSize 等（schema `56-75`）。Traits 有 id/kind/countMode/breakpoints；装备纹章会影响 effectiveTraits（`engine.js:85-97,147-155`）。这些字段足以做透明的静态特征与星级/装备反事实差值，**不足以做准确的战斗胜负模拟**。
- 数据中五费且有 solo trait 的例子：**芮尔** `DA_Rell19`，role tank/front，Traits `DA_RnB19` + `DA_Rell19_UniqueTrait`；ability 文本提到4秒护盾与音波，故可抽取“护盾”能力标签但当前数据并未给能力标签结构或目标条件；文本还列出骑乘/非骑乘两个技能分支（需区分状态，不能当两种同时生效的能力）。**崔斯特** `DA_TwistedFate19`，marksman/back，solo trait + Trickshot；ability 文本描述战斗开始按商店牌数抽牌、刷新后战利品及攻速/多目标卡牌。可推断存在经济/战斗效用候选，但收益依赖开战商店牌数、是否刷新等条件，且引擎当前未建模战前商店/随机 loot。**努努和威朗普** `DA_Nunu19`，specialist/front，solo trait + Frontman；描述有法力回复与滚动球体伤害，没有证据支持把它标为控制、减疗或团队护盾。[当前快照字段来自 `data/set19.json` 对这些 ID 的 JSON 记录；来源/抓取时间列于该文件 meta。此为 tftTest 数据快照，tooltip 数字不能当作 live 数值，不基于它给出强弱/版本强度结论。]
- 这些例子说明“5费 + solo trait”不应自动赋统一加成。该牌如果能低代价填人口、提供与当前板不同的有效能力、且不会拆核心职责/羁绊，可作为独立的一种可选补强类别；solo 本身不是额外战斗能力。Tooltip 的自由文本可供人工标注/提出待核验标签，但不应靠关键词解析当成权威机制表。

## 收益算法建议（可解释、待调参）

建议所有候选都评估同一对象：`candidateBoard = candidateAction(currentBoard)`，通过唯一 `evaluateBoard(board, ctx)` 返回分项及 blockers，再以基线 delta 排序，而非按费用/角色直接打单一分。分项举例：

`gain = ΔboardValue + ΔtraitValue + ΔroleCoverage + ΔcapabilityCoverage + Δposition/itemCompatibility - replacementLoss - risk`

- **羁绊启用者**：以 `traitCount`/`breakpointState` 现成结果，比较新增/失活阈值与部分进度，给每个 trait 一个单独边际值（已有值函数 `STYLE_VALUE`, `breakpointState`：`engine.js:7-8,147-201`）。已激活再添人的收益是到下一断点的部分进展，不可再次记一次相同断点全额收益；枚举 `effectiveTraits`，纹章与原生羁绊同 trait 只计一次（`85-97`）。
- **主C/主坦升级**：对主C输出、真实坦克承担/耐久分别评估，但能力存在和职责标签不是 combat power 的证明。角色贡献用“是否补当前缺口 + 单位 stat 基线变化”边际估分，并保留星级因子；不要使用 `cost^x` 作为替代品。现有 `carryScore/tankScore` (`engine.js:346-355`) 可作为旧基线/输入特征，不要被直接提升为真实战力值。
- **utility bot**：对队伍控制、减疗、破甲/削抗、治疗/护盾、团队增益、法力/经济等能力记录“能力覆盖”而非伤害假设；只给未满足的团队需求正向权重，重复来源应用 diminishing return/上限。例如相同“破甲”已覆盖时第二个来源边际下降，避免同一个单位的同能力同时以主C分和 utility 全额记分。
- **五费 solo-trait splash**：类别是候选解释标签，不是固定分。Solo trait 可以是单位自身机制，不意味着给所有队伍一个羁绊全队增益。将其 utility 标签、能力有效条件、队伍当前需求和人口/替换代价通过同一个边际算法判定；不预设五费一定强于三星低费。
- **收益去重原则**：维护归一化 capability key（如 `shield.team`, `shred.armor`, `control.stun`）及作用范围/目标/持续条件；一个能力只通过 capability coverage 项计分一次。trait value 独立评估真正羁绊断点/进度；若 trait 效果本身与 capability key 重叠，应选一方计入或显式折减，禁止“羁绊激活值 + 能力标签全值”双计。全局置信度/来源级别乘数区分官方结构化字段、人工确认、文本抽取/未知。
- **条件/可靠度契约**：season 数据 `capabilities[]` 建议存 `{id,kind,scope,target,condition,source,confidence,stackGroup,notes}`；`kind` 枚举至少 `control, antiheal, armor_shred, mr_shred, heal, shield, mana, team_buff, economy`。`condition` 为文本或小型结构化门槛（如开战/施法/变形/商店刷新），没法建模的条件标 `unknown` 并降低置信，不编造触发率/数值；`source` 记录 tooltip/手工校核/patch。若数值可被精确解析，另设 value+unit+stage，未确认则空值。优先人工/官方数据验证后添加标签。
- 分数应输出子项（trait breakpoint、carry/tank delta、coverage gap、换出损失、风险）与语义 reasons；权重是可配置的产品偏好/启发式，提供解释，不称胜率或绝对强度。9金币/购买成本不可用作战斗收益 proxy。

## 统一评估迁移覆盖点、现存约束

建议 `evaluateBoard`（可先包现有 evaluate）成为所有增加/替换/升星候选的共用分数与 explanation 契约，并独立 `assessReplacement` 对星级/职责/装备/羁绊损失实施硬门槛；避免只改普通填板，遗漏特殊路径：

1. `shortlist()` + `fill()`，连同 empty-board `openings()` 的候选（`engine.js:778-845,951-973`）。
2. `nextBuys()` 单位推荐（`1066-1085`）。
3. `starUps()` 现有单位升星（`1087-1133`）；不是模拟 bench copies 的商店命中率。
4. `coreUpgrades()`、`fullSwaps()` 及 `tankRebalance` 两次换人组合（`1192-1309`；第二替换另在 `1475-1501`）。
5. `fit()` 的溢出下场/精炼评估（`999-1047`）；不能让候选算法保护主C、但满人口 fit 删除主C。
6. plan materialization / `applyPlan` 传回的解释与装备结果（`915-935,1169-1189`; UI `app.js:688-713`）。

当前一些有益门槛应保留：`legal()` 控制重复、slots、rollable、unlock keys 与互斥单位（`engine.js:737-748`）；`replacement()` 保留 mark/position、验证装备、纹章处理（`1144-1166`）；`board.js:51-75,92-108` 验证装备与站位。显式用户 mark 的优先级也应保留：`classify()` 首先选手动 `carry/carry2`；`replacement()` 把出牌 mark 传给新单位（`engine.js:426-430,1144-1166`）。即使换入单位 roleGroup 不同，手动 carry/tank mark 仍应作为用户指定职责保留、不能因为自动 role inference 改写。

### 需要解决的已见边缘约束

- `realTank(unit,ctx)` 目前定义为 `roleGroup==='tank' && cost>=curve.floor`（`engine.js:343-345`），会把低费三星坦克仍标成“非 realTank”，使缺坦判断/满人口 rebalance 误认为无坦（`1263-1290,1460-1523`）。推荐 evaluator 的 tank coverage 应基于职责、星级、装备/用户 mark 等一致特征，而不是仅成本 floor；低费/高星已持有 tank 不得因 reroll/等级曲线被否认。
- `classify.infer('carry')` comparator 先投资，再对“两者都未三星”用 on-curve 特判，否则用分数（`engine.js:401-418`）。此 pairwise 条件产生非全序风险：排序算法期待可传递 comparator；应先算每行明确 tuple/rank（如 explicit mark > 当前职责持有/投资 > on-curve tier > score > stable ID），再以同一 key 排序，避免比较结果取决于 sort 次序。
- 四/五费自动三星追牌与手动阵容分析必须拆开：`starUps()` 遍历所有现有棋子，不限 cost；它列出的建议是已持有单位下一星，不是因为任意高费可自动追牌就合理（`engine.js:1087-1133`）。候选策略过滤不许删/降级手动已放棋子或清除其装备/mark。

## 测试范围提示（不执行）

现有 `test_engine.mjs` 已覆盖角色识别、坦克重平衡、swap 装备/mark/position、高星低费不可用1星候选直接替换、minRoll 与 tracker 最小性（`test_engine.mjs:23-54,253-299,393-400`）。但未见对能力标签条件/去重、收益分项可解释性、style-specific UI、成本异级效用比较、realTank低费三星、强制mark跨role替换、候选排序稳定/传递性及 `starUps` 高费偏好/已有高费保留的专门断言。测试存在不等于已运行/通过。
