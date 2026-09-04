/**
 * 强制终止占用指定端口的进程（跨平台：Windows / Linux / macOS）
 * 用法: node scripts/kill-port.js [port]
 * 默认端口: 8080
 */
const { execFileSync } = require('child_process');

const port = process.argv[2] || '8080';

// 严格校验端口为纯数字，杜绝 shell 注入
if (!/^\d{1,5}$/.test(port)) {
  console.error(`[kill-port] 无效端口: ${port}`);
  process.exit(1);
}

const isWin = process.platform === 'win32';

try {
  if (isWin) {
    // execFileSync 不经过 shell，参数安全
    let out;
    try {
      out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_) {
      process.exit(0); // netstat 无输出表示端口未被占用
    }
    const pidSet = new Set();
    out.split('\n').forEach(line => {
      if (!line.includes(`:${port}`) || !line.includes('LISTENING')) return;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pidSet.add(pid);
    });
    pidSet.forEach(pid => {
      try {
        execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'pipe' });
        console.log(`[kill-port] 已终止占用端口 ${port} 的进程 (PID: ${pid})`);
      } catch (_) { /* 进程可能已退出 */ }
    });
  } else {
    // Linux/macOS: fuser 直接传端口参数，不经 shell 拼接
    try {
      execFileSync('fuser', ['-k', `${port}/tcp`], { stdio: 'pipe' });
      console.log(`[kill-port] 已释放端口 ${port}`);
    } catch (_) { /* 端口未被占用 */ }
  }
} catch (_) {
  // 端口未被占用，无需处理
}
