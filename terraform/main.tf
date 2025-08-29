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
    package_json  = filemd5("${path.module}/../package.json")
  }

  provisioner "local-exec" {
    command = "npm install && npm run build"
    working_dir = "${path.module}/.."
  }
}

# Create ZIP archive of the bundled Lambda function
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/lambda_function.zip"
  source_file = "${path.module}/../dist/index.js"
  output_file_mode = "0666"

  depends_on = [null_resource.build_lambda]
}

# IAM role for Lambda function
resource "aws_iam_role" "lambda_role" {
  name        = "${var.project_name}-lambda-role"
  description = "IAM role for ${var.project_name} Lambda function - managed by Terraform"
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

# Lambda function
resource "aws_lambda_function" "telegram_bot" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = var.project_name
  description      = "${var.project_name} Telegram notification bot - managed by Terraform"
  role            = aws_iam_role.lambda_role.arn
  handler         = "index.handler"
  runtime         = "nodejs22.x"
  timeout         = var.lambda_timeout
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  # Security: Set reserved concurrency to prevent runaway costs (low for notifications)
  reserved_concurrent_executions = 2

  environment {
    variables = {
      TELEGRAM_BOT_TOKEN = var.telegram_bot_token
      TELEGRAM_CHAT_ID   = var.telegram_chat_id
      NODE_ENV          = "production"
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.lambda_logs,
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
  description = "API Gateway for ${var.project_name} Telegram bot webhook - managed by Terraform"
  
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
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.telegram_bot.invoke_arn
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "telegram_deployment" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id

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
  tags = var.tags
}

# Method throttling settings
resource "aws_api_gateway_method_settings" "webhook_throttling" {
  rest_api_id = aws_api_gateway_rest_api.telegram_api.id
  stage_name  = aws_api_gateway_stage.telegram_stage.stage_name
  method_path = "${aws_api_gateway_resource.webhook.path_part}/${aws_api_gateway_method.webhook_post.http_method}"

  settings {
    throttling_rate_limit   = 5     # requests per second (more than enough for notifications)
    throttling_burst_limit  = 10    # burst capacity (cost-optimized)
    logging_level          = "ERROR" # Only log errors to minimize CloudWatch costs
    data_trace_enabled     = false  # Disable to reduce costs
    metrics_enabled        = false  # Disable to reduce costs (can enable if needed)
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
      RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${var.telegram_bot_token}/setWebhook" \
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