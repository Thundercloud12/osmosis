resource "aws_instance" "game_server" {
  ami                         = data.aws_ami.ubuntu_2404_amd64.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnet.selected.id
  vpc_security_group_ids      = [aws_security_group.game_server.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2_runtime.name
  associate_public_ip_address = false
  monitoring                  = var.enable_detailed_monitoring

  user_data = templatefile("${path.module}/templates/ec2-user-data.sh.tftpl", {
    aws_region        = var.aws_region
    game_hostname     = local.game_hostname
    compose_file_b64  = local.compose_file_b64
    deploy_script_b64 = local.deploy_script_b64
  })
  # cloud-init runs bootstrap user data once per instance; replace the host
  # when bootstrap changes so the new script is actually executed.
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size           = var.root_volume_size_gib
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  lifecycle {
    precondition {
      condition     = data.aws_subnet.selected.vpc_id == data.aws_vpc.default.id
      error_message = "subnet_id must identify an existing subnet in the default VPC; this configuration never manages the VPC or subnet."
    }
  }

  tags = merge(local.common_tags, { Name = "osmosis-production-game-server" })
}

resource "aws_cloudwatch_metric_alarm" "instance_status" {
  alarm_name          = "osmosis-production-instance-status"
  alarm_description   = "EC2 instance status check failed. Check the instance and host logs."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { InstanceId = aws_instance.game_server.id }
  tags       = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "system_status" {
  alarm_name          = "osmosis-production-system-status"
  alarm_description   = "EC2 system status check failed for ten minutes. Supported instances use AWS simplified automatic recovery by default."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { InstanceId = aws_instance.game_server.id }
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "osmosis-production-cpu-high"
  alarm_description   = "EC2 CPU utilization exceeded 85% for ten minutes."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { InstanceId = aws_instance.game_server.id }
  tags       = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "osmosis-production-memory-high"
  alarm_description   = "Host memory usage exceeded 90% for ten minutes."
  namespace           = "Osmosis/EC2"
  metric_name         = "mem_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 90
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { InstanceId = aws_instance.game_server.id }
  tags       = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "disk" {
  alarm_name          = "osmosis-production-disk-high"
  alarm_description   = "Root disk usage exceeded 85% for ten minutes."
  namespace           = "Osmosis/EC2"
  metric_name         = "disk_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { InstanceId = aws_instance.game_server.id, path = "/", fstype = "ext4" }
  tags       = local.common_tags
}
