# TTPOS FreshGuard 行业差距分析与功能提案

> 日期：2026-06-10
> 范围：后端 (Node/Express + SQLite 多租户)、admin-web 管理后台、frontend 巡检 SPA、flutter_app 门店端
> 目标：识别「现状没有或只有半成品、而行业水平产品普遍具备」的功能，按 P0/P1/P2 提出可落地提案
> 约束：SQLite 单库、单服务器、小团队、中国餐饮连锁场景优先；不含 IoT 硬件平台 / AI 视觉

---

## 一、现状摘要

### 已经做得不错（不重复提）
- **多租户隔离**：brand→store 数据模型，应用层 WHERE 作用域，跨品牌写操作 403 防护，事务+乐观锁（handleReminder / consumeBindingCode / createBatchWithReminders）。
- **效期核心链路**：自动计算到期日（printed_at + shelfLifeDays）、可溯源 barcode、PAO 开封效期（opened_shelf_life_hours）、处理动作（discarded/sold/transferred）含 HACCP staff 归属。
- **标签能力**：单/双语标签、过敏原、储存条件、占位符模板 CRUD、品牌默认模板、TSPL/CPCL 物理打印（Android USB）。
- **巡检模块**：模板+检查项 CRUD、巡检/自检 start/submit、低分自动生成 issues、scorecard A-F 评级、问题跟踪。
- **Dashboard/报表**：4 KPI + 3 图表（Chart.js）、过期处理报表 + CSV 导出、巡检报表。
- **门店员工**：store_staff PIN 归属（bcrypt）、verify-pin。

### 结构性缺口（与行业水平差距最大）
1. **主动到期提醒完全缺失**：无 FCM/推送、无 cron/scheduler。「到期提醒」目前纯靠客户端手动拉取 `GET /api/store/reminders`，服务端无主动触发——对一个「效期提醒」SaaS 是核心功能缺口。
2. **FIFO/FEFO、报废原因分析、批次追溯、损耗 KPI**：中国效期系统普遍具备的「经营分析 / 降损」层几乎为空（只有平铺的过期处理报表）。
3. **合规制度对接（日管控周排查月调度、色标管理）**：中国市场监管强制/检查要点，现状完全没有。
4. **后台 RBAC、批量导入、列表分页/搜索/筛选、审计作用域**：管理后台工程化能力普遍缺失或半成品。
5. **门店端（Flutter）薄**：无扫码、无离线、无本地通知、无历史批次重打、PIN/JWT 明文 HTTP。

---

## 二、对标摘要

| 维度 | 国际效期标签 (DateCodeGenie/Jolt/Freshmarx) | 国际食安平台 (Jolt/Zenput/FoodDocs/Trail) | 中国效期管理 (海鼎/客如云/蜜雪/慧运营/畅捷通) |
|---|---|---|---|
| 自动效期计算 | universal | - | universal |
| **FIFO/FEFO 出库匹配** | - | - | **universal（中国标配）** |
| **多级临期阶梯预警+多端推送** | common（离线打印/推送提醒） | universal（移动 App 推送） | **universal（30/15/7 天多端）** |
| **报废登记+损耗统计/降损看板** | common | common | **common→differentiator（降损 KPI）** |
| 批次追溯/一物一码 | common（QR 追溯） | differentiator | common |
| **后台 RBAC/多门店分级** | universal（云门户分发） | common（区域经理仪表盘） | common（总部-门店两级管控） |
| **批量导入/集中下发** | universal（一键推全店） | - | common |
| **打印审计/合规报表** | common | universal（时间戳+稽查日志） | common（责任人标签） |
| 离线打印/离线能力 | common | - | - |
| **日管控周排查月调度** | - | - | **differentiator（中国合规独有）** |
| **后厨四色色标管理** | - | - | **differentiator（中国本地化）** |
| 临期自动促销/下架联动 | - | - | differentiator |
| 扫码盘点/效期巡检移动端 | common | common | differentiator |

**结论**：现状在「标签生成 + 巡检 + 基础看板」已达品类入门门槛，但在三类行业标配上落后：(a) **主动到期推送**（国际+国内 universal）；(b) **FIFO/FEFO + 报废损耗分析**（中国 universal）；(c) **后台工程化（RBAC/批量/分页/审计作用域）**。差异化机会集中在**中国合规（日管控周排查月调度、色标）**与**降损 KPI 看板**。

---

## 三、功能提案表

> 优先级：P0=行业标配且当前缺失 / P1=常见能力 / P2=差异化
> 端：BE=后端, AW=admin-web, FE=frontend巡检SPA, FL=flutter门店端
> Effort：S(<3天) / M(3-8天) / L(>8天)

### P0 — 行业标配且缺失

| ID | 功能 | 端 | Effort | Rationale |
|---|---|---|---|---|
| P0-1 | **主动到期提醒（cron 调度 + 推送）** | BE+FL+AW | L | 国际(Jolt/Squadle 推送轮转提醒)与国内(30/15/7 天多端推送)均为 universal。现状无 cron、无 FCM、纯客户端拉取——「效期提醒」名不副实。先做 node-cron 定时扫描临期/过期 reminder + Flutter 本地通知(flutter_local_notifications，无需 Firebase 凭据即可落地)，FCM 远程推送作为第二步。 |
| P0-2 | **FIFO/FEFO 出库/处理匹配 + 批次先进先出提示** | BE+FL | M | 中国效期系统 universal(海鼎「出库优先推荐最早生产货」)。现状 reminders 按 batch 生成但处理时无「最早到期优先」引导。在 reminders 列表/处理按 expires_at 升序强排，门店端处理界面突出「应先处理」批次。 |
| P0-3 | **列表分页/搜索/筛选（全站）** | BE+AW+FE+FL | M | 所有列表(产品/员工/绑定码/模板/提醒/巡检/审计/报表)全量返回，数据增长后内存与响应体爆炸，是工程化硬伤。后端加 limit/offset + 关键字/状态/日期筛选，前端补搜索框与分页器。 |
| P0-4 | **关键索引补全 + 报表/dashboard 查询优化** | BE | S | audit_logs/handling_logs/reminders(batch_id)/inspections/issues 全表无业务索引，dashboard/report 全表扫 reminders 随数据劣化。补复合索引 + 合并 dashboard 的多次 COUNT。低成本高收益，是 P0-3 的配套。 |
| P0-5 | **审计日志补全 + 品牌作用域 + 分页筛选** | BE+AW | M | 审计是合规品类硬需求(Jolt audit-ready 日志)。现状 partial：brand/store/binding-code/printer/issue/template 写操作未审计；且 audit-logs 查询不按 brandId 过滤，brand-scoped admin 可读全平台审计(越权读，安全缺陷)。补全审计点 + brandId 收窄 + actor/action/日期过滤 + 索引。 |

### P1 — 常见能力

| ID | 功能 | 端 | Effort | Rationale |
|---|---|---|---|---|
| P1-1 | **后台 RBAC 角色分级（平台超管/品牌管理员/区域经理/只读）** | BE+AW | L | 国际(云门户分发权限)与国内(总部-门店两级管控)common。现状 admin-web 单一管理员 cookie 登录，无角色分级、无多 admin 自助创建、无密码重置。建 admin role 表 + 中间件按角色/页面授权 + admin 管理界面 + 密码重置。 |
| P1-2 | **批量导入/导出（产品/员工/标签模板 CSV）** | BE+AW | M | 国际(一键推全店品项/模板)universal，国内 common。现状仅报表一张表有 CSV 导出，主数据全靠表单逐条录入。加 CSV 模板下载 + 上传解析 + 校验报错 + 事务批量插入(复用 createBatch 的批量优化)。 |
| P1-3 | **报废原因分析 + 损耗率看板（降损 KPI）** | BE+AW | M | 中国 common→差异化「半年损耗率 3.2%→1.1%」是给连锁老板的核心价值。现状只有过期处理平铺报表。基于已有 handling_logs(discarded/sold/transferred reason) 做按门店/产品/时段的损耗率、报废金额(需产品成本字段)、Top 损耗品趋势驾驶舱。 |
| P1-4 | **门店端扫码输入（绑定码/产品/批次条码）** | FL | M | 国际/国内移动端 common。现状 flutter 无扫码依赖，绑定码与产品全手输/下拉，已打印 barcode(FG-brand-store-batchId)却无法扫回。引入 mobile_scanner，扫码绑定/选品/扫批次条码定位 reminder 处理，闭合「打印→扫码处理」回路。 |
| P1-5 | **门店端历史批次重打 + 打印队列/重试** | FL+BE | M | 现状 USB Test Print 强依赖本次会话刚 Generate 的 label，无法重打历史批次，无队列/重试/批量连打。加 `GET /api/store/batches/:id/label` 重渲染历史批次 + 客户端打印队列与失败重试。 |
| P1-6 | **门店端离线缓存 + 离线打印队列** | FL | M | 国际效期产品 common(Jolt 离线打印、DateCodeGenie 离线缓存)，厨房网络不稳。现状断网即产品/提醒/打印全失败。用 SQLite/Hive 缓存产品与提醒，打印批次离线排队、联网补传。 |
| P1-7 | **安全加固：store JWT 撤销、PIN 限流、HTTPS/secure storage** | BE+FL | M | 现状 store JWT 45 天无撤销(丢设备只能轮换 SECRET 全量失效)、verify-pin 无限流(4 位 PIN 易暴破)、PIN/JWT 明文 HTTP + 明文 SharedPreferences。加 token 版本号/吊销表、verify-pin 限流、flutter_secure_storage、强制 HTTPS。 |

### P2 — 差异化（中国连锁场景优先）

| ID | 功能 | 端 | Effort | Rationale |
|---|---|---|---|---|
| P2-1 | **「日管控·周排查·月调度」合规记录自动生成** | BE+AW+FE | L | 市场监管总局强制、已立行业标准(MR/T 食品安全日管控周排查月调度工作规范)的中国独有合规能力。基于已有巡检/自检/效期处理数据，自动生成《每日检查记录》《每周排查治理报告》《每月调度会议纪要》+ 风险管控清单。是面向中国连锁的强差异化卖点。 |
| P2-2 | **后厨四色色标管理（红畜肉/蓝水产/绿果蔬/黄熟食）** | BE+AW+FL | S | 中国餐饮后厨监管检查要点。在 product/label-template 增 color_code 字段，标签渲染按品类配色，巡检模板内置「色标核查」检查项。低成本本地化加分项。 |
| P2-3 | **临期自动促销/下架联动** | BE+AW+FL | M | 海鼎「过期不能销售、临期自动促销」差异化能力。现状临期只提醒不联动动作。加临期规则引擎(到 X 天自动打折标/标记下架)，门店端提醒附「转促销」动作，沉淀促销/下架记录。 |
| P2-4 | **纠正措施(Corrective Action)闭环 + 任务排程** | BE+FE | M | 国际食安平台 common(Zenput/MeazureUp 自动生成 follow-up 任务并指派问责)。现状 issues 仅 CRUD，无指派人、无截止、无完成闭环、无定时任务提醒。给 issue 加 assignee/due_date/状态流转 + cron 到期催办。 |
| P2-5 | **多门店仪表盘下钻 + 日期范围筛选 + 门店排名** | BE+AW | M | 连锁 common(区域经理单屏定位需关注门店)。现状 dashboard 时间范围写死(今日/近30天)，无日期筛选、无品牌/门店下钻。加日期范围参数 + 门店维度下钻 + 完成率/损耗排名。 |
| P2-6 | **标签模板所见即所得可视化编辑器** | AW | M | 国际 universal(拖拽式 template builder)。现状仅 {{token}} 文本预览，无真实尺寸/条码/配色可视化。做按 mm/DPI 渲染的可视化预览(Canvas)，降低连锁总部配模板门槛。 |

---

## 四、落地建议（小团队 + SQLite + 单服务器约束）

**第一波（先补「名实相符」）**：P0-1(本地通知先行) + P0-2(FIFO) + P0-4(索引) + P0-3(分页)。
让「效期提醒」真正主动、查询不劣化。node-cron 单进程内跑即可，无需额外基础设施。

**第二波（工程化与安全）**：P0-5(审计作用域，含越权修复) + P1-7(安全加固) + P1-1(RBAC)。
P0-5 的「brand-scoped admin 可读全平台审计」是已知越权缺陷，应尽快修。

**第三波（中国连锁价值）**：P1-3(降损看板) + P2-1(日管周排月调) + P2-2(色标)。
这是相对国际产品的本地化护城河，且大多复用已有 handling_logs / 巡检数据。

**门店端并行**：P1-4(扫码) + P1-5(重打) + P1-6(离线) 可由 Flutter 单独推进，但建议先把 main.dart(1294 行单文件) 做基本分层，否则后续维护成本陡增。

**注意**：FCM 远程推送待 Firebase 凭据；P0-1 用 flutter_local_notifications 可先不依赖 FCM 落地基础到期通知。报废金额分析(P1-3)需先给产品加成本字段。

---

## 五、来源链接

### 国际效期标签产品
- https://www.datecodegenie.com/ ; https://www.ncco.com/date-code-genie/
- https://get.jolt.com/products/labeling/ ; https://www.jolt.com/lp/food-labels/
- https://shopmonarch.averydennison.com/freshmarx-9417-food-labeling-solution/
- https://www.ecolab.com/solutions/prep-n-print-food-labeling
- https://restauranttechnologynews.com/2022/04/squadle-introduces-remote-food-safety-monitoring-system-for-restaurants/

### 国际食品安全运营平台
- https://www.jolt.com/solutions/digital-food-safety/
- https://www.crunchtime.com/food-safety ; https://www.zenput.com/platform/temp-monitoring
- https://www.fooddocs.com/ ; https://www.fooddocs.com/food-traceability
- https://trailapp.com/why-trail/compliance ; https://www.theaccessgroup.com/en-gb/products/trail-evo/
- https://meazureup.com/product/ ; https://www.compliancemate.com/

### 中国市场效期管理
- https://www.keruyun.com/ ; https://retailcloud.hd123.com/
- https://www.hd123.com/solution/digital-intelligence-retail/fresh-wisdom
- https://www.dmall.com/ ; https://www.hyunying.com/newsDetail-I31122.html
- 市场监管总局《食品安全日管控周排查月调度工作规范》：https://mr.samr.gov.cn/mr_kfs/file/downportal?md5=7d99c50da1e4fc94fa487c9bc153567d
- https://www.gov.cn/zhengce/zhengceku/202406/content_6955731.htm
- 进销存效期模块代表：https://www.zhihuiji.cn/help/doc/983 ; https://www.chanjetvip.com/edu/21735.html
- 降损案例：https://www.cnblogs.com/zzylj/p/18768083
