/**
 * SSH 隧道脚本
 * 将本地 27017 端口通过 SSH 安全转发到服务器上的 MongoDB(127.0.0.1:27017)
 * 用途：本地开发调试时，让本地后端连接远程数据库，无需将 MongoDB 对公网开放
 *
 * 使用：node scripts/db-tunnel.js （保持窗口运行）
 * 本地后端仍使用 MONGODB_URI=mongodb://localhost:27017/happychat 即可
 */
const net = require('net');
const { NodeSSH } = require('node-ssh');
require('dotenv').config();

const LOCAL_PORT = parseInt(process.env.TUNNEL_LOCAL_PORT) || 27017;
const REMOTE_HOST = '127.0.0.1'; // 服务器上 MongoDB 的绑定地址
const REMOTE_PORT = 27017;

const ssh = new NodeSSH();

async function main() {
    console.log('正在建立 SSH 隧道到远程数据库...');

    await ssh.connect({
        host: process.env.SERVER_HOST,
        port: process.env.SERVER_PORT || 22,
        username: process.env.SERVER_USER,
        password: process.env.SERVER_PASSWORD,
        keepaliveInterval: 10000,
    });

    const conn = ssh.connection;

    const server = net.createServer((socket) => {
        conn.forwardOut('127.0.0.1', 0, REMOTE_HOST, REMOTE_PORT, (err, stream) => {
            if (err) {
                console.error('端口转发失败:', err.message);
                socket.end();
                return;
            }
            socket.pipe(stream).pipe(socket);
            socket.on('error', () => stream.end());
            stream.on('error', () => socket.end());
        });
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`✘ 本地端口 ${LOCAL_PORT} 已被占用（可能本地已运行 MongoDB）。请先停止本地 MongoDB 服务，或设置环境变量 TUNNEL_LOCAL_PORT 换一个端口。`);
        } else {
            console.error('✘ 隧道服务器错误:', e.message);
        }
        process.exit(1);
    });

    server.listen(LOCAL_PORT, '127.0.0.1', () => {
        console.log(`✔ SSH 隧道已建立: localhost:${LOCAL_PORT} → ${process.env.SERVER_HOST} 的 MongoDB(${REMOTE_HOST}:${REMOTE_PORT})`);
        console.log('  现在本地后端可用 mongodb://localhost:27017 连接远程数据库。');
        console.log('  保持此窗口运行，Ctrl+C 关闭隧道。');
    });

    conn.on('close', () => {
        console.error('✘ SSH 连接已断开，隧道关闭。');
        process.exit(1);
    });
}

main().catch((e) => {
    console.error('✘ 隧道建立失败:', e.message);
    process.exit(1);
});
