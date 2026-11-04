resource "aws_iam_role" "ec2_runtime" {
  name                 = "osmosis-ec2-runtime"
  permissions_boundary = var.runtime_permissions_boundary_arn

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

resource "aws_iam_role_policy" "ec2_runtime" {
  name = "osmosis-ec2-runtime-access"
  role = aws_iam_role.ec2_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuthorization"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PullOsmosisImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = local.ecr_repository_arn
      },
      {
        Sid    = "ReadOsmosisProductionParameters"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = [for key in [
          "CLIENT_ORIGINS",
          "LIVEKIT_URL",
          "LIVEKIT_API_KEY",
          "LIVEKIT_API_SECRET",
          "RECONNECT_SECRET",
          "METRICS_TOKEN",
          "ENABLE_QUICK_PLAY",
        ] : "${local.parameter_arn_prefix}/${key}"]
      },
      {
        Sid    = "DecryptOsmosisSecureParameters"
        Effect = "Allow"
        Action = "kms:Decrypt"
        # AWS-managed alias/aws/ssm is account/region specific and its key ID
        # is not a Terraform-owned resource. These conditions constrain the
        # wildcard to SSM decryption for this app's parameter path only.
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
          StringLike = {
            "kms:EncryptionContext:PARAMETER_ARN" = "${local.parameter_arn_prefix}/*"
          }
        }
      },
      {
        Sid      = "PublishOsmosisHostMetrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "Osmosis/EC2" }
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_runtime.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_runtime" {
  name = "osmosis-ec2-runtime"
  role = aws_iam_role.ec2_runtime.name

  tags = local.common_tags
}
