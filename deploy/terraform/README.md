# Osmosis AWS deployment in Mumbai

> **Deprecated — do not run Terraform from this directory.** The production
> source of truth is [`infra/`](../../infra/README.md), which matches the
> current single-instance design, remote state, DNS-only `game` endpoint,
> `osmosis` ECR repository, and GitHub OIDC workflows. This older root is kept
> for historical review and describes a different AMI, instance size, ECR
> name, state model, and resource ownership. Running `terraform apply` here
> can create or change duplicate production resources.

This Terraform root configures one direct-to-EC2 production game server in
`ap-south-1`:

- Amazon Linux 2023 x86_64, `t3.small`, an Elastic IP, no SSH key, and public
  HTTP/HTTPS ingress.
- A 30 GiB gp3 root disk with delete-on-termination.
- ECR `osmosis/game-server`, a regional KMS key, and the `/osmosis/prod/*` SSM
  parameters.
- The EC2 runtime role and GitHub Actions OIDC deployment role.
- A one-time bootstrap that installs Docker, Caddy, and the SSM agent. Caddy
  terminates HTTPS/WSS for `game_hostname` and forwards to
  `127.0.0.1:2567`.

There is no Cloudflare Tunnel connector in this deployment. The production
backend hostname is `osmosis-backend.keerthanpoojary.tech`, served through a
Cloudflare DNS-only A record pointing to the Terraform `game_server_public_ip`
output. Cloudflare continues to host the frontend, but backend game traffic
goes directly to EC2 and its public IP is visible.

The default VPC and subnet are data sources, not Terraform-managed resources.
The Cloudflare DNS record, frontend Worker/Pages build settings, and GitHub
repository variables remain outside this Terraform configuration and must be
kept in sync with the outputs and deployment docs.

## Inputs

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in the intended
production values. The local file is ignored by Git. Terraform does not
automatically load dotenv files. SecureString inputs use the AWS provider's
write-only `value_wo` support and require Terraform 1.11 or newer.

The deployed North Virginia parameter values were not read during the prior
inventory. Confirm the intended application values before applying. This
configuration does not contain or install a Cloudflare Tunnel token.

The security group allows TCP 443 for game traffic and TCP 80 for redirects
and Caddy certificate validation. It does not expose port 2567 or SSH. This
direct DNS-only origin is intentionally public; it does not receive Cloudflare
proxy WAF or proxy DDoS protections.

## Applying safely

Terraform currently uses its default local state backend. Configure protected
remote state with locking and backups before relying on this as the long-term
shared source of truth. Reconcile/import existing AWS resources into that
state first; do not apply a plan that unexpectedly replaces or deletes the
live instance, EIP, security group, IAM roles, ECR repository, or parameters.

The direct-host Terraform edits have not been applied by this repository
change. Inspect the plan before applying. Updating EC2 user data can stop/start
the instance, while user data itself runs only on first boot. The existing
instance's Caddy configuration and any installed Tunnel service need explicit
cutover handling; changing this bootstrap does not update/remove services on an
already running host.

The Elastic IP is billed as a public IPv4 address. The root volume currently
has `encrypted = false`; account-level EBS encryption defaults may affect the
actual volume setting, so verify the live value before deciding how to migrate
it.

## Post-apply configuration

Set the Cloudflare DNS A record `osmosis-backend` to the
`game_server_public_ip` output and leave it DNS-only. Remove the old Tunnel
route/record for that hostname. Build the frontend with
`VITE_GAME_SERVER_URL=https://osmosis-backend.keerthanpoojary.tech` and set
`/osmosis/prod/CLIENT_ORIGINS` to `https://play.keerthanpoojary.tech`.

Set the GitHub Actions repository variables to the Terraform outputs:

- `AWS_REGION` from `aws_region`
- `EC2_INSTANCE_ID` from `ec2_instance_id`
- `AWS_ROLE_ARN` from `github_deploy_role_arn`
- `ECR_REPOSITORY` to `osmosis/game-server`

See [the production deployment guide](../../docs/DEPLOYMENT.md) for parameter
values, frontend configuration, deployment flow, and live cutover notes.
