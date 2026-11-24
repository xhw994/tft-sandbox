# 推荐系统 V2 需求规格

## 目标与范围

本规格定义现有 TFT 手动阵容工作台的下一版推荐、呈现、数据与性能契约，供后续实现拆分任务使用；**本次仅定规格，不改运行时代码、测试、README 或构建产物**。目标是让推荐跨路径一致、对用户可核验，并明确启发式局限；不是追求伪精确的战斗模拟。

范围内：评估加入/替换后的完整棋盘边际收益，统一候选硬门槛与保护规则，区分羁绊激活和单位职责/工具性，追三星偏好及条件状态，补齐已确认 UI 项，增强静态数据/存档兼容性，并验证性能后再优化。可选扩展为用户输入经济、等级、回合与已有副本的手动备战比较；这些字段目前不存在，不是基础推荐修复的前置条件。

不做：运行中游戏读取、实时对局指令、对手侦察/预测、胜率承诺、未经数据支持的实时经济或指定棋子命中概率、精确伤害模拟、自动最佳装备/站位方案。维持静态搭建/复盘工具定位。Set19 当前数据混有 tftTest 与 Data Dragon 16.23.1，必须标注来源和版本，不能声称已验证 live。

## 现状与设计原则

入口 `index.html` 加载 classic scripts，可从 `file://` 使用；`engine.js` 实现评估、分类、搜索、换牌与追星，`board.js` 提供集中状态转换与校验，`app.js` 管理 DOM、存档和渲染；构建器及 JSON schema 管理赛季数据。保留这条无 bundler 的路径及 `TFTBoard.apply/normalize` 动作边界。已有动作验证、装备兼容/继承、徽章处理和 `track()` 的分片取消、generation guard 是应延续的模式。

设计原则：资格和不可接受损失先于分数；所有建议基于完整棋盘前后差值；价格不等于战力；角色标签、普攻静态属性和费用不等于技能模拟；未知项不奖励候选，也不惩罚双方共有的未知；同一战斗效果只记一次；状态事实、当前收益、未来潜力和经济机会成本分别展示；确定性规则优先于复杂综合分。不得用统一“封顶”把已有高星棋子压到普通一星的等价价值。

## 推荐评估契约

所有生成器（阵容填充、核心升级、整板换牌、坦克重排、羁绊/计划搜索和追星）调用同一评估入口，建议流水线固定为：

```text
生成候选 → 资格/锁定/星级/物品校验 → 构造 before/after 完整状态
  → 计算差分及风险 → now / conditional / alternative / unknown
  → 确定性排序 → 输出同一解释结构
```

`before` 是用户当前状态，`after` 是候选动作合法应用后的完整状态；不得把未持有单位/副本写成已拥有。建议接口 `assessCandidate(before, action, context, profile)` 返回统一 `CandidateAssessment`；建议结果至少满足此契约：

```json
{
  "candidateId": "stable-action-id",
  "inputRevision": "board+set revision",
  "action": { "type": "replace|add|starUp|fit|plan", "unitIds": [] },
  "status": "now|conditional|alternative|unknown|blocked|not_recommended",
  "blockers": [],
  "conditions": [],
  "contributions": [{
    "featureId": "frontline.coverage",
    "bucket": "damage|frontline|traits|utility",
    "sourceIds": ["stable-source-id"],
    "before": { "lo": 0, "mid": 0, "hi": 0 },
    "after": { "lo": 0, "mid": 0, "hi": 0 },
    "delta": { "lo": 0, "mid": 0, "hi": 0 },
    "sourceChanges": [{
      "sourceId": "stable-source-id", "effectIds": [],
      "beforeEvidence": { "lo": 0, "mid": 0, "hi": 0 },
      "afterEvidence": { "lo": 0, "mid": 0, "hi": 0 },
      "marginalBefore": { "lo": 0, "mid": 0, "hi": 0 },
      "marginalAfter": { "lo": 0, "mid": 0, "hi": 0 },
      "explanationOnly": true
    }],
    "dependencyUncertain": false,
    "futureOnly": false
  }],
  "score": { "lo": 0, "mid": 0, "hi": 0, "minNow": 2 },
  "risks": [],
  "reasons": [],
  "materialization": {
    "added": [], "removed": [], "starChanges": [], "markChanges": [],
    "itemMoves": [], "looseItems": [], "requiresUserApply": true
  }
}
```

`contributions` 按唯一可加总 feature 输出 interval/Δ；各 effect/source 的 before/after evidence 与 leave-one-source-out marginal 仅作说明，明确 `explanationOnly`，不相加。`conditions` 明确所缺上下文/目标；`blockers` 是不可自动执行原因；`materialization` 明示升星/移除/mark 改动、物品迁移与松散装备，不可丢弃/伪造资产。该结构须用于 `shortlist/fill/openings/nextBuys/starUps/coreUpgrades/fullSwaps/tankRebalance/fit/plan materialize/applyPlan` 所有路径。

状态枚举互斥，按以下顺序裁决：无效动作/硬约束失败为 `blocked`；关键变更效果资料未知且区间不足以判断为 `unknown`；必须依赖未输入等级/商店/阶段/角色 mark 选择等条件为 `conditional`；完整输入下若保守 `score.lo > minNow`（初值2启发式点）且无降星，则为 `now`；中心值为正但未过线，或正收益的2★→1★替换，为 `alternative`（需用户确认，不自动 apply）；否则 `not_recommended`。no-op 为0且不列为升级。2★目标只有在已提供合法副本/目标条件时才可评为 `now`；没有 bench 副本输入时为 `conditional`，仍只生成待执行目标，不在 materialization 中制造已拥有的二星。所有 star-up 由用户确认后应用现有 action。推荐列表先分组 `now > alternative > conditional > unknown`；conditional/unknown 各自独立，不跨组按分数比较；blocked/not_recommended 不进入推荐列表。相同 status、`inputRevision` 和比较 context 内按固定字典序：`score.lo` 降序、`score.mid` 降序、risk 数量升序、策略 preference 匹配度降序、stable `candidateId` 升序；不同 target level/条件属于不同 context。使用精确 tuple 比较，不设 epsilon、不使用非传递 comparator。

等级/人口可从现有棋盘/上下文读取，不得误报为缺失。当前未记录或不完整的是阶段/回合、金币、商店、备战席副本及对手争牌状态；已有棋盘上的副本可直接计数，备战席副本可作为可选用户输入，未输入只表示无法计算全部持有数，不抹去已知棋盘副本。缺少共享池/对手占有信息时无法给单牌概率；不影响展示已输入的持有副本。未来经济机会成本独立于当前 `score`。

## 候选资格与保护约束

统一门槛至少检查唯一/解锁/商店可抽资格、羁绊与人口合法性、槽位/装备兼容、目标星级资格、星级损失、关键职责和现有用户意图。必须覆盖所有生成/转换路径：`shortlist()`/`fill()`/空盘 `openings()`、`nextBuys()`、`starUps()`、`coreUpgrades()`、`fullSwaps()`、`tankRebalance` 两次换人、`fit()` 溢出下场、plan materialization/`applyPlan`。特别验证 rebalance 第二笔替换也过同一门槛；任何候选不可从特殊路径绕开。一个门槛失败就不进入总分排序，输出明确原因。

`focusId` 是身份锁；carry/carry2/tank mark 是用户职责意图，不是锁也不是 strength evidence。原始棋盘 mark 永不被 evaluator 改写；profile 的 `markCompatibility` 控制计划能否保留/迁移，处理规则见下文。

身份锁仅为 `focusId`；自动换牌不得以低星替代已有三星，三星身份本身可由同星/更高星候选升级替换。职责容量按已算好的 `damage/frontline` coverage 保护，而不锁定主C/主坦单位身份：若当前板 `before.lo >= 0.30`，该角色即为 duty obligation（不论是否有 mark）；其自动替换下限为 `floor=min(before.lo,0.60)`，候选 `after.lo` 必须达到 floor。手动 `carry/carry2/tank` mark 再分别增加同角色 obligation，但 mark 不作 evidence。Duty floor 明确低于下限则 `blocked`；after/before 区间不足以确定是否达到 floor，则按上述状态规则为 `unknown` 或 `conditional`。角色 mark 的 `markCompatibility[mark]` 必须由 profile 给 `compatible/incompatible/unknown`：仅 compatible 可在用户 apply 时迁移；其他情况保留原 mark 并要求用户选择，不能静默清除/迁移或由 mark 赋予 incoming 强度。

所有自动换牌禁止用低星单位替掉已有三星；这是星级硬门槛，不等于锁死三星单位身份：另一名同星/更高星且满足职责 coverage 下限的单位可升级替换。2★→1★ 替换可计算并解释，但最多 `alternative`、必须用户确认，不能 `now`。`focusId` 锁定、非法物品/人口/重复单位等候选为 `blocked`。三星目标可以是其他手动候选，但不得由自动追三星筛选移除手动已有高费三星状态。移除职责成员不因名字/“主C”标签被永久禁止；角色容量由 profile 的 after 下界和总收益共同决定。

## 收益模型与可解释分解

### 有界、差分、可审计的启发式

V1 只允许四类当前收益，权重固定且总和精确为100；**没有未定义的“其他代理分”**：

```text
S = 30·Δdamage + 30·Δfrontline + 25·Δtraits + 15·Δutility
每个 Δbucket = f_bucket(after) - f_bucket(before)，f ∈ [0,1]
```

以下是唯一启发式 profile 的初值；它用于透明排序，不是胜率、DPS、护甲或经实战校准的强度。所有中心值/上下界可由当前赛季 profile 覆盖，但须保留来源和 patch。

```json
{
  "id": "heuristic-v1",
  "weights": {
    "damage": 30, "frontline": 30, "traits": 25,
    "utility": { "control": 4, "survivability": 4, "enemyDebuff": 4, "teamSupport": 3 }
  },
  "minNow": 2,
  "rolePriorLevels": {
    "low":    { "lo": 0.10, "mid": 0.25, "hi": 0.40, "confidence": "low" },
    "medium": { "lo": 0.40, "mid": 0.55, "hi": 0.70, "confidence": "low" },
    "high":   { "lo": 0.65, "mid": 0.80, "hi": 0.95, "confidence": "low" }
  },
  "roleStarFactor": {
    "1": { "lo": 0.55, "mid": 0.60, "hi": 0.65 },
    "2": { "lo": 0.75, "mid": 0.80, "hi": 0.85 },
    "3": { "lo": 1.00, "mid": 1.00, "hi": 1.00 }
  },
  "damageAggregation": { "top": 2, "coefficients": [1.0, 0.35], "cap": 1.0 },
  "frontlineAggregation": { "top": 3, "coefficients": [1.0, 0.50, 0.25], "cap": 1.0 },
  "trait": { "strengthDivisor": 4, "progressAffectsCurrentScore": false },
  "utilityAggregation": {
    "exclusiveSameStackGroup": "max",
    "independentControl": { "top": 3, "coefficients": [1.0, 0.50, 0.25], "cap": 1.0 },
    "additive": "only-if-profile-declares-stackCap"
  },
  "unknownEquippedItemDelta": { "lo": -0.10, "mid": 0.0, "hi": 0.10 },
  "sourcePriority": ["confirmed-structured", "manually-verified", "unverified-extraction"]
}
```

V1 只有 `damage/frontline/traits/utility` 四项；没有额外 `star/position/item` 分。profile 为每单位的 damage/frontline 写 `level: low|medium|high`（映射上方有界表）或显式 `{lo,mid,hi}`，附 `source,patch,confidence`，允许 per-star 覆盖；粗等级只能是 low-confidence 角色先验，不是 DPS/护甲实值。`roleGroup` **只用于候选资格/mark 兼容性，不是战力证据**；AD/AS/技能文本不可自动换算伤害。V1 每个可进入 shortlist 的 unit 都有 profile 行；无证据写 unknown，不能以0当真值，相关候选不可成为 now。五费及 solo-trait 单位均有 review 状态，对各工具能力写已核实 effect、已核实不存在或 unknown；不要求无证据地填全能力，但不能因 rarity/trait name 加分。

单位 role 记录的固定形状例如：

```json
{
  "unitId": "set-stable-id",
  "damage": {
    "level": "low",
    "source": "curated-role-prior", "patch": "set-id",
    "confidence": "low",
    "byStar": { "3": { "lo": 0.65, "mid": 0.80, "hi": 0.95 } }
  },
  "frontline": { "level": "medium", "source": "curated-role-prior", "patch": "set-id", "confidence": "low" },
  "supportedRoles": ["tank"],
  "markCompatibility": { "tank": "compatible", "carry": "unknown", "carry2": "incompatible" }
}
```

`supportedRoles`/`markCompatibility` 仅声明职责/标记是否兼容，不贡献 score；unknown mark compatibility 必须等用户选择。缺少某一 role/capability q 时固定为 `{lo:0,mid:0.5,hi:1,confidence:"unknown"}`；mid=0.5 只为区间运算，不是证据值，无法因此成为 `now`，也不以0当真值。`roleGroup` 不可直接加权。profile 里未覆盖 unit 的所有候选路径给 unknown。

每单位每角色供给为 `q_i,r=clamp(evidence_i,r×roleStarFactor[star]+knownItemDelta_i,r+unknownItemDelta_i,r,0,1)`；有可信 per-star 覆盖时用该星 evidence（仍可叠装备增量），不再乘 starFactor。无装备时 item delta 精确为0；已识别装备只通过 canonical owner 的显式效果增量改变相应 q，不另加分；无法识别的已装备物保留已知基线，**每单位/role 汇总后**加一个 `unknownItemDelta∈[-0.10,0,+0.10]`（normalized q 的加法区间，中心0；只在最后 clamp 至 `[0,1]`），不可按物品数量叠加未知区间。按 q 降序，伤害 coverage 只用前两名：`f_damage=min(1,q1+0.35q2)`；前排只用前三名：`f_frontline=min(1,q1+0.50q2+0.25q3)`，缺少者为0；第4名以后无直接加分。由此同职责升级可补位，不因增加裸 carry 数获得全额同等收益；低费三星坦克按 role/star evidence 进入前排评分，不受 cost floor 排除。

工具能力不得继承 `roleStarFactor`：effect 必须给逐星 `[lo,mid,hi]`，或显式 `starInvariant:true`；否则该 effect unknown。Utility channel 权重固定为 control=4、survivability=4、enemyDebuff=4、teamSupport=3，最终 `f_utility=(4f_control+4f_survivability+4f_enemyDebuff+3f_teamSupport)/15`。每个 channel 中先按 `(stackGroup,target,condition)` 聚合：`exclusive` 取 `max(q)`；`additive` 取 `min(1,stackCap,Σq)` 且必须显式有 `stackCap`；其他 stacking 未声明为 unknown。Control 对 exclusive group 去重后，将独立组按 q 降序取前三项，`f_control=min(1,q1+0.50q2+0.25q3)`；其他三个 channel 对 distinct stack groups 使用 `f_channel=1-∏(1-g_group)`。未知 effect/stacking 保留 unknown 区间、不作为零值 filler；不把未覆盖权重转给别的 channel。经济 utility 不计入战斗 score。

### 变化、未知和来源归属

canonical effect owner 按机制固定：伤害修正→`damage`，耐久/减伤/**所有护盾与治疗**→`frontline`，控制/敌方减益→`utility`，剩余确有战斗效果且未被前三类表示的羁绊专属效果→`traits`。Utility 的 survivability **仅**用于未在 frontline 数值化的复活、净化、控制免疫等实际效果；teamSupport 仅用于非伤害、非耐久、非减益的 team utility（如合资格法力支持）；重复/冲突机制遵循 owner 优先级，unknown effects 不塞入空缺 channel。所有 trait 导致的 score delta 均在对应 canonical bucket 计一次；trait 面板可另列其来源和阈值损益，但不能把同一 trait 因果 delta 再计入 `traits`。canonical `effectId`/alias 固定 owner；不同单位保留不同 `sourceId`，按所属类别 stack 规则聚合；无独立 `Δ_item`。

同一 effect 数据冲突按来源序 `confirmed-structured > manually-verified > unverified-extraction`；低优先级只作来源注记不另计。最高优先级相同且数值冲突，标 conflict/unknown。能力记录必需字段：`effectId,sourceId,owner,scope,target,condition,stackGroup,stacking,stackCap,lo,mid,hi,byStar|starInvariant,source,patch,confidence`。未经核实的 tooltip 关键词不是已验证机制。

只将 bucket/feature Δ 求和得到 S；`sourceChanges` 作为该 feature 的来源说明，不能再把 source 行相加来复算。before/after 每个 feature 都按**完整 source 集**聚合。共享未知 source 在非线性 top-N/max/截顶中可能改变边际；用同一潜在值 `u` 联合计算 `F(after,u)-F(before,u)`。若无法保留相关性，保守用 `[after.lo-before.hi, after.hi-before.lo]` 并标 `dependencyUncertain`，不宣称共同 source 逐项抵消。依赖图完全相同的未变 feature Δ 精确0；no-op 所有差分必须0。这样未知不会给“移除 unknown”固定奖励，也不会对每个 board 固定扣分。

### 羁绊分项

共享 `evaluateTraits(board,set)` 输出 `effectiveTraits`、count、最高已达 breakpoint、next breakpoint、prismatic flag、active effect IDs、适用单位及来源。每条 trait 明确 `resolution:"replace"|"cumulative"`：replace 只启用最高已达档，cumulative 启用所有已达档；缺失 resolution 或未核 breakpoint 效果时，该 trait 效果 unknown。style/铜银金彩棱彩/prismatic flag 是层级与 UI 信息，**不自动代表战力强弱**。

为同一评估批次先固定容量 `C=before` 的共享 board/context population capacity；所有候选共用该 `C`，不由各候选成员数设置分母。不同 target level 属不同 conditional comparison context，应另成批评估。对 scope/eligible units 明确的 effect，beneficiary ratio=`clamp(count(eligible beneficiaries in this state)/C,0,1)`；eligible membership 只进分子。每 trait 的 `v_t` 只累加 `owner=="traits"` 的 active、去重 effect：`strength×beneficiaryRatio`；trait coverage=`f_traits=min(1,Σ_t v_t/4)`，贡献仅 `25×(f_after-f_before)`。由伤害/耐久/utility owner 归属的 trait-activated effects 只计其 canonical bucket；trait 解释面板仍展示**全部**trait 导致的跨桶增损，但解释项不可加回 score。缺 scope/value 来源则 unknown，style 不代替效果值。

下一档进度只显示 `count/nextBreakpoint`、“还差几名”等事实；**不进当前 S、不进 minNow、不构成自动升级理由**。仅实际跨断点并按 resolution 启用的 effects 计当前收益；羁绊断档与 beneficiary 变化分别解释。

### 数字示例（仅说明运算）

抽象算例一：前排 `f` 从0.8→0.7，贡献 `30×(-0.1)=-3`；damage 从0.4→0.6，贡献`30×0.2=+6`；traits 从0.5→0.7，贡献`25×0.2=+5`；utility 不变贡献0。总 `S=+8`，未计不确定性。这不是实战提升百分比；若某伤害效果已归 owner=damage，就不能再进 traits 重复加5。
抽象跨费用算例：某已校核控制效果把 control coverage 从0.2提到0.9，则 `4×0.7=+2.8`；1费或5费使用同一 q/来源/星级/作用条件时都是+2.8，费用不改分。同队另一5费 solo-trait 机制未核验时为 `unknown`，不能凭稀有度自动压过该确定候选；也不能把 unknown 说成0或确定较差。

### 星级与成本的边界

各 `f_bucket` 的上限只表示“该评估维度的已覆盖需求饱和”，不表示单位/棋盘真实战力被封顶或所有满覆盖棋盘等强。三星高费手动单位仍依星级保护规则禁止低星自动替换，不参与“普通低星单位与其等价”的 rank 声明；饱和值不能覆盖星级/职责门槛。

## 职责、羁绊与效用

### 职责角色

职责资格和数值贡献分离：`roleGroup`/`supportedRoles` 只判断候选是否可承担某角色、mark 是否兼容；damage/frontline evidence 才进入四项评分，mark 本身永远不是强度。评估先算 raw profile 与 coverage，再输出 inferred carry/tank 等标签；标签不得反馈进 score。角色排序先给每个单位算确定性 tuple，再按 key 排序，不能用双方星级条件不对称的比较器。

当前 `realTank(unit,ctx)` 的 cost floor 会把低费三星坦克排除。改为同一个 front coverage/profile 作为缺坦、候选和替换判断依据，费用只用于 chase preference；已持有高星、已装备或职责标记的单位参与前后板容量，不能因 cost floor 被当作“无坦”。主C也不能用 `carryScore` 的成本/AD/AS去推断技能伤害。

能力档案的 V1 数据覆盖契约：所有可自动进入候选集的单位必须有 damage/frontline 证据等级或明确 unknown；当前 set 全部五费、全部拥有 solo-trait 的单位都要有人工 review 状态，并对 control/survivability/enemyDebuff/teamSupport 每项写“已核实 effect / 已核实不具此能力 / unknown”。至少每个真实 effect 有前述数值、逐星或不变声明、scope/condition/stack/source；不要求无证据地填全能力，也不把 unknown当0。这样五费效用可按统一函数评估，未支持机制明确输出 unknown；核心 scoring 不等未来额外框架。

快照示例仅说明不能凭名字或费用推理：芮尔 `DA_Rell19` 的护盾/音波文本包含骑乘和非骑乘两种备选状态，不能同时计两份；崔斯特 `DA_TwistedFate19` 的商店/刷新收益依赖当前工具缺失的战前商店/刷新条件，未输入则条件化/unknown；努努 `DA_Nunu19` 的法力/滚动伤害文案并未证明控制、减疗或团队盾，不得擅加能力标签。这些是 tftTest 数据快照，不是 live 强度或数值结论。

## 追星、经济与条件式建议

只将**自动追三星（2★→3★）**候选限制为 1–3 费；4/5 费追二星仍允许，手动已有高费三星保持可见、可分析且受保护。筛选按目标星级区分：自动 3 星按费用门槛，自动 2 星允许 4/5 费但仍需通过全局保护与收益门槛。不能把“已有单位下一星分析”与“自动新增追三星候选”混为一条过滤。

默认策略偏好仅覆盖已确认模板：等级5偏好1/2费，等级6偏好2/3费，等级7偏好3费。它们只改变追牌意愿/候选排序，不是硬规则、不替代实际商店概率、不保证命中。其余等级不推导默认费用策略；用户可选无偏好或自行配置。可使用简洁数据配置：

```json
{
  "autoStarUp": { "3": { "costs": [1, 2, 3] }, "2": { "costs": [1, 2, 3, 4, 5] } },
  "chasePreferenceByLevel": { "5": [1, 2], "6": [2, 3], "7": [3] }
}
```

“不推荐自动追四/五费三星”不得阻止读取/保留用户已上场三星或手动设置的目标状态；同理 4/5 费追二星不是追三星过滤的例外漏洞，而是本来就合法的另一个目标。

等级/人口和当前板副本可直接用现有状态；不是缺失字段。当前缺或不完整的是阶段/回合、金币、商店、备战席副本、对手争牌/共享池状态。用户可选输入 bench copies，从而计入已有副本并估算尚缺张数；不输入只会让总持有数未知，不丢弃已知棋盘副本。缺少共享池/对手占有与单牌抽取模型时，单牌命中概率仍不可得；费用档 odds 只表示费用档。

## UI 与用户解释

继续用紧凑卡片列出候选，但每项展示动作、当前/候选星级、总分及保守区间、分组差值、失去/获得的羁绊阈值、职责替换、装备迁移、硬门槛/未知项和理由。启发式分只标“相对评估点”，不显示百分号或胜率。`swapCard()` 至少与方案卡一致显示原因；羁绊显示人数变化和已达效果变化，不能只给 from/to。

所有已确认待做的表现修正：选中棋子状态应采用一致的选择态设计，同时**保留费用颜色**（现有 selected 样式会覆盖成本边框）；棋子装备白点改为现有装备资产的缩略图；三星横向重复星号改为更醒目的尺寸并将三星改成三角形；羁绊按钮按实际铜/银/金/彩/棱彩档位着色，区分 on/unmet/target，并保留文字/非颜色状态以满足可辨识性。已有资源优先，不创建重复图标资产。版式在窄屏下不能遮挡星级、物品或选中状态。

## 数据、模块边界与兼容性

数据 schema 纳入稳定唯一 ID、引用完整性、set identity、来源 URL/数据集、抓取时间、目标 game patch、`dataStatus`（如 test/PBE/live/unknown）、`schemaVersion`、规则覆盖状态与资产路径。导入失败须给出 JSON 路径、字段和原因，不只吞掉异常。Set19 的 tftTest 与 Data Dragon 16.23.1 需标为混合/测试来源；Riot 文档提到 19.1 自 2026-12-01 起的数据管线变化，尚未验证新管线时不得声称迁移完成。builder 可继续生成静态 JSON/`data.js` 与现有资产。

本地存档按 set/custom data identity 分区，保存 schema 版本；迁移时只保留 ID 可验证的字段，显式处理失配，并避免不同赛季同名不同 ID 串档。升级不得丢失现有棋盘、星级、物品或角色标记；无对应 ID 时给用户可恢复的诊断/选择，不做静默重映射。

渐进模块边界建议：纯 set/schema 校验；共享羁绊和角色评估；替换门槛及边际收益/解释；候选生成/策略配置；UI 卡片与存档。可以作为 `engine.js` 内部函数逐步拆分，按需小文件并由 `index.html` 明确加载，继续 classic script/IIFE，无需引入框架、bundler 或破坏现有 API。不要让 UI 和引擎各自复制一套羁绊阈值计算。

## 性能与渐进实施

先定义固定棋盘规模、候选数量和搜索场景，记录耗时、调用次数、扩展节点及取消延迟；当前没有 benchmark，不能预先宣称卡顿或收益。若数据证实重复开销，再在**单次分析上下文**复用同一 board 的 trait/role/evaluation 结果，缓存以 board identity/version 和 set identity 为界，不做跨状态全局缓存。将普通推荐渐进接入现有可取消分片任务模式；新一代输入取消旧任务并丢弃旧 generation 结果。小数组筛选和 JSON clone 不先优化，除非基准显示其为热点。

实施顺序：①落地共享资格门槛、星级/锁定保护、角色/羁绊差分与理由结构；②接入边际收益 profile、unknown/conditional 状态和分解 UI；③完成追星策略配置、物品/三星/羁绊外观；④加 schema/provenance/存档迁移；⑤基准后决定复用与分片范围。每阶段维持 file:// 检查和 API 兼容，禁止先做大规模重写。

## 验收标准

行为测试按契约断言而不是硬编码未经校准的英雄总分：

| 场景 | 必须观察到 |
|---|---|
| before/after 完全相同 | 所有 feature Δ 和 S 严格为0；无伪造收益或损失 |
| 非线性 feature 含共同 unknown source，另有 source 变化 | 用同一潜在值重算；无法相关计算则保守给区间并标 `dependencyUncertain`，source 行不相加 |
| 某 effect 同时在 trait、role 或 item 数据出现 | 按 canonical owner 只进一个 bucket；不同 provider 保留 sourceId，再按 stack 规则聚合 |
| role evidence 缺失 / roleGroup 有标记 | 缺失为 unknown；roleGroup 只决定资格/mark compatibility，不贡献数值，unknown role 不能成为 now |
| role/capability q 缺数据 | 固定区间`[0,0.5,1]`、confidence unknown；中心仅算术，不当证据或正收益 |
| 多个 damage/frontline 来源 | 分别使用 top2 / top3 折扣公式；第4个及以后无直接加分，无额外 carry 人数奖励 |
| 没有装备 / 装备已识别 / 装备未识别 | 无装备 delta=0；已识别走唯一 owner；未知装备保留基线并给每单位/role 单一 `[-.10,0,+.10]` 区间 |
| 只对工具能力改变星级 | 无 `byStar` 且无 `starInvariant` 时 effect unknown；不可套用统一role星级乘数 |
| 同一 utility `stackGroup` exclusive / independent control / additive | 分别按 max / top3折扣 / 明示 `stackCap`；无 stack 语义 unknown |
| 低费三星坦克费用低于旧 curve floor | 仍按 front coverage/profile 纳入，不被误判为缺坦 |
| focusId 单位被替换 / 手动 mark 到 incoming | 前者 blocked；mark 依显式 compatibility，unknown/incompatible 都须用户选择，原始 mark不静默改写且mark不加战力 |
| 自动换牌拟用低星替代现有三星（任意费用/路径） | blocked；不会由总分/羁绊加分抵消 |
| 2★→1★ 替换 / 1★→2★目标计划 | 前者最多 alternative，不可 now；后者缺少bench副本输入时 conditional，不制造已拥有二星 |
| 自动追三星候选费用1–3 / 4–5 | 前者可继续评估，后者排除 |
| 自动追二星候选费用4/5 | 仍可评估，不受追三星过滤误伤 |
| 手动已有4/5费三星 | 保留、识别、分析且不会被低星自动替换 |
| 五费 solo-trait 与低费工具候选 | 不按费用/solo固定加分；已核能力按当前缺口计，没核能力为unknown |
| 五费 Rell/TF/Nunu 快照字段 | Rell两形态不双计；TF未输入商店条件为conditional/unknown；不凭Nunu文本添加控制/减疗/团队盾 |
| 等级5/6/7偏好与未配置等级 | 遵循 5:[1,2]、6:[2,3]、7:[3]；其他等级不擅自推断 |
| traits 未跨档 / 跨档 / prismatic style | 未跨档只显示潜在人数进度、不进S/minNow；跨档按 resolution/effectOwner；style不自动当强度 |
| 同一已验证能力但 candidate cost 不同 | 使用同一 q/公式得同一分，不加费用项 |
| 候选重复排序 / 星级比较交叉 | 结果稳定；预计算tuple，不用非传递 pairwise comparator |
| 装备迁移非法/有 loose item | 候选拒绝或明确合法落地；materialization列出去向，不丢装备 |
| 所有生成路径（含 rebalance 第二换/fit/plan） | 同一资格 gate、evaluate、assessment结构，无旁路 |
| 新棋盘提交后旧搜索返回 | generation guard 丢弃陈旧结果并可取消 |
| 重复 ID、悬空引用、未知版本 | 路径化导入诊断；存档迁移不静默串档 |
| 窄屏和非颜色辨识 | 保留费用色、三星三角清楚、装备缩略图和羁绊状态可辨 |

## 未决项与版本说明

V1 evaluator 的权重、分组函数、unknown 默认、输出结构和星级/装备/trait门槛已在本规格中固定，不以“后续调研”作为实现前置。各单位有来源的证据值和能力覆盖按版本维护；无法核验项显式 unknown。后续可通过行为样例调整 v1 heuristics 数值，但不得改变 unknown、差分、去重、保护等契约。另待产品选择的是多方案 UI 比较方式、可选经济输入字段，以及随新 patch 更新官方数据来源；这些不影响当前手动规划器的核心算法。

本规格是需求与设计契约，不代表已有功能，也不宣称任何建议已实现或测试通过。数值 profile 的示例仅为可解释起点，后续须以固定样例验证单调性、无双计与保守拒绝行为；若需要改动已批准硬约束，应先更新此规格再实现。
