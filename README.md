# Telegram Notify Bot

Serverless Telegram bot for sending notifications. Deploy with one command to AWS Lambda.

## What it does

- Receives messages via Telegram webhook
- Processes and responds to messages  
- Sends notifications to configured chat
- Automatically handles infrastructure deployment

## Prerequisites

- [Telegram Bot Token](https://t.me/botfather) (create bot with @BotFather)
- AWS account with CLI configured
- [Terraform](https://terraform.io) installed
- Node.js 22+

## Setup

1. **Get your bot token and chat ID**:
   - Create bot: message [@BotFather](https://t.me/botfather) → `/newbot`
   - Get chat ID: message your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates`

2. **Create `.env` file**:
   ```bash
   TELEGRAM_BOT_API_KEY=123456789:your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

3. **Configure AWS profile** (if using SSO):
   ```bash
   aws sso login --profile your-profile
   ```
   Then edit `terraform/main.tf` to set your profile name.

4. **Deploy**:
   ```bash
   npm install
   cd terraform
   terraform init
   terraform apply
   ```

Webhook is automatically registered with Telegram after deployment.

## Usage

Send HTTP POST to your webhook URL:
```bash
curl -X POST "https://your-api-url/webhook" \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "Hello from webhook!"}}'
```

## Configuration

Edit `terraform/terraform.tfvars`:
```hcl
telegram_bot_token = "your_token"
telegram_chat_id   = "your_chat_id"
aws_region         = "eu-central-1"
project_name       = "my-bot"
```

## Cost Optimization

Configured for minimal costs:
- Lambda: 2 concurrent executions max
- API Gateway: 5 requests/second limit
- CloudWatch: 7-day log retention
- **Estimated cost**: ~$0.10-0.50/month

## Security Features

- Input validation and request size limits
- Rate limiting (5 rps)
- Restricted IAM permissions
- No sensitive data in logs
- Bot token sent via POST body (not URL)

## Development

```bash
npm run build    # Build TypeScript
npm run dev      # Watch mode
npm run deploy   # Deploy via Terraform
terraform plan   # Preview infrastructure changes
```

## Cleanup

```bash
cd terraform
terraform destroy
```