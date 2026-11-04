# Production gaps

**Updated:** 2026-11-04

This list describes the remaining work for Osmosis's selected single-instance
production design: static frontend on Cloudflare, one direct EC2 backend,
DNS-only Cloudflare record, Caddy TLS, and external LiveKit. Cloudflare Tunnel,
proxying, load balancers, Kubernetes, and API Gateway are not part of the
selected game traffic path.

## Current deployment state

The production IaC and workflow code is now in `infra/` and `.github/workflows/`.
It has not been applied. Read-only AWS inspection on 2026-11-03 found no
Project=osmosis EC2 instance, Elastic IP, `osmosis` ECR repository, or matching
security group in `ap-south-1`. The backend is therefore not provisioned by
this configuration yet. The SSM parameters and IaC bootstrap (state bucket,
OIDC provider, Plan/Apply roles, and runtime permissions boundary) already
exist. No live Cloudflare resource was changed or checked through the API.

The required repository variables and `CLOUDFLARE_API_TOKEN` secret are now
present. The token's permissions still need confirmation, and `EC2_INSTANCE_ID`
is added after Terraform creates EC2. The private S3 plan prefix now has a
verified one-day lifecycle rule. The remaining setup is in
[infra/BOOTSTRAP_REMAINING.md](../infra/BOOTSTRAP_REMAINING.md).

## Remaining gaps

| Priority | Gap | Closure |
|---|---|---|
| Blocker | First infrastructure deployment has not been applied | Manually create and inspect a Plan-role plan, then manually dispatch Apply. Do not proceed if any existing resource would be replaced or deleted unexpectedly. |
| High | Cloudflare token permissions and live provider refresh have not been verified | The repository secret and DNS variables are present. Confirm the token is limited to Zone Read and DNS Edit for the configured zone, then use the manually dispatched plan to verify provider access. |
| Blocker | Terraform IAM coverage has not been proven by a GitHub OIDC plan | Existing Plan/Apply inline policies were inspected and cover the resource graph's expected AWS operations. Resolve only exact denied actions reported by the first plan; do not broaden roles. |
| High | No high availability | One EC2 instance in one AZ means host/AZ failure takes the game offline. Keep the low-cost v1 design, verify recovery from Terraform, and consider multi-instance coordination only when traffic warrants the added architecture. |
| High | Game and matchmaking state live in process memory | Restart, deployment or crash clears matches and queues. Schedule deployments between matches and retain the prior immutable image for rollback. |
| High | Direct origin has no Cloudflare WAF/proxy protection | DNS-only is required for the latency target and reveals the origin IP. The security group, Caddy, and app are the boundary; add request abuse controls and an incident procedure if public traffic grows. |
| High | Capacity and fairness under representative load remain unverified | Run a real 2v2 and later 5v5 playtest after deployment. Observe CPU, memory, disk, event-loop delay, Colyseus RTT, disconnect/reconnect behavior and LiveKit independently. A `t3.medium` is an initial size, not a capacity guarantee. |
| Medium | CloudWatch alarms have no notification destination | The instance status, CPU, memory and disk alarms will be visible in CloudWatch. Add SNS/email only if alert delivery is needed and budget for its usage. |
| Medium | Application logs remain on the instance | Docker logs have bounded local rotation; CloudWatch Agent ships memory and disk metrics, not container logs. A lost/replaced root disk loses local logs. Add centralized log forwarding if post-incident history becomes necessary. |
| Medium | T3 credit behavior can affect cost/performance | Monitor CPU credit balance and CPU. Sustained use above the T3 baseline can cause surplus-credit charges in Unlimited mode or throttling in Standard mode; choose based on observed gameplay load. |
| Medium | LiveKit is outside this AWS deployment | Keep its signaling/media endpoint, UDP/TURN reachability, credentials, availability, and provider costs verified separately. It is not routed through Caddy or the Colyseus port. |
| Medium | Main branch and Cloudflare frontend settings are external controls | Protect `main`, allow only the maintainer to merge, and confirm production uses `VITE_GAME_SERVER_URL=https://game.keerthanpoojary.tech`. Frontend configuration is public, and dashboard values can override the checked-in `.env.production`. |
| Launch gate | Production test rooms are on | `ENABLE_TEST_ROOM_MODES=true` is retained for testing. Test room modes are public and are not an access-control mechanism. Disable or guard them before opening broad public matchmaking. |

## Before calling this production-ready

1. Confirm the Cloudflare token scope.
2. Review a successful infrastructure plan and resolve any exact IAM denies.
3. Apply from the manual `main` workflow; wait for cloud-init and SSM to finish.
4. Deploy an immutable server image and verify HTTPS health, browser matchmaking,
   a 2v2 playtest, and LiveKit audio independently.
5. Set the exact frontend origin in SSM, rebuild the frontend, and confirm browser CORS
   and WebSocket behavior against `game.<domain>`.
6. Set an AWS budget and decide whether CloudWatch alarms should send
   notifications. Review direct-origin security and expected traffic capacity.
