data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "selected" {
  id = var.subnet_id
}

data "aws_ami" "ubuntu_2404_amd64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

locals {
  game_hostname        = "game.${var.game_domain}"
  ecr_repository_arn   = "arn:${data.aws_partition.current.partition}:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/osmosis"
  parameter_arn_prefix = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/osmosis/prod"

  common_tags = {
    Project     = "osmosis"
    Environment = "production"
    ManagedBy   = "Terraform"
  }

  compose_file_b64  = filebase64("${path.module}/../deploy/compose.production.yaml")
  deploy_script_b64 = filebase64("${path.module}/../deploy/deploy-on-ec2.sh")
}
