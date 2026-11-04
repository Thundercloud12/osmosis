# Historical IAM policy templates

These JSON files are retained as historical policy examples only. Do not apply
them as a second deployment path. The active production Terraform root is
[`../../infra/`](../../infra/README.md): it creates the runtime role and the
application deployment workflow uses the already bootstrapped
`osmosis-github-deploy-role`.

The ECR repository in the current design is named `osmosis`. Runtime role
permissions, including SSM parameter reads, KMS decrypt conditions and host
metrics, are declared in `infra/iam.tf`; the EC2 permissions boundary is an
existing bootstrap resource and is not created here. If the example JSON
policies are ever reused for another environment, review each action/resource
against that environment before attaching them.
