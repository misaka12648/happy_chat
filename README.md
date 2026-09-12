# HappyChat 💬

> 与好友分享每一刻 —— 类微信/QQ 的点对点聊天应用

HappyChat 是一个前后端分离的即时通讯 Web 应用：注册登录、搜索/添加好友、实时收发文字 / 图片 / 视频 / 富文本消息、消息撤回与编辑、回复引用、正在输入、已读回执、未读计数、头像裁切上传等，界面采用「Warm Mist」玻璃拟态设计语言。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 后端 | Node.js · Express 4 · MongoDB (Mongoose 7) · ws (WebSocket) · JWT 双 Token · multer + sharp |
| 前端 | uni-app (Vue 3 `<script setup>`) · Pinia · Vite 5 · Sass · uni-ui（发布目标：H5） |
| 运维 | PM2 · Nginx 反向代理 · SSH 隧道（本地开发连远程库） |

## 功能特性

- 🔐 账号体系：注册 / 登录 / 双 Token 静默续期 / 修改密码 / 记住用户名 / 密码强度提示与明文切换
- 👥 好友体系：搜索用户、好友申请与接受（全局横幅提醒）、在线状态实时广播、最后在线时间、删除好友
- 💬 实时聊天：文字、图片/视频（上传进度气泡）、语音（连续播放 / 倒计时 / 进度填充）、富文本（图文混排 + 粘贴图片 + 富文本粘贴纯文本化）、链接识别
- 🛡️ 消息可靠性：clientId 幂等去重、ACK 超时标记失败、断线重连后自动补拉与重发（顶部断线状态条可见）、多端同时在线
- ✨ 消息增强：会话内搜索（Ctrl+F 呼出、关键词高亮、点击定位）、跨会话全局搜索、表情回应（实时同步）、撤回（5 分钟内）与再编辑、复制、多选批量转发/删除、回复引用快照、超长消息折叠、未读红点与 TabBar 徽标、未读预览加粗、"以下为新消息"分隔线、清空聊天记录（仅自己视角）
- 🌈 外观与提醒：深色模式三态（跟随系统/浅色/深色，列表页一键切换）、应用内消息横幅（点击直达会话）、桌面通知（点击跳转会话、群聊带群名）、标签页标题闪动提醒
- 👨‍👩‍👧 群聊：创建/邀请/改名/群公告（实时推送）/解散、群成员 @提及（选择面板 + 消息高亮 + [@我] 红字预览 + 穿透免打扰 + 群信息弹窗点击成员快捷@）、发送者昵称、群信息管理、退群/解散实时通知
- 🎨 体验细节：会话软删除、右键/长按快捷菜单、下拉刷新、会话草稿（列表 [草稿] 红字标识）、表情最近使用、通讯录拼音分组索引、消息缓存秒开（SWR）、头像裁切上传、清理聊天草稿、版本热更新提示

## 项目结构

```
happy_chat/
├── backend/                 # Express + MongoDB + WebSocket 后端
│   └── src/
│       ├── app.js           # 入口：CORS 白名单、路由、错误兜底
│       ├── websocket.js     # WS 网关：鉴权、消息分发、在线状态
│       ├── middleware/      # JWT 认证
│       ├── models/          # User / Conversation / Message / Friendship
│       ├── routes/          # auth / users / friends / conversations / messages / upload
│       └── utils/           # jwt 双 Token、统一响应 { code, msg, data }
├── frontend/                # uni-app H5 前端
│   └── src/
│       ├── pages/           # chat(list/detail) / contacts / profile / login / register
│       ├── components/      # AppAvatar / BaseModal / FormInput / GradientButton / MenuRow / SearchBar / StateView / ToggleSwitch / CallOverlay
│       ├── store/           # Pinia：user / chat / contacts / call（SWR 缓存 + 三态）
│       └── utils/           # request 封装 / socket 客户端 / format 工具 / theme 主题 / notify 提醒体系 / connect-status 连接状态条
├── scripts/                 # db-tunnel / deploy / rollback / kill-port
├── CLAUDE.md                # 项目规范（开发前必读）
└── Agent.md                 # AI 协作常驻规则摘要
```

## 快速开始

### 0. 环境要求

- Node.js ≥ 18
- MongoDB（本地运行，或通过隧道连接远程库）
- 复制环境变量模板并按需修改：

```bash
cp .env.example .env
```

必填项：`JWT_SECRET`（生成方式见模板注释）、`MONGODB_URI`。本地开发前端默认指向 `http://localhost:8080`。

### 1. 安装依赖

```bash
npm run install:all
```

### 2. 启动开发

```bash
# 方式一：本地起后端 + SSH 隧道连远程 MongoDB（默认，需要 .env 中服务器凭据）
npm run dev

# 方式二：本地 MongoDB（MONGODB_URI 指向本机）
npm run dev:local
```

启动后访问前端开发地址（终端会打印，默认 http://localhost:5173）。后端仅绑定 `127.0.0.1`，如需手机真机调试可在 `.env` 设 `HOST=0.0.0.0`。

### 3. 构建

```bash
npm run build        # 前端 H5 生产构建 → frontend/dist
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 隧道 + 后端 + 前端三进程并行 |
| `npm run dev:local` | 不开隧道，本地开发 |
| `npm run test:mongo` | 验证 MongoDB 连通 |
| `node frontend/gen_icons.js` | 重新生成 TabBar 图标 |
| `npm run deploy` | 部署到服务器（**请人工核对后自行执行**） |
| `npm run rollback` | 回滚上一个版本 |

## 部署架构

```
浏览器 ──HTTPS──▶ Nginx
                  ├── /            → frontend/dist 静态资源
                  ├── /api /media  → 127.0.0.1:8080 (Express, PM2 守护)
                  └── /ws          → 127.0.0.1:8080 (WebSocket upgrade)
```

后端默认只绑定 `127.0.0.1`，公网入口统一由 Nginx 管理；CORS 白名单经 `CORS_ORIGINS` 配置。媒体文件保存在服务器 `UPLOAD_DIR`，经 `/media` 静态服务。

## 开发规范

- 项目规范见 [CLAUDE.md](./CLAUDE.md)：接口/WS 协议、命名、UI 设计系统、安全清单、部署纪律。
- AI 协作常驻规则见 [Agent.md](./Agent.md)：UI 风格一致性、禁止自动部署。

## License

[AGPL-3.0](./LICENSE)
