output "api_gateway_invoke_url" {
  description = "Invoke URL for the API Gateway webhook"
  value       = "https://${aws_api_gateway_rest_api.telegram_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.stage_name}/webhook"
  sensitive   = true
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.telegram_bot.function_name
  sensitive   = true
}

output "sqs_queue_url" {
  description = "URL of the SQS queue for message buffering"
  value       = aws_sqs_queue.telegram_queue.url
}

output "sqs_dlq_url" {
  description = "URL of the SQS dead letter queue for failed messages"
  value       = aws_sqs_queue.telegram_dlq.url
}