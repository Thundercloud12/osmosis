# First EC2 Deployment

This is the single-instance v1 deployment described in `ARCHITECTURE.md`: one
Node/Colyseus game server, a static web build, and the existing LiveKit service.
Cloudflare Tunnel provides the public route to the game server. It does not
persist or recover match state if the game process stops.

## Traffic path

```text
Player browser --HTTPS--> Cloudflare Pages (play.example.com)
Player browser --HTTPS/WSS--> Cloudflare edge --> named Tunnel
                                      --> cloudflared on EC2
                                      --> game-server:2567 on private Docker network
Player browser --WebRTC/WSS--> LiveKit Cloud
```

The web build is static and hosted separately. The game server has no published
host port; only `cloudflared` can reach it on the Docker network. Voice media is
between each browser and LiveKit, not through EC2 or the tunnel.

## Files and secrets

- `deploy/compose.production.yaml` runs only the game server and the tunnel
  connector. It deliberately does not publish ports 2567 or 5173.
- `deploy/production.env.example` is a template. Copy it to
  `deploy/production.env` and keep that file out of Git.
- The Cloudflare Tunnel is remotely managed. Its public hostname route is
  configured in Cloudflare; no local tunnel credentials JSON or ingress file is
  needed.

Keep `RECONNECT_SECRET`, `METRICS_TOKEN`, LiveKit credentials and the tunnel
token private. Keep `ENABLE_QUICK_PLAY=false` until the production abuse-report
review process is ready. Test-room modes are always disabled by this Compose
file.

## 1. Create the Cloudflare routes

You need a Cloudflare account and a domain whose DNS is managed by Cloudflare.
Use these example names consistently below, replacing `example.com` with your
domain:

- `play.example.com` — Cloudflare Pages static game client.
- `game.example.com` — named Cloudflare Tunnel route to the Colyseus server.

In Cloudflare Zero Trust, create a named tunnel such as `osmosis-production`,
choose Docker as the connector, and copy its tunnel token into
`deploy/production.env` later. Add a published-application route:

```text
Hostname: game.example.com
Service:  http://game-server:2567
```

The `game-server` name resolves because the connector and application share the
Compose network. Do not create an A record pointing `game.example.com` at the
EC2 public address; the named tunnel manages that hostname's DNS route.

## 2. Create the static web app

In Cloudflare Pages, create a Git-connected project for the repository and set:

```text
Root directory: /
Build command: pnpm install --frozen-lockfile && pnpm --filter @osmosis/web build
Build output directory: apps/web/dist
Node version: 22.12.0 (NODE_VERSION environment variable)
SKIP_DEPENDENCY_INSTALL: 1
VITE_GAME_SERVER_URL: https://game.example.com
```

Connect `play.example.com` as the Pages custom domain. The Pages environment
variable `VITE_GAME_SERVER_URL` is baked into the JavaScript at build time. The
Colyseus client converts the HTTPS endpoint to WSS for the game socket.

Set the production web origin in `CLIENT_ORIGINS` below to the exact origin,
including `https://`. If you also want to test using the `pages.dev` hostname,
add that exact origin as a comma-separated value.

## 3. Create the EC2 instance

For an initial closed beta, use Ubuntu Server 24.04 LTS, x86_64, `t3.medium`
(2 vCPU and 4 GiB RAM), and a 30 GiB gp3 root volume. This gives Docker builds
and the Node process more headroom than a micro instance; it is a starting size,
not a measured capacity guarantee. Run the existing stress tester against the
deployed server before deciding how many simultaneous rooms it can support.

Create an EC2 security group with these rules:

| Direction | Protocol / port | Source / destination |
|---|---|---|
| Inbound | TCP 22 (SSH) | Your current public IP only |
| Inbound | None for 80, 443, 2567 or 5173 | — |
| Outbound | Allow required internet egress | Default outbound rule is sufficient |

The tunnel connector establishes outbound connections to Cloudflare, so the
game ports do not need inbound security-group rules. The browsers connect to
LiveKit directly, so LiveKit's WebRTC ports do not need to be opened on EC2.

Create an EC2 IAM role trusted by `ec2.amazonaws.com`, attach the AWS-managed
`AmazonSSMManagedInstanceCore` policy, and attach that role to this instance.
The AWS Ubuntu 24.04 AMI normally includes SSM Agent; confirm the instance shows
as an Online managed node in Systems Manager before configuring CI.

Create or select an SSH key pair and save the private key somewhere safe on your
computer. Launch the instance with a public IPv4 address for SSH administration.
The public IPv4 address is not used for player traffic.

## 4. Install Docker and check out the repository

From your computer, connect using the downloaded key (replace the key path and
address):

```sh
chmod 400 osmosis-ec2.pem
ssh -i osmosis-ec2.pem ubuntu@EC2_PUBLIC_IPV4
```

On the EC2 instance, install Docker Engine, Compose and Git using Docker's
official Ubuntu apt repository:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run hello-world
```

Check out the deployed source under `/opt/osmosis`:

```sh
sudo mkdir -p /opt/osmosis
sudo chown "$USER":"$USER" /opt/osmosis
cd /opt/osmosis
git clone https://github.com/Thundercloud12/osmosis.git .
```

If the GitHub repository is private, configure a read-only deploy key for the
repository before running `git clone`; do not put a GitHub access token in the
clone URL or in the Compose environment file.

## 5. Set production environment values

On EC2:

```sh
cd /opt/osmosis
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
openssl rand -hex 32
openssl rand -hex 32
nano deploy/production.env
```

Paste the first generated value as `RECONNECT_SECRET`, the second as
`METRICS_TOKEN`, then fill in:

- `CLIENT_ORIGINS=https://play.example.com`
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from the existing
  LiveKit Cloud project (or leave all three blank to intentionally disable
  voice)
- `CLOUDFLARE_TUNNEL_TOKEN` from the named tunnel connector setup
- `ENABLE_QUICK_PLAY=false`

Do not regenerate `RECONNECT_SECRET` during routine deployments. Do not commit
`deploy/production.env` or paste its contents into logs or chat.

## Production Quick Play gate

Keep Quick Play disabled for this first deployment. The join limit uses
Colyseus `context.ip`; its installed resolver checks `X-Real-IP` and
`X-Forwarded-For`, but not Cloudflare's `CF-Connecting-IP`. Before enabling
public Quick Play, verify the IP headers arriving through the tunnel and make
sure a caller cannot spoof the address used by the limiter. Cloudflare
recommends `CF-Connecting-IP` as the canonical visitor-IP header.

## 6. Start the application

After the Cloudflare route and environment file are ready, run on EC2:

```sh
cd /opt/osmosis
sudo docker compose \
  --env-file deploy/production.env \
  -f deploy/compose.production.yaml \
  up -d --build
```

Check container status and startup logs:

```sh
sudo docker compose --env-file deploy/production.env -f deploy/compose.production.yaml ps
sudo docker compose --env-file deploy/production.env -f deploy/compose.production.yaml logs --tail=100 game-server cloudflared
curl -fsS https://game.example.com/health
```

The health response should report `status: "ok"`. `voiceConfigured` should be
true if LiveKit credentials were supplied. Visit `https://play.example.com`,
create a private room and join from a second browser before sharing the link.

## 7. Updating the deployment

Only deploy when no match is active: rebuilding/restarting the single game
server clears all live rooms and matchmaking queues.

```sh
cd /opt/osmosis
git fetch origin main --prune
git checkout --force --detach origin/main
sudo docker compose \
  --env-file deploy/production.env \
  -f deploy/compose.production.yaml \
  up -d --build
```

Web-only changes are rebuilt and published by the Pages Git integration. A
game-server restart still ends active matches; the reconnect reservation cannot
restore a room after the process has been replaced.

## 8. Automatic GitHub deployment

`.github/workflows/deploy-ec2.yml` runs the workspace typecheck, tests and build
on relevant pull requests and server/shared/production-infrastructure pushes to
`main`. Only a successful push to `main` deploys. Frontend-only changes are
published by Pages and do not restart the game server. The workflow uses
GitHub's OIDC identity to assume a narrowly
scoped AWS role, then sends the deployment command through AWS Systems Manager
Run Command. No SSH port is opened to GitHub and no long-lived AWS access key is
stored in GitHub. `workflow_dispatch` can redeploy the selected `main` commit.
Pull requests run checks on GitHub-hosted runners and never access EC2. Cloudflare
Pages separately publishes the web build from its Git integration.

### Set up AWS permissions for GitHub Actions

1. In AWS IAM, add an OpenID Connect identity provider with URL
   `https://token.actions.githubusercontent.com` and audience
   `sts.amazonaws.com`.
2. Create an IAM role named `OsmosisGitHubDeployRole` for Web Identity using
   that provider. Use `deploy/iam/github-deploy-trust-policy.json` as its trust
   policy. Replace `ACCOUNT_ID` with your AWS account ID. The `sub` condition
   limits role assumption to pushes and manual runs from this repository's
   `main` branch.
3. Attach a customer-managed permissions policy based on
   `deploy/iam/github-deploy-permissions-policy.json`. Replace `REGION`,
   `ACCOUNT_ID`, and `INSTANCE_ID` with the selected AWS region, account ID,
   and EC2 instance ID. It permits sending `AWS-RunShellScript` only to this
   instance and reading the resulting command status.
4. In GitHub repository Settings > Secrets and variables > Actions > Variables,
   add:

   | Variable | Value |
   |---|---|
   | `AWS_REGION` | EC2 region, for example `ap-south-1` |
   | `AWS_DEPLOY_ROLE_ARN` | ARN of `OsmosisGitHubDeployRole` |
   | `EC2_INSTANCE_ID` | EC2 instance ID, such as `i-0123456789abcdef0` |

The EC2 instance needs the `AmazonSSMManagedInstanceCore` role from the earlier
step, and must be Online in Systems Manager. Default outbound access allows the
SSM Agent to reach AWS Systems Manager. If the GitHub repository is private,
EC2 also needs a read-only GitHub deploy key so `git fetch origin main` works.

**Each successful automatic deployment replaces the single in-memory game
server and ends any active matches and matchmaking queues.** Merge or manually
dispatch a deployment only while no match is running. The pipeline does not
provide zero-downtime game-server replacement or match migration.
