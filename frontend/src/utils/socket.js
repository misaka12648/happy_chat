// 生产环境使用当前域名（由 Nginx 反向代理 /ws），开发环境读取 .env 配置
import { tryRefreshToken } from '@/utils/request';

let BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8080/ws';
// #ifdef H5
if (process.env.NODE_ENV === 'production' && typeof location !== 'undefined') {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  BASE_URL = `${proto}//${location.host}/ws`;
}
// #endif

class WebSocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 100;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageHandlers = new Map();
  }

  /**
   * 连接 WebSocket
   */
  connect() {
    const token = uni.getStorageSync('token');
    if (!token) {
      console.error('未找到 token，无法连接 WebSocket');
      return;
    }
    // 防重入：上一轮连接尚未结束时忽略新的 connect 调用（否则新旧连接互相关闭形成重连风暴）
    if (this._connecting) {
      return;
    }
    this._connecting = true;

    // 重置重连上限（disconnect 会设为 0，再次 connect 时需恢复）
    if (this.maxReconnectAttempts === 0) {
      this.maxReconnectAttempts = 100;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const task = uni.connectSocket({
      url: `${BASE_URL}?token=${token}`,
      success: () => {
        console.log('WebSocket 连接中...');
      }
    });
    this.socket = task;

    task.onOpen(() => {
      this._connecting = false;
      const wasReconnecting = this.reconnectAttempts > 0;
      console.log('WebSocket 已连接', wasReconnecting ? '(重连成功)' : '');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      // 重连成功后通知页面补拉断连期间错过的消息
      if (wasReconnecting) {
        const handlers = this.messageHandlers.get('RECONNECTED');
        if (handlers) {
          handlers.forEach(handler => {
            try { handler({}); } catch (e) { console.error('RECONNECTED 处理器错误:', e); }
          });
        }
      }
    });

    task.onMessage((res) => {
      try {
        const message = JSON.parse(res.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('解析消息失败:', error);
      }
    });

    task.onClose((res) => {
      this._connecting = false;
      // 仅当前连接的关闭才触发重连：被 connect()/disconnect() 接管的旧连接不参与
      if (this.socket !== task) return;
      console.log('WebSocket 已断开', res && res.code ? `(code: ${res.code})` : '');
      this.isConnected = false;
      this.stopHeartbeat();
      // 4001 = 服务端因 token 缺失/失效关闭：先静默续期，成功再重连（避免拿过期 token 反复失败）
      if (res && res.code === 4001) {
        tryRefreshToken().then((ok) => { if (ok) this.tryReconnect(); });
      } else {
        this.tryReconnect();
      }
    });

    task.onError((err) => {
      console.error('WebSocket 错误:', err);
      this.isConnected = false;
    });
  }

  /**
   * 处理收到的消息
   */
  handleMessage(message) {
    const { type, data } = message;
    
    // 触发注册的消息处理器
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('消息处理器错误:', error);
        }
      });
    }
  }

  /**
   * 注册消息处理器
   */
  on(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(handler);
  }

  /**
   * 移除消息处理器
   */
  off(type, handler) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 发送消息
   */
  send(type, data) {
    if (!this.isConnected) {
      console.error('WebSocket 未连接');
      return false;
    }

    try {
      this.socket.send({
        data: JSON.stringify({ type, data }),
        success: () => {
          console.log('消息发送成功');
        },
        fail: (err) => {
          console.error('消息发送失败:', err);
        }
      });
      return true;
    } catch (error) {
      console.error('发送消息错误:', error);
      return false;
    }
  }

  /**
   * 发送聊天消息
   */
  sendMessage(conversationId, receiverId, content, messageType = 'TEXT', mediaUrl = '', thumbnailUrl = '', contentBlocks = [], replyInfo = null, clientId = '', duration = 0) {
    return this.send('SEND_MESSAGE', {
      conversationId,
      receiverId,
      content,
      messageType,
      mediaUrl,
      thumbnailUrl,
      contentBlocks,
      replyInfo,
      clientId,
      duration
    });
  }

  /**
   * 撤回消息
   */
  recallMessage(messageId, conversationId, receiverId) {
    return this.send('RECALL_MESSAGE', {
      messageId,
      conversationId,
      receiverId
    });
  }

  /**
   * 发送输入状态
   */
  sendTyping(conversationId, receiverId) {
    return this.send('TYPING', {
      conversationId,
      receiverId
    });
  }

  /**
   * 标记消息已读
   */
  markAsRead(messageId, conversationId) {
    return this.send('READ_MESSAGE', {
      messageId,
      conversationId
    });
  }

  /**
   * 开始心跳检测
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        // 发送心跳消息
        this.send('HEARTBEAT', {});
      }
    }, 15000);
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 尝试重连
   */
  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stopHeartbeat();
    this._connecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.maxReconnectAttempts = 0; // 阻止重连
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.isConnected = false;
    this.messageHandlers.clear();
  }
}

// 创建单例
const wsClient = new WebSocketClient();

export default wsClient;
