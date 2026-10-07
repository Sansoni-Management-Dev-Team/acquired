// Deploy an existing image to the dedicated app host. Does not change DNS,
// external schedulers, secrets, database schema, or any other Droplet.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isIP } from "node:net";

const [image, environmentFile, ...extra] = process.argv.slice(2);
if (!image || !environmentFile || extra.length || !/^acquire-app:[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(image))
  throw new Error("Usage: node scripts/app-deploy.mjs acquire-app:<release-tag> <restricted-env-file>");
const record = JSON.parse(readFileSync(".local-data/app/digitalocean-deployment.json", "utf8"));
if (record.name !== "acquire-app-01" || record.projectId !== "a5255506-6f88-4e91-b501-f79d7c347d4f" || isIP(record.address) !== 4)
  throw new Error("Invalid dedicated app deployment record");
if (statSync(environmentFile).mode & 0o077) throw new Error("Environment file must not be readable by group or other users");
const sshOptions = ["-i", resolve(".local-data/app/deploy_ed25519"), "-o", `UserKnownHostsFile=${resolve(".local-data/app/known_hosts")}`, "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "ConnectTimeout=15"];
const host = `acquire@${record.address}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed; review deployment/rollback output`);
  return result;
}
const archive = resolve(".local-data/app/app-image.tar");
const localImage = run("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { encoding: "utf8", stdio: "pipe" }).stdout.trim();
const remoteImage = spawnSync("ssh", [...sshOptions, host, `docker image inspect '${image}' --format '{{.Id}}'`], { encoding: "utf8", stdio: "pipe" });
const needsImage = remoteImage.status !== 0 || remoteImage.stdout.trim() !== localImage;
if (needsImage) {
  run("docker", ["save", "-o", archive, image]);
  run("scp", [...sshOptions, archive, `${host}:/opt/acquire-app/app-image.tar`]);
}
run("scp", [...sshOptions, "ops/app/compose.hosted.yml", `${host}:/opt/acquire-app/ops/app/compose.hosted.yml`]);
run("scp", [...sshOptions, resolve(environmentFile), `${host}:/opt/acquire-app/ops/app/.env.hosted.next`]);
const command = `set -eu
cd /opt/acquire-app/ops/app
export COMPOSE_FILE=compose.hosted.yml
chmod 600 .env.hosted.next
${needsImage ? "docker load -i /opt/acquire-app/app-image.tar >/dev/null" : "# Verified image already present"}
docker image inspect '${image}' --format '{{.Id}}'
mkdir -p releases
chmod 700 releases
if [ -f .env ]; then cp .env releases/previous-image.env; fi
if [ -f .env.hosted ]; then cp .env.hosted releases/previous-runtime.env; fi
mv .env.hosted.next .env.hosted
printf '%s\n' 'APP_IMAGE=${image}' > .env
chmod 600 .env
if docker compose up -d --wait --wait-timeout 120; then
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET}}).then(r=>{if(!r.ok)process.exit(1);console.log('Database readiness passed')}).catch(()=>process.exit(1))"; then
    rm -f /opt/acquire-app/app-image.tar
    exit 0
  fi
fi
echo 'Deployment verification failed; attempting previous-image rollback'
if [ -f releases/previous-image.env ] && [ -f releases/previous-runtime.env ]; then
  cp releases/previous-image.env .env
  cp releases/previous-runtime.env .env.hosted
  docker compose up -d --wait --wait-timeout 120
  docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET}}).then(r=>{if(!r.ok)process.exit(1);console.log('Previous release database readiness passed')}).catch(()=>process.exit(1))"
else
  docker compose stop app
fi
exit 1`;
run("ssh", [...sshOptions, host, command]);
