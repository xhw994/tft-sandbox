# TFT 游戏玩法约束与改进建议

## 经济、升人口与追三星

### Takeaway

利息、升级经验和刷新都是同一有限经济下的竞争用途；推荐系统应把追牌偏好作为可调策略，而非把某级别/费用追三星写成通用规则。TFT 是共享牌池、构筑与经济管理的对局，但本次找到的 Riot 官方资料没有给出现行利息分档、升级经验成本或各人口 shop odds 的完整规则表。

### Cited Findings
- Riot 对 TFT 的基本说明明确包含共享冠军资源池、队伍构筑、经济管理、购买对手竞争的棋子、装备及站位；同时强调每局须适应、存在多种获胜策略。[官方基础介绍](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/what-is-teamfight-tactics/)（2021-05-01；文中描述当时赛季，适合做系统概念，不适合作现行数值来源）。
- Riot 16.1 补丁说明把经济构筑、连胜/强开局与晚期高费阵容联系起来，并称 Yordle 兼作 reroll 与 fast-nine 经济引擎，且分别调整两种玩法。这说明策略会随赛季机制和补丁变化。[16.1 官方补丁说明](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-1)（2025-12-02；版本数值并非 Set19）。
- 本地 `data/set19.json` 的 `meta` 标注 Set19「棱彩音乐盛典」，来源为 `https://utils.iesdev.com/static/json/tftTest/set19/zh_cn/`，抓取时间 `2026-11-21T02:07:26+00:00`；同一记录列 94 units、47 traits、32 unlocks、147 items。`build_data.py` 注释称从该静态源构建，并使用 Data Dragon `16.23.1` 装备资料；代码另自带 shopOdds 表与若干手工规则。由 `tftTest` 来源和混合版本依赖可见 provenance，不等同 Riot 已确认的 live 平衡数据。[项目数据文件](file:///C:/Users/xegna/Documents/Workspace/tft-set19/data/set19.json)；[项目构建器](file:///C:/Users/xegna/Documents/Workspace/tft-set19/build_data.py)。
- 项目 JSON 目前仅存 shopOdds（1–5费概率）而未见兴趣/利息、基础金币收入、升级经验成本、刷新成本或当前商店/牌池状态字段；模板/schema 也围绕静态 odds 与 units/traits/items。概率表是项目维护数据，不是已由 Riot 官方当前版本证实的数值。[schema](file:///C:/Users/xegna/Documents/Workspace/tft-set19/template/set.schema.json)；[模板](file:///C:/Users/xegna/Documents/Workspace/tft-set19/template/set.template.json)。

### Inferences
- 9 金的机会成本不仅是“买一张牌”：它不能再用于升级、roll、利息档位或其他临时战力购买。把同样 9 金当成等量战力是错误的；其战力回报取决于具体单位、星级、前排缺口、装备与羁绊等局面。
- 改进方向：补充带来源/版本/生效日期的经济规则数据，并让建议解释“保留金币档位、经验投入、刷新目标”各自代价；目前不宜仅凭成本推断战力大小。

### Gaps
- 本次未找到可核实的 Riot 官方现行利息档位、升级成本与逐级商店概率指南，故不报告诸如“50 金封顶利息”等未经官方来源在此确认的具体数值。可在产品中引用的项目 odds 应标注其来源与适用版本。

## 商店 odds、共享牌池与升星

### Takeaway

某费用牌的商店 odds 是抽到费用档的概率，不是抽到某指定英雄的概率；指定英雄概率还要由该费用英雄的数量、共享池剩余量及商店格数共同决定。项目 README 已正确警示“商店概率是各费用档的出现概率，不是命中率”，建议进一步把有限共享池/竞争者作为不可知项或显式输入，而非假装有精确单牌命中率。

### Cited Findings
- Riot 的基础介绍将冠军描述为从共享资源池 draft，并指出可通过购买对手竞争的单位影响竞逐。[官方基础介绍](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/what-is-teamfight-tactics/)（2021-05-01）。
- 项目 `data/set19.json` `shopOdds` 按等级/费用给百分比，说明中写明 7 级 5 费为 1%、7 费不在普通商店、低于 `minRoll` 不推荐；`README.md` 又明确指出该值是费用档而非命中率。这些是项目内规则，不可据此推出指定英雄概率。[set19 数据](file:///C:/Users/xegna/Documents/Workspace/tft-set19/data/set19.json)；[README](file:///C:/Users/xegna/Documents/Workspace/tft-set19/README.md)。
- 三张相同弈子合成 2 星、三张 2 星（合计九张相同弈子）合成 3 星，是该工具用户操作语义/建议模型可用的基础升星规则；本次所查 Riot 官方页面未找到含此规则的权威现行说明。以明确可核实来源为准，这条在本研究中未取得官方引文，不要包装为本次验证过的 Riot 事实。

### Inferences
- 在缺少按费用英雄池总量与对手持有量的可靠静态/实时输入时，不应输出“刷 N 次就会命中”的确定结论。若将来给单牌概率，必须注明假设（该费用池构成、剩余牌数、一次商店槽位独立近似等）并避免与费用 odds 混淆。
- 3 张合 2 星、9 张合 3 星可用于候选目标标签和复制数状态，但建议计算不能只看剩余差几张；追牌的经济成本和替换导致的战力损失可能抵消升星收益。

### Gaps
- 本次没有官方来源确认不同费用的每英雄初始副本数、被拿走/被淘汰单位返还规则，或 3/9 副本升星公式；在建议文中明确列为待核验数据，不能擅自硬编码作为已证实新机制。

## 羁绊、前排/主C、补丁依赖与产品边界

### Takeaway

阵容替换必须同时审视星级、角色/站位、装备归属和羁绊断点；总金币成本不是战力度量，也不能推出特定棋子必然更强。Set19 数据应明确其测试/PBE 来源、抓取时间和兼容补丁，避免把本地数据误称当前 live；工具保持静态、可解释、多方案，避免变成局内动态指挥。

### Cited Findings
- Riot 基础介绍将装备与位置战斗阵型都列为赢得对局的因素，称阵容需适应每局变化。[官方基础介绍](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/what-is-teamfight-tactics/)。
- 16.1 补丁说明对不同单位/羁绊/玩法逐项平衡调整，例：Yordle 的 reroll 补偿与 fast-nine 约束分开处理；说明即便同一赛季内，单位强度与策略适用性也随补丁改变。[官方补丁说明](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-16-1)。
- Riot 开发者政策要求面向玩家的产品须注册；鼓励帮助玩家长期提升的工具，静态赛前建议可接受，但实时基于玩家操作直接指令、动态实时信息、局内对手侦察/预测等不允许；产品应保留重要决策、支持多种选择并增加策略多样性。[Riot TFT 开发者政策](https://developer.riotgames.com/docs/tft)（访问日 2026-11-22；政策可能更新，应上线前复核）。项目 README 自述是静态手动搭建工具，建议仍是启发式非胜率预测。[README](file:///C:/Users/xegna/Documents/Workspace/tft-set19/README.md)。
- 当前数据的 `meta.source` 指向 `tftTest` 静态站点，builder 使用 16.23.1 Data Dragon 装备数据；Riot 的 TFT 文档另提示 Data Dragon 更新可能晚于 TFT 补丁，且自 19.1（2026-12-01）开始数据管线/结构会变化。由于本研究日期早于公告所述 19.1 生效日，不可声称 Set19 当前 live 或 19.1 schema 已实际验证。[Riot TFT 文档](https://developer.riotgames.com/docs/tft)；[set19 数据](file:///C:/Users/xegna/Documents/Workspace/tft-set19/data/set19.json)；[builder](file:///C:/Users/xegna/Documents/Workspace/tft-set19/build_data.py)。

### Inferences
- 5级追1/2费、6级追2/3费、7级追3费应作为用户要求的“操作偏好/可切换追牌模板”，而非普世玩法法则；局势、血量、已有副本、争牌情况、经济/升级窗口、版本强度都可能改变合理性。
- 需求约束：推荐的自动新增/追三星候选排除4/5费；玩家手动已有的4/5费三星或副本仍需正常显示、保留并允许分析。可把“候选资格”与“已有阵容状态识别”分离。
- 用可解释的替换评估门槛：若替换会降星、移除关键前排/保护、拆开已达羁绊档位、夺走关键装备，必须将这些损失纳入判定或提示；仅成本相同不能抵消损失。角色标签、lane、traits、stats 等静态数据可用于形成解释性特征，但不能声称精确战斗模拟。
- 赛季数据应展示来源、抓取时间、预期 patch/测试标记、规则覆盖缺口；对 `tftTest` + 16.23.1 依赖应标为测试/PBE/非权威 live 来源，待官方 live 数据验证后再改标。避免在 schema 无来源字段时只用泛化“当前赛季”描述。
- 符合 Riot 政策的产品优化方向：明确这是手动搭建/复盘规划工具，给多个可编辑方案及其取舍，不做局内自动动态指令、对手侦察或胜率承诺；公众发布前检查注册要求及政策更新。

### Gaps
- Riot 的官方资料未提供本项目 Set19 每个单位的具体实战强度/前后排定位优劣、装备最佳分配，也未找到现行全套羁绊阈值数据；不能据购买价格推断战斗力，也不能在未核验实际补丁中给英雄强弱排序。
- 本次只查看了 README、数据元信息、builder、template/schema；未审阅引擎，故建议为功能/数据结构层面的只读方向，不是对现有算法具体缺陷的断言。
