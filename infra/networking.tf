resource "aws_security_group" "game_server" {
  name        = "osmosis-production-game-server"
  description = "Public TLS for Osmosis through Caddy; Colyseus remains localhost-only."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Caddy HTTPS and secure WebSockets"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Caddy HTTP redirect and ACME HTTP-01 challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTPS for SSM, ECR, package updates, and certificate issuance"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP for Ubuntu package repositories and ACME redirects"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "VPC DNS resolution"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  egress {
    description = "TCP VPC DNS resolution"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  tags = merge(local.common_tags, { Name = "osmosis-production-game-server" })
}

resource "aws_eip" "game_server" {
  domain = "vpc"

  tags = merge(local.common_tags, { Name = "osmosis-production-game-server" })
}

resource "aws_eip_association" "game_server" {
  allocation_id = aws_eip.game_server.id
  instance_id   = aws_instance.game_server.id
}
