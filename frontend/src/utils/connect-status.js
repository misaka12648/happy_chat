/**
 * 全局连接状态条（仅 H5）：让断线"看得见"。
 * - WebSocket 断开（含掉线/后端不可达/令牌失效待重连）→ 顶部滑入红色"连接已断开，正在重连…"
 * - 重连成功 → 变绿色"已重新连接"，2.5s 后自动收起
 * - 与 notify.js 的消息横幅同思路：uni-app H5 下 App.vue 的 <template> 不渲染，
 *   直接往 document.body 挂 DOM，样式读 CSS 变量自动跟随明暗主题。
 * 注册时序与通知处理器一致：App.vue 启动时注册一次，登录/注册后由 user store 再注册
 * （wsClient.disconnect 会清空处理器，二者不会叠加）。
 */
import wsClient from '@/utils/socket';

const STATUS_STYLE_ID = 'hc-conn-status-style';
const STATUS_STYLE = `
.hc-conn-bar {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translate(-50%, -110%);
  width: min(480px, 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 12px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #FFFFFF;
  background: var(--color-error);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  z-index: 9998;
  transition: transform 0.3s ease, background 0.3s ease;
  pointer-events: none;
}
.hc-conn-bar--show { transform: translate(-50%, 0); }
.hc-conn-bar--ok { background: var(--color-success); }
.hc-conn-bar__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  animation: hc-conn-blink 1s ease-in-out infinite;
}
@keyframes hc-conn-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
`;

let barEl = null;
let hideTimer = null;

const ensureStyle = () => {
  if (typeof document === 'undefined') return false;
  if (!document.getElementById(STATUS_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STATUS_STYLE_ID;
    style.textContent = STATUS_STYLE;
    document.head.appendChild(style);
  }
  return true;
};

const showDisconnected = () => {
  // #ifdef H5
  if (!ensureStyle()) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!barEl) {
    barEl = document.createElement('div');
    barEl.className = 'hc-conn-bar';
    document.body.appendChild(barEl);
  }
  barEl.classList.remove('hc-conn-bar--ok');
  barEl.innerHTML = '<span class="hc-conn-bar__dot"></span>连接已断开，正在重连…';
  requestAnimationFrame(() => barEl && barEl.classList.add('hc-conn-bar--show'));
  // #endif
};

const showReconnected = () => {
  // #ifdef H5
  if (!barEl) return;
  barEl.classList.add('hc-conn-bar--ok');
  barEl.innerHTML = '<span>已重新连接</span>';
  hideTimer = setTimeout(() => {
    if (!barEl) return;
    barEl.classList.remove('hc-conn-bar--show');
    const el = barEl;
    barEl = null;
    setTimeout(() => el.remove(), 350);
  }, 2500);
  // #endif
};

/** 注册连接状态监听（App.vue 启动 / 登录注册后各调用一次，随 disconnect 自动清空） */
export const registerConnectStatus = () => {
  // #ifdef H5
  wsClient.on('DISCONNECTED', showDisconnected);
  wsClient.on('RECONNECTED', showReconnected);
  // #endif
};
