# Setup

## Prerequisites

- [Telegram Bot Token](https://t.me/botfather) (create with @BotFather)
- AWS account with CLI configured
- [OpenTofu](https://opentofu.org) v1.6+
- Node.js 24+
- S3 bucket for OpenTofu state

## 1. Create Telegram Bot

- Message [@BotFather](https://t.me/botfather) on Telegram
- Send `/newbot` and follow instructions
- Save your bot token

## 2. Get Your Chat ID

- Message your new bot
- Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
- Find your chat ID in the response

## 3. Configure OpenTofu

Create `terraform/terraform.tfvars`:

```hcl
aws_region             = "eu-central-1"
aws_profile            = ""  # Optional
terraform_state_bucket = "your-terraform-state-bucket"
telegram_bot_token     = "123456789:your_bot_token_here"
telegram_admin_chat_id = "your_chat_id_here"
project_name           = "telegram-notify-bot"
```

## 4. Deploy

```bash
npm install
npm run build
cd terraform

# Create backend config
cat > backend.hcl << EOF
bucket = "$(grep terraform_state_bucket terraform.tfvars | cut -d'"' -f2)"
region = "$(grep aws_region terraform.tfvars | cut -d'"' -f2)"
EOF

tofu init -backend-config=backend.hcl
tofu apply
```
