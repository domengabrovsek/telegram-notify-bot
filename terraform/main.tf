terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.11"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Remote state backend for S3 (partial configuration)
  backend "s3" {
    key     = "telegram-notify-bot/terraform.tfstate"
    encrypt = true
    # bucket and region are provided via backend-config or backend.hcl
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile != "" ? var.aws_profile : null
}

# Build is expected to run before tofu apply (npm run build in CI or locally).
# Terraform just zips the pre-built dist output.
data "archive_file" "lambda_zip" {
  type             = "zip"
  output_path      = "${path.module}/lambda_function.zip"
  source_file      = "${path.module}/../dist/index.mjs"
  output_file_mode = "0666"
}

# IAM role for Lambda function
resource "aws_iam_role" "lambda_role" {
  name        = "${var.project_name}-lambda-role"
  description = "Lambda execution role for ${var.project_name}"
  tags        = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })

  lifecycle {
    prevent_destroy = false
  }
}

# Get current AWS account ID for security
data "aws_caller_identity" "current" {}

# IAM policy attachment for Lambda basic execution
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# SSM Parameters for secrets management
# Terraform creates these with placeholder values on first apply
# Update the actual values manually in AWS Systems Manager Console/CLI
resource "aws_ssm_parameter" "bot_token" {
  name        = "/telegram-notify-bot/bot-token"
  description = "Telegram bot token from @BotFather"
  type        = "SecureString"
  value       = var.telegram_bot_token
  tags        = var.tags

  lifecycle {
    ignore_changes = [value] # Prevent Terraform from overwriting manual updates
  }
}

resource "aws_ssm_parameter" "admin_chat_id" {
  name        = "/telegram-notify-bot/admin-chat-id"
  description = "Admin Telegram chat ID for alerts and authorization"
  type        = "SecureString"
  value       = var.telegram_admin_chat_id
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "additional_chat_ids" {
  name        = "/telegram-notify-bot/additional-chat-ids"
  description = "Additional authorized Telegram chat IDs (comma-separated)"
  type        = "SecureString"
  value       = var.telegram_chat_ids
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# IAM policy for SSM Parameter Store access
resource "aws_iam_role_policy" "lambda_ssm_access" {
  name = "${var.project_name}-ssm-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSSMParameterRead"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/telegram-notify-bot/*"
        ]
      },
      {
        Sid    = "AllowKMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

# Lambda function
resource "aws_lambda_function" "telegram_bot" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = var.project_name
  description      = "Handles webhook requests and sends Telegram notifications"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = var.lambda_timeout
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # Reserved concurrency to prevent runaway costs while handling burst traffic
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      NODE_ENV = "production"
      # AWS region is automatically available via AWS_REGION environment variable
      # SSM parameter names are hardcoded in application code
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy.lambda_ssm_access,
    aws_cloudwatch_log_group.lambda_logs,
    aws_ssm_parameter.bot_token,
    aws_ssm_parameter.admin_chat_id,
    aws_ssm_parameter.additional_chat_ids,
  ]
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${var.project_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

/* Public Lambda Function URL - the Telegram webhook + notify-workflow ingestion
   endpoint, replacing the former API Gateway -> SQS path. Unauthenticated at the
   edge (Telegram cannot sign requests); the handler authorizes by chat id. */
resource "aws_lambda_function_url" "telegram_bot" {
  function_name      = aws_lambda_function.telegram_bot.function_name
  authorization_type = "NONE"
}

# Allow public unauthenticated invokes of the Function URL (Telegram + notify workflows).
resource "aws_lambda_permission" "function_url" {
  statement_id           = "AllowPublicFunctionUrlInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.telegram_bot.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Register webhook with Telegram after deployment
resource "null_resource" "register_webhook" {
  triggers = {
    webhook_url = aws_lambda_function_url.telegram_bot.function_url
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "Registering webhook with Telegram..."
      TOKEN=$(aws ssm get-parameter --name "/telegram-notify-bot/bot-token" --with-decryption --query 'Parameter.Value' --output text --region ${var.aws_region})
      RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "${aws_lambda_function_url.telegram_bot.function_url}"}')

      if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "✅ Webhook registered successfully!"
        echo "Webhook URL: ${aws_lambda_function_url.telegram_bot.function_url}"
      else
        echo "❌ Failed to register webhook:"
        echo "$RESPONSE"
        exit 1
      fi
    EOT
  }

  depends_on = [aws_lambda_function_url.telegram_bot]
}

# EventBridge rule to keep Lambda warm (every 5 minutes)
resource "aws_cloudwatch_event_rule" "lambda_warmup" {
  name                = "${var.project_name}-warmup"
  description         = "Pings Lambda every 5 min to avoid cold starts"
  schedule_expression = "rate(5 minutes)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "lambda_warmup" {
  rule = aws_cloudwatch_event_rule.lambda_warmup.name
  arn  = aws_lambda_function.telegram_bot.arn
}

resource "aws_lambda_permission" "eventbridge_warmup" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.telegram_bot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.lambda_warmup.arn
}
