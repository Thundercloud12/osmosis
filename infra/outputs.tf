output "aws_region" {
  description = "AWS region containing the production deployment."
  value       = var.aws_region
}

output "ec2_instance_id" {
  description = "Set this as the GitHub Actions EC2_INSTANCE_ID repository variable."
  value       = aws_instance.game_server.id
}

output "game_server_public_ip" {
  description = "Stable Elastic IP used by the DNS-only Cloudflare A record."
  value       = aws_eip.game_server.public_ip
}

output "game_server_hostname" {
  description = "Direct public game and voice API hostname."
  value       = local.game_hostname
}

output "game_server_url" {
  description = "Production VITE_GAME_SERVER_URL; Colyseus negotiates secure WebSockets from this HTTPS origin."
  value       = "https://${local.game_hostname}"
}

output "ecr_repository_uri" {
  description = "Immutable image repository used by GitHub Actions and EC2."
  value       = aws_ecr_repository.game_server.repository_url
}

output "runtime_role_arn" {
  description = "Least-privilege instance role attached to the EC2 host."
  value       = aws_iam_role.ec2_runtime.arn
}
