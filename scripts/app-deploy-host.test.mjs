import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "acquire-rollout-"));
  const host = join(root, "host"), release = join(root, "release"), bin = join(root, "bin");
  const app = join(host, "ops/app");
  for (const path of [app, release, bin]) mkdirSync(path, { recursive: true });
  const sha = "a".repeat(40), id = `sha256:${"b".repeat(64)}`;
  writeFileSync(join(app, ".env"), "APP_IMAGE=acquire-app:previous\n");
  writeFileSync(join(app, ".env.hosted"), "PRESERVED_RUNTIME=fixture\n");
  writeFileSync(join(app, "compose.hosted.yml"), "previous-compose\n");
  for (const [name, value] of Object.entries({ commit: sha, "image-id": id, "compose.hosted.yml": "new-compose\n", "app-public-smoke.mjs": "" })) writeFileSync(join(release, name), value);
  writeFileSync(join(release, "image.tar.gz"), gzipSync("fixture image"));
  // Only relocate filesystem paths; execute the actual rollout/rollback logic.
  const script = readFileSync(new URL("./app-deploy-host.sh", import.meta.url), "utf8").replaceAll("/opt/acquire-app", host);
  writeFileSync(join(root, "deploy.sh"), script);
  writeFileSync(join(bin, "flock"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "docker"), `#!/bin/sh
echo "$*" >> "$FIXTURE_LOG"
case "$*" in
  load) cat >/dev/null;;
  'image inspect '*) echo "$FIXTURE_IMAGE_ID";;
  'compose exec '*)
    case "$*" in *campaign-readiness*) if [ "$FAIL_CAMPAIGN_CHECK" = 1 ]; then exit 1; fi;; esac
    if [ "$FAIL_FIRST_CHECK" = 1 ] && [ ! -f "$FIXTURE_FAILURE" ]; then touch "$FIXTURE_FAILURE"; exit 1; fi;;
esac
`, { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "deploy.sh"), release, sha], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_LOG: join(root, "log"), FIXTURE_IMAGE_ID: id, FIXTURE_FAILURE: join(root, "failed"), ...overrides } });
  const state = { result, image: readFileSync(join(app, ".env"), "utf8"), runtime: readFileSync(join(app, ".env.hosted"), "utf8"), compose: readFileSync(join(app, "compose.hosted.yml"), "utf8"), log: readFileSync(join(root, "log"), "utf8") };
  rmSync(root, { recursive: true, force: true });
  return state;
}
test("deploys a verified image without replacing on-host production configuration", () => {
  const state = fixture();
  assert.equal(state.result.status, 0, state.result.stderr);
  assert.equal(state.image, `APP_IMAGE=acquire-app:github-${"a".repeat(40)}\n`);
  assert.equal(state.runtime, "PRESERVED_RUNTIME=fixture\n");
  assert.equal(state.compose, "new-compose\n");
});
test("failed readiness restores the previous image and compose and reports failure", () => {
  const state = fixture({ FAIL_FIRST_CHECK: "1" });
  assert.notEqual(state.result.status, 0);
  assert.equal(state.image, "APP_IMAGE=acquire-app:previous\n");
  assert.equal(state.compose, "previous-compose\n");
  assert.equal(state.runtime, "PRESERVED_RUNTIME=fixture\n");
  assert.equal(state.log.match(/compose up/g)?.length, 2);
});
test("image identity mismatch fails before changing the running app", () => {
  const state = fixture({ FIXTURE_IMAGE_ID: `sha256:${"c".repeat(64)}` });
  assert.notEqual(state.result.status, 0);
  assert.equal(state.image, "APP_IMAGE=acquire-app:previous\n");
  assert.ok(!state.log.includes("compose up"));
});

test("failed campaign enforcement readiness restores the previous release", () => {
  const state = fixture({ FAIL_CAMPAIGN_CHECK: "1" });
  assert.notEqual(state.result.status, 0);
  assert.equal(state.image, "APP_IMAGE=acquire-app:previous\n");
  assert.equal(state.compose, "previous-compose\n");
  assert.equal(state.runtime, "PRESERVED_RUNTIME=fixture\n");
  assert.equal(state.log.match(/compose up/g)?.length, 2);
});
