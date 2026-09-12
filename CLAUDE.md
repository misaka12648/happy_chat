# HappyChat 项目规范

> 本文档是项目的权威规范（Master Standard），适用于人类开发者与 AI 编码助手。
> `Agent.md` 是其常驻摘要，二者冲突时以本文档为准。

## 1. 项目概览

HappyChat 是一个类微信/QQ 的**点对点聊天应用**，前后端分离：

- **后端** `backend/`：Node.js + Express 4 + Mongoose 7 (MongoDB) + ws (原生 WebSocket) + JWT 双 Token
- **前端** `frontend/`：uni-app (Vue 3 `<script setup>` + Pinia + Vite 5 + Sass)，当前仅面向 **H5** 端发布（大量 H5 专属能力：contenteditable 富文本、DOM 滚动、canvas 裁切）
- **运维脚本** `scripts/`：SSH 数据库隧道、部署、回滚、端口清理
- **部署形态**：后端绑定 `127.0.0.1` 由 Nginx 反代对外；前端 H5 构建产物由 Nginx 静态托管；媒体文件存服务器磁盘经 `/media` 提供

## 2. 命令速查

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 一键开发：SSH 隧道 + 后端(nodemon) + 前端(H5) |
| `npm run dev:local` | 本地开发（需本地 MongoDB，不开隧道） |
| `npm run install:all` | 安装前后端依赖 |
| `npm run test:mongo` | 验证 MongoDB 连通性 |
| `npm run build` | 前端 H5 生产构建 |
| `npm run deploy` / `npm run rollback` | 部署 / 回滚（**见第 9 节部署纪律**） |

## 3. 目录结构与命名

```
backend/src/
  app.js               # 入口：CORS 白名单、路由挂载、错误兜底、启动时序
  websocket.js         # WS 网关：鉴权、消息分发、在线状态
  middleware/auth.js   # JWT 认证中间件
  models/              # Mongoose 模型，PascalCase 单数（User.js）
  routes/              # 路由，小写复数（users.js）
  utils/               # jwt.js / response.js
frontend/src/
  pages/<模块>/<页面>.vue   # 页面：chat/list.vue、chat/detail.vue …
  components/<Name>/<Name>.vue  # 组件：PascalCase 目录与文件同名
  store/               # Pinia：index.js 汇总导出 useXxxStore
  utils/               # request.js / socket.js / format.js
```

命名约定：

- 后端变量/函数 camelCase；模型/组件 PascalCase；路由路径全小写。
- 前端组合式 API：页面一律 `<script setup>`；Pinia store id 与文件名一致（`'user'`、`'chat'`、`'contacts'`）。
- 注释、日志、错误文案统一使用**中文**；注释解释“为什么”，不复述代码。

## 4. 接口规范（HTTP）

### 4.1 统一响应格式

所有接口返回 `{ code, msg, data }`，**code 与 HTTP 状态码保持一致**：

- 成功：`ok(res, data, msg, 200)`；创建成功用 `201`
- 失败：`fail(res, code, msg)`，`data` 恒为 `null`
- 401 语义：未提供/无效/过期 token；403：已认证但无权操作；404：资源不存在；400：参数错误

### 4.2 路由清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/register | 注册（密码经 `HC_` 编码传输，见 4.4） |
| POST | /api/auth/login | 登录 |
| POST | /api/auth/refresh | refresh token 换新（滑动续期，同时下发新 refresh） |
| GET/PUT | /api/users/me | 当前用户信息 / 更新昵称头像 |
| PUT | /api/users/me/password | 修改密码（需旧密码） |
| GET | /api/users/search?keyword= | 按用户名/昵称搜索 |
| GET | /api/users/:id | 指定用户信息 |
| POST | /api/friends/request | 发送好友申请 |
| POST | /api/friends/accept | 接受申请 |
| GET | /api/friends/requests | 收到的申请列表 |
| GET | /api/friends | 好友列表 |
| DELETE | /api/friends/:friendId | 删除好友（对方收到 FRIEND_REMOVED 通知） |
| PUT | /api/friends/:friendId/remark | 设置好友备注（仅自己可见，空串清除，≤20 字） |
| GET/PUT | /api/conversations | 会话列表（含 type/pinned/muted；群聊含 name/members；私聊 otherUser 附 remark）/ 创建或获取私聊会话（仅限好友） |
| POST | /api/conversations/group | 创建群聊（成员须为创建者好友，上限 50 人） |
| GET | /api/conversations/:id | 单会话详情（私聊对方信息 / 群聊成员列表） |
| PUT | /api/conversations/:id/name · /:id/members | 群改名 / 邀请成员（仅群主，被邀者为群主好友） |
| PUT | /api/conversations/:id/announcement | 设置群公告（仅群主，≤200 字，空串清除） |
| POST | /api/conversations/:id/quit | 退出群聊（群主不可退） |
| DELETE | /api/conversations/:id/group | 解散群聊（仅群主，删除会话与群消息） |
| PUT | /api/conversations/:id/read | 标记已读 |
| PUT | /api/conversations/:id/pin · /:id/mute | 置顶 / 免打扰开关（仅当前用户视角，布尔体 { pinned } / { muted }） |
| DELETE | /api/conversations/:id | 软隐藏（仅自己列表消失，消息保留） |
| GET | /api/messages/:conversationId | 历史消息分页（page/limit，按时间正序返回） |
| GET | /api/messages/search/global | 跨会话消息搜索（我参与的会话，keyword 模糊匹配，倒序，limit≤50） |
| GET | /api/messages/:conversationId/search | 会话内消息搜索（keyword 模糊匹配 TEXT/RICH 文本，倒序，limit≤50） |
| POST | /api/messages | HTTP 发消息（备用通道，支持 clientId 幂等） |
| PUT | /api/messages/:id/read · /recall | 已读 / 撤回（5 分钟内，HTTP 备用通道） |
| DELETE | /api/messages/conversation/:conversationId | 清空聊天记录（仅自己视角：记录 clearedAt 时间点，拉取时过滤此前消息） |
| DELETE | /api/messages/:id | 删除消息（仅自己视角：加入 hiddenFor，对方不受影响） |
| PUT | /api/messages/:id/reactions | 切换表情回应（参与者均可用，结果实时广播 MESSAGE_REACTION） |
| POST | /api/upload | 上传图片/视频（multipart，字段名 `file`，≤10MB） |
| GET | /api/health · /api/version | 健康检查 / 前端热更新版本号 |

新增接口时：先在本表补一行，再写代码；保持"参数校验 → 权限校验 → 业务 → 响应"的顺序。

### 4.3 参数与输入校验纪律

- 所有 `req.params.id` / `req.body.xxxId` 先经 `isValidObjectId`（mongoose`Types.ObjectId.isValid`）校验，非法直接 404/400，**不得**让 CastError 落到 500。
- 用户输入拼正则必须先转义（`keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`）。
- 消息内容长度上限 10000 字符；`contentBlocks` ≤ 50 块；文本块内容 ≤ 5000 字符。上限在路由/WS 层校验，**不要**加在 Mongoose schema 上（save 会全文校验，可能卡住历史数据的状态更新）。
- 密码类字段只做长度校验（≥6），复杂度规则留在前端引导。

### 4.4 密码传输编码

前端将明文密码编码为 `HC_` + `btoa(密码).split('').reverse().join('')` 后传输；后端逆向解码。
这是**混淆而非加密**，真正的机密性由 HTTPS 保证；前后端必须使用同一约定，改动需双侧同步。

### 4.5 认证与 Token

- 双 Token：access（`JWT_SECRET`，2h）+ refresh（`JWT_REFRESH_SECRET`，30d，滑动续期）。
- `JWT_SECRET` 必须由环境变量提供，**禁止**任何形式的硬编码兜底。
- 前端 `utils/request.js` 统一处理 401：静默刷新 → 重试原请求一次 → 仍失败才跳登录页；`/api/auth/*` 的 401 视为普通业务错误（如密码错误），不触发续期。
- WS 鉴权：连接时 `?token=` 校验一次；收到 close(4001) 先静默续期再重连。

## 5. WebSocket 协议

- 端点 `GET /ws?token=...`；消息帧统一 `{ type, data }` JSON。
- **同一用户允许多端同时在线**（多标签页/多设备），服务端按 `userId -> Set<connection>` 管理；任一连接存活即视为在线，全部断开才广播离线。
- 消息可靠性：客户端生成 `clientId`（幂等键），服务端 `(sender, clientId)` 唯一索引去重；前端对每条待确认消息启动 10s ACK 超时，超时标记失败可手动/自动重发。

| type | 方向 | 说明 |
| --- | --- | --- |
| CONNECTED | S→C | 连接成功 |
| HEARTBEAT | C→S | 应用层心跳（连接层另有 ping/pong） |
| SEND_MESSAGE | C→S | 发消息（含 clientId / replyInfo / contentBlocks） |
| MESSAGE_SENT | S→C | 发送确认（回显落库后的消息） |
| NEW_MESSAGE | S→C | 推送给在线接收方 |
| TYPING | C↔S | 正在输入 |
| READ_MESSAGE / MESSAGE_READ | C→S / S→C | 已读回执；C→S 不带 messageId 时为批量已读，S→C 回执带 readAll 标记 |
| RECALL_MESSAGE / MESSAGE_RECALLED | C→S / S→C | 撤回（5 分钟内；库中保留原文可追溯） |
| ONLINE_STATUS | S→C | 好友上下线广播 |
| FRIEND_REQUEST / FRIEND_ACCEPTED / FRIEND_REMOVED | S→C | 好友关系事件 |
| GROUP_ADDED | S→C | 被邀请入群（客户端强刷会话列表） |
| GROUP_MEMBER_LEFT | S→C | 有成员退群（客户端刷新成员与列表并提示） |
| GROUP_DISBANDED | S→C | 群被解散（客户端本地移除会话，若正在浏览则退出详情页） |
| GROUP_ANNOUNCEMENT | S→C | 群公告更新（浏览中的公告条即时更新，未浏览弹提示） |
| MESSAGE_REACTION | S→C | 消息表情回应变更（按消息 ID 更新本地 reactions） |
| ERROR | S→C | 服务端错误 |

新增消息类型时：服务端 `handleMessage` 分发 + 本表登记 + 前端 `wsClient.on(type)` 注册，三处缺一不可。

## 6. 数据模型要点

- **User**：密码 bcrypt(10)；`toJSON` 恒删 password；`online`/`lastSeen` 由 WS 连接维护；`bio` 个性签名（≤50 字）。
- **Conversation**：`type` ∈ P2P/GROUP；群聊含 `name`（≤30 字）与 `owner`（群主，独享改名/加人/解散权）；私聊 P2P 查询**必须**带 `type: 'P2P'` 过滤（否则 `$all` 会误命中含双方成员的群）；`unreadCounts` 为 `Map<userId, count>`；`hiddenFor` 软删除、`pinnedFor` 置顶、`mutedFor` 免打扰均为当前用户视角；`lastMessageSenderName` 存群聊最后一条消息发送者展示名（列表预览"名字: 内容"用）。
- **Message**：`type` ∈ TEXT/IMAGE/VIDEO/RICH/VOICE；群聊消息 `receiver` 为 null（私聊必填）；VOICE 附 `duration`（秒）；`contentBlocks` 承载富文本；`replyInfo` 存被回复消息**快照**；`(sender, clientId)` 部分唯一索引做幂等。**新增消息类型时必须同步扩展 `Conversation.lastMessageType` 的枚举，否则会话保存将抛 ValidationError**（历史教训）。
- **Friendship**：`(requester, recipient)` 唯一索引，状态机 PENDING → ACCEPTED/REJECTED；`remarks` 为 `Map<设置者userId, 备注文本>`（备注仅设置者可见，≤20 字）。
- **Friendship**：`(requester, recipient)` 唯一索引，状态机 PENDING → ACCEPTED/REJECTED。
- 索引变更属于破坏性操作，需评估现有数据量并在 PR/说明中注明。

## 7. 前端规范

### 7.1 状态管理与数据获取

- Pinia store 是唯一跨页数据源；每个 store 提供 **SWR 式拉取**：`fetchXxx({ force, ttl })` + 模块级 in-flight Promise 去重 + `loading/error` 三态字段。
- 页面派生三态视图统一交由 `StateView` 组件：`loading → error → empty → ready`，有数据（含陈旧）永远优先展示。
- WS 事件处理器在 `onMounted` 注册、`onUnmounted` 注销（tabBar 页面常驻，可不注销）；处理器内部 try/catch，避免拖垮其他订阅者。

### 7.2 请求层

- 一律通过 `utils/request.js` 的 `get/post/put/del/upload`，禁止裸调 `uni.request`（版本检查除外）。
- 后台/轮询/分页请求传 `silent: true`，不弹全局 loading 与错误 toast。
- 媒体地址一律经 `format.js#getMediaUrl` 拼接（本地开发指向 `VITE_MEDIA_BASE_URL` 生产域名）。

### 7.3 UI 设计系统（Warm Mist）

- **设计令牌**只允许来自 `App.vue :root` 的 CSS 变量：主色 `--color-primary #FF6B6B`、辅色 `--color-secondary #A78BFA`、主渐变 `--gradient-primary (135deg, #FF6B6B → #A78BFA)`、背景 `--color-bg #FAF9F7`。
- **单位**：布局用 `rpx`；玻璃拟态卡片统一 `rgba(255,255,255,0.85)` + `backdrop-filter: blur()` + `1rpx solid rgba(255,255,255,0.6)` + `24rpx` 圆角。
- **字体**：正文 28-30rpx，标题 32-40rpx，辅助文字 22-26rpx；字重 500/600/700 三档。
- **动效**：入场 `fadeIn/slideUp`，按压反馈统一 `:active { transform: scale(0.94~0.98) }`，时长 0.15-0.3s。
- **图标**：统一 `uni-icons` 线性风格；头像无图时用 `format.js` 的 6 色渐变板按首字符取色。
- 新页面/新组件**必须**先参考现有页面（尤其 chat/list、profile）再动手；禁止引入设计令牌之外的颜色与阴影。扩展令牌需先改 `App.vue :root` 并全文检索复用。
- 头像类展示统一走 `AppAvatar`；弹窗统一走 `BaseModal`；空/错/载入态统一走 `StateView`；按钮统一走 `GradientButton`；开关统一走 `ToggleSwitch`。不要重复造这些轮子。

### 7.4 平台差异处理

- H5 专属代码必须包在 `// #ifdef H5 ... // #endif` 中（DOM 操作、window、canvas 等）。
- 发布目标当前仅 H5：不要为小程序写通用化代码，但也不要破坏 uni-app 条件编译结构。

## 8. 安全清单（提交前自查）

- [ ] 新增路由已挂到 `app.js` 对应的 `authenticateToken` 之后（auth/health/version 除外）。
- [ ] 所有 ID 参数做过 ObjectId 校验；会话/消息操作校验了参与者身份。
- [ ] 无用户输入直接进 `$regex` / `eval` / `exec` / shell。
- [ ] 上传文件扩展名由服务端 mimetype 白名单映射生成，不信任原始文件名。
- [ ] 错误响应不泄露堆栈（生产环境 `data: null`）。
- [ ] 未引入新的第三方依赖时优先复用现有依赖；确需引入须说明理由。

### 8.1 已知传递依赖漏洞（评估后暂不升级，2026-09 评估）

- **sharp（后端）**：libheif 相关 GHSA-g89c-p67h-r497 / GHSA-2jg2-4ch7-h545（3 high + 3 moderate）。
  修复需升级 sharp@0.35（破坏性变更）。**风险不可达**：上传接口 mimetype 白名单仅放行
  jpeg/png/webp（见 routes/upload.js），sharp 实际只处理这三类输入，攻击者无法投递 HEIF 文件。
  升级时机：需要 HEIF/AVIF 支持或 sharp 官方 backport 时一并处理，升级后必须回归图片缩略图链路。
- **前端 uni-app 工具链**：约 60 项告警集中在 @dcloudio/* 的传递依赖（jimp / ws / uni-mp-vite 等），
  属于构建期与小程序端模块，H5 运行时不包含。框架自身锁版本，升级等价于 uni-app 大版本迁移。
  处理策略：跟随 uni-app 官方版本升级时自然解决，不单独处理。

## 9. 部署纪律（硬性约束）

- **AI 助手与开发者在协作时严禁自动执行** `npm run deploy` / `rollback`、严禁 `git push`、严禁改动远程服务器。
- 完成代码修改后保持工作区现状，由用户自行核对并执行部署。
- 提交信息遵循 Conventional Commits（中文描述可用），如 `fix(backend): ...`、`feat(frontend): ...`、`docs: ...`。
- `.env` 永不入库；新增环境变量必须同步更新 `.env.example` 并附注释。

## 10. 验证要求

改动后最低验证门槛：

1. 后端：`node --check` 通过所有改动的 `.js` 文件；若本地 MongoDB 可用，跑 `npm run test:mongo` 并冒烟启动。
2. 前端：`cd frontend && npm run build:h5` 构建成功，无 Vue 模板/作用域错误。
3. 涉及协议变更（第 4/5 节）时，前后端同步修改并在文档登记。
