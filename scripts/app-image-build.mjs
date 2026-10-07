import { spawnSync } from "node:child_process";

const [origin, image, ...extra] = process.argv.slice(2);
if (!origin || !image || extra.length || new URL(origin).origin !== origin || !/^(https?):/.test(origin)
  || !/^acquire-app:[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(image))
  throw new Error("Usage: node scripts/app-image-build.mjs <origin> acquire-app:<unique-release-tag>");
const result = spawnSync("docker", ["build", "--platform", "linux/amd64", "-f", "ops/app/Dockerfile", "--build-arg", `NEXT_PUBLIC_APP_URL=${origin}`, "-t", image, "."], { stdio: "inherit" });
process.exit(result.status ?? 1);
