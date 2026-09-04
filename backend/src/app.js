const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const WebSocket = require('ws');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');

const { authenticateToken } = require('./middleware/auth');
const { setupWebSocket } = require('./websocket');
const { ok } = require('./utils/response');

const app = express();
const server = http.createServer(app);

// 中间件
// CORS 白名单：生产域名默认放行，本地开发放行 localhost/127.0.0.1 任意端口，其余拒绝。
// 可在 .env 用 CORS_ORIGINS 覆盖生产白名单（英文逗号分隔多个来源）。
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['https://chat.misaka12648.asia'];
app.use(cors({
  origin(origin, callback) {
    // 无 origin（同源请求、curl、原生 App WebView）直接放行
    if (!origin) return callback(null, true);
    // 本地开发：放行 localhost / 127.0.0.1 任意端口
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态资源服务
app.use('/media', express.static(path.join(__dirname, '../uploads')));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/friends', authenticateToken, friendRoutes);
app.use('/api/conversations', authenticateToken, conversationRoutes);
app.use('/api/messages', authenticateToken, messageRoutes);
app.use('/api/upload', authenticateToken, uploadRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 版本检查接口
const APP_VERSION = Date.now().toString();
app.get('/api/version', (req, res) => {
  ok(res, { version: APP_VERSION });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  // 统一 { code, msg, data } 格式；开发环境把错误详情放入 data 便于调试
  res.status(500).json({
    code: 500,
    msg: '服务器内部错误',
    data: process.env.NODE_ENV === 'development' ? { error: err.message } : null
  });
});

// 连接数据库
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/happychat';
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB 连接成功');
    
    // 启动 WebSocket
    setupWebSocket(server);
    
    // 启动服务器
    const PORT = process.env.PORT || 8080;
    // 安全加固：默认只绑定 127.0.0.1，后端不直接暴露公网（统一经 Nginx 反向代理转发）。
    // 如需局域网访问（如手机连开发机调试），在 .env 设置 HOST=0.0.0.0
    const HOST = process.env.HOST || '127.0.0.1';
    server.listen(PORT, HOST, () => {
      console.log(`服务器运行在 http://${HOST}:${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB 连接失败:', err);
    process.exit(1);
  });
