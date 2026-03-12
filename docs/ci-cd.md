# CI/CD

## GitHub Actions Workflows

### Pull Request (`pull-request.yml`)

Runs on every pull request to `master`:

- **Build** - installs dependencies, builds Lambda, verifies output
- **Lint & Format** - runs Biome and TypeScript typecheck
- **OpenTofu Validation** - format check, init, validate
- **Secret Detection** - scans for leaked secrets with Gitleaks
- **Security & Privacy Analysis** - runs Bearer SAST scanner
- **OpenTofu Security Scan** - runs Trivy on Terraform configs

### Deploy (`deploy.yml`)

Runs on push to `master`:

- Builds the Lambda function
- Deploys infrastructure with OpenTofu
- Sends deployment notification via the bot

## Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your values in `.env`

3. Add the same secrets to your GitHub repository settings (`Settings` -> `Secrets and variables` -> `Actions`)

### Authentication

Choose one method:

- **Option A (recommended):** Set `TERRAFORM_ROLE` with IAM role ARN for OIDC
- **Option B:** Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

### Required Secrets

- `TERRAFORM_STATE_BUCKET` - S3 bucket for OpenTofu state
- `TELEGRAM_BOT_TOKEN` - your bot token
- `TELEGRAM_CHAT_ID` - your chat ID
- `TELEGRAM_API_URL` - Telegram API URL
- `AWS_REGION` - AWS region

See [configuration.md](./configuration.md) for the full list.
