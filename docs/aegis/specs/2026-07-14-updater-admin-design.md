# Updater Admin 详细需求与架构设计

- 状态：用户已于 2026-07-14 整体批准
- 日期：2026-07-14
- 修订：2026-07-19 增加 Netlify Functions 并发请求头平台例外与真实 Preview Mutation 验收门禁
- 目标项目：/Users/bytedance/prog/updater-admin
- 参考后端：/Users/bytedance/prog/UpdaterServer，commit 277b28e
- 约束：业务实现必须遵循已索引实施计划、所有权边界和验证门禁

## 1. 产品目标

构建一个单租户的版本管理后台，用于管理员维护程序、版本及其发布文件，并提供基础运行状态、审计记录和可供图表消费的监控数据。登录后直接进入程序管理，不设置 Dashboard 首页。

管理员的核心任务是：

1. 登录后台并管理其他管理员账号。
2. 创建、查询、编辑和删除程序。
3. 为程序创建版本，选择文件夹并直传 Aliyun OSS。
4. 启用或停用版本；多个版本可以同时启用。
5. 在监控页面查看系统健康状态、发布趋势、存储量和最近操作。

系统必须使用 Solid、TanStack Start、TanStack Router、TanStack Query、TanStack Table、TanStack Form、TanStack Store、Better Auth、Elysia、Drizzle、Neon、Sentry 和 Netlify。

## 2. 明确范围

### 2.1 首期范围

- 单租户、全局数据空间。
- Better Auth 邮箱密码登录。
- 所有登录账号拥有相同的完整管理员权限。
- 程序、版本、文件元数据和版本文件关系管理。
- 参考 UpdaterServer 迁移程序、版本、文件和 STS 的业务能力，由 Elysia 提供面向新后台重新设计的 API；不逐条复制旧 23 个 HTTP 契约。
- Aliyun OSS STS 浏览器直传。
- 程序和版本表格、筛选、排序、分页、表单和嵌套路由。
- 健康检查、审计记录和图表就绪的监控数据。
- Sentry 浏览器端与服务端错误监控。
- 简体中文和英文。
- 单仓库、单 Netlify 站点部署。

### 2.2 明确不做

- Billing、订阅、套餐、价格、账单或支付 Provider。
- 多租户、Organization、Workspace 或 tenant_id。
- 旧业务数据导入；Neon 从空库开始。
- ABP 用户、角色、权限、设置、Feature、Bootstrap API。
- OpenIddict 的 /connect/*、Discovery 或 JWKS 协议面。
- 现有客户端改造、路由切换、上线兼容验收或旧服务退役。
- UpdaterServer 路径、DTO、ABP 错误 Envelope、App:* 错误码和匿名客户端接口的兼容层。2026-07-20 新增的匿名只读发布接口是重新设计的独立合同，不恢复旧客户端兼容。
- 从 Sentry API 拉取 Issue 数据。
- 自动删除任何 OSS 对象。
- 邮件邀请服务或公开注册。

## 3. 已确认的业务规则

### 3.1 账号与权限

- 公开注册在服务端关闭。
- 通过一次性环境变量和幂等脚本创建首个账号。
- 首个账号只是初始化账号，不是特殊角色。
- 已登录管理员可以创建其他管理员并设置临时密码。
- 临时密码账号首次登录后必须修改密码。
- 所有有效账号权限完全相同。
- 不允许禁用或删除最后一个有效管理员。
- 管理员禁用后立即撤销其全部 Session。

### 3.2 程序

- 名称必填，最大 128 字符，并在未删除程序中全局区分大小写唯一。
- 描述可空，最大 512 字符。
- 列表首期仅按名称筛选，与参考截图保持一致。
- 删除使用软删除，并在同一事务中软删除所属版本；版本文件关系继续附着于已删除版本，以便审计。
- 文件元数据和 OSS 对象不随程序删除。

### 3.3 版本

- 版本号只接受三个非负十进制整数：major.minor.patch。
- 每段只能是 0 或非零数字开头的整数，因此拒绝空白、正负号、前导零、预发布和 build metadata。
- 同一程序内的未删除版本号唯一。
- 新版本号必须严格大于该程序未删除、已正式完成版本中的最高版本号；软删除版本不再占用版本号或参与比较。
- 新版本创建后默认未启用。
- 多个版本可以同时启用；启停一个版本不影响其他版本。
- 最新版本等于所有启用版本中三个数字段比较后的最高版本。
- 描述必填，最大 1024 字符。
- applicationId 创建后不可修改。
- 编辑版本时，未选择新文件夹则保留现有关联；选择后完整替换文件集合。
- 删除版本使用软删除，保留文件元数据与 OSS 对象。

### 3.4 文件

- 文件夹选择保留相对路径。
- 拒绝绝对路径、空路径、.. 跳转、反斜杠混用和控制字符。
- 浏览器计算 SHA-256，并采集字节大小和 MIME 类型。
- 唯一语义是未删除记录中的 path + sha256 + size。
- 上传显示单文件和整体进度，失败文件可以重试。
- 相同完成请求必须幂等，不能重复创建文件元数据。
- 任何自动流程都不得删除 OSS 对象；异常或孤儿对象只能由后续人工治理流程处理。

## 4. 信息架构与路由

### 4.1 页面路由

| 路由 | 权限 | 页面职责 |
|---|---|---|
| /login | 公开 | 邮箱密码登录；处理首次改密跳转 |
| / | 登录 | 重定向到 /programs |
| /programs | 登录 | 程序查询、分页、创建、编辑、删除 |
| /programs/$programId/versions | 登录 | 当前程序的版本、上传、启停、编辑和删除 |
| /administrators | 登录 | 管理员列表、创建、禁用和重置临时密码 |
| /monitoring/overview | 登录 | Neon、OSS、应用状态和业务指标 |
| /monitoring/audit | 登录 | 审计记录筛选和详情 |
| /settings/profile | 登录 | 姓名、语言和密码 |
| /settings/account | 登录 | 当前账号和 Session 信息 |
| /settings/system | 登录 | 系统名称、默认语言、默认分页数和仓库链接 |

不存在 Dashboard、Billing 或租户相关路由。登录成功且没有合法 returnTo 时进入 /programs。

### 4.2 路由行为

- 使用 pathless authenticated layout 统一检查登录状态。
- Router guard 只负责页面导航；Elysia 必须独立执行 API 鉴权。
- 程序和版本弹窗状态写入类型安全的 URL search params，使刷新、返回键和深链接可复现。
- 程序行的“版本”操作进入 /programs/$programId/versions。
- 动态页签位于顶部工具栏下方、页面标题上方，由 TanStack Store 管理并写入 sessionStorage；它不是第二套路由状态。
- /programs 是默认固定页签，不允许关闭。访问其他页面时打开或激活对应页签；同一路由键只保留一个页签，程序版本页以 programId 区分。
- 页签必须保存已打开页面，而不是根据当前 URL 临时投影。切换页面不能丢失其他页签；关闭非活动页签不导航，关闭活动页签回到左侧相邻页签，没有可用页签时回到 /programs。
- 版本页签保留具体 /programs/$programId/versions 地址，标题使用“版本 · 程序名”；页签过多时横向滚动，不压缩到不可读。
- 退出登录或切换账号时清空页签会话；恢复时丢弃已经失效或无权访问的地址。
- 页面筛选、排序和分页写入 URL，分享或刷新后保持一致。

## 5. 视觉与交互设计

### 5.1 设计方向

产品对象是内部发布操作台，页面的单一工作是让管理员安全、快速地判断“哪个程序的哪个版本正在发布”。视觉以提供的截图为结构基线，不套用通用营销型 SaaS 首页。

色彩令牌：

| 名称 | 色值 | 用途 |
|---|---|---|
| Release Green | #00A870 | 主操作、启用状态、选中导航 |
| Deep Green | #087F5B | Hover、Focus、深色文字强调 |
| Ink | #1F2D35 | 主文字和关键数据 |
| Mist | #F6F9F8 | 页面底色和筛选区 |
| Divider | #E5ECE9 | 边框、表格分隔和禁用背景 |
| Signal Red | #F04438 | 删除、失败和危险提示 |

字体角色：

- 正文和中文界面：Noto Sans SC，系统中文字体回退。
- 拉丁文字和数字：Inter。
- UUID、版本号、Hash 和文件大小：JetBrains Mono。

代表性交互元素是动态页签栏：它承载真实的后台多页面工作上下文，并严格位于顶部工具栏下方、页面标题上方。其余页面保持克制，避免渐变、营销大标题和过量圆角卡片。

### 5.2 桌面结构

~~~text
┌──────────────┬──────────────────────────────────────────────┐
│ 品牌与侧栏   │ 顶部工具：语言 / 仓库 / 设置 / 用户        │
│              ├──────────────────────────────────────────────┤
│ 程序         │ 动态页签：程序 / 版本 · 程序名 / 管理员…   │
│ 管理员       ├──────────────────────────────────────────────┤
│ 监控         │ 页面标题                                     │
│ 设置         │ ┌──────────────────────────────────────────┐ │
│              │ │ 筛选区 / 表格工具栏 / Table + 分页       │ │
│              │ └──────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────┘
~~~

- 桌面侧栏宽 232px，可折叠到 64px。
- 顶部工具栏高 56px；其下是独立页签栏，再下方才是页面标题和主内容。主内容保持与截图相近的宽留白和居中卡片。
- 程序与版本页优先高保真还原截图中的筛选区、工具栏、复制 ID、启停开关、分页和模态表单。
- GitHub 图标只在配置 repositoryUrl 后显示，不能保留无功能按钮。

### 5.3 响应式与动效

- 小于 1024px 时侧栏改为抽屉。
- 表格在窄屏允许横向滚动，关键操作列保持可见。
- 模态框最大占视口高度，上传列表独立滚动。
- Focus ring 必须明显，所有图标按钮都有可读名称和 Tooltip。
- 动效集中在抽屉、弹窗和启停开关，时长 120–180ms。
- 尊重 prefers-reduced-motion。

### 5.4 文案

- 默认简体中文，支持英文。
- 操作名称保持一致：创建、保存更改、启用、停用、删除、重试上传。
- 空状态直接给出下一步，例如“还没有程序，创建第一个程序”。
- 错误必须说明原因和恢复方式，不使用笼统的“操作失败”。

## 6. 页面功能

### 6.1 登录

- 字段：邮箱、密码。
- 无注册链接。
- 登录错误不区分账号不存在和密码错误。
- 失败次数受到速率限制。
- mustChangePassword 为真时只允许进入修改密码流程。
- 修改成功后撤销旧 Session，并建立新 Session。

### 6.2 程序管理

- 名称筛选框、查询和重置。
- 服务端分页，默认 20 条，可选 20、50、100。
- 支持创建时间排序；服务端使用字段白名单，不能直接执行客户端排序表达式。
- 表格列：序号、ID、名称、描述、创建时间、操作。
- ID 支持复制并显示成功反馈。
- 操作：查看版本、编辑、删除。
- 创建与编辑使用 TanStack Form；名称失焦校验，保存时服务端再次校验。
- 删除二次确认，确认内容显示程序名及受影响版本数量。

### 6.3 版本管理

- 标题显示当前程序名称。
- 表格列：序号、ID、版本号、描述、状态、创建时间、操作。
- 最高启用版本显示“最新”标记。
- 启停开关使用乐观 UI；服务端失败时回滚并显示具体原因。
- 创建表单：版本号、描述、程序文件夹。
- 选择文件夹后展示文件数、总大小、相对路径冲突和 Hash 计算状态。
- 上传按钮只有在校验通过后可用。
- 编辑允许修改描述；版本号变更仍必须严格大于未删除、已正式完成版本中的最高版本。
- 替换文件夹是显式操作，不选则保留现有文件。
- 删除二次确认，不删除文件和 OSS 对象。

### 6.4 管理员

- 表格：姓名、邮箱、状态、创建时间、最后登录时间、操作。
- 创建账号需要姓名、邮箱和临时密码。
- 不接邮件服务。
- 操作：禁用/启用、重置临时密码、撤销 Session。
- 禁止管理员禁用自己。
- 禁止禁用最后一个有效管理员。

### 6.5 监控与审计

- Monitoring Overview 展示应用版本、构建信息、Neon 状态、OSS STS 状态和最近检查时间。
- 公开 /health 只返回进程存活，不泄露依赖、凭证或版本细节。
- 登录后的监控状态接口返回 Neon 和 OSS 的细分结果。
- Audit 页面按操作者、动作、资源类型、结果和日期筛选。
- 审计详情展示 before/after JSON 差异，但永不记录密码、Session、Cookie、STS 或永久密钥。
- 发布趋势支持 7、30、90 天，接口返回不绑定图表供应商的通用时间序列：

~~~ts
type TimeSeries = {
  from: string
  to: string
  interval: "day"
  points: Array<{ bucket: string; value: number }>
  total: number
}
~~~

- 首期在监控页使用可访问的原生 SVG 图表，证明数据获取已具备图表消费能力，但不增加图表供应商。

### 6.6 设置

- Profile：姓名、语言、修改密码。
- Account：邮箱、当前 Session、其他 Session 撤销。
- System：系统显示名称、默认语言、默认分页数、可选仓库 URL。
- 数据库、OSS、Sentry 和 Better Auth Secret 只由部署环境管理，不允许在 UI 编辑。

## 7. TanStack 职责分工

| 库 | 唯一职责 | 首期证明点 |
|---|---|---|
| TanStack Start | SSR、应用壳、Netlify 请求入口 | 浏览器同域 transport 与 request-scoped SSR direct bridge |
| TanStack Router | 嵌套路由、Guard、URL search state | programs/$programId/versions 和可回退弹窗 |
| TanStack Query | 唯一远端缓存所有者 | 列表、详情、监控序列、Mutation 和精确失效 |
| TanStack Table | 服务端表格状态 | 程序、版本、管理员、审计表格 |
| TanStack Form | 表单状态和客户端校验 | 程序、版本、管理员、设置 |
| TanStack Store | 纯客户端共享 UI 状态 | 侧栏、动态已打开页签、上传队列和首屏 locale 回退 |
| TanStack CLI | 脚手架与生态元数据 | package script 和 .cta.json |
| TanStack Intent | 当前版本的本地实现指南 | AGENTS.md 规定的 list/load 流程 |

TanStack Router loader 只调用 queryClient.ensureQueryData。defaultPreloadStaleTime 保持 0，避免 Router 和 Query 成为两个缓存所有者。

## 8. 系统架构

~~~mermaid
flowchart LR
  B["Solid 管理后台"] --> R["TanStack Router"]
  R --> Q["TanStack Query"]
  Q -->|"浏览器同域 HTTP"| S["TanStack Start Server Route"]
  S --> E["Elysia API"]
  SSR["TanStack Start SSR Request Context"] -->|"same-origin direct bridge"| E
  E --> A["Better Auth Session 校验"]
  E --> D["Drizzle"]
  D --> N["Neon Postgres"]
  E --> STS["Aliyun STS"]
  B -->|"短期凭证直传"| OSS["Aliyun OSS"]
  B --> SC["Sentry Browser"]
  E --> SS["Sentry Server"]
  S --> NF["Netlify Function"]
~~~

### 8.1 所有权边界

- /api/auth/* 由 Better Auth 专用 Start route 处理。
- 浏览器发出的 /api/v1/* 由 Start catch-all transport route 转交 Elysia Fetch handler。
- SSR 内部 API 调用默认使用当前请求作用域内的同域 direct Elysia bridge，只继承 `authorization`、`cookie` 和 `origin`，拒绝跨域目标，不向同一个 Netlify Function 发起 HTTP 自请求。
- /health 是最小公开存活检查。
- Start route 不包含业务规则、数据库查询或授权决定。
- Elysia service 负责验证、鉴权、事务、错误映射和审计。
- Drizzle repository 负责 SQL 和持久化，不复制业务规则。

### 8.2 服务端目录目标

保持生成结构，在批准后增量增加：

~~~text
src/
  server/
    api/
      app.ts
      middleware/
      modules/
        applications/
        versions/
        files/
        administrators/
        monitoring/
    auth/
    db/
      schema/
      repositories/
    integrations/
      oss/
      sentry/
  routes/
    health.ts
    api/
      auth/$.ts
      v1/$.ts
~~~

## 9. 新后台 Elysia API

UpdaterServer 只作为业务能力和边界条件的参考，不作为 HTTP Contract。新后台使用统一的 /api/v1 命名、请求模型、分页和错误结构，不实现 /api/app/* 兼容层，也不提供面向现有更新客户端的匿名接口。

### 9.1 通用合同

- /api/auth/* 继续由 Better Auth 处理；除 /health 外，/api/v1/* 全部要求有效管理员 Session。
- JSON 字段使用 camelCase，ID 使用 UUID，时间使用 UTC ISO 8601。
- 列表统一返回 { items, page, pageSize, total }，page 从 1 开始。
- 单资源查询和 Mutation 直接返回资源 DTO；删除成功返回 204。
- Elysia 运行时 Schema 是请求和响应的合同源，前端只导入 server-safe 的 DTO 类型，不导入数据库或服务端运行时代码。
- TanStack Query 的 queryKey 按资源、ID 和 URL search 参数构造；Mutation 成功后只精确失效受影响的列表和详情。
- 所有写操作生成 requestId 和审计事件。

### 9.2 API 清单

| 方法与路径 | 用途 |
|---|---|
| GET /api/v1/programs | 程序筛选、排序和分页 |
| POST /api/v1/programs | 创建程序 |
| GET /api/v1/programs/{programId} | 程序详情 |
| PATCH /api/v1/programs/{programId} | 编辑程序 |
| DELETE /api/v1/programs/{programId} | 软删除程序及其版本 |
| GET /api/v1/programs/{programId}/versions | 当前程序版本分页 |
| POST /api/v1/programs/{programId}/versions | 使用已登记文件创建版本 |
| GET /api/v1/programs/{programId}/versions/{versionId} | 版本详情 |
| PATCH /api/v1/programs/{programId}/versions/{versionId} | 编辑版本和可选替换文件集合 |
| DELETE /api/v1/programs/{programId}/versions/{versionId} | 软删除版本 |
| PUT /api/v1/programs/{programId}/versions/{versionId}/activation | 幂等设置 active 布尔值 |
| GET /api/v1/programs/{programId}/versions/{versionId}/files | 当前版本文件清单 |
| POST /api/v1/uploads/credentials | 为待上传文件签发受限 STS 凭证和确定性 objectKey |
| POST /api/v1/uploads/complete | 批量、幂等登记已完成上传的文件元数据 |
| GET /api/v1/files | 文件元数据筛选和分页 |
| GET /api/v1/files/{fileId} | 文件元数据详情 |
| GET /api/v1/administrators | 管理员分页 |
| POST /api/v1/administrators | 创建临时密码账号 |
| PATCH /api/v1/administrators/{administratorId} | 修改姓名、语言或启用状态 |
| POST /api/v1/administrators/{administratorId}/reset-password | 设置临时密码并撤销 Session |
| POST /api/v1/administrators/{administratorId}/revoke-sessions | 撤销该账号全部 Session |
| GET /api/v1/profile | 当前账号资料与 Session 摘要 |
| PATCH /api/v1/profile | 修改姓名和语言 |
| POST /api/v1/profile/change-password | 修改当前账号密码并轮换 Session |
| GET /api/v1/settings/system | 系统设置 |
| PATCH /api/v1/settings/system | 修改系统设置 |
| GET /api/v1/monitoring/status | Neon、OSS、应用状态与业务计数 |
| GET /api/v1/monitoring/release-series | 7/30/90 天图表就绪时间序列 |
| GET /api/v1/audit-events | 审计分页和筛选 |
| GET /health | 仅进程存活 |

### 9.3 UpdaterServer 能力映射边界

- 程序 CRUD、版本 CRUD、启停、文件关联和 STS 上传能力迁入新的 Elysia 领域模块。
- “最高启用版本”在版本列表 DTO 中由服务端标记 isLatest，不保留单独的旧 latest 路由。
- 文件查询按 ID、版本和分页由新嵌套路由覆盖，不保留 by-id、by-hash 等旧命名。
- 新后台只需要上传 STS；旧下载 STS、匿名版本清单和面向现有更新客户端的文件 URL 接口不属于本后台。
- 不复制 ABP Conventional Controller、DTO Envelope、认证标记或 App:* 错误码。

### 9.4 匿名只读发布接口（2026-07-20 新增）

- `GET /api/public/v1/programs/:programId/releases/latest` 返回未删除程序中数值最高的启用版本。
- `GET /api/public/v1/programs/:programId/releases/:versionNumber` 只返回指定的未删除、已启用、规范 `major.minor.patch` 版本。
- 响应包含程序 ID/名称、版本号、描述、以版本创建时间表示的 `publishedAt`、统一下载过期时间，以及按路径稳定排序的文件 `path/size/sha256/checksumAlgorithm/mimeType/downloadUrl`。
- `downloadUrl` 是永久服务端身份签发的单对象 300 秒 OSS GET URL；不发放下载 STS，不返回原始 `objectKey` 字段、OSS ETag、内部版本/文件 ID、操作者或凭证。
- Manifest 使用 `Cache-Control: no-store`，避免缓存过期签名地址。
- 该命名空间不鉴权但只读；所有管理接口和上传接口继续位于受管理员 Session 保护的 `/api/v1`。
- 浏览器跨域只允许 `PUBLIC_API_ALLOWED_ORIGINS` 中的精确 Origin，不携带 Cookie/凭证；无 Origin 的原生和服务端调用可用。GET/HEAD 按 Netlify 客户端 IP 使用 Neon 固定窗口限流。

## 10. 错误与并发合同

### 10.1 Problem Details

非 2xx 响应统一使用接近 RFC 9457 的 JSON：

~~~json
{
  "type": "https://updater-admin.local/problems/version-not-greater",
  "title": "版本号必须大于当前最高版本",
  "status": 409,
  "code": "VERSION_NOT_GREATER",
  "detail": "当前最高版本为 1.4.2",
  "requestId": "req_...",
  "fieldErrors": [
    { "path": "versionNumber", "code": "VERSION_NOT_GREATER" }
  ]
}
~~~

- 前端按 status 和 code 决定交互与本地化文案，不解析 title 或 detail。
- fieldErrors 仅在字段级错误时出现；生产环境的 detail 不包含堆栈、SQL、凭证或内部路径。
- 未处理异常返回 INTERNAL_ERROR，并通过 requestId 关联 Sentry。

### 10.2 首期错误码

| HTTP | code | 用途 |
|---|---|---|
| 400 | BAD_REQUEST | 请求结构无法解析 |
| 401 | UNAUTHENTICATED | 未登录或 Session 失效 |
| 403 | FORBIDDEN | 账号被禁用或动作被保护规则拒绝 |
| 404 | NOT_FOUND | 程序、版本、文件或管理员不存在 |
| 409 | PROGRAM_NAME_CONFLICT | 程序名重复 |
| 409 | VERSION_NUMBER_CONFLICT | 同程序版本号重复 |
| 409 | VERSION_NOT_GREATER | 新版本号不高于当前最高版本 |
| 409 | UPLOAD_METADATA_CONFLICT | path、SHA-256、size 或对象信息冲突 |
| 409 | STALE_WRITE | rowVersion 已过期 |
| 409 | LAST_ADMIN_REQUIRED | 试图禁用最后一个有效管理员 |
| 422 | VALIDATION_FAILED | 一个或多个字段不合法 |
| 428 | PRECONDITION_REQUIRED | 并发写操作缺少 X-Updater-If-Match |
| 429 | RATE_LIMITED | 超过速率限制 |
| 500 | INTERNAL_ERROR | 未预期服务端错误 |

这是一套为新后台设计的小型稳定集合，不要求与 UpdaterServer 错误码一一映射。

### 10.3 乐观并发

- 2026-07-14 的原设计选择了标准 `If-Match` 请求头；2026-07-19 的真实 Netlify Functions 路径证明平台代理会在 Function 前剥离该请求头，因此以下平台例外取代原请求头选择，但不改变 ETag/rowVersion 并发模型。
- 每个受乐观并发保护的 Mutation 必须发送应用自有的 `X-Updater-If-Match`。客户端和服务端都从 `src/shared/api/common.ts` 导入 `UPDATER_IF_MATCH_HEADER`，不允许各自复制字符串。
- 服务端只读取 `X-Updater-If-Match`。不得双读标准 `If-Match` 作为兼容 fallback；即使请求只带标准头，也按缺少应用头处理并返回 `428 PRECONDITION_REQUIRED`。过期应用头返回 `409 STALE_WRITE`。
- 详情 GET 和返回实体的成功 Mutation 继续使用标准 `ETag` 响应头，值由 rowVersion 生成；列表项继续包含同一个不透明 `etag` 字段。成功 DELETE 仍返回无 ETag 的 `204`。
- TanStack Query 在缓存中保存 ETag，并在 Mutation 时把该值放入 `X-Updater-If-Match`；冲突后重新拉取详情并让用户决定是否重试。
- Domain/service/repository 层的参数名保留为 `ifMatch`，因为它表达内部前置条件概念，不代表 wire header 名称。

## 11. Neon 与 Drizzle 数据模型

### 11.1 Better Auth 与管理员

- Better Auth 标准 user、session、account、verification 表、数据库限流表，并包含 admin 插件要求的技术字段：user.role、user.banned、user.ban_reason、user.ban_expires 和 session.impersonated_by。
- role 固定为 admin，仅用于 Better Auth 的服务端管理 API，不构成产品 RBAC，也不提供角色管理界面。
- user.banned 是账号禁用状态的唯一鉴权真相源；禁用操作者和前后状态写入 audit_events，不在 metadata 中维护第二份禁用状态。
- admin_metadata：
  - user_id 主键和外键。
  - must_change_password。
  - locale，默认 zh-CN。
  - last_login_at。
- 不建立 role、permission、organization、tenant、subscription 或 invoice 表。

### 11.2 applications

- id uuid 主键。
- name varchar(128)。
- description varchar(512) 可空。
- created_at/by、updated_at/by、deleted_at/by。
- row_version bigint，默认 1。
- 部分唯一索引：name WHERE deleted_at IS NULL。

### 11.3 application_versions

- id uuid 主键。
- application_id uuid 外键。
- version_number varchar(20)，保存规范化 major.minor.patch 并用于显示。
- version_major、version_minor、version_patch integer，均 CHECK >= 0。
- description varchar(1024)。
- is_active boolean，默认 false。
- 完整审计字段和 row_version。
- 部分唯一索引：application_id + 三个版本数字 WHERE deleted_at IS NULL。
- latest 查询索引：application_id + is_active + 三个版本数字降序。

### 11.4 file_metadata

- id uuid 主键。
- path varchar(1024)。
- sha256 char(64)。
- size bigint CHECK >= 0。
- object_key varchar(1024)，作为 OSS 位置真相源。
- mime_type varchar(255)。
- etag varchar(255) 可空。
- checksum_algorithm 固定为 sha256。
- 完整审计字段和 row_version。
- 部分唯一索引：path + sha256 + size WHERE deleted_at IS NULL。
- sha256 普通索引。

uploads/complete 强制 sha256 是小写 64 位十六进制字符串，并核对凭证请求中的 path、size 和 objectKey。

### 11.5 version_files

- version_id + file_metadata_id 复合主键。
- 仅保留两个真实外键，不复制旧 EF 的影子 ApplicationVersionId。
- 文件集合替换在事务中完成；前后集合写入 audit_events。

### 11.6 audit_events

- id uuid。
- actor_id 可空，系统动作允许为空。
- action、resource_type、resource_id、result。
- before_json、after_json。
- request_id、ip、user_agent。
- created_at timestamptz。
- 只追加，不更新、不软删除。

### 11.7 system_settings

单例配置：

- system_name，默认“版本管理系统”。
- default_locale，默认 zh-CN。
- default_page_size，默认 20。
- repository_url 可空。
- updated_at/by 和 row_version。

所有时间在数据库保存 UTC timestamptz；界面默认按 Asia/Shanghai 显示，并按照语言格式化。

### 11.8 rate_limit_windows

- endpoint + subject_key + window_started_at 复合唯一键。
- count、expires_at 和 created_at。
- 仅为 Netlify 多实例下的 STS、管理员创建/重置和改密限流提供共享计数；登录限流仍由 Better Auth 负责。
- 过期窗口由请求路径机会式清理，不引入 Redis、租户或第二套安全事件系统。

## 12. 上传事务流程

~~~mermaid
sequenceDiagram
  participant U as 管理员浏览器
  participant API as Elysia
  participant STS as Aliyun STS
  participant OSS as Aliyun OSS
  participant DB as Neon

  U->>API: POST /api/v1/uploads/credentials
  API->>STS: AssumeRole，限制新系统前缀和短 TTL
  STS-->>API: 临时凭证
  API-->>U: 临时凭证 + objectKey 映射
  U->>U: 校验相对路径，计算 SHA-256/size/MIME
  U->>OSS: 并发直传，显示进度并重试失败文件
  OSS-->>U: objectKey + ETag
  U->>API: POST /api/v1/uploads/complete
  API->>DB: 幂等登记文件元数据
  DB-->>API: fileMetadataIds
  U->>API: POST /api/v1/programs/{programId}/versions
  API->>DB: 事务创建版本和 version_files
  DB-->>API: 默认未启用版本
  API-->>U: VersionDto
~~~

- STS 权限只允许配置的 bucket 和新系统 object prefix。
- 上传并发数有上限，默认 4。
- 文件 Hash 计算和上传支持取消。
- objectKey 由 OSS_UPLOAD_PREFIX、SHA-256 和规范化相对路径确定性生成；同一文件的重试落到同一对象键。
- Metadata 完成请求以 path + sha256 + size 的部分唯一索引做原子 upsert，并校验 objectKey 与 ETag；重复提交返回已有文件元数据，不引入额外 uploadSession 状态。
- 创建版本失败不删除对象；记录失败审计，允许管理员重新提交。

## 13. 认证与安全

- Better Auth 使用 HttpOnly、Secure、SameSite=Lax Cookie。
- 登录 returnTo 只接受本站已注册的受保护路由，拒绝外部 URL，避免开放重定向。
- 生产环境只允许 HTTPS，BETTER_AUTH_URL 必须是 Netlify canonical URL。
- 登录、改密、管理员创建和 STS 接口实施速率限制。
- 所有非 GET 管理写操作实施 CSRF 防护。
- Elysia 对 Body、Query、Params 全部做运行时 Schema 校验。
- 动态排序使用服务端字段白名单。
- UUID、分页上限、文件大小、路径和版本号都在服务端验证。
- 上传 STS TTL 尽可能短并限制前缀；永久 OSS 密钥只存在于 Netlify Secret。
- Sentry 在发送前清除 Cookie、Authorization、密码、Session、STS 和上传 URL 中的敏感参数。
- requestId 从入口贯穿 Elysia、审计和 Sentry。

## 14. 监控与 Sentry

### 14.1 健康检查

- GET /health：200 + { status: "ok" }，仅代表进程可响应。
- 登录后状态：并行检查 Neon 简单查询、STS AssumeRole 可用性和配置完整性。
- 详细状态不返回连接串、角色 ARN 或凭证。

### 14.2 Sentry

- 浏览器和服务端分别初始化。
- 配置 release、environment、requestId 和用户 ID；不发送密码或 Token。
- Netlify 构建上传 Source Map。
- 错误边界覆盖 Router 页面、Query Mutation 和 Elysia 未处理异常。
- 后台不调用 Sentry Issue API，监控页面只展示自身健康与业务指标。

### 14.3 业务指标

- 程序总数。
- 版本总数和启用版本数。
- 文件记录数与总字节数。
- 每日版本创建数量。
- 每日启用/停用数量。
- 最近成功与失败管理操作。

这些指标只出现在监控页面及其 API 中，不形成独立 Dashboard 页面。

## 15. 国际化与可访问性

- 所有用户可见文案使用 key，不在组件散落中英文常量。
- 服务端保存用户 locale；localStorage 仅用于首屏回退。
- 切换语言立即刷新当前页面文案，不改变业务查询。
- 日期、数字和文件大小使用 Intl。
- 默认时区 Asia/Shanghai，数据库始终 UTC。
- 表格表头、排序、分页、开关、弹窗和上传进度支持键盘与屏幕阅读器。
- 颜色不作为唯一状态表达；同时提供文字或图标。
- 最低达到 WCAG 2.1 AA 的对比度和 Focus 可见性。

## 16. 环境变量与部署

### 16.1 必需变量

- DATABASE_URL
- BETTER_AUTH_URL
- BETTER_AUTH_SECRET
- BOOTSTRAP_ADMIN_NAME
- BOOTSTRAP_ADMIN_EMAIL
- BOOTSTRAP_ADMIN_PASSWORD
- VITE_SENTRY_DSN
- SENTRY_DSN
- SENTRY_AUTH_TOKEN
- SENTRY_ORG
- SENTRY_PROJECT
- SENTRY_ENVIRONMENT
- OSS_ACCESS_KEY_ID
- OSS_ACCESS_KEY_SECRET
- OSS_UPLOAD_RAM_ROLE_ARN
- OSS_STS_ENDPOINT
- OSS_BUCKET
- OSS_REGION
- OSS_UPLOAD_PREFIX
- PUBLIC_API_ALLOWED_ORIGINS

### 16.2 部署规则

- Netlify 执行 pnpm build，TanStack Start 生成 SSR Function。
- Elysia 通过 Web Fetch handler 运行在同一 Function 请求面。
- Drizzle Migration 由显式部署步骤执行，不能在请求启动时自动执行。
- Neon 使用 pooled serverless connection。
- 首个管理员脚本成功后，从 Netlify 删除 BOOTSTRAP_ADMIN_PASSWORD。
- 发布文件永远不进入 Netlify 构建产物或 Function Body。
- Preview Deployment 使用独立 Neon Branch 和独立 OSS prefix。

## 17. 验收标准

### 17.1 认证

- 未登录访问所有后台页面都会跳转 /login。
- 登录成功且没有合法 returnTo 时进入 /programs；系统不存在 /dashboard 页面或导航项。
- 未登录调用管理 API 返回 401。
- 公开注册不存在且无法绕过。
- 首个账号可幂等初始化，其他账号可用临时密码登录并强制改密。
- 最后一个有效管理员不能被禁用。

### 17.2 程序和版本

- 程序列表支持名称筛选、重置、排序和服务端分页。
- 创建重复名称返回 409 PROGRAM_NAME_CONFLICT。
- 新后台版本号严格按无前导零的三个数字段验证和排序。
- 同程序重复版本返回 409 VERSION_NUMBER_CONFLICT，非新版本返回 409 VERSION_NOT_GREATER。
- 多个版本可同时启用，版本列表只对最高启用版本标记 isLatest。
- 所有写入产生审计事件；并发写入缺少 `X-Updater-If-Match` 返回 428，应用头过期返回 409。

### 17.3 文件上传

- 文件夹相对路径、SHA-256、大小和 MIME 正确保存。
- 浏览器直传 OSS，Netlify Function 不接收文件正文。
- 上传进度和失败重试可见。
- 重复完成请求不会产生重复元数据。
- 删除程序或版本不会删除 OSS 对象。

### 17.4 API 合同

- Contract Test 覆盖第 9 节 /api/v1 路径、请求/响应 Schema、分页和认证边界。
- 所有 /api/v1 接口必须登录，公开面只有 /health 和 Better Auth 自身所需入口。
- Error Contract Test 覆盖 Problem Details 字段、HTTP 状态、新错误码和 requestId。
- 并发 Contract Test 证明客户端和服务端共享 `UPDATER_IF_MATCH_HEADER`，标准 `If-Match` 不触发兼容 fallback，详情/Mutation 仍返回标准 `ETag`。
- 不测试 UpdaterServer 路径、DTO、App:* 错误码或现有更新客户端兼容性。

### 17.5 UI、监控和国际化

- 程序与版本页在桌面端高保真对应参考截图。
- 顶部工具栏下方、页面标题上方存在动态页签栏；程序页签固定，连续切换多个页面后已打开页签仍保留。
- 页签关闭行为、活动页签回退、具体程序版本地址和 sessionStorage 恢复均有组件与浏览器测试。
- 小屏可完成全部核心操作。
- 中文默认，英文切换持久化。
- Monitoring 数据可加载、空状态明确、错误可恢复，时间序列可直接供图表消费。
- /health 不泄露依赖信息；详细状态必须登录。
- 浏览器与服务端测试错误可在 Sentry 对应 Environment 中看到。

### 17.6 工程验证

- pnpm check、pnpm typecheck、pnpm test、pnpm build 全部通过。
- Unit Test 覆盖版本比较、路径校验、唯一性、软级联和权限保护。
- Integration Test 覆盖 Drizzle/Neon Repository、事务、审计和 OSS Adapter。
- Component Test 覆盖 Table、Form、Dialog、Switch 和上传队列。
- E2E 覆盖登录、程序 CRUD、版本上传、启停、管理员创建和语言切换。
- Netlify Preview 完成登录、数据库、Elysia、Sentry 和 OSS Smoke Test。
- 最终并发验收必须由真实已登录浏览器向授权 Netlify Preview 发起至少一次受保护 Mutation，穿过平台代理并到达 Function，证明请求携带 `X-Updater-If-Match`、状态确实更新且响应返回新的标准 `ETag`；直接调用 Elysia、mock 路由、local dev 或 built-handler smoke 均不能替代该门禁。

## 18. 参考证据

- 旧接口清单用于确认源业务能力，而不是新 API Contract：[UpdaterServerHttpApiHostModule.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.HttpApi.Host/UpdaterServerHttpApiHostModule.cs:222)。
- 程序接口与认证边界：[ApplicationAppService.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Application/Application/ApplicationAppService.cs:19)。
- 版本接口、最新版本与文件查询：[ApplicationVersionAppService.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Application/ApplicationVersion/ApplicationVersionAppService.cs:23)。
- 文件接口与查询语义：[FileAppService.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Application/File/FileAppService.cs:19)。
- STS 上传与下载边界：[StsAppService.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Application/Sts/StsAppService.cs:11)。
- 版本唯一、新版本限制和文件关系：[ApplicationVersionManager.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Domain/ApplicationVersion/ApplicationVersionManager.cs:69)。
- 当前业务表、外键和索引：[业务表迁移](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.EntityFrameworkCore/Migrations/20250204030314_Add_Application_ApplicationVersion_FileMetadata_VersionFile.cs:17)。
- 旧错误码只用于理解源行为，新合同采用第 10 节的新错误模型：[ApplicationVersionErrorCodes.cs](/Users/bytedance/prog/UpdaterServer/src/UpdaterServer.Domain.Shared/ApplicationVersion/ApplicationVersionErrorCodes.cs:3)。

## 19. 设计审查摘要

### 19.1 TaskIntentDraft

- Outcome：在现有 TanStack CLI 脚手架上建立可验证的单租户版本管理后台。
- Goal：完整覆盖程序、版本、文件上传、管理员、监控、审计和国际化，并以新 Elysia API 承载后台所需业务能力。
- Success evidence：第 17 节验收标准全部满足。
- Stop condition：设计已批准；当前停在实施计划交付与执行模式选择，尚未开始业务代码。
- Non-goals：Billing、多租户、旧数据迁移、客户端切换、ABP/OpenIddict 平台面、自动 OSS 删除。
- Risks：Netlify/Elysia 运行时适配、新 API 合同一致性、直接上传幂等和大文件体验。

### 19.2 BaselineReadSetHint

- AGENTS.md。
- 本 Design Spec。
- docs/aegis/baseline/2026-07-14-initial-baseline.md。
- UpdaterServer 四个 Application Service、Domain Manager、DTO、实体和 EF Migration。
- 用户提供的八张截图。
- 已安装 TanStack Intent 的 Start、Solid Start、Deployment、Router、Data Loading、Auth Guard 和 Server Route 指南。

### 19.3 BaselineUsageDraft

- Required baseline refs：AGENTS.md、初始双基线、UpdaterServer commit 277b28e。
- Delivered context refs：用户需求、逐项选择和最终批量确认。
- Acknowledged before plan refs：CLI/Intent 约束、Netlify、Neon、OSS、Better Auth、Elysia 所有权。
- Cited in design refs：第 18 节代码证据。
- Missing refs：无阻塞项；新 API 的 Contract Test 在实现阶段建立。
- Decision：approved；continue to implementation planning。

### 19.4 Requirement Ready Check

- Requirement source refs：用户原始请求、截图、后续选择、UpdaterServer 源码。
- Goals and scope refs：第 1–3 节。
- User / scenario refs：第 1、3、6 节。
- Requirement item refs：第 4–16 节。
- Acceptance / verification criteria refs：第 17 节。
- Open blocker questions：无。
- Decision：approved and ready for implementation planning。

### 19.5 ImpactStatementDraft

- Affected layers：Solid UI、TanStack Router/Query/Table/Form/Store、Start transport、Better Auth、Elysia、Drizzle/Neon、OSS、Sentry、Netlify。
- Canonical owners：第 7、8 节和初始双基线。
- Invariants：单租户、无 Billing、全员同权限、Query 单缓存、Elysia 单业务 API Owner、OSS 直传、不自动删对象。
- Compatibility：不提供 UpdaterServer Wire Contract 或现有客户端兼容层；只迁移后台所需业务语义。
- Non-goals：第 2.2 节。

### 19.6 Existence Check

| 新表面 | 复用候选 | 必要性结论 |
|---|---|---|
| Start 到 Elysia transport adapter | TanStack Start server route | add-with-proof：用户明确要求 Elysia；Adapter 只转发 Request，不成为业务 Owner |
| /api/v1 Elysia 合同 | UpdaterServer 旧路由 | replace-with-proof：用户明确允许重新设计前后端通信且不要求客户端兼容 |
| uploads/complete | 通用文件登记 | add-with-proof：新后台需要批量幂等、MIME、objectKey 和 ETag |
| 原生 SVG 图表 | 新图表依赖 | reuse-existing：数据和 SVG 足够首期，不增加供应商 |
| 内部监控 | Sentry Issue API | add-with-proof：健康与业务指标不属于 Sentry，且用户明确不要 Issue 拉取 |

### 19.7 Product 与架构风险

- Value：将发布管理、上传、审计和健康状态放入一个可维护后台。
- Trade-off：新合同显著简化后台协作与错误处理，但不会兼容 UpdaterServer 路径或现有更新客户端；这是明确的范围选择。
- Architecture integrity：Elysia 是唯一业务 Owner；Start 仅 Transport；Query 是唯一远端缓存；Better Auth 是唯一 Session Owner。
- Complexity budget：高复杂度跨层任务，必须按 applications、versions/uploads、auth/admin、monitoring 四个垂直切片实施，不建立巨型 API 或页面文件。
- Baseline alignment：aligned，scope: both；设计已获用户批准。
- ADR signal：批准并验证实现后，应记录 Netlify/Elysia 同域拓扑、/api/v1 新合同边界和新数据模型三个耐久决策；本提案本身不创建已接受 ADR。

## 20. 设计批准的含义

用户已于 2026-07-14 批准本文件；2026-07-19 的 Netlify 请求头平台例外按第 10.3 节修订并收紧最终 Preview 验收。下一步是交付并选择执行 `docs/aegis/plans/2026-07-14-updater-admin-implementation.md`，然后按垂直切片开始业务实现。批准不代表允许创建真实云资源、写入生产数据库、修改旧 UpdaterServer、删除 OSS 对象或切换现有客户端。
