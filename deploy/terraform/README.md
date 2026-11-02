# Osmosis AWS deployment in Mumbai

This Terraform root recreates the observed production stack in `ap-south-1`:

- Amazon Linux 2023 x86_64, `t3.small`, public IPv4, no SSH key, and no inbound security-group rules.
- A 30 GiB `gp3` root disk with delete-on-termination, matching the North Virginia instance.
- ECR `osmosis/game-server`, a regional KMS key, and the existing `/osmosis/prod/*` SSM parameter names.
- The EC2 runtime role and GitHub Actions OIDC deployment role.
- A one-time EC2 bootstrap that installs Docker and `cloudflared`, then joins the existing Cloudflare Tunnel using the SecureString parameter.

The default VPC and subnet are data sources, not Terraform-managed resources. The Cloudflare Tunnel, hostname route, frontend Worker, and GitHub repository variables are also outside this Terraform configuration.

## Inputs

Copy `terraform.tfvars.example` to `terraform.tfvars` and enter the intended production values. The local file is ignored by Git. Terraform does not automatically load a dotenv file; transfer only the correct values into this file. The AWS provider's `value_wo` writes SecureString values without persisting them to Terraform state. Terraform 1.11 or newer is required for write-only values.

The deployed North Virginia parameter values were not read during inventory. Confirm each input from its source before applying. `CLOUDFLARE_TUNNEL_TOKEN` should be the token for the existing tunnel. The new instance retrieves it through its IAM role and installs `cloudflared` as a system service.

After deployment, update the GitHub Actions repository variables to the Terraform outputs:

- `AWS_REGION` from `aws_region`
- `EC2_INSTANCE_ID` from `ec2_instance_id`
- `AWS_ROLE_ARN` from `github_deploy_role_arn`
- `ECR_REPOSITORY` to `osmosis/game-server`

No Terraform apply is performed by this change. Review the plan before applying it. Terraform currently uses its default local state backend; choose and configure a protected remote state backend before relying on this as the long-term source of truth.
