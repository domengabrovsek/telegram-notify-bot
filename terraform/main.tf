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

# SQS Dead Letter Queue for failed messages
resource "aws_sqs_queue" "telegram_dlq" {
  name                      = "${var.project_name}-dlq"
  message_retention_seconds = 1209600 # 14 days
  tags                      = var.tags
}

# SQS Queue for buffering incoming messages
resource "aws_sqs_queue" "telegram_queue" {
  name                       = "${var.project_name}-queue"
  visibility_timeout_seconds = 60 # 4x Lambda timeout
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20 # long polling
  tags                       = var.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.telegram_dlq.arn
    maxReceiveCount     = 3
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
    aws_iam_role_policy.lambda_sqs_access,
    aws_cloudwatch_log_group.lambda_logs,
    aws_ssm_parameter.bot_token,
    aws_ssm_parameter.admin_chat_id,
    aws_ssm_parameter.additional_chat_ids,
  ]
}

# IAM policy for Lambda to consume from SQS
resource "aws_iam_role_policy" "lambda_sqs_access" {
  name = "${var.project_name}-sqs-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSQSConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          aws_sqs_queue.telegram_queue.arn,
          aws_sqs_queue.telegram_dlq.arn
        ]
      }
    ]
  })
}

# SQS -> Lambda event source mapping
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn                   = aws_sqs_queue.telegram_queue.arn
  function_name                      = aws_lambda_function.telegram_bot.arn
  batch_size                         = 1
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
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
  description = "Webhook API for ${var.project_name}"

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

# IAM role for API Gateway -> SQS
resource "aws_iam_role" "api_gateway_sqs_role" {
  name        = "${var.project_name}-apigw-sqs-role"
  description = "Allows API Gateway to send messages to SQS for ${var.project_name}"
  tags        = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_gateway_sqs_send" {
  name = "${var.project_name}-apigw-sqs-send"
  role = aws_iam_role.api_gateway_sqs_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.telegram_queue.arn
      }
    ]
  })
}

# API Gateway Integration - sends request body to SQS
resource "aws_api_gateway_integration" "lambda_integration" {
  rest_api_id             = aws_api_gateway_rest_api.telegram_api.id
  resource_id             = aws_api_gateway_resource.webhook.id
  http_method             = aws_api_gateway_method.webhook_post.http_method
  integration_http_method = "POST"
  type                    = "AWS"
  uri                     = "arn:aws:apigateway:${var.aws_region}:sqs:path/${data.aws_caller_identity.current.account_id}/${aws_sqs_queue.telegram_queue.name}"
  credentials             = aws_iam_role.api_gateway_sqs_role.arn

  request_parameters = {
    "integration.request.header.Content-Type" = "'application/x-www-form-urlencoded'"
  }

  request_templates = {
    "application/json" = "Action=SendMessage&MessageBody=$util.urlEncode($input.body)"
  }
}

# Method response for 200 OK
resource "aws_api_gateway_method_response" "webhook_200" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  resource_id = aws_api_gateway_resource.webhook.id
  http_method = aws_api_gateway_method.webhook_post.http_method
  status_code = "200"

  response_models = {
    "application/json" = "Empty"
  }
}

# Integration response - maps SQS success to 200
resource "aws_api_gateway_integration_response" "webhook_200" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  resource_id = aws_api_gateway_resource.webhook.id
  http_method = aws_api_gateway_method.webhook_post.http_method
  status_code = aws_api_gateway_method_response.webhook_200.status_code

  response_templates = {
    "application/json" = "{\"message\": \"queued\"}"
  }

  depends_on = [aws_api_gateway_integration.lambda_integration]
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "telegram_deployment" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  description = "Auto-redeployed on API configuration changes"

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.webhook.id,
      aws_api_gateway_method.webhook_post.id,
      aws_api_gateway_integration.lambda_integration.id,
      aws_api_gateway_method_response.webhook_200.id,
      aws_api_gateway_integration_response.webhook_200.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_method.webhook_post, aws_api_gateway_integration.lambda_integration, aws_api_gateway_integration_response.webhook_200]
}

# API Gateway Stage
resource "aws_api_gateway_stage" "telegram_stage" {
  deployment_id = aws_api_gateway_deployment.telegram_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.telegram_api.id
  stage_name    = var.stage_name
  description   = "Production stage with throttling and error-only logging"
  tags          = var.tags
}

# Method throttling settings
resource "aws_api_gateway_method_settings" "webhook_throttling" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  stage_name  = aws_api_gateway_stage.telegram_stage.stage_name
  method_path = "${aws_api_gateway_resource.webhook.path_part}/${aws_api_gateway_method.webhook_post.http_method}"

  settings {
    throttling_rate_limit  = 20      # requests per second (headroom for burst traffic)
    throttling_burst_limit = 40      # burst capacity (allows concurrent deployments)
    logging_level          = "ERROR" # Only log errors to minimize CloudWatch costs
    data_trace_enabled     = false   # Disable to reduce costs
    metrics_enabled        = false   # Disable to reduce costs (can enable if needed)
  }
}

# API Gateway CloudWatch log group removed to minimize costs (access logging disabled)

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
  ]
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