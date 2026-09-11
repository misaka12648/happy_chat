/**
 * 轻量内存限流器（固定窗口）：按客户端 IP 限流，无第三方依赖。
 * 适用单实例部署（与现有 PM2 单实例形态一致）；多实例需换 Redis 方案。
 */

/**
 * 创建限流中间件
 * @param {Object} options
 * @param {number} options.windowMs 统计窗口毫秒数
 * @param {number} options.max      窗口内允许的最大请求数
 */
function createRateLimiter({ windowMs = 5 * 60 * 1000, max = 30 } = {}) {
  // ip -> { count, resetAt }
  const hits = new Map();

  // 定期清理过期条目，避免 Map 无限增长
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }, windowMs);
  // 不阻止进程退出
  if (cleanupTimer.unref) cleanupTimer.unref();

  return function rateLimiter(req, res, next) {
    // trust proxy 已开启（Nginx 反代），req.ip 为真实客户端 IP
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();

    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retrySeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retrySeconds));
      return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试', data: null });
    }
    next();
  };
}

module.exports = { createRateLimiter };
