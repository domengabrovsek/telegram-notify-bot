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
    key     = "telegram-bot/terraform.tfstate"
    encrypt = true
    # bucket and region are provided via backend-config or backend.hcl
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile != "" ? var.aws_profile : null
}

# Build the bundle using esbuild
resource "null_resource" "build_lambda" {
  triggers = {
    index_ts      = filemd5("${path.module}/../index.ts")
    telegram_ts   = filemd5("${path.module}/../src/telegram.ts")
    utils_ts      = filemd5("${path.module}/../src/utils.ts")
    handler_ts    = can(filemd5("${path.module}/../src/handler.ts")) ? filemd5("${path.module}/../src/handler.ts") : ""
    ssm_client_ts = can(filemd5("${path.module}/../src/ssm-client.ts")) ? filemd5("${path.module}/../src/ssm-client.ts") : ""
    package_json  = filemd5("${path.module}/../package.json")
  }

  provisioner "local-exec" {
    command     = "npm install && npm run build"
    working_dir = "${path.module}/.."
  }
}

# Create ZIP archive of the bundled Lambda function
data "archive_file" "lambda_zip" {
  type             = "zip"
  output_path      = "${path.module}/lambda_function.zip"
  source_file      = "${path.module}/../dist/index.js"
  output_file_mode = "0666"

  depends_on = [null_resource.build_lambda]
}

# IAM role for Lambda function
resource "aws_iam_role" "lambda_role" {
  name        = "${var.project_name}-lambda-role"
  description = "Execution role for ${var.project_name} Lambda function (Telegram notification bot). Grants CloudWatch Logs access. Managed by Terraform."
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

  # Prevent role deletion protection
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

# Import existing SSM parameters into Terraform state
import {
  to = aws_ssm_parameter.bot_token
  id = "/telegram-notify-bot/bot-token"
}

import {
  to = aws_ssm_parameter.admin_chat_id
  id = "/telegram-notify-bot/admin-chat-id"
}

import {
  to = aws_ssm_parameter.additional_chat_ids
  id = "/telegram-notify-bot/additional-chat-ids"
}

# SSM Parameters for secrets management
# Terraform creates these with placeholder values on first apply
# Update the actual values manually in AWS Systems Manager Console/CLI
resource "aws_ssm_parameter" "bot_token" {
  name        = "/telegram-notify-bot/bot-token"
  description = "Telegram bot token from @BotFather. Used for API authentication. Managed by Terraform."
  type        = "SecureString"
  value       = var.telegram_bot_token
  tags        = var.tags

  lifecycle {
    ignore_changes = [value] # Prevent Terraform from overwriting manual updates
  }
}

resource "aws_ssm_parameter" "admin_chat_id" {
  name        = "/telegram-notify-bot/admin-chat-id"
  description = "Admin Telegram chat ID for security alerts and authorization. Managed by Terraform."
  type        = "SecureString"
  value       = var.telegram_admin_chat_id
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "additional_chat_ids" {
  name        = "/telegram-notify-bot/additional-chat-ids"
  description = "Comma-separated list of additional authorized Telegram chat IDs. Managed by Terraform."
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
  description      = "Telegram notification bot handler. Receives messages via API Gateway webhook and sends them to authorized Telegram chats. Managed by Terraform."
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = var.lambda_timeout
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # Security: Set reserved concurrency to prevent runaway costs (low for notifications)
  reserved_concurrent_executions = 2

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

# API Gateway REST API
resource "aws_api_gateway_rest_api" "telegram_api" {
  name        = "${var.project_name}-api"
  description = "REST API for Telegram bot webhook. Receives POST requests at /webhook endpoint and invokes Lambda function. Managed by Terraform."

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags

  # Ensure proper deletion order
  lifecycle {
    create_before_destroy = false
  }
}

# API Gateway Resource
resource "aws_api_gateway_resource" "webhook" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  parent_id   = aws_api_gateway_rest_api.telegram_api.root_resource_id
  path_part   = "webhook"
}

# API Gateway Method
resource "aws_api_gateway_method" "webhook_post" {
  rest_api_id   = aws_api_gateway_rest_api.telegram_api.id
  resource_id   = aws_api_gateway_resource.webhook.id
  http_method   = "POST"
  authorization = "NONE"

  # Request validation
  request_validator_id = aws_api_gateway_request_validator.webhook_validator.id

  # Require JSON content type
  request_models = {
    "application/json" = "Empty"
  }
}

# Request validator
resource "aws_api_gateway_request_validator" "webhook_validator" {
  name                        = "${var.project_name}-validator"
  rest_api_id                 = aws_api_gateway_rest_api.telegram_api.id
  validate_request_body       = true
  validate_request_parameters = true
}

# API Gateway Integration
resource "aws_api_gateway_integration" "lambda_integration" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  resource_id = aws_api_gateway_resource.webhook.id
  http_method = aws_api_gateway_method.webhook_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.telegram_bot.invoke_arn
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "telegram_deployment" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  description = "Deployment of Telegram bot webhook API. Auto-redeployed on configuration changes. Managed by Terraform."

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.webhook.id,
      aws_api_gateway_method.webhook_post.id,
      aws_api_gateway_integration.lambda_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_method.webhook_post, aws_api_gateway_integration.lambda_integration]
}

# API Gateway Stage
resource "aws_api_gateway_stage" "telegram_stage" {
  deployment_id = aws_api_gateway_deployment.telegram_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.telegram_api.id
  stage_name    = var.stage_name
  description   = "Production stage for Telegram bot webhook API. Throttled to 5 req/s with error-only logging. Managed by Terraform."
  tags          = var.tags
}

# Method throttling settings
resource "aws_api_gateway_method_settings" "webhook_throttling" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  stage_name  = aws_api_gateway_stage.telegram_stage.stage_name
  method_path = "${aws_api_gateway_resource.webhook.path_part}/${aws_api_gateway_method.webhook_post.http_method}"

  settings {
    throttling_rate_limit  = 5       # requests per second (more than enough for notifications)
    throttling_burst_limit = 10      # burst capacity (cost-optimized)
    logging_level          = "ERROR" # Only log errors to minimize CloudWatch costs
    data_trace_enabled     = false   # Disable to reduce costs
    metrics_enabled        = false   # Disable to reduce costs (can enable if needed)
  }
}

# API Gateway CloudWatch log group removed to minimize costs (access logging disabled)

# Lambda permission for API Gateway
resource "aws_lambda_permission" "api_gateway_lambda" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.telegram_bot.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.telegram_api.execution_arn}/${var.stage_name}/POST/webhook"
}

# Register webhook with Telegram after deployment
resource "null_resource" "register_webhook" {
  triggers = {
    webhook_url = "https://${aws_api_gateway_rest_api.telegram_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.stage_name}/webhook"
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "Registering webhook with Telegram..."
      TOKEN=$(aws ssm get-parameter --name "/telegram-notify-bot/bot-token" --with-decryption --query 'Parameter.Value' --output text --region ${var.aws_region})
      RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://${aws_api_gateway_rest_api.telegram_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.stage_name}/webhook"}')

      if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "✅ Webhook registered successfully!"
        echo "Webhook URL: https://${aws_api_gateway_rest_api.telegram_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.stage_name}/webhook"
      else
        echo "❌ Failed to register webhook:"
        echo "$RESPONSE"
        exit 1
      fi
    EOT
  }

  depends_on = [
    aws_api_gateway_deployment.telegram_deployment,
    aws_api_gateway_stage.telegram_stage,
    aws_lambda_permission.api_gateway_lambda
  ]
}