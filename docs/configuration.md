# Configuration

## OpenTofu Variables (`terraform/terraform.tfvars`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `aws_region` | Yes | AWS region for deployment | `eu-central-1` |
| `aws_profile` | No | AWS CLI profile (uses default if empty) | `my-sso-profile` |
| `terraform_state_bucket` | Yes | S3 bucket name for OpenTofu state | `my-terraform-state` |
| `telegram_bot_token` | Yes | Bot token from @BotFather | `123456789:ABCdef...` |
| `telegram_admin_chat_id` | Yes | Admin Telegram chat ID | `12345678` |
| `telegram_chat_ids` | No | Additional authorized chat IDs (comma-separated) | `-100123,-100456` |
| `project_name` | Yes | Project identifier | `telegram-notify-bot` |
| `lambda_reserved_concurrency` | No | Max concurrent Lambda executions (default: 10) | `10` |

## GitHub Actions Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | AWS region for deployment |
| `TERRAFORM_STATE_BUCKET` | Yes | S3 bucket name for OpenTofu state |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID |
| `TELEGRAM_API_URL` | Yes | Telegram API base URL |
| `TERRAFORM_ROLE` | Yes* | IAM role ARN for OIDC authentication |

\* Using OIDC authentication (recommended). Alternatively, use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for key-based auth.
