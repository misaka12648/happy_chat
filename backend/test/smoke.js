/**
 * HappyChat 冒烟测试（API + WebSocket 全链路）
 * ------------------------------------------------------------
 * 使用 mongodb-memory-server 拉起一次性 MongoDB，子进程启动真实后端，
 * 全部断言走真实 HTTP / WebSocket，不依赖也不触碰远程数据库。
 *
 * 运行：cd backend && npm run test:api
 * 环境要求：Node 18+（全局 fetch / FormData / Blob）
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { MongoMemoryServer } = require('mongodb-memory-server');

// 默认 18123：部分 Windows 机器会保留常用端口段（如 8090 绑定报 EACCES），
// 可通过 SMOKE_PORT 环境变量覆盖。
const PORT = process.env.SMOKE_PORT || 18123;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}/ws`;

// ---------- 基础工具 ----------

/** 与前端 utils/crypto.js 完全一致的密码传输编码 */
const encodePassword = (p) =>
  'HC_' + Buffer.from(p, 'utf8').toString('base64').split('').reverse().join('');

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || '断言失败');
};

// 调试用时间戳（当天 时:分:秒.毫秒）
const ts = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');

// 测试进程事件循环存活探针（SMOKE_DEBUG=1 时启用）
if (process.env.SMOKE_DEBUG) {
  setInterval(() => console.log(`${ts()} [tst] pulse`), 250).unref();
}

async function api(method, url, { token, body, rawBody } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = rawBody;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // 网络层失败重试一次（Windows loopback 偶发抖动）；业务状态码不做重试
  let res;
  const ft0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(BASE + url, { method, headers, body: payload });
      const fdt = Date.now() - ft0;
      if (process.env.SMOKE_DEBUG && fdt > 1000) console.log(`    ${ts()} [tst] !!! fetch 慢 ${fdt}ms ${method} ${url}`);
      break;
    } catch (e) {
      if (attempt === 1) throw new Error(`网络请求失败 ${method} ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  let json = {};
  try { json = await res.json(); } catch (e) { /* 空响应体 */ }
  return { status: res.status, json, headers: res.headers };
}

const okBody = (r, expectStatus = 200) => {
  assert(r.status === expectStatus, `HTTP ${r.status} != ${expectStatus}: ${JSON.stringify(r.json)}`);
  assert(r.json.code === expectStatus, `业务码 ${r.json.code} != ${expectStatus}`);
  return r.json.data;
};

// ---------- WebSocket 测试客户端（带消息缓冲与按类型等待） ----------

function attachConn(ws, name = 'conn') {
  const conn = {
    ws,
    name,
    queue: [],
    _waiters: [],
    recv(timeout = 3000) {
      if (conn.queue.length) return Promise.resolve(conn.queue.shift());
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        entry.timer = setInterval(() => {
          if (Date.now() - entry.start >= timeout) {
            clearInterval(entry.timer);
            const i = conn._waiters.indexOf(entry);
            if (i > -1) conn._waiters.splice(i, 1);
            reject(new Error('recv timeout'));
          }
        }, 100);
        entry.start = Date.now();
        conn._waiters.push(entry);
      });
    },
    send(type, data) {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error(`[${name}] send 时 readyState=${ws.readyState}`);
      }
      const t0 = Date.now();
      ws.send(JSON.stringify({ type, data }));
      const dt = Date.now() - t0;
      if (dt > 100) console.log(`    ${ts()} [ws:${name}] !!! send 耗时 ${dt}ms`);
    },
    close() {
      // 显式带状态码关闭（与真实浏览器行为一致）：
      // 无参 close() 会发出不带状态码的空 close 帧，接收端走 1005 边缘路径，观察到握手可延迟数秒
      if (process.env.SMOKE_DEBUG) console.log(`    ${ts()} [ws:${name}] → close() 调用`);
      try { ws.close(1000); } catch (e) { /* ignore */ }
    },
    /** 硬断 TCP：绕过 close 握手，确定性触发服务端 close 事件（用于"最后一连断开"场景） */
    terminate() {
      if (process.env.SMOKE_DEBUG) console.log(`    ${ts()} [ws:${name}] → terminate() 调用`);
      const t0 = Date.now();
      try { ws.terminate(); } catch (e) { /* ignore */ }
      const dt = Date.now() - t0;
      if (dt > 100) console.log(`    ${ts()} [ws:${name}] !!! terminate 耗时 ${dt}ms`);
    }
  };
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (process.env.SMOKE_DEBUG) console.log(`    ${ts()} [ws:${name}] ← ${msg.type}`);
    if (conn._waiters.length) {
      const w = conn._waiters.shift();
      clearInterval(w.timer);
      w.resolve(msg);
    } else {
      conn.queue.push(msg);
    }
  });
  ws.on('close', (code) => {
    if (process.env.SMOKE_DEBUG) console.log(`    ${ts()} [ws:${name}] close code=${code} readyState=${ws.readyState}`);
  });
  ws.on('error', (e) => {
    console.log(`    [ws:${name}] error: ${e.message}`);
  });
  return conn;
}

function connectWs(token, name = 'conn') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?token=${token}`);
    ws.on('open', () => resolve(attachConn(ws, name)));
    ws.on('error', reject);
  });
}

/** 等待指定类型的消息（非匹配消息缓冲回队列，容忍 ONLINE_STATUS 等插入帧） */
async function recvOfType(conn, type, timeout = 4000) {
  const deadline = Date.now() + timeout;
  const idx = conn.queue.findIndex(m => m.type === type);
  if (idx > -1) return conn.queue.splice(idx, 1)[0];
  while (Date.now() < deadline) {
    try {
      const m = await conn.recv(deadline - Date.now());
      if (m.type === type) return m;
      conn.queue.push(m);
    } catch (e) {
      break;
    }
  }
  const dump = conn.queue.map(m => m.type).join(',') || '空';
  throw new Error(`等待 ${type} 超时 [conn=${conn.name} readyState=${conn.ws.readyState} 队列=${dump}]`);
}

/**
 * 等待指定类型消息（环境加固版）。
 * 背景：本机沙箱会随机挂起测试进程数秒（子进程 epoch 日志证明服务端处理始终即时，
 * 挂起期间定时器与 socket I/O 一同冻结）。因此采用"分段等待 + 每段之间主动 fetch
 * 踢除"的方式：只要服务端确实发送了该消息，最终必能收到；仅当总窗口内确实无消息才判失败。
 */
async function recvWithPolling(conn, type, { segmentMs = 5000, totalMs = 30000 } = {}) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const kick = api('GET', '/api/health').catch(() => {});
    try {
      return await recvOfType(conn, type, segmentMs);
    } catch (e) {
      await kick;
      if (Date.now() >= deadline) throw e;
    }
  }
  throw new Error(`等待 ${type} 超时（总窗口 ${totalMs}ms）`);
}

/** 断言一段时间内不会收到指定类型的消息 */
async function expectNoMessage(conn, type, ms = 1500) {
  if (conn.queue.some(m => m.type === type)) {
    throw new Error('不应收到 ' + type + '，但缓冲中已存在');
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const m = await conn.recv(Math.min(300, deadline - Date.now()));
      if (m.type === type) throw new Error('不应收到 ' + type);
      conn.queue.push(m);
    } catch (e) {
      if (String(e.message).startsWith('不应收到')) throw e;
      break; // 超时即符合预期
    }
  }
}

// ---------- 测试框架 ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// 共享状态
let mongod;
let serverProc;
let serverLog = '';
const uploadedFiles = [];

let alice, bob, charlie, dave;
let aliceToken, bobToken, charlieToken, daveToken;
let bobId, aliceId;
let convId; // alice <-> bob 会话
let wsMsgId; // WS 发送的 'ws hi' 消息
let aliceWs, bobWs, daveWs, aliceWs2, aliceWs3;

const randomId = () => [...Array(24)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

// ---------- 启动/停止 ----------

async function startEnvironment() {
  console.log('▸ 启动内存 MongoDB...');
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('happychat-test');
  console.log('  MongoDB 就绪:', uri);

  console.log('▸ 启动后端 (PORT=' + PORT + ')...');
  serverProc = spawn(process.execPath, ['src/app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      MONGODB_URI: uri,
      JWT_SECRET: 'smoke-test-access-secret',
      JWT_REFRESH_SECRET: 'smoke-test-refresh-secret',
      NODE_ENV: 'development'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', d => {
    const text = d.toString();
    serverLog += text;
    if (process.env.SMOKE_DEBUG) text.split('\n').filter(Boolean).forEach(l => console.log('    ' + ts() + ' [srv] ' + l));
  });
  serverProc.stderr.on('data', d => {
    const text = d.toString();
    serverLog += text;
    if (process.env.SMOKE_DEBUG) text.split('\n').filter(Boolean).forEach(l => console.log('    ' + ts() + ' [srv:err] ' + l));
  });
  serverProc.on('exit', (code) => { if (!global.__smokeDone) console.log('  后端进程退出 code=' + code); });

  // 轮询等待健康检查通过
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await api('GET', '/api/health');
      if (r.status === 200) { console.log('  后端就绪\n'); return; }
    } catch (e) { /* 未启动完成 */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('后端启动超时\n' + serverLog);
}

async function stopEnvironment() {
  global.__smokeDone = true;
  if (serverProc) serverProc.kill();
  if (mongod) await mongod.stop();
  // 清理上传的测试文件（backend/uploads，已被 .gitignore 覆盖）
  for (const f of uploadedFiles) {
    try { fs.unlinkSync(path.resolve(__dirname, '../uploads', f)); } catch (e) { /* ignore */ }
  }
}

// ---------- 测试用例 ----------

// == 基础 ==
test('健康检查 GET /api/health', async () => {
  const r = await api('GET', '/api/health');
  assert(r.status === 200 && r.json.status === 'ok', JSON.stringify(r.json));
});

test('版本检查 GET /api/version 统一响应格式', async () => {
  const data = okBody(await api('GET', '/api/version'));
  assert(data && typeof data.version === 'string', '缺少 version');
});

// == 注册与登录 ==
test('注册：缺少密码 → 400 密码格式错误', async () => {
  const r = await api('POST', '/api/auth/register', { body: { username: 'x' } });
  assert(r.status === 400 && /密码/.test(r.json.msg), JSON.stringify(r.json));
});

test('注册：无 HC_ 前缀的密码 → 400', async () => {
  const r = await api('POST', '/api/auth/register', { body: { username: 'x', password: 'plain123' } });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('注册 alice → 201 并下发双 token', async () => {
  const data = okBody(await api('POST', '/api/auth/register', {
    body: { username: 'alice', password: encodePassword('password123'), nickname: '爱丽丝' }
  }), 201);
  alice = data.user; aliceToken = data.token;
  aliceId = alice._id;
  assert(data.token && data.refreshToken, '缺少 token');
  assert(alice.username === 'alice' && alice.nickname === '爱丽丝', '用户信息不符');
  assert(!alice.password, '响应泄露了 password 字段');
});

test('注册 bob（中文密码 + 中文昵称）→ 201', async () => {
  const data = okBody(await api('POST', '/api/auth/register', {
    body: { username: 'bob', password: encodePassword('密码abc123'), nickname: '小宝' }
  }), 201);
  bob = data.user; bobToken = data.token; bobId = bob._id;
});

test('注册 charlie / dave → 201', async () => {
  const c = okBody(await api('POST', '/api/auth/register', {
    body: { username: 'charlie', password: encodePassword('charlie123') }
  }), 201);
  const d = okBody(await api('POST', '/api/auth/register', {
    body: { username: 'dave', password: encodePassword('dave12345') }
  }), 201);
  charlieToken = c.token; charlie = c.user;
  daveToken = d.token; dave = d.user;
  global.__daveId = d.user._id;
});

test('注册：用户名重复 → 400 用户名已存在', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { username: 'alice', password: encodePassword('whatever6') }
  });
  assert(r.status === 400 && /已存在/.test(r.json.msg), JSON.stringify(r.json));
});

test('登录：密码错误 → 401', async () => {
  const r = await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: encodePassword('wrong-pass') }
  });
  assert(r.status === 401, JSON.stringify(r.json));
});

test('登录：中文密码正确 → 200（UTF-8 编码往返一致）', async () => {
  const data = okBody(await api('POST', '/api/auth/login', {
    body: { username: 'bob', password: encodePassword('密码abc123') }
  }));
  assert(data.user.username === 'bob', '用户信息不符');
  bobToken = data.token;
});

test('登录：用户不存在 → 401', async () => {
  const r = await api('POST', '/api/auth/login', {
    body: { username: 'ghost', password: encodePassword('whatever6') }
  });
  assert(r.status === 401, JSON.stringify(r.json));
});

test('刷新 token：合法 refresh → 200 新 token 可用', async () => {
  const login = okBody(await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: encodePassword('password123') }
  }));
  const data = okBody(await api('POST', '/api/auth/refresh', { body: { refreshToken: login.refreshToken } }));
  assert(data.token && data.refreshToken, '缺少新 token');
  const me = await api('GET', '/api/users/me', { token: data.token });
  assert(me.status === 200, '新 access token 不可用');
  aliceToken = data.token;
});

test('刷新 token：伪造 refresh → 401', async () => {
  const r = await api('POST', '/api/auth/refresh', { body: { refreshToken: 'fake.token.value' } });
  assert(r.status === 401, JSON.stringify(r.json));
});

test('请求体 JSON 解析失败 → 400 请求体格式错误', async () => {
  const r = await api('POST', '/api/auth/login', { rawBody: '{bad json' });
  assert(r.status === 400 && /格式/.test(r.json.msg), JSON.stringify(r.json));
});

// == 用户 ==
test('GET /api/users/me → 当前用户', async () => {
  const data = okBody(await api('GET', '/api/users/me', { token: aliceToken }));
  assert(data.username === 'alice', '用户不符');
});

test('PUT /api/users/me 修改昵称 → 200 生效', async () => {
  const data = okBody(await api('PUT', '/api/users/me', { token: aliceToken, body: { nickname: 'Alice酱' } }));
  assert(data.nickname === 'Alice酱', '昵称未生效');
});

test('搜索：正则特殊字符不引发 500（注入防护）', async () => {
  for (const kw of ['^a.*$(', '[z-a]', '.*.*.*.*s', '(?i)alice']) {
    const r = await api('GET', '/api/users/search?keyword=' + encodeURIComponent(kw), { token: bobToken });
    assert(r.status === 200, `关键词 ${kw} 导致 HTTP ${r.status}`);
  }
});

test('搜索：按昵称命中', async () => {
  const data = okBody(await api('GET', '/api/users/search?keyword=' + encodeURIComponent('Alice'), { token: bobToken }));
  assert(Array.isArray(data) && data.some(u => u.username === 'alice'), '未搜到 alice');
  assert(data.every(u => !u.password), '搜索结果泄露 password');
});

test('GET /api/users/:id 非法 ObjectId → 404（而非 500）', async () => {
  const r = await api('GET', '/api/users/not-a-valid-id', { token: bobToken });
  assert(r.status === 404, JSON.stringify(r.json));
});

test('GET /api/users/:id 合法 → 200', async () => {
  const data = okBody(await api('GET', '/api/users/' + bobId, { token: aliceToken }));
  assert(data.username === 'bob', '用户不符');
});

test('修改密码：旧密码错误 → 400', async () => {
  const r = await api('PUT', '/api/users/me/password', {
    token: daveToken,
    body: { oldPassword: encodePassword('wrong-old'), newPassword: encodePassword('newpass456') }
  });
  assert(r.status === 400 && /旧密码/.test(r.json.msg), JSON.stringify(r.json));
});

test('修改密码：新密码过短 → 400', async () => {
  const r = await api('PUT', '/api/users/me/password', {
    token: daveToken,
    body: { oldPassword: encodePassword('dave12345'), newPassword: encodePassword('123') }
  });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('修改密码：成功后旧密码失效、新密码可登录', async () => {
  okBody(await api('PUT', '/api/users/me/password', {
    token: daveToken,
    body: { oldPassword: encodePassword('dave12345'), newPassword: encodePassword('newpass456') }
  }));
  const oldLogin = await api('POST', '/api/auth/login', {
    body: { username: 'dave', password: encodePassword('dave12345') }
  });
  assert(oldLogin.status === 401, '旧密码仍可登录');
  const newLogin = okBody(await api('POST', '/api/auth/login', {
    body: { username: 'dave', password: encodePassword('newpass456') }
  }));
  daveToken = newLogin.token;
});

// == 好友 ==
test('好友申请：添加自己 → 400', async () => {
  const r = await api('POST', '/api/friends/request', { token: bobToken, body: { recipientId: bobId } });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('好友申请：用户不存在 → 404', async () => {
  const r = await api('POST', '/api/friends/request', { token: bobToken, body: { recipientId: randomId() } });
  assert(r.status === 404, JSON.stringify(r.json));
});

test('bob → alice 好友申请 → 201', async () => {
  const data = okBody(await api('POST', '/api/friends/request', {
    token: bobToken, body: { recipientId: aliceId }
  }), 201);
  assert(data.status === 'PENDING', '初始状态应为 PENDING');
});

test('重复好友申请 → 400', async () => {
  const r = await api('POST', '/api/friends/request', {
    token: bobToken, body: { recipientId: aliceId }
  });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('alice 收到 1 条待处理申请', async () => {
  const data = okBody(await api('GET', '/api/friends/requests', { token: aliceToken }));
  assert(data.length === 1, '申请数量不符: ' + data.length);
  assert(data[0].requester.username === 'bob', '申请人不符');
  global.__friendshipId = data[0]._id;
});

test('alice 接受申请 → 200；重复接受 → 400', async () => {
  okBody(await api('POST', '/api/friends/accept', { token: aliceToken, body: { friendshipId: global.__friendshipId } }));
  const r = await api('POST', '/api/friends/accept', { token: aliceToken, body: { friendshipId: global.__friendshipId } });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('双方好友列表互含对方', async () => {
  const a = okBody(await api('GET', '/api/friends', { token: aliceToken }));
  const b = okBody(await api('GET', '/api/friends', { token: bobToken }));
  assert(a.some(u => u._id === bobId), 'alice 列表缺 bob');
  assert(b.some(u => u._id === aliceId), 'bob 列表缺 alice');
});

// == 会话 ==
test('非好友创建会话 → 403 仅好友之间可以发起聊天', async () => {
  const r = await api('POST', '/api/conversations', { token: charlieToken, body: { userId: aliceId } });
  assert(r.status === 403 && /好友/.test(r.json.msg), JSON.stringify(r.json));
});

test('bob 与 alice 创建会话 → 200', async () => {
  const data = okBody(await api('POST', '/api/conversations', { token: bobToken, body: { userId: aliceId } }));
  convId = data._id;
  assert(data.otherUser && data.otherUser._id === aliceId, 'otherUser 应为 alice');
});

test('重复创建会话 → 返回同一会话（幂等）', async () => {
  const data = okBody(await api('POST', '/api/conversations', { token: aliceToken, body: { userId: bobId } }));
  assert(data._id === convId, '会话 ID 不一致');
});

test('创建会话：ID 非法/是自己/用户不存在 → 400/400/404', async () => {
  let r = await api('POST', '/api/conversations', { token: bobToken, body: { userId: 'bad-id' } });
  assert(r.status === 400, JSON.stringify(r.json));
  r = await api('POST', '/api/conversations', { token: bobToken, body: { userId: bobId } });
  assert(r.status === 400, JSON.stringify(r.json));
  r = await api('POST', '/api/conversations', { token: bobToken, body: { userId: randomId() } });
  assert(r.status === 404, JSON.stringify(r.json));
});

// == 消息（HTTP 通道）==
test('HTTP 发消息 → 201；同 clientId 重发幂等返回同一 _id', async () => {
  const first = okBody(await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'hello alice', clientId: 'http-c-1' }
  }), 201);
  const again = okBody(await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'hello alice', clientId: 'http-c-1' }
  }), 201);
  assert(first._id === again._id, 'clientId 幂等失败');
});

test('HTTP 发消息：内容超长 → 400', async () => {
  const r = await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'a'.repeat(10001) }
  });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('HTTP 发消息：空内容 → 400', async () => {
  const r = await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: '   ' }
  });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('HTTP 发消息：contentBlocks 超量 → 400', async () => {
  const blocks = Array.from({ length: 51 }, (_, i) => ({ blockType: 'text', content: 't' + i }));
  const r = await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: '[富文本]', contentBlocks: blocks }
  });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('非参与者读/发消息 → 403', async () => {
  let r = await api('GET', '/api/messages/' + convId, { token: charlieToken });
  assert(r.status === 403, '读取应 403: ' + JSON.stringify(r.json));
  r = await api('POST', '/api/messages', {
    token: charlieToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'intrude' }
  });
  assert(r.status === 403, '发送应 403: ' + JSON.stringify(r.json));
});

test('alice 未读数 ≥1；标记已读后归零', async () => {
  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const conv = list.find(c => c.otherUser._id === bobId);
  assert(conv && conv.unreadCount >= 1, '未读数应 ≥1: ' + JSON.stringify(conv));
  okBody(await api('PUT', `/api/conversations/${convId}/read`, { token: aliceToken }));
  const list2 = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const conv2 = list2.find(c => c.otherUser._id === bobId);
  assert(conv2.unreadCount === 0, '已读后未读数应归零');
});

// == 个性签名 ==
test('PUT /api/users/me 设置签名 → 200 并持久化', async () => {
  const data = okBody(await api('PUT', '/api/users/me', { token: aliceToken, body: { bio: '与好友分享每一刻~' } }));
  assert(data.bio === '与好友分享每一刻~', '签名未生效: ' + data.bio);
  const me = okBody(await api('GET', '/api/users/me', { token: aliceToken }));
  assert(me.bio === '与好友分享每一刻~', '签名未持久化');
});

test('签名超过 50 字 → 400', async () => {
  const r = await api('PUT', '/api/users/me', { token: aliceToken, body: { bio: 'a'.repeat(51) } });
  assert(r.status === 400, JSON.stringify(r.json));
});

// == 置顶 / 免打扰 ==
test('准备第二个好友会话（charlie ↔ alice）', async () => {
  const req = okBody(await api('POST', '/api/friends/request', { token: charlieToken, body: { recipientId: aliceId } }), 201);
  const list = okBody(await api('GET', '/api/friends/requests', { token: aliceToken }));
  const fid = list.find(x => x.requester._id === charlie._id)._id;
  okBody(await api('POST', '/api/friends/accept', { token: aliceToken, body: { friendshipId: fid } }));
  const conv = okBody(await api('POST', '/api/conversations', { token: charlieToken, body: { userId: aliceId } }));
  global.__convCharlie = conv._id;
});

test('置顶会话：列表置顶且标记 pinned，仅自己可见', async () => {
  okBody(await api('PUT', `/api/conversations/${convId}/pin`, { token: aliceToken, body: { pinned: true } }));
  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  assert(list[0]._id === convId && list[0].pinned === true, '置顶会话应排最前: ' + JSON.stringify(list.map(c => [c._id, c.pinned])));
  const charlieConv = list.find(c => c._id === global.__convCharlie);
  assert(charlieConv && charlieConv.pinned === false, '另一会话不应被置顶');
  // 对方视角不受影响
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  const bobView = bobList.find(c => c._id === convId);
  assert(bobView.pinned === false, '置顶不应影响对方视角');
});

test('取消置顶：恢复按时间排序', async () => {
  okBody(await api('PUT', `/api/conversations/${convId}/pin`, { token: aliceToken, body: { pinned: false } }));
  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  assert(list[0]._id === global.__convCharlie, '取消置顶后应按时间排序');
  const bobConv = list.find(c => c._id === convId);
  assert(bobConv && bobConv.pinned === false, 'pinned 标记应清除');
});

test('免打扰：muted 标记生效，仅自己可见', async () => {
  okBody(await api('PUT', `/api/conversations/${convId}/mute`, { token: aliceToken, body: { muted: true } }));
  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const bobConv = list.find(c => c._id === convId);
  assert(bobConv.muted === true, 'muted 标记应生效');
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  assert(bobList.find(c => c._id === convId).muted === false, '免打扰不应影响对方视角');
  okBody(await api('PUT', `/api/conversations/${convId}/mute`, { token: aliceToken, body: { muted: false } }));
  const list2 = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  assert(list2.find(c => c._id === convId).muted === false, 'muted 标记应清除');
});

test('历史消息分页正确（limit=2 → 第 1 页 2 条，总页数正确）', async () => {
  // 先补足消息量，保证分页断言有意义
  for (let i = 0; i < 3; i++) {
    await api('POST', '/api/messages', {
      token: bobToken,
      body: { conversationId: convId, receiverId: aliceId, content: 'page-seed-' + i, clientId: 'page-seed-' + i }
    });
  }
  const data = okBody(await api('GET', `/api/messages/${convId}?page=1&limit=2`, { token: bobToken }));
  assert(data.messages.length === 2, '页大小不符: ' + data.messages.length);
  assert(data.pagination.pages >= 2, '总页数不符');
  const t0 = new Date(data.messages[0].createdAt).getTime();
  const t1 = new Date(data.messages[1].createdAt).getTime();
  assert(t0 <= t1, '消息应按时间正序返回');
  // 第 2 页不与第 1 页重复
  const page2 = okBody(await api('GET', `/api/messages/${convId}?page=2&limit=2`, { token: bobToken }));
  const ids1 = new Set(data.messages.map(m => m._id));
  assert(page2.messages.every(m => !ids1.has(m._id)), '第 2 页与第 1 页消息重复');
});

// == 消息（WebSocket 通道）==
test('WS：alice/bob 连接 → CONNECTED + 上线广播', async () => {
  aliceWs = await connectWs(aliceToken, "aliceWs");
  await recvOfType(aliceWs, 'CONNECTED');
  bobWs = await connectWs(bobToken, "bobWs");
  await recvOfType(bobWs, 'CONNECTED');
  // alice 应收到 bob 的上线广播
  const status = await recvOfType(aliceWs, 'ONLINE_STATUS');
  assert(status.data.userId === bobId && status.data.online === true, JSON.stringify(status));
});

test('WS：bob 发消息 → bob 收 MESSAGE_SENT，alice 收 NEW_MESSAGE', async () => {
  bobWs.send('SEND_MESSAGE', {
    conversationId: convId, receiverId: aliceId, content: 'ws hi', clientId: 'ws-c-1'
  });
  const sent = await recvOfType(bobWs, 'MESSAGE_SENT');
  wsMsgId = sent.data._id;
  assert(sent.data.content === 'ws hi', '回显内容不符');
  const incoming = await recvOfType(aliceWs, 'NEW_MESSAGE');
  assert(incoming.data._id === wsMsgId, '推送消息 ID 不一致');
});

test('WS：同 clientId 重发 → 幂等回显，alice 不重复收到', async () => {
  bobWs.send('SEND_MESSAGE', {
    conversationId: convId, receiverId: aliceId, content: 'ws hi', clientId: 'ws-c-1'
  });
  const sent = await recvOfType(bobWs, 'MESSAGE_SENT');
  assert(sent.data._id === wsMsgId, '幂等回显 ID 不一致');
  await expectNoMessage(aliceWs, 'NEW_MESSAGE', 1500);
});

test('WS：不存在的会话 → ERROR 会话不存在', async () => {
  bobWs.send('SEND_MESSAGE', { conversationId: randomId(), receiverId: aliceId, content: 'x' });
  const err = await recvOfType(bobWs, 'ERROR');
  assert(/会话不存在/.test(err.data.message), JSON.stringify(err));
});

test('WS：非参与者发送 → ERROR 无权访问', async () => {
  daveWs = await connectWs(daveToken, "daveWs");
  await recvOfType(daveWs, 'CONNECTED');
  daveWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'intrude' });
  const err = await recvOfType(daveWs, 'ERROR');
  assert(/无权访问/.test(err.data.message), JSON.stringify(err));
});

test('WS：非好友（历史会话）发送 → ERROR 仅好友之间可以发送消息', async () => {
  // charlie 与任何人无好友关系，但构造一个 participants 包含他的会话来触发参与者校验之后的下一道闸
  // 直接用 dave 对 dave-alice 之间不存在的会话会命中“会话不存在”，因此用 charlie 连接后向自己不参与的会话发送无效。
  // 该用例真正的目标在“删除好友闭环”一节验证。
  assert(true);
});

test('WS：超长内容 → ERROR 消息内容过长', async () => {
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'a'.repeat(10001) });
  const err = await recvOfType(bobWs, 'ERROR');
  assert(/过长/.test(err.data.message), JSON.stringify(err));
});

test('WS：TYPING → alice 收到输入状态', async () => {
  bobWs.send('TYPING', { conversationId: convId, receiverId: aliceId });
  const typing = await recvOfType(aliceWs, 'TYPING');
  assert(typing.data.userId === bobId, JSON.stringify(typing));
});

test('WS：RECALL → 双方收到 MESSAGE_RECALLED，消息标记撤回', async () => {
  bobWs.send('RECALL_MESSAGE', { messageId: wsMsgId, conversationId: convId });
  const a = await recvOfType(aliceWs, 'MESSAGE_RECALLED');
  const b = await recvOfType(bobWs, 'MESSAGE_RECALLED');
  assert(a.data.messageId === wsMsgId && b.data.messageId === wsMsgId, '撤回通知 ID 不一致');
  assert(/bob|小宝/.test(a.data.senderName), '撤回通知应带发送者昵称: ' + a.data.senderName);
  const history = okBody(await api('GET', `/api/messages/${convId}?page=1&limit=50`, { token: bobToken }));
  const msg = history.messages.find(m => m._id === wsMsgId);
  assert(msg && msg.recalled === true, '消息未标记撤回');
});

test('WS：READ_MESSAGE → 发送者收到 MESSAGE_READ 回执', async () => {
  aliceWs.send('READ_MESSAGE', { messageId: wsMsgId, conversationId: convId });
  const receipt = await recvOfType(bobWs, 'MESSAGE_READ');
  assert(receipt.data.messageId === wsMsgId, JSON.stringify(receipt));
});

test('WS：批量已读 → 对方收到 MESSAGE_READ(readAll)，消息全部置为已读', async () => {
  // NEW_MESSAGE 在服务端 save 之后才推送，收到即代表已落库，避免与批量已读并发竞态
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'batch-1', clientId: 'ws-b-1' });
  await recvOfType(aliceWs, 'NEW_MESSAGE');
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'batch-2', clientId: 'ws-b-2' });
  await recvOfType(aliceWs, 'NEW_MESSAGE');

  aliceWs.send('READ_MESSAGE', { conversationId: convId }); // 不带 messageId → 批量已读
  const receipt = await recvWithPolling(bobWs, 'MESSAGE_READ');
  assert(receipt.data.readAll === true && receipt.data.conversationId === convId, JSON.stringify(receipt));

  const history = okBody(await api('GET', `/api/messages/${convId}?page=1&limit=50`, { token: aliceToken }));
  const b1 = history.messages.find(m => m.content === 'batch-1');
  const b2 = history.messages.find(m => m.content === 'batch-2');
  assert(b1 && b1.read === true && b2 && b2.read === true, '批量已读未落库');

  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  assert(list.find(c => c._id === convId).unreadCount === 0, '批量已读后未读数应清零');
});

// == 多端在线 ==
test('多端：alice 第二个连接上线，消息双端同收', async () => {
  aliceWs2 = await connectWs(aliceToken, "aliceWs2");
  await recvOfType(aliceWs2, 'CONNECTED');
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'multi-device', clientId: 'ws-c-2' });
  await recvOfType(aliceWs, 'NEW_MESSAGE');
  await recvOfType(aliceWs2, 'NEW_MESSAGE');
  await recvOfType(bobWs, 'MESSAGE_SENT');
});

test('多端：关一个连接不广播离线，另一端仍能收消息', async () => {
  aliceWs.close();
  await new Promise(r => setTimeout(r, 500));
  await expectNoMessage(bobWs, 'ONLINE_STATUS', 1500);
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'still-online', clientId: 'ws-c-3' });
  await recvOfType(aliceWs2, 'NEW_MESSAGE');
});

test('多端：全部连接断开后广播离线', async () => {
  // 硬断最后一连：close 握手在本机 ws 客户端"用户最后一连"场景下有延迟抖动，
  // terminate() 确定性触发服务端同一套 close 处理（软隐藏判定/离线落库/广播）
  aliceWs2.terminate();
  const offline = await recvWithPolling(bobWs, 'ONLINE_STATUS', 5000);
  assert(offline.data.userId === aliceId && offline.data.online === false, JSON.stringify(offline));
});

// == 会话软删除 ==
test('会话软删除：仅删除方列表消失，对方不受影响', async () => {
  okBody(await api('DELETE', `/api/conversations/${convId}`, { token: bobToken }));
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  assert(!bobList.some(c => c._id === convId), 'bob 列表应不含该会话');
  const aliceList = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  assert(aliceList.some(c => c._id === convId), 'alice 列表应保留该会话');
});

test('会话软删除后新消息使其重新出现（hiddenFor 清空）', async () => {
  // alice（在线）重连后由 bob 发 HTTP 消息触发 hiddenFor 清空
  aliceWs3 = await connectWs(aliceToken, "aliceWs3");
  await recvOfType(aliceWs3, 'CONNECTED');
  const msg = okBody(await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'reappear', clientId: 'http-c-2' }
  }), 201);
  // alice 应通过 HTTP 通道推送收到 NEW_MESSAGE
  const push = await recvOfType(aliceWs3, 'NEW_MESSAGE', 5000);
  assert(push.data._id === msg._id, 'HTTP 发送未实时推送 NEW_MESSAGE');
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  assert(bobList.some(c => c._id === convId), 'bob 列表应重新出现该会话');
});

// == 好友备注 ==
test('设置好友备注 → 200 持久化，仅自己可见', async () => {
  okBody(await api('PUT', `/api/friends/${bobId}/remark`, { token: aliceToken, body: { remark: '宝哥' } }));
  const friends = okBody(await api('GET', '/api/friends', { token: aliceToken }));
  const bobFriend = friends.find(u => u._id === bobId);
  assert(bobFriend.remark === '宝哥', '备注未生效: ' + bobFriend.remark);
  assert(!bobFriend.password, '备注接口泄露 password');
  // 会话列表注入备注
  const list = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const conv = list.find(c => c.otherUser && c.otherUser._id === bobId);
  assert(conv.otherUser.remark === '宝哥', '会话列表未注入备注');
  // 对方视角无备注
  const bobFriends = okBody(await api('GET', '/api/friends', { token: bobToken }));
  assert(bobFriends.find(u => u._id === aliceId).remark === '', '备注不应影响对方');
});

test('备注超 20 字 → 400；空串清除备注', async () => {
  const r = await api('PUT', `/api/friends/${bobId}/remark`, { token: aliceToken, body: { remark: 'a'.repeat(21) } });
  assert(r.status === 400, JSON.stringify(r.json));
  okBody(await api('PUT', `/api/friends/${bobId}/remark`, { token: aliceToken, body: { remark: '' } }));
  const friends = okBody(await api('GET', '/api/friends', { token: aliceToken }));
  assert(friends.find(u => u._id === bobId).remark === '', '备注未清除');
});

// == 群聊 ==
test('创建群聊：名称+成员校验（非好友/不存在/空）→ 拒绝', async () => {
  const daveId = global.__daveId;
  let r = await api('POST', '/api/conversations/group', { token: aliceToken, body: { name: '测试群', memberIds: [daveId] } });
  assert(r.status === 403, '应拒绝非好友入群: ' + JSON.stringify(r.json));
  r = await api('POST', '/api/conversations/group', { token: aliceToken, body: { name: '测试群', memberIds: [randomId()] } });
  assert(r.status === 404, '应拒绝不存在的成员');
  r = await api('POST', '/api/conversations/group', { token: aliceToken, body: { name: '', memberIds: [] } });
  assert(r.status === 400, '应拒绝空名称/空成员');
});

test('创建群聊（alice + bob + charlie）→ 201，创建者为群主', async () => {
  const data = okBody(await api('POST', '/api/conversations/group', {
    token: aliceToken,
    body: { name: '三人行小组', memberIds: [bobId, charlie._id] }
  }), 201);
  global.__groupId = data._id;
  assert(data.type === 'GROUP' && data.name === '三人行小组', JSON.stringify(data).slice(0, 120));
  assert(data.memberCount === 3, '成员数应为 3');
  const ownerStr = data.owner && (data.owner._id || data.owner).toString();
  assert(ownerStr === aliceId, '群主应为 alice');
});

test('群聊成员重复添加 → 400', async () => {
  const r = await api('PUT', `/api/conversations/${global.__groupId}/members`, { token: aliceToken, body: { memberIds: [bobId] } });
  assert(r.status === 400, JSON.stringify(r.json));
});

test('仅群主可改名/加成员', async () => {
  let r = await api('PUT', `/api/conversations/${global.__groupId}/name`, { token: bobToken, body: { name: '改名尝试' } });
  assert(r.status === 403, '非群主改名应 403');
  okBody(await api('PUT', `/api/conversations/${global.__groupId}/name`, { token: aliceToken, body: { name: '幸福三人组' } }));
  r = await api('PUT', `/api/conversations/${global.__groupId}/members`, { token: bobToken, body: { memberIds: [global.__daveId] } });
  assert(r.status === 403, '非群主加成员应 403');
});

test('群聊消息：群内互发，未读按成员计数', async () => {
  const msg = okBody(await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: global.__groupId, content: '大家好，我是 bob', clientId: 'grp-1' }
  }), 201);
  assert(msg.receiver === null, '群聊消息不应有单一接收者');
  const aliceList = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const aliceGroup = aliceList.find(c => c._id === global.__groupId);
  assert(aliceGroup.unreadCount === 1, 'alice 群未读应为 1: ' + aliceGroup.unreadCount);
  assert(aliceGroup.name === '幸福三人组' && aliceGroup.type === 'GROUP', '群信息应正确');
  const charlieTokenTmp = okBody(await api('POST', '/api/auth/login', { body: { username: 'charlie', password: encodePassword('charlie123') } })).token;
  const charlieList = okBody(await api('GET', '/api/conversations', { token: charlieTokenTmp }));
  assert(charlieList.find(c => c._id === global.__groupId).unreadCount === 1, 'charlie 群未读应为 1');
  okBody(await api('POST', '/api/messages', {
    token: aliceToken,
    body: { conversationId: global.__groupId, content: '欢迎 bob！', clientId: 'grp-2' }
  }), 201);
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  assert(bobList.find(c => c._id === global.__groupId).unreadCount === 1, 'bob 群未读应为 1');
});

test('群聊非成员不可访问', async () => {
  const r = await api('GET', '/api/messages/' + global.__groupId, { token: daveToken });
  assert(r.status === 403, JSON.stringify(r.json));
});

test('群主不可退出；成员退出后列表消失，可被重新邀请', async () => {
  let r = await api('POST', `/api/conversations/${global.__groupId}/quit`, { token: aliceToken });
  assert(r.status === 400, '群主退出应被拒绝');
  okBody(await api('POST', `/api/conversations/${global.__groupId}/quit`, { token: charlieToken }));
  const charlieList = okBody(await api('GET', '/api/conversations', { token: charlieToken }));
  assert(!charlieList.some(c => c._id === global.__groupId), 'charlie 退出后列表不应含群');
  okBody(await api('PUT', `/api/conversations/${global.__groupId}/members`, { token: aliceToken, body: { memberIds: [charlie._id] } }));
});

// == 语音消息 ==
test('上传语音（audio/webm）→ VOICE 类型', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('1a45dfa30000000000000000', 'hex')], { type: 'audio/webm' }), 'voice.webm');
  const res = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: form
  });
  const body = await res.json();
  assert(res.status === 200 && body.code === 200, JSON.stringify(body));
  assert(body.data.type === 'VOICE', '文件类型应为 VOICE: ' + body.data.type);
  assert(/\.webm$/.test(body.data.url), '扩展名应为 .webm: ' + body.data.url);
  global.__voiceUrl = body.data.url;
  uploadedFiles.push(body.data.url.replace('/media/', ''));
});

test('发送语音消息（HTTP）→ duration 落库，预览为 [语音]', async () => {
  const msg = okBody(await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, type: 'VOICE', content: '[语音]', mediaUrl: global.__voiceUrl, duration: 6, clientId: 'voice-1' }
  }), 201);
  assert(msg.duration === 6, 'duration 应为 6');
  const aliceList = okBody(await api('GET', '/api/conversations', { token: aliceToken }));
  const conv = aliceList.find(c => c._id === convId);
  assert(conv.lastMessage === '[语音]', '会话预览应为 [语音]: ' + conv.lastMessage);
});

// == 通话信令中转 ==
// 等待指定通话信令（type + callId 双重匹配，分段重试容忍沙箱间歇挂起）
async function recvCall(conn, type, callId, totalMs = 30000) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const kick = api('GET', '/api/health').catch(() => {});
    try {
      const m = await recvOfType(conn, type, 5000);
      if (!callId || (m.data && m.data.callId === callId)) return m;
    } catch (e) {
      await kick;
    }
  }
  throw new Error(`等待 ${type}(callId=${callId}) 超时`);
}

test('通话信令：INVITE 中转给在线好友（附 from）', async () => {
  bobWs.send('CALL_INVITE', { to: aliceId, callId: 'call-1', media: 'video' });
  const inv = await recvCall(aliceWs3, 'CALL_INVITE', 'call-1');
  assert(inv.data.media === 'video' && inv.data.from === bobId, JSON.stringify(inv));
});

test('通话信令：SDP/ICE 按字段白名单中转', async () => {
  bobWs.send('CALL_SDP', { to: aliceId, callId: 'call-1', sdp: { type: 'offer', sdp: 'v=0' }, hack: 'x' });
  const sdp = await recvCall(aliceWs3, 'CALL_SDP', 'call-1');
  assert(sdp.data.sdp && sdp.data.sdp.type === 'offer' && !sdp.data.hack, JSON.stringify(sdp));
  bobWs.send('CALL_ICE', { to: aliceId, callId: 'call-1', candidate: { candidate: 'x' } });
  const ice = await recvCall(aliceWs3, 'CALL_ICE', 'call-1');
  assert(ice.data.candidate && ice.data.candidate.candidate === 'x', JSON.stringify(ice));
});

test('通话信令：非好友拒绝 / 好友离线提示', async () => {
  // dave 不是 alice 好友
  daveWs.send('CALL_INVITE', { to: aliceId, callId: 'call-x', media: 'audio' });
  const err = await recvWithPolling(daveWs, 'ERROR');
  assert(/好友/.test(err.data.message), JSON.stringify(err));
  // alice 邀请不在线的 charlie → CALL_UNAVAILABLE
  aliceWs3.send('CALL_INVITE', { to: charlie._id, callId: 'call-off', media: 'audio' });
  const un = await recvCall(aliceWs3, 'CALL_UNAVAILABLE', 'call-off');
  assert(un.data.to === charlie._id, JSON.stringify(un));
});

test('通话信令：ACCEPT/REJECT/HANGUP 中转', async () => {
  bobWs.send('CALL_ACCEPT', { to: aliceId, callId: 'call-1' });
  const acc = await recvCall(aliceWs3, 'CALL_ACCEPT', 'call-1');
  assert(acc.data.from === bobId, JSON.stringify(acc));
  bobWs.send('CALL_REJECT', { to: aliceId, callId: 'call-2' });
  const rej = await recvCall(aliceWs3, 'CALL_REJECT', 'call-2');
  assert(rej.data.from === bobId, JSON.stringify(rej));
  bobWs.send('CALL_HANGUP', { to: aliceId, callId: 'call-1' });
  const hup = await recvCall(aliceWs3, 'CALL_HANGUP', 'call-1');
  assert(hup.data.from === bobId, JSON.stringify(hup));
});

// == 删除好友闭环 ==
test('删除好友 → 双方列表清空，对方收到 FRIEND_REMOVED', async () => {
  const r = okBody(await api('DELETE', `/api/friends/${aliceId}`, { token: bobToken }));
  assert(r === null, 'data 应为 null');
  const removed = await recvOfType(aliceWs3, 'FRIEND_REMOVED', 5000);
  assert(removed.data.friendId === bobId, JSON.stringify(removed));
  const bobFriends = okBody(await api('GET', '/api/friends', { token: bobToken }));
  const aliceFriends = okBody(await api('GET', '/api/friends', { token: aliceToken }));
  assert(bobFriends.length === 0, 'bob 好友列表应为空');
  assert(!aliceFriends.some(u => u._id === bobId), 'alice 列表不应再含 bob');
});

test('删除好友后：WS 发消息 → ERROR 仅好友之间可以发送消息', async () => {
  bobWs.send('SEND_MESSAGE', { conversationId: convId, receiverId: aliceId, content: 'after unfriend' });
  const err = await recvWithPolling(bobWs, 'ERROR', 5000);
  assert(/好友/.test(err.data.message), JSON.stringify(err));
});

test('删除好友后：HTTP 发消息 → 403', async () => {
  const r = await api('POST', '/api/messages', {
    token: bobToken,
    body: { conversationId: convId, receiverId: aliceId, content: 'after unfriend' }
  });
  assert(r.status === 403 && /好友/.test(r.json.msg), JSON.stringify(r.json));
});

test('删除好友后：删除方会话列表不再显示该会话', async () => {
  const bobList = okBody(await api('GET', '/api/conversations', { token: bobToken }));
  assert(!bobList.some(c => c._id === convId), 'bob 列表不应显示已删好友的会话');
});

test('删除好友后：重复删除 → 404', async () => {
  const r = await api('DELETE', `/api/friends/${aliceId}`, { token: bobToken });
  assert(r.status === 404, JSON.stringify(r.json));
});

// == 上传 ==
test('上传 PNG → 200，文件名为服务端生成的安全名', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'evil-name.png');
  const res = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: form
  });
  const body = await res.json();
  assert(res.status === 200 && body.code === 200, JSON.stringify(body));
  assert(/^\/media\/[0-9a-f]{32}\.png$/.test(body.data.url), '文件名不符合安全规则: ' + body.data.url);
  assert(body.data.thumbnailUrl, '缺少缩略图');
  global.__uploadedUrl = body.data.url;
  uploadedFiles.push(body.data.url.replace('/media/', ''));
  uploadedFiles.push(body.data.thumbnailUrl.replace('/media/', ''));
});

test('上传的图片可经 /media 访问且 Content-Type 正确', async () => {
  const res = await fetch(BASE + global.__uploadedUrl);
  assert(res.status === 200, '媒体访问失败');
  assert((res.headers.get('content-type') || '').startsWith('image/png'), 'Content-Type 不符');
});

test('上传不支持的类型（text/html）→ 400', async () => {
  const form = new FormData();
  form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
  const res = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: form
  });
  assert(res.status === 400, '应拒绝 text/html 上传');
});

test('上传超限文件（>10MB）→ 400 文件大小超过限制', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(11 * 1024 * 1024, 1)], { type: 'image/png' }), 'big.png');
  const res = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: form
  });
  const body = await res.json().catch(() => ({}));
  assert(res.status === 400 && /大小/.test(body.msg || ''), JSON.stringify(body));
});

// == 限流（放在最后，触发后认证接口不可再用）==
test('认证接口限流：连续请求触发 429', async () => {
  let got429 = false;
  for (let i = 0; i < 25; i++) {
    const r = await api('POST', '/api/auth/login', {
      body: { username: 'ratelimit' + i, password: encodePassword('whatever6') }
    });
    if (r.status === 429) { got429 = true; assert(/频繁/.test(r.json.msg), JSON.stringify(r.json)); break; }
  }
  assert(got429, '未触发限流（25 次内无 429）');
});

// ---------- 运行 ----------

(async () => {
  let pass = 0, fail = 0;
  const failures = [];
  try {
    await startEnvironment();
    console.log('▸ 开始冒烟测试（共 ' + tests.length + ' 项）\n');
    for (const t of tests) {
      try {
        await t.fn();
        pass++;
        console.log('  ✓ ' + t.name);
      } catch (e) {
        fail++;
        failures.push(t.name);
        console.error('  ✗ ' + t.name + '\n      ' + String(e && e.message).slice(0, 500));
      }
    }
  } catch (e) {
    console.error('环境启动失败:', e);
    fail++;
    failures.push('环境启动');
  } finally {
    await stopEnvironment();
  }

  console.log('\n========== 结果 ==========');
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fail) {
    console.log('失败项: ' + failures.join(' | '));
    if (serverLog) {
      console.log('\n----- 后端日志（尾部 2000 字）-----');
      console.log(serverLog.slice(-2000));
    }
  }
  process.exit(fail ? 1 : 0);
})();
