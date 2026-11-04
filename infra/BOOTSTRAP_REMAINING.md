# Remaining bootstrap and first-deployment actions

The initial AWS bootstrap and SSM parameter upload have been performed. The following account and repository setup still needs a human check before a first GitHub plan/apply; this document does not authorize Terraform to make live changes.

## GitHub repository variables and secret

The repository variables `AWS_REGION`, `AWS_SUBNET_ID`, `GAME_DOMAIN`, `CLOUDFLARE_ZONE_ID`, `AWS_TF_PLAN_ROLE_ARN`, `AWS_TF_APPLY_ROLE_ARN`, and `AWS_DEPLOY_ROLE` are present and were checked by name and value. The `CLOUDFLARE_API_TOKEN` repository secret is present; its value was not read. Confirm its Cloudflare permissions are limited to Zone Read and DNS Edit for the configured zone. `GAME_DOMAIN=keerthanpoojary.tech` is the zone apex; Terraform builds the backend hostname `game.keerthanpoojary.tech` from it.

After a reviewed infrastructure apply, add `EC2_INSTANCE_ID` using the `ec2_instance_id` Terraform output. Until then, the application deployment job skips automatically. After setting it, manually dispatch the app workflow for the initial deployment. The frontend host must set `VITE_GAME_SERVER_URL` to the `game_server_url` output and rebuild the static frontend. This Vite setting is public configuration, not a secret.

## One-day lifecycle for saved Terraform plans

The Plan role already has `s3:PutObject` only under `production/plans/*`, and the Apply role has `GetObject`/`DeleteObject` there. The state bucket is versioned and encrypted, so the workflows store the binary and readable plan in this private S3 prefix instead of a GitHub Actions artifact. GitHub documents that anyone with read access to a public repository can access its workflow artifacts, so they are not appropriate for saved plans.

The one-day S3 lifecycle rules are configured on the existing bucket `osmosis-tfstate-sexy2223` and were verified after creation:

- Prefix: `production/plans/` only.
- Expire current plan objects after 1 day.
- Expire noncurrent versions after 1 day and remove expired delete markers.
- Do not change expiration for `production/terraform.tfstate` or its lock file.

The successful Apply workflow deletes the active objects after applying. Lifecycle expiration removes old object versions and plans that were never applied. The rules are scoped away from `production/terraform.tfstate` and its lock file. Preserve the existing state bucket encryption, versioning, and public-access block. This is a one-time bootstrap bucket setting, not managed by the application Terraform root.

## Existing IAM policies: permission review required

The trust policies for the existing Terraform Plan/Apply roles were previously restricted to the `Thundercloud12/osmosis` `main` branch, and the separate `osmosis-github-deploy-role` is used for app deployments. Before the first apply, compare each denied AWS action from an OIDC-backed plan/apply run with these needs. The AWS CLI identity available to the implementation session was the account root user; it was used for read-only inspection only, and no Terraform plan/apply was run with it.

Terraform Apply needs the following scoped operations for this resource graph (many may already be granted by the bootstrap inline policies):

- EC2: describe VPCs/subnets/AMIs/instances/security groups/addresses/route tables; create/run/tag the instance; create/delete/authorize/revoke the Osmosis security group; allocate/associate/release the EIP; and create/update/delete the five CloudWatch alarms.
- IAM: get the existing permissions boundary; create/get/tag/delete only `osmosis-ec2-runtime`; put/delete that role's inline policy; attach/detach `AmazonSSMManagedInstanceCore`; create/get/tag/delete only the `osmosis-ec2-runtime` instance profile; add/remove that role from the profile; and `iam:PassRole` for this runtime role to `ec2.amazonaws.com`.
- ECR: create/describe/tag/delete repository `osmosis`; configure scanning, encryption, immutable tags, and its lifecycle policy. The GitHub app role separately needs ECR image push actions; it does not need `ecr:DescribeImages` for this workflow because rollbacks use a known immutable tag.
- S3 backend: list the existing state bucket; get/put the `production/terraform.tfstate` object; get/put/delete the matching `production/terraform.tfstate.tflock` object; and read bucket versioning. The existing bucket uses AES-256 encryption, not a customer-managed KMS key.
- Cloudflare: the human-managed API token needs only DNS record edit and zone read for the one configured zone. It is not an AWS IAM permission.

Read-only inspection of the actual inline policies found the Terraform Apply role already has the scoped EC2 launch, EIP, security-group, ECR, IAM runtime-role/profile, CloudWatch alarm, and S3 state/lock actions listed above. Its `iam:CreateRole` permission is conditioned on both the exact permissions boundary and `Project=osmosis`, and its `iam:PassRole` is scoped to the runtime role and `ec2.amazonaws.com`. No AWS write-policy expansion was made for this implementation. The Plan role also has the required EC2 description calls, IAM read calls, CloudWatch alarm reads, and S3 state/lock access.

Static comparison of the current AWS inline policy documents against the configured resources found no confirmed missing AWS action for the expected Plan/Apply graph. This is not a live provider plan: although the Cloudflare token secret is now present, its permissions have not been verified and a live Cloudflare refresh/plan has not been run. Resolve any exact `AccessDenied` reported by the first GitHub OIDC plan/apply before retrying. The Plan and Apply policies also contain an SSM read permission for Canonical's public AMI parameter that this configuration no longer uses (AMI discovery uses `ec2:DescribeImages`); it is unnecessary and can be removed during a separately reviewed least-privilege policy cleanup.

The Plan role must remain read-only for AWS infrastructure. It needs describe/read permissions for the above Terraform data sources and managed resources, plus the S3 backend state/lock operations. It must not have EC2, ECR, IAM, CloudWatch, or DNS write permissions. The Cloudflare token is required for provider refresh in a plan, so it is supplied only to the trusted `main` branch plan/apply jobs and never to pull-request validation.

Do not attach broad administrator/read-only managed policies to make the workflow pass. For any `AccessDenied`, capture the action and resource ARN from the log, verify the resource is within this design, then add only that specific missing permission to the correct pre-existing role. Do not change Terraform Apply or Plan roles from application Terraform.

## GitHub safety settings

- Keep the OIDC trust subject restricted to `repo:Thundercloud12/osmosis:ref:refs/heads/main`; do not trust all branches, tags, or pull requests.
- Protect `main` from force pushes and require the available CI checks before merging. Since this is a single-maintainer public repository, ensure only the maintainer can update `main`.
- Production Terraform plans are created only when a maintainer manually dispatches `Terraform infrastructure` from `main`; PR runs perform credential-free validation only. Review the private S3 plan under `production/plans/<run-id>/` before manually dispatching the apply workflow; its run ID must match the current main commit.
- Do not enable secrets for fork pull requests. The validation workflow needs no AWS or Cloudflare credentials.
- Create the scoped Cloudflare token in the Cloudflare dashboard, store it directly as the GitHub secret, and do not paste it into the repository, issue, terminal transcript, or Terraform variables.

## Confirm the pre-existing AWS resources before first plan

The implementation only read-confirmed these bootstrap facts: account `066523631927`, bucket `osmosis-tfstate-sexy2223` in `ap-south-1`, bucket versioning enabled, SSE-S3/AES-256 encryption, default VPC `vpc-0ab70e0e7b97bbe2a`, and subnet `subnet-0fbd118cb7d4e59e4` in `ap-south-1b`. Before the first plan, confirm no manually created EC2 instance, EIP, ECR repository named `osmosis`, matching DNS A record, or same-named runtime role/profile exists. If any does exist, import it into the remote Terraform state only after reviewing ownership and resource attributes. Do not let Terraform create a duplicate or replace it by surprise.

The SSM application parameters were uploaded separately from the local environment file. Terraform intentionally does not manage their values and does not import them into state.

## Items still needed after infrastructure apply

1. Set repository variable `EC2_INSTANCE_ID` from Terraform output.
2. Configure the frontend hosting provider's production `VITE_GAME_SERVER_URL` to the output URL, then rebuild/publish the frontend.
3. Ensure `/osmosis/prod/CLIENT_ORIGINS` exactly matches the deployed frontend HTTPS origin and redeploy the backend.
4. Verify Caddy has obtained a public certificate and test `https://game.<domain>/health` plus a real browser WebSocket match.
5. Decide whether CloudWatch alarms should notify via email/SNS. Alarm resources exist, but no notification channel is provisioned.
6. Set an AWS Budget and monitor internet data transfer, EIP, CloudWatch, ECR, and external LiveKit charges.

No live infrastructure has been applied by this implementation. Review the private S3 plan and bootstrap policy coverage before starting the manual Terraform apply workflow.
