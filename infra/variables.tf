variable "aws_region" {
  description = "AWS region containing the production EC2 instance."
  type        = string
  default     = "ap-south-1"
}

variable "subnet_id" {
  description = "Existing public subnet in the default VPC. The VPC and its networking are not managed by this configuration."
  type        = string
  default     = "subnet-0fbd118cb7d4e59e4"

  validation {
    condition     = can(regex("^subnet-[0-9a-f]+$", var.subnet_id))
    error_message = "subnet_id must be an existing AWS subnet ID."
  }
}

variable "instance_type" {
  description = "EC2 instance size for the Colyseus service."
  type        = string
  default     = "t3.medium"
}

variable "game_domain" {
  description = "Cloudflare-managed zone apex, without the game subdomain."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9.-]+$", var.game_domain)) && !startswith(var.game_domain, ".") && !endswith(var.game_domain, ".")
    error_message = "game_domain must be a DNS zone apex without a scheme, path, or leading/trailing dot."
  }
}

variable "cloudflare_zone_id" {
  description = "ID of the existing Cloudflare zone for game_domain."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be the 32-character zone ID from Cloudflare."
  }
}

variable "runtime_permissions_boundary_arn" {
  description = "ARN of the existing osmosis-ec2-permissions-boundary policy."
  type        = string
  default     = "arn:aws:iam::066523631927:policy/osmosis-ec2-permissions-boundary"
}

variable "root_volume_size_gib" {
  description = "Encrypted gp3 root disk size."
  type        = number
  default     = 30
}

variable "enable_detailed_monitoring" {
  description = "Enable one-minute EC2 basic metrics (additional CloudWatch cost may apply)."
  type        = bool
  default     = false
}
