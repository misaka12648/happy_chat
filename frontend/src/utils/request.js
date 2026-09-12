// 生产环境使用相对路径（由 Nginx 反向代理），开发环境读取 .env 配置
export const BASE_URL = process.env.NODE_ENV === 'production' ? '' : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080');

// 媒体文件（图片/视频/头像）实体存放在生产服务器磁盘上，本地后端没有这些文件；
// 本地开发时媒体地址单独指向生产域名（VITE_MEDIA_BASE_URL），未配置时回退到 BASE_URL。
export const MEDIA_BASE_URL = process.env.NODE_ENV === 'production' ? '' : (import.meta.env.VITE_MEDIA_BASE_URL || BASE_URL);

// 默认请求超时（毫秒）
const DEFAULT_TIMEOUT = 15000;

// 全局 loading 引用计数：并发请求只显示一个 loading，全部结束才隐藏。
// 使用原生 uni.showLoading（uni-app H5 下 App.vue 的 <template> 不渲染，自定义组件方案
// 无法挂载），并在 App.vue 全局 CSS 中把它重绘为珊瑚色 spinner，以匹配整体 UI。
let loadingCount = 0;
const showGlobalLoading = (title) => {
  loadingCount++;
  uni.showLoading({ title: title || '加载中...', mask: true });
};
const hideGlobalLoading = () => {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    uni.hideLoading();
  }
};

// 统一错误提示
const showErrorToast = (msg) => {
  uni.showToast({ title: msg || '请求失败', icon: 'none' });
};

// 401 登录态失效：防止并发请求触发多次跳转登录页
let redirecting = false;
const redirectToLogin = () => {
  if (redirecting) return;
  redirecting = true;
  uni.removeStorageSync('token');
  uni.removeStorageSync('refreshToken');
  uni.removeStorageSync('userInfo');
  uni.reLaunch({
    url: '/pages/login/login',
    complete: () => { redirecting = false; }
  });
};

// ===== access token 静默续期 =====
// 用 refresh token 换取新 access token：成功则写回本地存储并返回 true，失败返回 false。
// 注意：此处用裸 uni.request（不走 request 包装）以避免 401 递归。
const doRefreshToken = () => {
  return new Promise((resolve) => {
    const refreshToken = uni.getStorageSync('refreshToken');
    if (!refreshToken) { resolve(false); return; }
    uni.request({
      url: `${BASE_URL}/api/auth/refresh`,
      method: 'POST',
      data: { refreshToken },
      header: { 'Content-Type': 'application/json' },
      timeout: DEFAULT_TIMEOUT,
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode === 200 && body.code === 200 && body.data && body.data.token) {
          uni.setStorageSync('token', body.data.token);
          if (body.data.refreshToken) {
            uni.setStorageSync('refreshToken', body.data.refreshToken);
          }
          resolve(true);
        } else {
          resolve(false);
        }
      },
      fail: () => resolve(false)
    });
  });
};

// 刷新协调器：并发的 401 只触发一次刷新，其余排队等待同一结果
let isRefreshing = false;
let refreshWaiters = [];
const refreshAccessToken = () => {
  return new Promise((resolve) => {
    refreshWaiters.push(resolve);
    if (!isRefreshing) {
      isRefreshing = true;
      doRefreshToken().then((success) => {
        isRefreshing = false;
        const waiters = refreshWaiters;
        refreshWaiters = [];
        waiters.forEach((w) => w(success));
      });
    }
  });
};

// 供 WebSocket 等外部模块在鉴权失效时主动续期
export const tryRefreshToken = refreshAccessToken;

// 是否鉴权接口（登录/注册/刷新）：这类接口返回 401 属于“账号密码错误/凭证失效”，不应触发静默续期或跳转
const isAuthEndpoint = (url) => /^\/api\/auth\//.test(url);

/**
 * 封装 uni.request，统一处理 { code, msg, data } 标准响应
 * @param {Object} options
 * @param {string}  options.url    以 /api 开头的接口路径
 * @param {string}  [options.method] 请求方法，默认 GET
 * @param {*}       [options.data] 请求数据
 * @param {boolean} [options.silent] 静默请求：不显示全局 loading、不弹错误 toast（用于后台/轮询/分页）
 * @param {string}  [options.loadingText] 自定义 loading 文案
 * @param {number}  [options.timeout] 超时毫秒数，默认 15000
 */
const request = (options) => {
  return new Promise((resolve, reject) => {
    const { silent = false, loadingText, timeout } = options;
    const token = uni.getStorageSync('token');

    const header = {
      'Content-Type': 'application/json',
      ...options.header
    };

    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }

    if (!silent) showGlobalLoading(loadingText);

    // 统一失败出口：非静默时弹 toast，然后 reject
    const failWith = (msg) => {
      if (!silent) showErrorToast(msg);
      reject(new Error(msg));
    };

    uni.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: timeout || DEFAULT_TIMEOUT,
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode === 200 || res.statusCode === 201) {
          // 业务码 200/201 视为成功，返回完整响应体 { code, msg, data }
          if (body.code === 200 || body.code === 201) {
            resolve(body);
          } else {
            failWith(body.msg || '请求失败');
          }
        } else if (res.statusCode === 401) {
          // 鉴权接口(登录/注册/刷新)或本地无 token：属普通错误（如账号密码错误），不跳转登录
          if (isAuthEndpoint(options.url) || !token) {
            failWith(body.msg || '用户名或密码错误');
          } else if (options._retried) {
            // 已静默刷新并重试过一次仍 401 => refresh 也失效，跳登录
            redirectToLogin();
            reject(new Error(body.msg || '登录已过期，请重新登录'));
          } else {
            // 携带 token 访问业务接口返回 401 => access token 可能过期，静默刷新后重试原请求
            refreshAccessToken().then((success) => {
              if (success) {
                resolve(request({ ...options, _retried: true }));
              } else {
                redirectToLogin();
                reject(new Error(body.msg || '登录已过期，请重新登录'));
              }
            });
          }
        } else {
          failWith(body.msg || '请求失败');
        }
      },
      fail: (err) => {
        const isTimeout = err && err.errMsg && err.errMsg.indexOf('timeout') !== -1;
        failWith(isTimeout ? '请求超时，请稍后重试' : '网络连接失败');
      },
      complete: () => {
        if (!silent) hideGlobalLoading();
      }
    });
  });
};

/**
 * GET 请求
 * @param {string} url
 * @param {*} [data]
 * @param {Object} [options] 透传 silent / loadingText / timeout 等
 */
export const get = (url, data, options = {}) => {
  return request({ url, method: 'GET', data, ...options });
};

/**
 * POST 请求
 */
export const post = (url, data, options = {}) => {
  return request({ url, method: 'POST', data, ...options });
};

/**
 * PUT 请求
 */
export const put = (url, data, options = {}) => {
  return request({ url, method: 'PUT', data, ...options });
};

/**
 * DELETE 请求
 */
export const del = (url, data, options = {}) => {
  return request({ url, method: 'DELETE', data, ...options });
};

/**
 * 上传文件
 * 说明：上传常伴随自定义交互（如“上传中...”“发送中...”），loading/toast 由调用方控制，
 * 这里只负责超时与标准响应体 { code, msg, data } 的解析。
 */
export const upload = (url, filePath, name = 'file', options = {}) => {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token');

    const task = uni.uploadFile({
      url: `${BASE_URL}${url}`,
      filePath,
      name,
      timeout: (options && options.timeout) || DEFAULT_TIMEOUT,
      header: {
        'Authorization': `Bearer ${token}`
      },
      success: (res) => {
        // uploadFile 返回的是字符串，需手动解析为 { code, msg, data }
        let body = {};
        try {
          body = JSON.parse(res.data);
        } catch (e) {
          body = {};
        }
        if (res.statusCode === 200 && (body.code === 200 || body.code === 201)) {
          resolve(body);
        } else if (res.statusCode === 401 && !options._retried) {
          // access token 过期：静默刷新后重试一次上传
          refreshAccessToken().then((success) => {
            if (success) {
              resolve(upload(url, filePath, name, { ...options, _retried: true }));
            } else {
              reject(new Error('登录已过期，请重新登录'));
            }
          });
        } else {
          // 失败时优先透出后端 msg（如“文件大小超过限制”），供调用方 toast
          reject(new Error(body.msg || '上传失败'));
        }
      },
      fail: (err) => {
        const isTimeout = err && err.errMsg && err.errMsg.indexOf('timeout') !== -1;
        reject(new Error(isTimeout ? '上传超时，请稍后重试' : '网络连接失败'));
      }
    });

    // 上传进度回调（0-100），供气泡内进度展示
    if (options.onProgress && task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((res) => {
        try { options.onProgress(res.progress); } catch (e) { /* 进度回调异常不影响上传 */ }
      });
    }
  });
};

export default {
  get,
  post,
  put,
  del,
  upload,
  BASE_URL,
  MEDIA_BASE_URL
};
