# 前端实施计划 · 门店原料补货 Agentic Workflow

> 后端对应文档：`backend-plan.md`（第 6 节为 API 契约权威定义）
> 领域模型与 28 个 Agent 职责见 `agentic-restock-workflow-plan.md`
> 本文档的 API 契约是**消费视角**：同样端点，但按页面组织，并标注调用时机与缓存策略

---

## 1. 范围边界

**前端负责**
- Owner / 店长的日常操作台：看库存水位、处理告警、人工接管、确认收货与付款
- 基础数据维护：原料阈值、配方 BOM、供应商、菜单上下架
- 实时事件呈现与告警触达

**前端不负责**
- 任何业务判定（阈值计算、下架决策、模板校验一律在后端）
- 直接调用 WhatsApp / LLM / 数据库

**核心用户场景决定设计取向**：主要使用者是**店长，用手机**。因此移动端优先（≥90% 场景在手机上完成），桌面端是同一套响应式布局的加宽版，不做独立的桌面信息架构。

---

## 2. 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Next.js 15（App Router）+ TypeScript | 与后端同语言；SSR 首屏快；API Route 可作 BFF 轻量聚合 |
| UI | Tailwind CSS + shadcn/ui | 组件可控，移动端适配成本低 |
| 数据获取 | TanStack Query v5 | 缓存、失效、重试、乐观更新开箱即用 |
| 实时 | SSE（`EventSource`） | 单向推送足够；比 WebSocket 简单，且自带断线重连语义 |
| 表单 | react-hook-form + zod | schema 与后端 TypeBox/JSON Schema 对齐 |
| Mock | MSW | 后端未就绪时按契约 mock，前后端并行 |
| 图表 | Recharts（轻量，仅看板用） | |

---

## 3. 信息架构

```
/                        看板 Dashboard
/materials               原料列表
/materials/[id]          原料详情（阈值配置 · 流水 · 在途工单）
/dishes                  菜单（上架/下架）
/dishes/[id]             菜品详情（配方 BOM 编辑）
/vendors                 供应商
/vendors/[id]            供应商详情（可达性 · onboarding）
/cases                   要货工单列表
/cases/[id]              工单详情（时间线 · 会话 · Invoice）
/invoices                Invoice 记录
/invoices/[id]           Invoice 详情（收货 · 付款）
/alerts                  告警中心
/handoffs                待我处理（人工接管队列）
/settings                设置
```

**全局元素**
- 顶部：未读告警徽标 + 待办接管徽标（这两个数字必须常驻可见）
- 底部 Tab（移动端）：看板 / 原料 / 工单 / 告警 / 我的

---

## 4. 页面规格

### 4.1 看板 `/`
- **数据**：`GET /dashboard/summary`
- **区块**
  1. 待处理卡片（红）：`pendingHandoffs` + `unreadAlerts`，点击进入对应页
  2. 风险原料：`atRisk[]` 按 `level` 降序，卡片显示 原料名 / 当前量 / 阈值百分比进度条 / 影响菜品数
  3. 已下架菜品：`delistedDishes` 数量 + 一键查看
  4. 在途工单：`openCases` 数量 + 催办次数 ≥2 的高亮
- **进度条配色**：L0 绿 / L1 黄 / L2 橙 / L3 红。库存涨用红、跌用绿不适用于此场景（这不是行情涨跌），此处统一用「越危险越红」

### 4.2 原料列表 `/materials`
- `GET /materials?level=&q=`
- 筛选项：预警级别（全部/L1/L2/L3）、搜索
- 每行：原料名 · `onHand / safetyStock` · 级别徽标 · 在途工单状态 · 操作（改阈值 / 盘点校正）
- **轮询**：无；靠 SSE `material.level_changed` 局部刷新

### 4.3 原料详情 `/materials/[id]`
- `GET /materials/:id`、`GET /materials/:id/ledger`
- Tab：概览（阈值配置表单） / 库存流水 / 关联菜品
- 阈值配置：`safetyStock` + 三个百分比滑块（W1/W2/W3），实时预览「当前量会触发哪一级」
- 盘点校正：`POST /materials/:id/adjust`，需二次确认弹窗（会直接改库存）

### 4.4 菜单 `/dishes`
- `GET /dishes?status=`
- 每行：菜品名 · 状态 · 下架原因 · 下架时间 · 手动上架/下架按钮
- 手动操作调 `PATCH /dishes/:id/listing`，与 Agent 共用后端幂等逻辑

### 4.5 菜品详情 `/dishes/[id]`
- `GET/PUT /dishes/:id/recipe`
- 配方表格：原料 · 每份用量 · 单位 · **是否关键原料**（`isCritical`）
- `isCritical=false` 的行要有说明文案：「缺料不会自动下架本菜品」

### 4.6 供应商 `/vendors`
- `GET /vendors`
- 每行：名称 · 电话 · 可达性徽标（已验证 / 未验证 / 不可达）· 优先级
- 不可达的行高亮 + 直接给「生成 onboarding 链接」入口

### 4.7 供应商详情 `/vendors/[id]`
- `GET /vendors/:id`、`GET /vendors/:id/materials`
- 卡片：WhatsApp 通道状态（`reachable` / `waId` / `lastProbeAt` / `sessionExpiresAt`）
- `POST /vendors/:id/probe` 手动重探
- `GET /vendors/:id/onboarding` → 展示二维码 + 链接，供线下让供应商扫码（用于引导注册/绑定）
- 报价表：`materialId / unitPrice / moq`

### 4.8 工单列表 `/cases`
- `GET /cases?status=&streak=`
- 默认筛「进行中」；单独一个「催办 ≥2 次」快捷筛选
- 每行：原料 · 供应商 · 状态徽标 · `attemptCount / unansweredStreak` · 下次催办倒计时
- `interrupted=true` 的行打「需处理」角标

### 4.9 工单详情 `/cases/[id]`（最复杂的一页）
- `GET /cases/:id`、`GET /cases/:id/messages`
- **三栏（桌面）/ 三 Tab（移动）**
  1. **时间线**：`timeline[]` 按 `actor` 着色（AGENT 灰 / VENDOR 蓝 / OWNER 绿 / SYSTEM 红）
  2. **会话**：WhatsApp 往来记录，出站在右、入站在左，显示送达/已读状态（双勾）
  3. **单据**：关联 Invoice 预览
- **操作区**（依状态显隐）
  - 「立即催办」→ `POST /cases/:id/send`
  - 「电话沟通后回填」→ `POST /cases/:id/manual-reply`（表单：到货日期、数量、单位、能否供货、供应商对接人）
  - 「换供应商」/「改数量」/「取消」→ `POST /cases/:id/resolve`
- **实时**：SSE `case.message` + `case.status_changed` 直接追加/更新，不整页刷新

### 4.10 Invoice 列表 `/invoices`
- `GET /invoices?status=&from=&to=`
- 表格列：`Date` · `RM` · `Volume` · `PIC` · 供应商 · 金额 · 状态
- 支持导出（后端 `/invoices/:id/pdf` 单张；批量导出后续再加）

### 4.11 Invoice 详情 `/invoices/[id]`
- `GET /invoices/:id`
- 卡片展示四要素：**Date / Volume / PIC / RM**，加单价与总额
- 「确认收货」→ `POST /invoices/:id/receive`（填实收量 + 门店签收人）
- 实收量与 `volume` 差异超容差 → 后端返回告警，前端强制显示差异条并要求确认
- 「付款」→ `POST /invoices/:id/pay`（超阈值时后端要求 `approved` + 显示审批提示）

### 4.12 告警中心 `/alerts`
- `GET /alerts?status=&type=`
- 按类型分组：`WARN_L1` / `WARN_L2` / `DELISTED` / `VENDOR_CANNOT` / `UNREACHABLE` / `SILENT_3X` / `SYSTEM`
- 左滑（移动）/ 按钮（桌面）标记已读：`PATCH /alerts/:id`
- 「确认处理」→ `POST /alerts/:id/ack`（带备注）
- SSE `alert.created` 时顶部插入 + 全局徽标 +1

### 4.13 待我处理 `/handoffs`
- `GET /handoffs?resolved=false`
- 每张卡：工单摘要 · 中断原因 · 建议动作（后端 payload 提供 `suggestedActions`）
- 决策即 `POST /handoffs/:id/decision`，提交后卡片消失

### 4.14 设置 `/settings`
- `GET/PATCH /settings`
- 开关：**自动下架**（关掉则 W3 只告警不下架）、**自动付款**（默认关）、**付款审批阈值**
- 通知渠道偏好

---

## 5. 状态管理与实时

### 5.1 Query Key 约定

```ts
qk = {
  materials:   (f) => ['materials', f],
  material:    (id) => ['material', id],
  ledger:      (id, r) => ['material', id, 'ledger', r],
  dishes:      (f) => ['dishes', f],
  dish:        (id) => ['dish', id],
  vendors:     (f) => ['vendors', f],
  vendor:      (id) => ['vendor', id],
  cases:       (f) => ['cases', f],
  case:        (id) => ['case', id],
  caseMsgs:    (id) => ['case', id, 'messages'],
  invoices:    (f) => ['invoices', f],
  invoice:     (id) => ['invoice', id],
  alerts:      (f) => ['alerts', f],
  handoffs:    (f) => ['handoffs', f],
  summary:     ()  => ['dashboard', 'summary'],
}
```

### 5.2 SSE 事件 → 缓存失效映射

| 事件 | 动作 |
| --- | --- |
| `material.level_changed` | `setQueryData(['material', id])` 局部更新 + 失效 `['materials']` 与 `['dashboard','summary']` |
| `case.status_changed` | 失效 `['case', id]`、`['cases']` |
| `case.message` | `setQueryData(['case', id, 'messages'])` 追加；若当前不在该页则只更新未读徽标 |
| `alert.created` | 失效 `['alerts']`、`['dashboard','summary']` + Toast |
| `dish.listing_changed` | 失效 `['dishes']`、`['dish', id]` |
| `handoff.created` | 失效 `['handoffs']` + 全局徽标 +1 |

**连接管理**：`EventSource` 放 App 级 Provider；断线指数退避重连，携带 `Last-Event-ID`；页面 `visibilitychange` 回前台时主动失效一次关键 query，防止后台期间漏事件。

### 5.3 乐观更新
只有两处做乐观更新（其余一律等服务端）：告警标记已读、工单取消。涉及库存和钱的操作**绝不做乐观更新**。

---

## 6. API 契约（消费视角）

完整字段定义以 `backend-plan.md` 第 6 节为准，此处按页面列出**调用点与关键出入参**。

### 6.1 端点 → 页面映射

| 端点 | 消费页面 | 缓存策略 | 触发时机 |
| --- | --- | --- | --- |
| `POST /auth/login` · `GET /auth/me` | 登录 / App 初始化 | 长期 | 启动 |
| `GET /dashboard/summary` | `/` | `staleTime 30s` | 进入 + SSE 失效 |
| `GET /materials` | `/materials` | `staleTime 30s` | 进入 |
| `GET /materials/:id` | `/materials/[id]` | `staleTime 10s` | 进入 |
| `PATCH /materials/:id/thresholds` | 原料详情 | 失效详情+列表 | 提交 |
| `POST /materials/:id/adjust` | 原料详情（二次确认） | 失效详情+流水 | 提交 |
| `GET /materials/:id/ledger` | 原料详情·流水 Tab | `staleTime 60s` | 切 Tab |
| `GET /dishes` | `/dishes` | `staleTime 30s` | 进入 |
| `PATCH /dishes/:id/listing` | `/dishes` | 失效列表 | 点击上下架 |
| `GET /dishes/:id/recipe` | `/dishes/[id]` | `staleTime 5m` | 进入 |
| `PUT /dishes/:id/recipe` | `/dishes/[id]` | 失效 | 提交 |
| `GET /vendors` | `/vendors` | `staleTime 5m` | 进入 |
| `POST /vendors` · `PATCH /vendors/:id` | 供应商 | 失效 | 提交 |
| `POST /vendors/:id/probe` | 供应商详情 | 失效详情 | 点击重探 |
| `GET /vendors/:id/onboarding` | 供应商详情 | 不缓存 | 点击生成 |
| `GET /vendors/:id/materials` | 供应商详情 | `staleTime 5m` | 进入 |
| `GET /cases` | `/cases` | `staleTime 15s` | 进入 + SSE 失效 |
| `GET /cases/:id` | `/cases/[id]` | `staleTime 5s` | 进入 + SSE 失效 |
| `POST /cases` | 原料详情 / 工单页 | 失效 | 手动建单 |
| `POST /cases/:id/send` | 工单详情 | 失效 | 立即催办 |
| `GET /cases/:id/messages` | 工单详情·会话 | `staleTime 5s` | 进入 + SSE 追加 |
| `POST /cases/:id/manual-reply` | 工单详情 | 失效 | 电话沟通后回填 |
| `POST /cases/:id/resolve` | 工单详情 / `/handoffs` | 失效 | 决策 |
| `POST /cases/:id/receipt` | 工单详情 | 失效工单+Invoice | 收货 |
| `GET /invoices` | `/invoices` | `staleTime 30s` | 进入 |
| `GET /invoices/:id` | `/invoices/[id]` | `staleTime 10s` | 进入 |
| `GET /invoices/:id/pdf` | Invoice 详情 | 不缓存 | 下载 |
| `POST /invoices/:id/confirm` | Invoice 详情 | 失效 | 确认承诺值 |
| `POST /invoices/:id/receive` | Invoice 详情 | 失效+失效原料 | 收货 |
| `POST /invoices/:id/pay` | Invoice 详情 | 失效 | 付款 |
| `GET /alerts` | `/alerts` + 全局徽标 | `staleTime 10s` | 进入 + SSE |
| `PATCH /alerts/:id` | 告警中心 | 乐观更新 | 标记已读 |
| `POST /alerts/:id/ack` | 告警中心 | 失效 | 确认处理 |
| `GET /handoffs` | `/handoffs` + 全局徽标 | `staleTime 15s` | 进入 + SSE |
| `POST /handoffs/:id/decision` | `/handoffs` | 失效 | 决策 |
| `GET/PATCH /settings` | `/settings` | `staleTime 5m` | 进入 |
| `GET /stream` | App 级 Provider | — | 登录后建立 |

### 6.2 关键出入参速查

```ts
// 原料列表行
{ id, name, unit, onHand, safetyStock, level: 0|1|2|3, fillPct, openCaseId, affectedDishes }

// 工单详情
{ id, materialName, vendorName, status, qtyRequested, qtyConfirmed, etaAt,
  attemptCount, unansweredStreak, warnLevel, nextAttemptAt, interrupted,
  timeline:[{at, type, actor, text}], messages:[MessageDTO], invoice }

// 工单决策
{ action: 'RESUME' | 'SWITCH_VENDOR' | 'ADJUST_QTY' | 'CANCEL', payload?: {...} }

// Invoice
{ id, caseId, status, date, volume, unit, picVendor, picStore, rm,
  vendorId, unitPrice, totalAmount, actualVolume, discrepancyPct }

// 告警
{ id, type, severity, title, body, materialId, caseId, dishId, status, createdAt }
```

### 6.3 错误处理约定

- `401` → 清 token 跳登录
- `403` → 页面级「无权限」占位（不做 Toast，避免刷屏）
- `409 CONFLICT` → 「数据已被他人修改，请刷新」+ 自动失效对应 query（乐观锁冲突，重试一次）
- `429` → Toast「操作过于频繁」+ 按钮禁用倒计时
- `5xx` → 错误边界 + 重试按钮
- 所有写操作带 `Idempotency-Key`（前端生成 UUID，同一表单重复提交复用同一个），防双击重复下单

### 6.4 权限矩阵（前端只做显隐，后端做校验）

| 能力 | OWNER | MANAGER | VIEWER |
| --- | --- | --- | --- |
| 查看全部页面 | ✅ | ✅ | ✅ |
| 改原料阈值 / 配方 | ✅ | ✅ | ❌ |
| 盘点校正 | ✅ | ✅ | ❌ |
| 手动上下架 | ✅ | ✅ | ❌ |
| 建工单 / 催办 / 回填 | ✅ | ✅ | ❌ |
| 工单决策 / 接管处理 | ✅ | ✅ | ❌ |
| 确认收货 | ✅ | ✅ | ❌ |
| 付款 | ✅ | ❌ | ❌ |
| 改设置 | ✅ | ❌ | ❌ |

---

## 7. 设计规范

- **移动优先**：所有列表页单列卡片，操作区固定在底部（`sticky bottom`），单手可达
- **配色**：危险度用红橙黄绿；**此处不套用股市涨跌配色**，因为是库存水位不是行情
- **状态徽标**：工单 8 个状态、告警 7 个类型各一套固定色，全局语义一致
- **关键操作二次确认**：盘点校正、手动下架、付款、取消工单——弹窗说明后果
- **空状态**：每个列表都要有，且说明「什么时候这里会有内容」
- **离线**：只读缓存可用；写操作禁用并提示（避免离线提交造成不一致）

---

## 8. 与后端并行：Mock 策略

后端 B0 阶段产出接口契约后，前端即可开工：

1. 用 **MSW** 按 `backend-plan.md` 第 6 节写 handler，放在 `mocks/handlers/`
2. 共享类型：从后端 `packages/contract` 导出 zod schema（或用 OpenAPI 生成 TS 类型），**禁止前端手写类型**
3. SSE 在 mock 阶段用 `MockEventSource` 定时推假事件，验证失效链路
4. 联调只需切 `NEXT_PUBLIC_API_MODE=mock|real`，页面代码零改动

---

## 9. 测试

| 类型 | 覆盖 |
| --- | --- |
| 组件测试（Vitest + RTL） | 状态徽标、阈值滑块预览、差异条、权限显隐 |
| 契约测试 | MSW handler 与后端 schema 快照比对，防接口漂移 |
| E2E（Playwright） | 三条主路径：① 收到 W2 告警 → 进工单 → 回填回复 → 生成 Invoice ② 催办 3 次 → 收到下架告警 ③ 收货 → 付款（超阈值走审批） |
| 可访问性 | 移动端触控目标 ≥44px，对比度达 AA |
| 视觉回归 | 仅对看板与工单详情页做快照 |

---

## 10. 分阶段实施

| 阶段 | 周次 | 交付 | 判据 |
| --- | --- | --- | --- |
| **F0 地基** | W1 | Next.js 骨架、布局/Tab、鉴权流、主题与徽标体系、MSW 搭好 | 能登录、能看空列表 |
| **F1 只读主线** | W1–W2 | 看板、原料列表/详情、菜单、供应商（全部只读） | 对接 mock 数据渲染正确 |
| **F2 实时** | W2 | SSE Provider + 事件→缓存映射 + 全局徽标 | mock 推事件时页面自动更新 |
| **F3 工单闭环** | W2–W3 | 工单列表/详情（时间线 + 会话 + 操作区）、待我处理 | 主路径① E2E 通过 |
| **F4 告警与下架** | W3 | 告警中心、下架/上架交互 | 主路径② E2E 通过 |
| **F5 Invoice 与付款** | W3–W4 | Invoice 列表/详情、收货、付款与审批 | 主路径③ E2E 通过 |
| **F6 配置与权限** | W4 | 设置页、配方编辑、阈值配置、权限矩阵落地 | 三种角色显隐正确 |
| **F7 联调打磨** | W4–W5 | 切真实后端、真机移动端测试、空状态与错误态补齐 | 真机走通三条主路径 |

**依赖关系**
- F0 需要后端 B0 的鉴权接口与类型定义
- F1–F5 全程可对 mock 开发，不阻塞后端
- F7 需要后端 B7（API 完备）就绪
- **F3 是最高风险页**（工单详情三栏 + 实时 + 多状态操作区），建议排期中给它留缓冲

---

## 11. 待确认

1. **是否需要多门店切换器**：当前按单门店设计；若一个 Owner 管多店，看板与所有列表都要加门店维度。
2. **移动端是否要做 PWA / 独立 App**：店长主要在微信里用的话，可能更适合把关键告警做成 WhatsApp/微信通知 + 轻量 H5，而非完整 PWA。
3. **付款审批流是否要多级**：当前只有「金额超阈值 → OWNER 确认」一级。
4. **是否需要批量操作**：如批量改阈值、批量确认收货。
