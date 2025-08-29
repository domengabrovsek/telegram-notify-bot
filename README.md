# 🤖 Telegram Notify Bot

A secure, serverless Telegram bot for sending notifications. Deploy with one command to AWS Lambda and start receiving alerts instantly! 

Built with TypeScript, secured by design, and optimized for minimal costs.

## ✨ What it does

- 📨 **Receives messages** via Telegram webhook
- 🔒 **Secure access control** - only you can use it
- 🚨 **Security alerts** - notifies you of unauthorized access attempts
- 🔄 **Message forwarding** - echoes your messages back to you
- ☁️ **Auto-deployment** - infrastructure handled automatically

Perfect for monitoring alerts, CI/CD notifications, or any automated messaging needs!

## 📋 Prerequisites

- 🤖 [Telegram Bot Token](https://t.me/botfather) (create with @BotFather)
- ☁️ AWS account with CLI configured
- 🏗️ [Terraform](https://terraform.io) installed (v1.6+)
- 📦 Node.js 22+

## 🚀 Quick Setup

### 1. 🤖 Create your Telegram bot
- Message [@BotFather](https://t.me/botfather) on Telegram
- Send `/newbot` and follow instructions
- Save your bot token (looks like `123456789:ABCdef...`)

### 2. 🆔 Get your chat ID
- Message your new bot with anything
- Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
- Find your chat ID in the response (usually a number like `12345678`)

### 3. ⚙️ Configure the project
Create `terraform/terraform.tfvars`:
```hcl
# AWS Configuration
aws_region = "eu-central-1"
aws_profile = "your-sso-profile"  # Optional: leave empty for default credentials

# Telegram Configuration  
telegram_bot_token = "123456789:your_bot_token_here"
telegram_chat_id = "your_chat_id_here"

# Project Configuration
project_name = "telegram-notify-bot"
```

### 4. 🚀 Deploy to AWS
```bash
# Install dependencies
npm install

# Deploy infrastructure
cd terraform
terraform init
terraform apply
```

That's it! 🎉 Your bot is live and webhook is automatically registered!

## 💬 How to use

### Send notifications via HTTP
```bash
curl -X POST "https://your-api-url/webhook" \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "🚀 Deployment completed!"}}'
```

### Message your bot directly
Just send any message to your bot on Telegram - it will echo it back to you!

### Integrate with CI/CD
Perfect for GitHub Actions, Jenkins, or any system that can send HTTP requests.

## 💰 Cost Optimization

Configured for **minimal AWS costs**:
- 💸 **Lambda**: 2 concurrent executions max
- 🚦 **API Gateway**: 5 requests/second limit  
- 📊 **CloudWatch**: 7-day log retention
- 💵 **Estimated cost**: ~$0.10-0.50/month

Ideal for personal projects and small-scale notifications!

## 🔒 Security Features

- ✅ **Access control** - only your chat ID can use the bot
- 🚨 **Intrusion alerts** - get notified of unauthorized access attempts  
- 🛡️ **Input validation** - request size limits and sanitization
- 🚦 **Rate limiting** - prevents abuse (5 requests/second)
- 🔐 **Secure logging** - no sensitive data in CloudWatch
- 🎯 **Restricted permissions** - minimal IAM roles

## 🛠️ Development

```bash
npm run build    # 📦 Build TypeScript
npm run dev      # 👀 Watch mode for development
npm run deploy   # 🚀 Deploy via Terraform

terraform plan   # 📋 Preview infrastructure changes
terraform apply  # ✅ Apply changes
```

## 🗂️ Project Structure

```
├── 🤖 src/
│   ├── handler.ts      # Lambda entry point
│   ├── telegram.ts     # Telegram API client
│   └── utils.ts        # Utility functions
├── 🏗️ terraform/       # Infrastructure as Code
├── 🔄 .github/         # CI/CD workflows
└── 📚 README.md        # You are here!
```

## 🧹 Cleanup

When you're done:
```bash
cd terraform
terraform destroy  # 🗑️ Remove all AWS resources
```

---

**Built with ❤️ by [Domen Gabrovšek](https://github.com/domengabrovsek)**  
*Secure • Serverless • Simple*