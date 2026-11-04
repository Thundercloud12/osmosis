variable "aws_region" {
  description = "AWS region for the Osmosis deployment."
  type        = string
  default     = "ap-south-1"
}

variable "availability_zone" {
  description = "Default-VPC Availability Zone for the EC2 instance. t3.small is available in ap-south-1a, 1b, and 1c."
  type        = string
  default     = "ap-south-1b"
}

variable "game_hostname" {
  description = "Production DNS-only hostname used by Caddy for direct WSS traffic to EC2."
  type        = string
  default     = "osmosis-backend.keerthanpoojary.tech"
}

variable "github_actions_subject" {
  description = "GitHub OIDC subject allowed to assume the deploy role. This matches the subject observed on the previous AWS role."
  type        = string
  default     = "repo:Thundercloud12@180408418/osmosis@1433457513:ref:refs/heads/main"
}

variable "client_origins" {
  description = "Exact browser origin allowed by the game server."
  type        = string
}

variable "enable_quick_play" {
  description = "String value for the existing ENABLE_QUICK_PLAY SSM parameter. Copy the intended value from the source environment."
  type        = string
}

variable "livekit_url" {
  description = "LiveKit server URL, or the configured value if voice is disabled."
  type        = string
}

variable "livekit_api_key" {
  description = "LiveKit API key."
  type        = string
  sensitive   = true
}

variable "livekit_api_secret" {
  description = "LiveKit API secret."
  type        = string
  sensitive   = true
}

variable "reconnect_secret" {
  description = "Secret used to sign reconnect and voice credentials."
  type        = string
  sensitive   = true
}

variable "metrics_token" {
  description = "Bearer token used to protect the metrics endpoint."
  type        = string
  sensitive   = true
}

variable "node_env" {
  description = "NODE_ENV SSM value retained from the existing configuration."
  type        = string
  default     = "production"
}

variable "secure_parameter_version" {
  description = "Increment to intentionally update the SecureString values managed by Terraform."
  type        = number
  default     = 1
}
