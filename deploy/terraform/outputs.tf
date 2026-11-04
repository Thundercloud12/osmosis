output "aws_region" {
  description = "Region where the deployment was created."
  value       = var.aws_region
}

output "ec2_instance_id" {
  description = "Set this as the EC2_INSTANCE_ID GitHub Actions variable."
  value       = aws_instance.game_server.id
}

output "game_server_public_ip" {
  description = "Elastic IP for the production DNS-only backend A record."
  value       = aws_eip.game_server.public_ip
}

output "game_server_hostname" {
  description = "Production DNS-only hostname served by Caddy for secure WebSocket connections."
  value       = var.game_hostname
}

output "game_server_url" {
  description = "Production VITE_GAME_SERVER_URL base URL; Colyseus upgrades to WSS."
  value       = "https://${var.game_hostname}"
}

output "ecr_repository_uri" {
  description = "ECR image repository URI."
  value       = aws_ecr_repository.game_server.repository_url
}

output "github_deploy_role_arn" {
  description = "Set this as the AWS_ROLE_ARN GitHub Actions variable."
  value       = aws_iam_role.github_deploy.arn
}

output "runtime_role_arn" {
  description = "IAM role attached to the EC2 instance."
  value       = aws_iam_role.ec2_runtime.arn
}

output "kms_key_arn" {
  description = "KMS key used for production SecureString parameters in this region."
  value       = aws_kms_key.ssm.arn
}
