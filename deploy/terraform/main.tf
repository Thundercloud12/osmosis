terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.14.1, < 7.0.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_partition" "current" {}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "selected" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "availability-zone"
    values = [var.availability_zone]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_ssm_parameter" "amazon_linux_2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  common_tags = {
    Application = "Osmosis"
    Environment = "production"
    ManagedBy   = "Terraform"
  }

  parameter_arn_prefix     = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/osmosis/prod"
  ecr_repository_arn       = "arn:${data.aws_partition.current.partition}:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/osmosis/game-server"
  github_oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"

  string_parameter_values = {
    CLIENT_ORIGINS    = var.client_origins
    ENABLE_QUICK_PLAY = var.enable_quick_play
    LIVEKIT_URL       = var.livekit_url
    NODE_ENV          = var.node_env
  }

  secure_parameter_values = {
    CLOUDFLARE_TUNNEL_TOKEN = var.cloudflare_tunnel_token
    LIVEKIT_API_KEY         = var.livekit_api_key
    LIVEKIT_API_SECRET      = var.livekit_api_secret
    METRICS_TOKEN           = var.metrics_token
    RECONNECT_SECRET        = var.reconnect_secret
  }
}

resource "aws_ecr_repository" "game_server" {
  name                 = "osmosis/game-server"
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = false
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_kms_key" "ssm" {
  description             = "Encryption key for Osmosis production secrets"
  deletion_window_in_days = 30
  enable_key_rotation     = false

  tags = local.common_tags
}

resource "aws_kms_alias" "ssm" {
  name          = "alias/osmosis-prod-key"
  target_key_id = aws_kms_key.ssm.key_id
}

resource "aws_ssm_parameter" "string" {
  for_each = local.string_parameter_values

  name        = "/osmosis/prod/${each.key}"
  description = "Osmosis production configuration: ${each.key}"
  type        = "String"
  tier        = "Standard"
  value       = each.value

  tags = local.common_tags
}

resource "aws_ssm_parameter" "secure" {
  # Keep the instance keys independent of sensitive input values.
  for_each = toset([
    "CLOUDFLARE_TUNNEL_TOKEN",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "METRICS_TOKEN",
    "RECONNECT_SECRET",
  ])

  name        = "/osmosis/prod/${each.key}"
  description = "Encrypted Osmosis production secret: ${each.key}"
  type        = "SecureString"
  tier        = "Standard"
  key_id      = aws_kms_key.ssm.key_id

  # Write-only values are not persisted in Terraform state. Increment the
  # version variable when intentionally rotating any SecureString.
  value_wo         = local.secure_parameter_values[each.key]
  value_wo_version = var.secure_parameter_version

  tags = local.common_tags
}

resource "aws_iam_role" "ec2_runtime" {
  name = "OsmosisEC2RuntimeRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "ec2_runtime" {
  name        = "OsmosisProdRuntimePolicy"
  description = "Allow the Osmosis EC2 server to pull its image and read production parameters."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuthentication"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PullOsmosisGameServer"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ]
        Resource = aws_ecr_repository.game_server.arn
      },
      {
        Sid    = "ReadProductionParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = [
          local.parameter_arn_prefix,
          "${local.parameter_arn_prefix}/*",
        ]
      },
      {
        Sid    = "DenyReadingOtherParameters"
        Effect = "Deny"
        Action = "ssm:GetParameter*"
        NotResource = [
          local.parameter_arn_prefix,
          "${local.parameter_arn_prefix}/*",
        ]
      },
      {
        Sid      = "DecryptProductionSecrets"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.ssm.arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
          StringLike = {
            "kms:EncryptionContext:PARAMETER_ARN" = "${local.parameter_arn_prefix}/*"
          }
        }
      },
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ec2_runtime" {
  role       = aws_iam_role.ec2_runtime.name
  policy_arn = aws_iam_policy.ec2_runtime.arn
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_core" {
  role       = aws_iam_role.ec2_runtime.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_runtime" {
  name = "OsmosisEC2RuntimeRole"
  role = aws_iam_role.ec2_runtime.name

  tags = local.common_tags
}

resource "aws_security_group" "game_server" {
  name        = "osmosis-prod-sg"
  description = "Osmosis production EC2; all public traffic arrives through Cloudflare Tunnel."
  vpc_id      = data.aws_vpc.default.id

  # Intentionally no ingress rules. cloudflared establishes outbound tunnel
  # connections; the game port remains bound to host localhost by Compose.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "osmosis-prod-sg" })
}

resource "aws_instance" "game_server" {
  ami                         = data.aws_ssm_parameter.amazon_linux_2023_ami.value
  instance_type               = "t3.small"
  subnet_id                   = data.aws_subnet.selected.id
  vpc_security_group_ids      = [aws_security_group.game_server.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_runtime.name
  user_data = templatefile("${path.module}/bootstrap.sh.tftpl", {
    aws_region                = var.aws_region
    cloudflare_parameter_name = "/osmosis/prod/CLOUDFLARE_TUNNEL_TOKEN"
  })

  root_block_device {
    volume_size           = 30
    volume_type           = "gp3"
    encrypted             = false
    delete_on_termination = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.ec2_runtime,
    aws_iam_role_policy_attachment.ec2_ssm_core,
    aws_ssm_parameter.secure["CLOUDFLARE_TUNNEL_TOKEN"],
  ]

  tags = merge(local.common_tags, { Name = "osmosis-prod-server" })
}

resource "aws_iam_role" "github_deploy" {
  name = "OsmosisGitHubDeployRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_oidc_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = var.github_actions_subject
        }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "github_ecr_push" {
  name        = "OsmosisGitHubECRPushPolicy"
  description = "Allow GitHub Actions to push Osmosis server images to ECR."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PushOsmosisImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.game_server.arn
      },
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "github_ssm_deploy" {
  name        = "OsmosisGitHubSSMDeployPolicy"
  description = "Allow GitHub Actions to deploy only to the Osmosis EC2 instance."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowDeploymentCommand"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-RunShellScript",
          aws_instance.game_server.arn,
        ]
      },
      {
        Sid    = "AllowCommandStatusCheck"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
        ]
        Resource = "*"
      },
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "github_ecr_push" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_ecr_push.arn
}

resource "aws_iam_role_policy_attachment" "github_ssm_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_ssm_deploy.arn
}
