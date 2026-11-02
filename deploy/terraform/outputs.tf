output "aws_region" {
  description = "Region where the deployment was created."
  value       = var.aws_region
}

output "ec2_instance_id" {
  description = "Set this as the EC2_INSTANCE_ID GitHub Actions variable."
  value       = aws_instance.game_server.id
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
