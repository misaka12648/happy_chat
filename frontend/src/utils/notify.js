/**
 * H5 桌面通知（仅 H5 端生效，其他端各方法安全降级为 no-op）
 * - 开关持久化在本地存储 'notifyEnabled'
 * - 实际弹通知前检查：页面处于后台（document.hidden）+ 用户已开启 + 已授权
 * - 免打扰会话不弹通知
 */
import wsClient from '@/utils/socket';
import { useChatStore } from '@/store/chat';

const STORAGE_KEY = 'notifyEnabled';

export const isNotificationEnabled = () => {
  // #ifdef H5
  return uni.getStorageSync(STORAGE_KEY) === '1';
  // #endif
  return false;
};

/**
 * 开关桌面通知：开启时向浏览器申请授权
 * @returns {Promise<{enabled: boolean, reason?: string}>}
 */
export const toggleNotifications = async () => {
  // #ifdef H5
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { enabled: false, reason: '当前环境不支持消息通知' };
  }
  if (isNotificationEnabled()) {
    uni.removeStorageSync(STORAGE_KEY);
    return { enabled: false };
  }
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { enabled: false, reason: '浏览器通知权限被拒绝，请在浏览器设置中开启' };
  }
  uni.setStorageSync(STORAGE_KEY, '1');
  return { enabled: true };
  // #endif
};

/**
 * 消息提示音：WebAudio 合成的两音短促"叮咚"，无资源文件依赖
 */
export const playMessageTone = () => {
  // #ifdef H5
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = playMessageTone._ctx || (playMessageTone._ctx = new Ctx());
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const now = ctx.currentTime;
    [[880, 0, 0.12], [1174.66, 0.1, 0.18]].forEach(([freq, delay, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.09, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  } catch (e) { /* 忽略音频设备缺失 */ }
  // #endif
};

// 预览文案：图片/视频/富文本转摘要，与消息列表预览规则一致
const buildPreview = (msg) => {
  if (msg.recalled) return '撤回了一条消息';
  if (msg.type === 'IMAGE') return '[图片]';
  if (msg.type === 'VIDEO') return '[视频]';
  if (msg.type === 'RICH' && msg.contentBlocks) {
    const text = msg.contentBlocks
      .map(b => (b.blockType === 'image' ? '[图片]' : b.content))
      .join(' ')
      .replace(/\n/g, ' ')
      .trim();
    return text || '[富文本]';
  }
  return msg.content || '';
};

/**
 * 注册全局 NEW_MESSAGE 通知处理器（App.vue 启动 / 用户登录后各调用一次；
 * wsClient.disconnect 会清空处理器，因此两处注册不会叠加）
 */
export const registerNotificationHandler = () => {
  // #ifdef H5
  wsClient.on('NEW_MESSAGE', (msg) => {
    try {
      // 免打扰会话：不响铃也不弹通知
      const conv = useChatStore().getConversations.find(c => c._id === msg.conversationId);
      if (conv && conv.muted) return;

      // 提示音：消息来自非当前会话，或页面处于后台
      const viewingIt = useChatStore().currentConversation && useChatStore().currentConversation._id === msg.conversationId;
      if (!document.hidden && viewingIt) return;
      playMessageTone();

      if (!document.hidden) return; // 页面可见时不需要系统通知
      if (!isNotificationEnabled()) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;


      const senderName = (msg.sender && (msg.sender.nickname || msg.sender.username)) || '新消息';
      const notification = new Notification(senderName, {
        body: buildPreview(msg),
        tag: msg.conversationId, // 同一会话的通知合并，避免刷屏
        icon: msg.sender && msg.sender.avatar ? msg.sender.avatar : undefined
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (e) {
      console.error('桌面通知失败:', e);
    }
  });
  // #endif
};
