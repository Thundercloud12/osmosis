# Osmosis production infrastructure

This Terraform root describes one direct-path production game server in AWS `ap-south-1`. It deliberately does not manage the default VPC, subnet, Terraform bootstrap bucket, OIDC provider, Terraform Plan/Apply roles, Cloudflare zone, or application secrets.

## Architecture and resources

```text
Browser ── HTTPS/WSS ──> game.<domain> (Cloudflare DNS only)
                                │
                                ▼
                         EC2 Elastic IP
                         Caddy :443/:80
                                │ localhost
                                ▼
                     Docker Compose :2567
                     Colyseus game server
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
          ECR image                         SSM Parameter Store
       GitHub Actions                         /osmosis/prod/*

Voice remains on the configured external LiveKit service.
```

Terraform manages:

| Resource | Configuration |
| --- | --- |
| EC2 | Ubuntu Server 24.04 LTS x86_64, configurable `t3.medium`, 30 GiB encrypted gp3 root disk, IMDSv2 required, existing subnet in the existing default VPC |
| Stable endpoint | One Elastic IP associated with the instance; Cloudflare DNS-only A record `game.<domain>` |
| Security group | Inbound TCP 80 and 443 only; no public SSH or port 2567; outbound limited to HTTP/HTTPS and VPC DNS |
| Runtime IAM | `osmosis-ec2-runtime`, existing permissions boundary, scoped ECR pull and SSM parameter reads, SSM Agent, CloudWatch host metrics |
| ECR | `osmosis`, immutable tags, scan on push, retain 20 images |
| Host services | Docker Engine/Compose, Caddy TLS reverse proxy, SSM Agent, signed CloudWatch Agent package |
| Monitoring | EC2 system/instance status, CPU, memory, and root-disk CloudWatch alarms; supported instance types use AWS simplified recovery by default; Docker JSON logs rotate at 10 MiB × 3 |

Cloudflare Tunnel is not installed. The Colyseus listener remains on host localhost port 2567 and Cloudflare proxying is disabled for the game record. Caddy obtains and renews TLS certificates; it proxies HTTPS and WebSocket upgrades to the local container. The LiveKit media service is external and needs its own network and cost configuration.

The origin's security boundary is the EC2 security group, host patching, Caddy, and the application. Cloudflare DNS-only mode does not put Cloudflare's HTTP proxy, WAF, or its proxy DDoS controls in front of this endpoint. AWS provides baseline network protections; this single public instance remains exposed to direct-origin traffic and volumetric attacks.

## Prerequisites

- AWS account `066523631927`, region `ap-south-1`, and the existing default VPC. The selected subnet is `subnet-0fbd118cb7d4e59e4` in `ap-south-1b`; it was checked against the existing VPC and is not managed by Terraform.
- Existing private, versioned, AES-256-encrypted S3 state bucket `osmosis-tfstate-sexy2223` in `ap-south-1`. The S3 backend uses native lock files.
- Existing GitHub OIDC provider, `osmosis-terraform-plan-role`, `osmosis-terraform-apply-role`, and `osmosis-ec2-permissions-boundary`. The roles are bootstrap resources and are not created or modified here.
- Existing production SSM parameters. Required names are `/osmosis/prod/CLIENT_ORIGINS`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `RECONNECT_SECRET`, `METRICS_TOKEN`, and `ENABLE_QUICK_PLAY`. Runtime secret values are never Terraform variables or state.
- A Cloudflare API token restricted to this zone with Zone DNS Edit (and the provider-required zone read permission); save it as the GitHub Actions secret `CLOUDFLARE_API_TOKEN`.
- Terraform 1.11 or later for local read-only validation. The committed provider lock file pins provider selections.

Terraform discovers the current Canonical Ubuntu 24.04 x86_64 AMI from AWS. It references the existing SSM key alias `alias/aws/ssm`; it does not create a KMS key or SSM parameter.

## GitHub repository configuration

The repository already has these Actions variables:

| Name | Purpose |
| --- | --- |
| `AWS_REGION` | `ap-south-1` |
| `AWS_TF_PLAN_ROLE_ARN` | Existing read-only Terraform role ARN |
| `AWS_TF_APPLY_ROLE_ARN` | Existing Terraform apply role ARN |
| `AWS_DEPLOY_ROLE` | Separate application deployment role ARN |

Add these repository variables before the first infrastructure plan:

| Name | Value |
| --- | --- |
| `AWS_SUBNET_ID` | `subnet-0fbd118cb7d4e59e4` |
| `GAME_DOMAIN` | Zone apex, currently `keerthanpoojary.tech` (without `game.`) |
| `CLOUDFLARE_ZONE_ID` | Zone ID from the Cloudflare dashboard for that domain |

Add the `CLOUDFLARE_API_TOKEN` Actions secret described above. The Cloudflare token is only passed to trusted `main` plan/apply jobs. Pull-request validation has no OIDC permission and receives no Cloudflare secret.

The application deployment workflow also needs `EC2_INSTANCE_ID`, populated from the Terraform output after the first approved apply. The current main-branch GitHub OIDC trust on each role must remain scoped to `repo:Thundercloud12/osmosis:ref:refs/heads/main`; these workflows do not change IAM trust policies.

## Initialize and validate

For local validation without accessing AWS or Cloudflare:

```sh
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra validate
```

For a read-only remote plan, authenticate using the dedicated Plan role (not root credentials), set `CLOUDFLARE_API_TOKEN`, and provide the GitHub variables as `TF_VAR_*` values or use a local untracked `infra/terraform.tfvars` copied from `terraform.tfvars.example`. Do not put credentials or secret values in that file. In GitHub Actions, PRs run credential-free validation only. A maintainer must manually dispatch the `Terraform infrastructure` workflow from `main` to create a production plan.

## Review and apply infrastructure

1. Open a PR for Terraform changes and wait for the credential-free format/init/validate job.
2. Merge the reviewed changes to `main`. No credentialed plan runs automatically on a push.
3. In Actions, manually run `Terraform infrastructure` from `main`. The Plan role creates a remote-state plan and stores the binary plan, readable rendering, and commit marker under the private S3 prefix `production/plans/<workflow-run-id>/`. The existing Plan role can write only to that prefix; the Apply role can read/delete it. The existing bucket has one-day expiration for current and noncurrent versions under this prefix, plus cleanup for expired delete markers. GitHub Actions artifacts are deliberately not used because this repository is public.
4. Download and review `terraform-plan.txt` from that private S3 prefix. If any resource is replaced or destroyed unexpectedly, stop and correct/import the resource before applying.
5. In Actions, run **Apply production Terraform plan** from the `main` branch and enter that plan run's ID. The workflow verifies the plan is successful, belongs to the current `main` commit, downloads that exact S3 plan, and applies it. After a successful apply it removes the current S3 objects; the one-day lifecycle rule also expires noncurrent versions. This manual dispatch is the approval step. Terraform runs are serialized across plan and apply workflows.

The apply workflow never creates or changes bootstrap IAM roles, the OIDC provider, the state bucket, the default VPC, or its subnet. It does create one production EC2 instance and related app resources. Do not use `terraform apply` until the first plan has been reviewed by the maintainer.

## Application image deployment

After the first infrastructure apply, copy `terraform output -raw ec2_instance_id` into the `EC2_INSTANCE_ID` repository variable. The app deployment job is gated on this variable: before it is set, matching pushes still run CI checks but skip the deploy job. Once set, manually dispatch `CI and EC2 deployment` for the initial release; later pushes to `main` that change a listed backend/deployment path deploy automatically. Set the frontend hosting environment variable `VITE_GAME_SERVER_URL` to the Terraform `game_server_url` output (currently `https://game.keerthanpoojary.tech`). This value is public build-time configuration, not a secret.

The `deploy.yml` workflow runs typecheck, tests, and workspace build, then builds the `server` Docker target for `linux/amd64`, pushes a unique immutable tag to ECR, and sends an SSM command to the tagged EC2 instance using the dedicated application role. EC2 reads the seven required parameters from Parameter Store, writes a root-only Compose env file under `/opt/osmosis/deploy/`, pulls the image, waits for the Compose health check, and rolls back to the previous image automatically if local health fails. The workflow also checks the public HTTPS `/health` endpoint.

For an intentional rollback, manually run `CI and EC2 deployment` on `main` and provide an earlier immutable ECR tag in `rollback_image_tag`. The repository retains the 20 most recent images. If the desired image has expired, rebuild its source commit and deploy the newly produced tag.

After DNS is live, set `/osmosis/prod/CLIENT_ORIGINS` to the exact frontend origin (`https://osmosis.keerthanpoojary.tech`) and rerun the application deployment workflow. Do not set `VITE_GAME_SERVER_URL` to `wss://`: Colyseus takes the HTTPS base URL and negotiates WebSockets; the voice token endpoint also requires HTTPS.

## Cloudflare DNS and TLS

Terraform manages only `game.<GAME_DOMAIN>` as an A record to the EC2 Elastic IP with `proxied = false`. It does not manage unrelated zone settings or records. Keep the record DNS-only so clients reach the EC2 origin directly. Security group TCP 80 is needed for redirects and Caddy's ACME HTTP-01 certificate flow; TCP 443 carries HTTPS and WSS. Caddy proxies to `127.0.0.1:2567`, which is not publicly exposed.

Do not use the existing Tunnel route or orange-cloud proxy for this game endpoint. DNS-only removes Cloudflare's HTTP WAF and reverse proxy protections. Use the AWS security group and application controls as the origin boundary, and monitor direct-origin traffic and AWS costs.

## Expected cost

For a continuously running Linux `t3.medium` in Mumbai, 30 GiB gp3 disk, one public IPv4 address, a few CloudWatch metrics/alarms, and low traffic, budget roughly **US$40–50 per month before data transfer, LiveKit, taxes, and any applicable credits**. The t3.medium is the largest fixed component; gp3 storage and the public IPv4 add a few dollars each monthly. Internet data transfer and high CloudWatch usage can exceed this estimate. Pricing changes by region and date; verify in the [AWS Pricing Calculator](https://calculator.aws/) before applying. AWS bills provisioned gp3 storage by GB-month and public IPv4 addresses hourly; see [EBS pricing](https://aws.amazon.com/ebs/pricing/) and [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/). Detailed EC2 monitoring is off by default. The five configured CloudWatch alarms have no notification channel; add an SNS topic only if you want paid/operational alert delivery.

Use AWS Budgets with an email alert before deploying, and review Cost Explorer monthly. Stop/terminate the instance when the game is not being used if availability is not required; the Elastic IP and persistent EBS volume have separate billing implications while the instance is stopped.

## Recovery and operational notes

- **EC2 recovery:** SSM Session Manager is the intended administrative path, with no inbound SSH rule. AWS simplified automatic recovery is enabled by default for supported instance types, including the selected `t3.medium`; it addresses underlying host failures and preserves the instance identity and Elastic IP. The status alarms expose failures in CloudWatch, but they do not notify anyone. Guest OS or application failures still require operator investigation/reboot/replacement. Docker and Caddy start through systemd after host reboot. Terraform replaces the EC2 instance when bootstrap user data changes, because cloud-init runs that configuration once per instance; review such replacements before applying. Replacing the instance preserves the EIP allocation as long as Terraform state is intact. The root disk is deleted on instance termination; the game server holds no durable match state.
- **Container recovery:** Docker restart policy is `unless-stopped`; Compose has a `/health` check and bounded log rotation. Deployments are immutable and the script retains the previous env file briefly for rollback.
- **Monitoring:** CloudWatch receives 60-second host memory/disk custom metrics; EC2 emits CPU and status metrics. Alarms appear in CloudWatch but no email/SNS notification target is configured.
- **Terraform state:** S3 versioning is enabled and server-side encryption uses AES-256. Native S3 lock files serialize operations. Restrict bucket access and expire plan objects after one day. A state file may contain infrastructure metadata even though application secrets are not managed there. For recovery, stop all Terraform runs, identify the last good S3 object version, preserve a copy, and restore only after reviewing the state serial and infrastructure drift. Do not edit remote state by hand.
- **Secrets:** Parameter Store SecureStrings use the AWS-managed SSM key. GitHub does not receive runtime secret values. Never echo values, include them in plans, or pass them as Terraform input. Rotate values directly in SSM and redeploy.
- **LiveKit:** The current external LiveKit service and its media network remain outside Terraform. WebRTC media ports, public address, capacity, credentials, and provider costs must be managed according to that service's setup; they are not proxied through Caddy or Colyseus.

## Permission troubleshooting

- OIDC `AccessDenied`: verify the workflow runs on `main`, its role variable is the intended role ARN, and that role trust matches `repo:Thundercloud12/osmosis:ref:refs/heads/main`.
- S3 backend access: the relevant role needs list/read/write access to this state key and permission to create, read, and delete the `.tflock` lock object. The bucket is AES-256 encrypted, so no KMS permissions are needed for state.
- Terraform planning: check `ec2:Describe*`, ECR/CloudWatch/IAM read actions required by the resource graph and Cloudflare token permissions limited to the zone. The current read/apply bootstrap policies must be checked against this exact configuration before first apply; see `BOOTSTRAP_REMAINING.md` for the specific review list.
- Apply failures: do not broaden IAM policies to `*` as a quick fix. Record the denied AWS action and resource ARN, compare it to the Terraform address and intended scope, then request only that permission on the appropriate Plan or Apply role.
- Instance deployment: verify EC2 is SSM-managed, the instance profile has ECR and `/osmosis/prod/*` access, the deployment role has `ssm:SendCommand` and `ssm:GetCommandInvocation` scoped to this instance, and the instance can reach AWS APIs over HTTPS.

## Safe teardown

There is no automatic Terraform destroy workflow. Teardown is a deliberate maintainer operation:

1. Announce downtime and stop new game sessions.
2. Back up the current versioned S3 state object and record the outputs.
3. Review `terraform plan -destroy` using the Apply role. Verify it does not include the default VPC, subnet, state bucket, OIDC provider, bootstrap roles, or SSM parameters; these are not Terraform-managed here.
4. Empty the ECR repository only if you intend to delete stored deployment images; `force_delete = false` intentionally prevents accidental image deletion.
5. Apply the reviewed destroy plan using the trusted Apply role.
6. Confirm the EIP, EC2 instance, ECR repository, security group, runtime IAM resources, CloudWatch alarms, and DNS record are gone. Keep the SSM parameters and Terraform bootstrap resources until separately reviewed.

Do not delete the state bucket or Terraform OIDC roles as part of normal application teardown. Destroying the EC2 server removes the live service and its root volume.
