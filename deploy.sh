#!/bin/bash

# ==============================================================================
# RuntoAds Telegram Bot 一键部署脚本 (OpenCloud OS 9)
# 环境要求: 公网IP, OpenCloud OS 9
# ==============================================================================

set -e

echo "=========================================================="
echo "    开始部署 RuntoAds Telegram Bot (OpenCloud OS 9)       "
echo "=========================================================="

# 1. 更新系统
echo ">> 1. 更新系统软件包..."
sudo yum update -y || sudo dnf update -y

# 2. 安装 Node.js 20
echo ">> 2. 安装 Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs || sudo dnf install -y nodejs

# 3. 安装 pnpm
echo ">> 3. 全局安装 pnpm..."
sudo npm install -g pnpm

# 4. 创建部署目录
echo ">> 4. 创建项目目录..."
PROJECT_DIR="/opt/runtoads-tg-bot"
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

# 将当前目录文件复制到部署目录 (假设在代码根目录执行)
cp -r ./* $PROJECT_DIR/
cd $PROJECT_DIR

# 5. 安装依赖并编译
echo ">> 5. 安装项目依赖并编译..."
pnpm install
pnpm run build

# 6. 生成 .env 文件 (带随机密码)
echo ">> 6. 配置环境变量..."
if [ ! -f ".env" ]; then
    RANDOM_PASS=$(openssl rand -base64 12)
    cat <<EOF > .env
BOT_TOKEN=8536488446:AAEiK7S4ukQNB6gltkPH7VxIiqLeg6yGcwg
INTERNAL_CHAT_IDS=-1003717624726
ADMIN_PORT=8090
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$RANDOM_PASS
GOOGLE_SHEET_ID=1FjFul0KvQ78udE70hcb-z658reJ7-Ko9jAl0Tyo8IvA
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_CREDENTIALS_PATH=config/google-credentials.json
LOG_LEVEL=info
EOF
    echo "已生成默认 .env 文件，ADMIN_PASSWORD 为: $RANDOM_PASS"
else
    echo ".env 文件已存在，跳过生成。"
fi

# 7. 提示上传 Google 凭据
echo ">> 7. 检查 Google Sheets 凭据..."
mkdir -p config/backups
if [ ! -f "config/google-credentials.json" ]; then
    echo "⚠️ 警告: config/google-credentials.json 不存在！"
    echo "请在服务启动前将 Google Service Account JSON 凭据上传至该路径。"
fi

# 8. 创建 systemd 服务
echo ">> 8. 配置 systemd 服务..."
cat <<EOF | sudo tee /etc/systemd/system/runtoads-tg-bot.service
[Unit]
Description=RuntoAds Telegram Bot Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable runtoads-tg-bot
sudo systemctl start runtoads-tg-bot

# 9. 开放防火墙 (OpenCloud OS 默认使用 firewalld)
echo ">> 9. 开放防火墙端口 8090..."
if systemctl is-active --quiet firewalld; then
    sudo firewall-cmd --zone=public --add-port=8090/tcp --permanent
    sudo firewall-cmd --reload
else
    echo "firewalld 未运行，跳过防火墙配置。请确保云服务商安全组已放行 8090 端口。"
fi

echo "=========================================================="
echo "部署完成！🎉"
echo "状态检查: sudo systemctl status runtoads-tg-bot"
echo "日志查看: sudo journalctl -fu runtoads-tg-bot"
echo "管理后台: http://43.155.232.10:8090/admin/config"
if [ -n "$RANDOM_PASS" ]; then
    echo "后台默认账号: admin"
    echo "后台默认密码: $RANDOM_PASS"
fi
echo "=========================================================="
