const { NodeSSH } = require('node-ssh');
const chalk = require('chalk');
const path = require('path');
const ora = require('ora').default || require('ora');
require('dotenv').config();

const ssh = new NodeSSH();

// 宝塔 Node.js 环境加载命令
const BT_NODE_ENV = 'export PATH=/www/server/nodejs/bin:$PATH && export NODE_HOME=/www/server/nodejs && export PATH=$NODE_HOME/bin:$PATH';

// Configuration
const config = {
    host: process.env.SERVER_HOST,
    port: process.env.SERVER_PORT || 22,
    username: process.env.SERVER_USER,
    password: process.env.SERVER_PASSWORD,
    privateKeyPath: process.env.SERVER_PRIVATE_KEY_PATH,
    remotePath: process.env.REMOTE_PATH || '/www/wwwroot/happychat',
    pm2AppName: process.env.PM2_APP_NAME || 'happychat-backend',
};

function validateConfig() {
    const required = ['host', 'username'];
    const missing = required.filter(key => !config[key]);

    if (!config.password && !config.privateKeyPath) {
        missing.push('password OR privateKeyPath');
    }

    if (missing.length > 0) {
        console.error(chalk.red('错误: 缺少配置变量:'));
        missing.forEach(key => console.error(chalk.red(` - ${key}`)));
        console.error(chalk.yellow('请检查 .env 文件。'));
        process.exit(1);
    }
}

async function connectServer() {
    const spinner = ora(`连接服务器 ${config.host}...`).start();
    try {
        const sshConfig = {
            host: config.host,
            port: config.port,
            username: config.username,
        };
        
        if (config.privateKeyPath) {
            sshConfig.privateKeyPath = config.privateKeyPath;
        } else {
            sshConfig.password = config.password;
        }

        await ssh.connect(sshConfig);
        spinner.succeed(`已连接到 ${config.host}`);
    } catch (err) {
        spinner.fail('连接失败');
        console.error(chalk.red(err));
        process.exit(1);
    }
}

async function listBackups() {
    const spinner = ora('查找备份文件...').start();
    try {
        const parentDir = path.posix.dirname(config.remotePath);
        const cmd = `ls -t ${parentDir}/backup_*.tar.gz 2>/dev/null`;
        const result = await ssh.execCommand(cmd);
        
        const backups = result.stdout.trim().split('\n').filter(f => f);
        
        if (backups.length === 0) {
            spinner.fail('没有找到备份文件!');
            process.exit(1);
        }
        
        spinner.succeed(`找到 ${backups.length} 个备份文件`);
        return backups;
    } catch (err) {
        spinner.fail('查找备份失败');
        console.error(chalk.red(err));
        process.exit(1);
    }
}

async function selectBackup(backups) {
    console.log(chalk.cyan('\n可用的备份文件:'));
    backups.forEach((backup, index) => {
        const filename = path.posix.basename(backup);
        console.log(chalk.white(`  ${index + 1}. ${filename}`));
    });
    
    // 默认选择最新的备份
    console.log(chalk.yellow(`\n将使用最新的备份: ${path.posix.basename(backups[0])}`));
    return backups[0];
}

async function performRollback(backupFile) {
    const spinner = ora('恢复备份...').start();
    try {
        const parentDir = path.posix.dirname(config.remotePath);
        
        // 清空当前目录
        spinner.text = '清空当前文件...';
        await ssh.execCommand(`find ${config.remotePath} -mindepth 1 -delete`);
        
        // 解压备份
        spinner.text = '解压备份文件...';
        const extractCmd = `tar -xzf ${backupFile} -C ${parentDir} --overwrite`;
        const extractResult = await ssh.execCommand(extractCmd);
        
        if (extractResult.code !== 0) {
            throw new Error(`解压失败: ${extractResult.stderr}`);
        }
        
        spinner.succeed('备份恢复成功');
    } catch (err) {
        spinner.fail('备份恢复失败');
        console.error(chalk.red(err));
        process.exit(1);
    }
}

async function restartBackend() {
    const spinner = ora('重启后端服务...').start();
    try {
        const remotePath = path.posix.join(config.remotePath, 'backend');
        
        // 重启 PM2 应用
        const restartCmd = `${BT_NODE_ENV} && cd ${remotePath} && pm2 restart ${config.pm2AppName}`;
        const result = await ssh.execCommand(restartCmd);
        
        if (result.code !== 0) {
            // 如果重启失败，尝试启动
            const startCmd = `${BT_NODE_ENV} && cd ${remotePath} && pm2 start src/app.js --name ${config.pm2AppName}`;
            await ssh.execCommand(startCmd);
        }
        
        spinner.succeed('后端服务已重启');
    } catch (err) {
        spinner.warn('后端重启可能失败，请手动检查');
        console.error(chalk.yellow(err));
    }
}

async function deleteBackup(backupFile) {
    const spinner = ora('删除已使用的备份...').start();
    try {
        await ssh.execCommand(`rm "${backupFile}"`);
        spinner.succeed('备份文件已删除');
    } catch (err) {
        spinner.warn('删除备份文件失败 (非关键错误)');
    }
}

async function run() {
    console.log(chalk.magenta('开始回滚 HappyChat\n'));
    
    validateConfig();
    
    await connectServer();
    
    const backups = await listBackups();
    
    const selectedBackup = await selectBackup(backups);
    
    await performRollback(selectedBackup);
    
    await restartBackend();
    
    await deleteBackup(selectedBackup);
    
    ssh.dispose();
    
    console.log(chalk.magenta('\n回滚完成!'));
    console.log(chalk.cyan(`前端地址: http://${config.host}`));
    console.log(chalk.cyan(`后端地址: http://${config.host}:8080`));
}

if (require.main === module) {
    run();
}
