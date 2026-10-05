# DigitalOcean private LinkedIn test deployment

This deploys one container on a 2 GiB Basic Droplet in the `project_acquire` project. The test service supports one browser worker with a 1536 MiB memory limit. This is an account pilot, not a capacity guarantee for hundreds of linked users.

Build the amd64 image in OrbStack and transfer the saved image to the host. The host needs Docker Engine and Compose. Copy `compose.testing.yml` and a separately generated mode-600 `.env.testing` to `/opt/acquire-linkedin/ops/linkedin/`, load the image, and run:

```sh
docker compose -f /opt/acquire-linkedin/ops/linkedin/compose.testing.yml up -d --wait
```

The service binds only to the Droplet's loopback interface. Its Chromium debugging/VNC ports are not published. Encrypted state stays in the named `linkedin-state` volume. Preserve the separately generated encryption key to restore state. Local account sessions are not copied.

Open an SSH tunnel from this computer, using the deployment's dedicated key and recorded host:

```sh
ssh -N -L 127.0.0.1:18097:127.0.0.1:18096 root@DROPLET_ADDRESS
```

Use `ExitOnForwardFailure=yes` and a persistent known-hosts file in practice. The DigitalOcean firewall allows SSH only from the deployment client's public IPv4 address; no public viewer/API ports are opened. The viewer advertises `http://127.0.0.1:18097`, which travels through SSH encryption.

The local app prefers ignored `.local-data/linkedin/remote-test.env` when present. It contains `LINKEDIN_SERVICE_URL=http://127.0.0.1:18097` and the remote service bearer secret. Restart `pnpm dev` after creating/removing that file. Open http://localhost:3010/settings and connect LinkedIn to sign in on the remote browser. Remove that file and restart development to use OrbStack again. Deployment does not configure the production app or apply database migrations.

Fixtures and live inbox reads can be tested. Real invitation/DM sends remain disabled. The optional Browser Use model key is not required for manual login or inbox reads.

## 512 MiB experiment (5 October 2026)

The existing WhatsApp host had 458 MiB usable RAM, approximately 136 MiB available, and no swap. A separate BuildKit builder used a 96 MiB memory/no-swap budget and one build operation at a time to constrain the attempt. Package installation failed with `ResourceExhausted: cannot allocate memory`; kernel logs also recorded a global OOM killing the WhatsApp Node process. WhatsApp briefly restarted, then its authenticated HTTPS health returned 200 and Docker reported healthy. The test builder and its state were removed. Logs are retained under `/opt/acquire-linkedin/results/` on that host, with a local copy in ignored `.local-data/linkedin/`.

This demonstrates that this shared 512 MiB host did not support the tested build budget; it does not prove that an empty 512 MiB host with swap could never build the image. It is not an appropriate shared Chromium runtime without measuring a larger configuration.

The separately authorized test host is `acquire-linkedin-test-01`, Droplet `606103512`, address `170.64.233.147`, Sydney, Basic 1 vCPU / 2 GiB, USD12/month. Its SSH-only firewall is `238a1ec8-e9a3-4bbf-978e-7a108fe7514b`. It belongs to the same DigitalOcean project as WhatsApp. Deployment records, keys and tunnel state remain under ignored `.local-data/linkedin/`. The WhatsApp host was not resized.


## Hosted validation

The image built natively on the 2 GiB DigitalOcean host with exit status 0. Seven unit tests and the real Chromium fixture smoke test passed on that host, including VNC/WebSocket streaming, API inbox reads, approved fictional invitation/DM dispatch, duplicate protection, encrypted cookie/localStorage restore, revoked viewer rejection and the one-worker admission limit. Browser Use model inspection was skipped because the remote service has no model key configured. The real LinkedIn login page also loaded in the hosted browser. Live account login/inbox validation still requires the user's fresh sign-in on this host.

Authenticated service status returned 200, unauthenticated connection requests returned 401, and both hosted health and the recovered WhatsApp health returned 200. The local app uses the remote service through port 18097. No production app deployment or database migration was performed.

Run `pnpm linkedin:cloud:tunnel` to reopen/check the saved SSH tunnel, or `pnpm linkedin:cloud:tunnel -- stop` to close it. If your public IP changes, the host's SSH-only DigitalOcean firewall also needs that client's new /32 address. The hostname/port advertised to the browser remains the local tunnel address, so no public viewer endpoint is created.

The live DigitalOcean login test passed: the encrypted LinkedIn cookies and local storage restored after a container rebuild/restart without reauthentication, and the frontend API returned 20 conversation references. The container was healthy at approximately 956 MiB memory use. Snapshot saving now reads only LinkedIn cookies and the existing page's local storage, avoiding Playwright's temporary tabs for embedded third-party origins. Eight unit tests pass, including storage capture without opening exporter tabs and retaining prior storage on capture failure. Live sends remain disabled; no production app deployment or database migration was performed.

Activity settings, durable owner-scoped quotas/approved queue, recovery/cooldowns, cached inbox reads, and optional read-only feed activity are deployed to the DigitalOcean test instance. The final build passed 24 service tests and the isolated one-worker Chromium fixture smoke on DigitalOcean; OrbStack passed the same tests and two-worker smoke. Four Next API proxy tests, scoped ESLint, TypeScript checks, and UI settings-save verification passed locally. The actual cloud session restored without reauthentication, a fresh inbox returned 20 conversations, and the next read was served from encrypted cache. Keep-alive is enabled for that account at variable 45–180 minute intervals within weekday 09:00–17:00 Australia/Melbourne hours; the first live visit is scheduled, not yet observed. Live sends remain disabled. Browser activity waits for human viewers to close. No proxy settings, database migrations, or production app deployment were made. The app integration remains local via the private SSH tunnel.

Weekend correction: keep-alive now has separate `keepAliveDays`, defaulting to Monday–Sunday, while `activeDays` continues to govern outreach. Both use the configured daytime hours and timezone. Pausing outreach does not stop read-only keep-alive; browser pause, verification, cooldowns, budgets and viewer exclusivity still apply. The actual test account is configured for seven-day keep-alive with weekday outreach. This build passed 26 service tests (including Saturday/Sunday independence), OrbStack and DigitalOcean browser smoke, scoped lint and typecheck.
