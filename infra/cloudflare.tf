resource "cloudflare_dns_record" "game" {
  zone_id = var.cloudflare_zone_id
  name    = local.game_hostname
  type    = "A"
  content = aws_eip.game_server.public_ip
  ttl     = 300
  proxied = false
  comment = "Osmosis direct game endpoint; TLS is terminated by Caddy on EC2."
}
