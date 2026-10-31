# Production deployment

Osmosis v1 runs one Colyseus server on EC2. GitHub Actions builds the server
image, pushes it to ECR, and asks EC2 to deploy it through Systems Manager.
Cloudflare Tunnel runs separately as a systemd service on EC2.

```text
Browser --HTTPS/WSS--> Cloudflare edge --> named Tunnel
                                      --> cloudflared systemd on EC2
                                      --> 127.0.0.1:2567 on EC2
                                      --> Docker-published Colyseus port
Browser --WebRTC/WSS--> LiveKit Cloud
```

Compose publishes the game port only on EC2 loopback. The Node process listens
on `0.0.0.0:2567` inside its container. This lets Docker forward the host's
`127.0.0.1:2567` connection to the container without opening port 2567 to the
internet.

## AWS resources

Keep EC2, ECR, and Parameter Store in `us-east-1`.

- ECR private repository: `osmosis/game-server`, with immutable image tags.
- EC2 instance: Amazon Linux 2023 x86_64, `t3.small` for an initial low-load
  deployment, 20 GiB gp3 disk, and a public subnet with outbound access.
- EC2 security group: no inbound game ports. If SSH is enabled for
  administration, restrict port 22 to the administrator's IP. The tunnel and
  SSM Agent use outbound connections.
- EC2 instance role: `AmazonSSMManagedInstanceCore`, ECR pull permissions, and
  `ssm:GetParameters` for the application parameters listed below. If those
  parameters use a customer-managed KMS key, allow this role `kms:Decrypt` on
  that key as well.
- GitHub deploy role: GitHub OIDC trust restricted to
  `Thundercloud12/osmosis` on `main`; permissions to push to the ECR repository
  and send an SSM Run Command to this EC2 instance.

The EC2 host must have Docker Engine, AWS CLI v2, Python 3, systemd, and an
online SSM Agent. If Docker is stopped, the workflow starts it. If Docker
Compose is missing, the workflow installs the official v5.6.1 CLI plugin and
verifies its SHA-256 checksum before use (`curl` and `sha256sum` are needed for
that installation). The host does not need a Git checkout, a GitHub deploy
key, or a local production environment file.

## Parameter Store

The deployment script requests only these names under `/osmosis/prod/` and
passes the returned values to Compose at startup:

| Parameter | Type | Required/value |
|---|---|---|
| `/osmosis/prod/CLIENT_ORIGINS` | String | Required. Exact browser origin, e.g. `https://play.example.com`. |
| `/osmosis/prod/RECONNECT_SECRET` | SecureString | Required. Persistent random secret; do not rotate during routine deployments. |
| `/osmosis/prod/METRICS_TOKEN` | SecureString | Required. A different random token. |
| `/osmosis/prod/ENABLE_QUICK_PLAY` | String | Required. `false` until the production abuse-report process is ready. |
| `/osmosis/prod/LIVEKIT_URL` | SecureString | Optional; provide with both LiveKit credentials or omit all three to disable voice. |
| `/osmosis/prod/LIVEKIT_API_KEY` | SecureString | Optional with the other two LiveKit values. |
| `/osmosis/prod/LIVEKIT_API_SECRET` | SecureString | Optional with the other two LiveKit values. |

`CLOUDFLARE_TUNNEL_TOKEN` is not part of the application deployment. Keep the
existing Parameter Store copy if desired, and keep the systemd connector's
working token at `/etc/cloudflared/token`. The GitHub deployment script does
not request or pass that token to Docker Compose.

`PORT=2567`, `NODE_ENV=production`, and `ENABLE_TEST_ROOM_MODES=false` are set
by `deploy/compose.production.yaml`. The workflow supplies `GAME_SERVER_IMAGE`
from the ECR URI and the commit/run-specific image tag.

## Cloudflare and frontend

Run `cloudflared` as a systemd service on EC2 and confirm the tunnel is
Healthy. In the tunnel's published application route, configure:

```text
Hostname: game.example.com
Service:  http://localhost:2567
```

Cloudflare Pages hosts the static client separately. Set its production
`VITE_GAME_SERVER_URL` build variable to `https://game.example.com`, and set
`CLIENT_ORIGINS` to the exact Pages origin, such as
`https://play.example.com`. Add any additional browser origin as a
comma-separated value. The Colyseus SDK upgrades the secure endpoint to WSS.

## GitHub Actions variables

In the repository's **Settings → Secrets and variables → Actions → Variables**,
set:

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | ARN of the GitHub OIDC deploy role. |
| `AWS_REGION` | `us-east-1` |
| `EC2_INSTANCE_ID` | ID of the production EC2 instance. |
| `ECR_REPOSITORY` | `osmosis/game-server` |

No long-lived AWS access key or application secret belongs in GitHub Actions.
The workflow uses OIDC and reads app secrets on EC2 through its instance role.

## Deployment and verification

A successful push to `main` runs typecheck, tests, and the workspace build,
then builds the server image on a GitHub-hosted runner. The workflow pushes the
image to ECR and invokes SSM Run Command. EC2 fetches the selected Parameter
Store values, pulls the image, and runs:

```text
docker compose pull game-server
docker compose up -d --no-build --wait
```

The deployment replaces the single in-memory game server and ends active
matches and matchmaking queues. Deploy only when no match is in progress.

After a successful deployment, check the health endpoint from EC2:

```sh
curl -fsS http://127.0.0.1:2567/health
```

Then check `https://game.example.com/health` through Cloudflare and connect to
the game from `https://play.example.com`. A healthy tunnel confirms its
connection to Cloudflare, while the health endpoint confirms that the local
Colyseus service is reachable.
