# Shared WhatsApp hosting

## Decision (1 October 2026)

Use a DigitalOcean Droplet running the shared Node container for the first hosted
pilot. The hosting comparison led to an explicitly authorized 512 MiB DigitalOcean
build/deployment experiment, described below. Keep the app on its
current host and connect the service to Supabase. The same service remains usable
in Cloudflare Containers when a Worker/Durable Object lifecycle wrapper is added.

| Consideration | DigitalOcean Droplet | Cloudflare Containers |
| --- | --- | --- |
| Always-connected accounts | Docker restart policy and ordinary VM process lifecycle | Explicit container lifecycle, restart monitoring and wake-up logic |
| Routing | Start with one shared service; services forward once to the assigned shard when configured | Worker routes to a small fixed pool of Durable Object/container IDs |
| Persistence | Supabase for encrypted sessions and ownership | Supabase for encrypted sessions and ownership; disk ephemeral by default |
| Operations | We maintain VM updates, firewall, TLS ingress and monitoring | Managed platform; we implement container lifecycle and account placement |
| Cost | Basic Regular 2 vCPU / 4 GiB bundled Droplet: USD24/month before extras | Provisioned memory/disk plus active CPU, Worker, Durable Object and traffic charges |

For comparison, one standard-1 Cloudflare container provisioned with 4 GiB RAM and
8 GB disk, continuously running for a 30-day month, costs approximately USD25.70
for memory and USD1.40 for disk after the monthly included allotments. Add the
USD5 Workers Paid plan if not already held, active CPU, Durable Objects, logs and
any chargeable egress. These allowances are account-wide and may already be used.
This is an estimate from documented rates, not a bill forecast. At the same memory
size DigitalOcean provides 2 shared vCPUs versus standard-1's 0.5 vCPU.
An existing Droplet with measured spare capacity could reduce incremental hosting
cost. DigitalOcean App Platform is a separate managed option, with its own pricing
and scaling model; this recommendation refers specifically to Droplets.

Sources checked 1 October 2026:
- https://www.digitalocean.com/pricing/droplets
- https://docs.digitalocean.com/products/droplets/how-to/create/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/containers/concepts/architecture/
- https://developers.cloudflare.com/containers/configuration/scaling-and-routing/

## Existing DigitalOcean project

Read-only API inspection using DIGITALOCEAN_TOKEN from `.env.local` confirmed
project `a5255506-6f88-4e91-b501-f79d7c347d4f` is named `project_acquire`, marked
Production, and had no resources before this deployment. Other Droplets exist in the account,
but none is assigned to this project. They have not been changed or selected for
reuse. A dedicated test host has since been created in the requested project.

## Deployment preparation

Do not connect cloud accounts until the specific production migrations are
explicitly approved and applied, and the local lease integration tests pass. Local `0014` and `0015_whatsapp_shared_sessions.sql` were specifically approved
and applied on 1 October 2026. All nineteen tests passed inside OrbStack, including
the real Postgres lease and 100-account/two-connection tests. The updated local
service restored the linked account without a new QR. Both cloud Supabase migrations were separately approved and applied on
1 October 2026; HTTPS service health returned 200 afterward.

On the chosen host, copy `hosted.env.example` to `.env.hosted` and replace the
placeholders using separate production secrets. Make the file readable only by
the deploy user. Use a Supabase direct or transaction-pooled server connection;
this service no longer requires session-level advisory locks. Confirm connection
limits and trust the database TLS certificate using DATABASE_SSL_CA. Do not put
database credentials in browser-facing settings or images.

The prepared single-service Compose file binds the API to loopback. Supply an
HTTPS reverse proxy or Cloudflare Tunnel before configuring the app's service URL;
retain service bearer authentication. The Compose file does not provision either
kind of ingress, create a Droplet, apply schema, or migrate the local paired device.

After those prerequisites:

```sh
docker compose -f ops/whatsapp/compose.hosted.yml up -d --build
```

The initial 32-account cap and 768 MiB admission threshold are conservative
operational settings, not a measured capacity guarantee. The container limit is
1 GiB; adjust all three limits together after observing real account sync memory,
CPU and event-loop behavior. The 100-account simulation checks coordination, not
provider load or real-world throughput. Before opening hundreds of accounts,
measure representative syncs, cache pressure, DB latency and reconnect bursts.

## Small fixed pool, when needed

Set the same WHATSAPP_SHARDS JSON on every service, and set a unique
WHATSAPP_SHARD_ID on each. For example:

```text
WHATSAPP_SHARD_ID=blue
WHATSAPP_SHARDS={"blue":"http://blue:8080","green":"http://green:8080"}
```

Keep shard endpoints private and share the service authentication secret and
credential encryption key between trusted shards. Any service can act as the
entrypoint and forwards once to the account's assigned shard, without retrying
mutations. Requests use the organisation/user IDs supplied by the authenticated
app server; membership is also checked in the container.

Accounts are assigned by rendezvous hashing. Startup and periodic recovery only
restore accounts assigned to the service. A single-shard deployment defaults to
`primary`; no shard map or separate router is required. A restart using a new owner
token cannot claim a still-valid lease. Recovery retries after its expiry.

Changing the shard map is an intentional rollout: stop/drain the old pool before
starting the new configuration, or briefly reject misrouted requests during a
coordinated switch. Existing services do not hot-reload the map. Do not run
containers with different maps against the same accounts; leases prevent two
owners, but mixed maps can temporarily make an account unavailable. Do not promise
transparent failover on host loss: a replacement must have the same shard ID/map,
and may wait up to the lease TTL plus recovery interval before reconnecting.


## Authorized 512 MiB experiment

On 1 October 2026 the user selected the USD4/month Basic Regular 512 MiB / 1 vCPU
Droplet and explicitly authorized deployment. Host `acquire-whatsapp-test-01`
(Droplet ID `605175578`) is in Sydney (`syd1`), assigned to the `project_acquire`
project, and uses Ubuntu 24.04 LTS. Docker's official signed repository supplied
the engine. An upstream Caddy repository signing key was expired; HTTPS uses
Ubuntu's signed Caddy package rather than bypassing signature verification.

The Node image built on the Droplet itself in 23 seconds without swap. Host memory
available during the sampled build never fell below approximately 132 MiB. All
17 unit tests passed on that host with the two local-only database tests skipped.
An unpaired live transport smoke test obtained a real WhatsApp QR, discarded it,
and exited without linking an account or sending messages. The full 19-test suite,
including real Postgres lease tests, passed separately in local OrbStack.

The cloud service is deployed behind Caddy at:
`https://whatsapp.170.64.166.54.sslip.io`

HTTPS certificate verification and unauthenticated rejection (401) passed.
Authenticated metrics returned 200 and initially reported zero sessions and
approximately 103 MiB process RSS. The cloud database's TLS certificate was
verified using the project's locally available Supabase CA. Runtime keys are
separate from local development and are not included in the image or repository.

**Cloud database setup is complete.** The user explicitly approved `0014` and
`0015` for the cloud Supabase database on 1 October 2026. Both were applied in one
transaction, with RLS verified on all three WhatsApp tables. HTTPS health returned
200, authenticated metrics returned 200 and a non-member request returned 403.
The background recovery loop only checks the schema; it never applies migrations.
The cloud service currently has zero linked accounts. The local paired account
remains in OrbStack and its credentials have not been copied into Supabase.

The host uses `compose.hosted.yml` with the `compose.testing-512.yml` overlay:
three-account cap, 256 MiB RSS admission threshold, 320 MiB container memory limit,
192 MiB Node heap, four pooled DB connections and smaller history caches.
These settings are an experiment, not demonstrated capacity for three fully
synced live accounts. Measure real history-sync bursts before expanding capacity.
The API binds only to loopback; ports 80/443 are handled by Caddy, and the
DigitalOcean firewall limits SSH to the provisioning client's public IPv4 address.

The remote deployment lives under `/opt/acquire-whatsapp`, with Compose files and
a mode-600 environment file under `ops/whatsapp`. Build output and sampled memory
are retained in `results/`. The dedicated SSH key and deployment record are kept
in ignored `.local-data/whatsapp/`; no private keys or database credentials are
checked in. The temporary sslip.io hostname can later be replaced with an owned
hostname. Building the image does not establish sustained live-account capacity.
