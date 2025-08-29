variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "eu-central-1"
  
  validation {
    condition = can(regex("^[a-z0-9-]+$", var.aws_region))
    error_message = "AWS region must be a valid region identifier."
  }
}

variable "aws_profile" {
  description = "AWS profile to use (optional - leave empty to use default credentials)"
  type        = string
  default     = ""
}

variable "project_name" {
  description = "Name of the project (used for Lambda function and other resources). Must be unique in your AWS account."
  type        = string
  default     = "telegram-notify-bot"
  
  validation {
    condition = can(regex("^[a-zA-Z0-9-_]+$", var.project_name)) && length(var.project_name) <= 64
    error_message = "Project name must contain only letters, numbers, hyphens, and underscores, and be 64 characters or less."
  }
}

variable "stage_name" {
  description = "API Gateway stage name"
  type        = string
  default     = "prod"
  
  validation {
    condition = can(regex("^[a-zA-Z0-9-_]+$", var.stage_name)) && length(var.stage_name) <= 64
    error_message = "Stage name must contain only letters, numbers, hyphens, and underscores, and be 64 characters or less."
  }
}

variable "telegram_bot_token" {
  description = "Telegram bot token obtained from @BotFather. Format: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
  type        = string
  sensitive   = true
  
  validation {
    condition = can(regex("^[0-9]+:[A-Za-z0-9_-]+$", var.telegram_bot_token))
    error_message = "Telegram bot token must be in format: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
  }
}

variable "telegram_chat_id" {
  description = "Telegram chat ID where messages will be sent. Can be a user ID (positive number) or group/channel ID (negative number)"
  type        = string
  sensitive   = true
  
  validation {
    condition = can(regex("^-?[0-9]+$", var.telegram_chat_id))
    error_message = "Telegram chat ID must be a number (positive for users, negative for groups/channels)."
  }
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 15  # Reduced for simple HTTP requests
  
  validation {
    condition = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "Lambda timeout must be between 1 and 900 seconds."
  }
}

# lambda_reserved_concurrency variable removed - now hardcoded to 2 for cost optimization

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7  # Reduced for cost savings
  
  validation {
    condition = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "Log retention days must be one of: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653."
  }
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    Project     = "telegram-notify-bot"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}