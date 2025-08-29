output "api_gateway_url" {
  description = "URL of the API Gateway webhook endpoint"
  value       = "${aws_api_gateway_rest_api.telegram_api.execution_arn}/${var.stage_name}/webhook"
}

output "api_gateway_invoke_url" {
  description = "Invoke URL for the API Gateway webhook"
  value       = "https://${aws_api_gateway_rest_api.telegram_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.stage_name}/webhook"
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.telegram_bot.function_name
}

output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.telegram_bot.arn
}