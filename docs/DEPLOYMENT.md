# Production deployment

The production deployment has one direct EC2 Colyseus origin in `ap-south-1`.
The Cloudflare Tunnel and Cloudflare HTTP proxy are not used for game traffic.
The browser connects directly to the DNS-only backend hostname, while Caddy on
EC2 provides TLS and reverse proxies to the local Colyseus port.

```text
Browser --HTTPS/WSS--> game.keerthanpoojary.tech (DNS-only A record)
                    --> EC2 Elastic IP:443 --> Caddy --> 127.0.0.1:2567
Browser --WebRTC/WSS--> configured LiveKit service
Frontend static files --> existing Cloudflare static frontend
```

The endpoint exposes the EC2 public IP and does not receive Cloudflare proxy
WAF or proxy DDoS protections. The EC2 security group admits TCP 80 and 443;
port 22 and Colyseus port 2567 are closed publicly. Use SSM Session Manager for
administration. LiveKit media networking stays separate from this endpoint.

## Source of truth and resources

`infra/` is the only active Terraform root. `deploy/terraform/` is a deprecated
historical root; do not initialize or apply it. The active root uses the
existing default VPC and subnet, S3 state bucket, GitHub OIDC provider/roles,
and runtime permissions boundary. It does not create, manage, or delete those
bootstrap resources or the manually provisioned SSM values.

Terraform provisions one Ubuntu 24.04 x86_64 `t3.medium` EC2 instance with an
encrypted 30 GiB gp3 root volume, one Elastic IP, an Osmosis security group, the
`osmosis` ECR repository, a least-privilege EC2 role/profile, Caddy and Docker
bootstrap, and CloudWatch alarms/host metrics. See [infra/README.md](../infra/README.md)
for the exact workflow, variables, cost estimate, recovery, and teardown steps.

## Frontend and backend configuration

The production Vite setting is `VITE_GAME_SERVER_URL=https://game.keerthanpoojary.tech`.
It is public build-time configuration, not a secret. The Colyseus SDK uses the
HTTPS base and upgrades room connections to WSS; the browser also calls the
voice-token endpoint over HTTPS. The frontend must rebuild after this
value is set.

Set `/osmosis/prod/CLIENT_ORIGINS` to the exact frontend origin,
`https://osmosis.keerthanpoojary.tech`, then redeploy the backend. The other six
runtime values are fetched by EC2 from SSM when each immutable image is
started. SecureString values are never passed to GitHub or Terraform.

The existing production Compose file runs only the game server, sets
`ENABLE_TEST_ROOM_MODES=true`, and publishes `127.0.0.1:2567:2567`. Caddy
proxies HTTPS/WSS to that local address. The server listens on
`0.0.0.0:2567` inside the container. Production test rooms remain enabled for
current playtesting; they are not access controlled.

## Infrastructure workflow

1. PRs run Terraform format, backend-free initialization, and validation. They
   receive neither cloud credentials nor OIDC permissions.
2. A maintainer manually dispatches `Terraform infrastructure` from `main`.
   The workflow assumes the existing read-only Terraform Plan role through
   OIDC, creates a saved plan, and uploads the plan, human-readable rendering,
   and commit marker to the private S3 prefix
   `production/plans/<workflow-run-id>/`.
3. Review `terraform-plan.txt` in the AWS console under the existing private
   state bucket. Do not copy the plan into a public issue, PR comment, or
   GitHub Actions artifact.
4. From GitHub Actions, manually run **Apply production Terraform plan** on
   `main` and enter the successful plan run ID. The workflow verifies that the
   run belongs to the current main commit, downloads and applies that exact
   plan using the separate Terraform Apply role, then deletes its current S3
   objects. The private S3 plan prefix has one-day lifecycle expiration for
   current and noncurrent versions, plus expired delete-marker cleanup.

Both the credentialed plan and apply require a maintainer to manually dispatch
their respective workflows from `main`. PR validation is automatic but has no
cloud credentials and cannot plan or modify infrastructure. The apply does not
reuse the application deployment role. Serialize and review all changes to
Terraform, IAM and workflow code.

## Application deployment workflow

`.github/workflows/deploy.yml` runs the workspace typecheck, tests and build on
backend/shared-code PRs. On successful pushes to `main` that touch a listed
backend/deployment path, it assumes the dedicated application deployment role
using OIDC, builds the Docker `server` target on the GitHub runner, and pushes
a unique immutable tag to ECR `osmosis`. The deploy job skips until the
`EC2_INSTANCE_ID` Actions variable is set. After the first infrastructure
apply, set that variable and manually dispatch the app workflow for the initial
release; later relevant pushes deploy automatically. It invokes AWS Systems
Manager Run Command on the configured instance.

The EC2 script retrieves the seven required `/osmosis/prod/*` parameters using
the instance role, writes a root-only Compose env file, pulls the selected
image and waits for the application health check. If local health fails, it
restores the prior image and environment. The workflow then checks the public
HTTPS `/health` endpoint. No repository checkout or AWS key is present on EC2.

For rollback, run the application workflow manually on `main` with a previous
immutable ECR tag in `rollback_image_tag`. ECR retains the 20 most recently
pushed images. A deployment restarts the single in-memory game server and
interrupts active matches.

## Live first-deployment tasks

No Terraform apply or live infrastructure changes are part of this repository
implementation. Before a first plan, confirm the scoped Cloudflare token
permissions and complete the S3 plan-retention rule listed in
[infra/BOOTSTRAP_REMAINING.md](../infra/BOOTSTRAP_REMAINING.md).
After applying, wait for cloud-init to finish and EC2 to appear as an online
SSM managed node before starting the application deployment. Set the `EC2_INSTANCE_ID`
Actions variable from Terraform output, configure the frontend build variable,
and check `https://game.keerthanpoojary.tech/health` before testing a real
browser WebSocket match and LiveKit voice.
