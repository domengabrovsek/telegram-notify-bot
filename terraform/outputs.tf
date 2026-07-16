output "webhook_url" {
  description = "Public Lambda Function URL registered as the Telegram webhook"
  value       = aws_lambda_function_url.telegram_bot.function_url
  sensitive   = true
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.telegram_bot.function_name
  sensitive   = true
}
