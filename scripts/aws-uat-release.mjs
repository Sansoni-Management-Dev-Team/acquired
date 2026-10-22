import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { UAT_ORIGIN, UAT_DATABASE_HOST } from '../ops/aws/uat/start.mjs';

const ACCOUNT = '352329340196', REGION = 'ap-southeast-2';
const REPOSITORY = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/acquire-acquire-develop`;
const REGISTER_FIELDS = ['family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions',
  'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory', 'pidMode', 'ipcMode',
  'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage', 'runtimePlatform', 'enableFaultInjection'];
const REQUIRED_SECRETS = ['DATABASE_URL', 'DATABASE_SSL_CA_BASE64', 'BETTER_AUTH_SECRET', 'APP_READINESS_SECRET'];

export function validateReleaseConfig(config) {
  if (config.schemaVersion !== 1 || config.accountId !== ACCOUNT || config.region !== REGION
    || config.cluster !== 'acquire-acquire-develop' || config.service !== 'acquire-app-develop'
    || config.origin !== UAT_ORIGIN || config.repository !== REPOSITORY
    || !new RegExp(`^arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/acquire-app-develop:[1-9][0-9]*$`).test(config.baseTaskDefinition)
    || !new RegExp(`^arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:acquire-app-develop-[A-Za-z0-9]{6}$`).test(config.secretArn))
    throw Error('Invalid Acquire UAT release configuration');
  return config;
}

/** Preserve the reviewed full task definition, including volumes, rather than container JSON alone. */
export function renderAppTask(config, task, image) {
  validateReleaseConfig(config);
  if (!new RegExp(`^${REPOSITORY.replaceAll('.', '\\.')}@sha256:[a-f0-9]{64}$`).test(image)
    || task.taskDefinitionArn !== config.baseTaskDefinition || task.family !== config.service
    || task.networkMode !== 'awsvpc' || JSON.stringify(task.requiresCompatibilities) !== '["FARGATE"]'
    || task.executionRoleArn !== `arn:aws:iam::${ACCOUNT}:role/acquire-app-execution-develop`
    || task.taskRoleArn !== `arn:aws:iam::${ACCOUNT}:role/acquire-app-task-develop`
    || task.containerDefinitions?.length !== 1) throw Error('Unreviewed UAT task configuration');
  const container = task.containerDefinitions[0];
  const environment = Object.fromEntries((container.environment || []).map(e => [e.name, e.value]));
  const expected = { NODE_ENV: 'production', DATABASE_DRIVER: 'postgres', APP_URL: UAT_ORIGIN, NEXT_PUBLIC_APP_URL: UAT_ORIGIN,
    AWS_UAT_DATABASE_HOST: UAT_DATABASE_HOST, AWS_UAT_DATABASE_NAME: 'acquire',
    RESEARCH_ENABLED: 'false', COMMUNICATIONS_RUNTIME_ENABLED: 'false', CAMPAIGN_N8N_ENABLED: 'false',
    TARGET_DATA_PROVIDER: 'fixture', OUTREACH_DRAFTING_PROVIDER: 'fixture', ALLOW_REAL_PERSONAL_DATA: 'false' };
  if (container.name !== 'app' || container.privileged || container.stopTimeout !== 120
    || JSON.stringify(container.command) !== '["node","uat-start.mjs"]'
    || !Object.entries(expected).every(([key, value]) => environment[key] === value)
    || container.logConfiguration?.options?.['awslogs-group'] !== '/ecs/acquire-app-develop'
    || !container.portMappings?.some(p => p.containerPort === 3000)) throw Error('UAT isolation prerequisites unavailable');
  const injected = container.secrets || [];
  if (injected.length !== REQUIRED_SECRETS.length
    || !REQUIRED_SECRETS.every(name => injected.some(s => s.name === name && s.valueFrom === `${config.secretArn}:${name}::`))
    || Object.keys(environment).some(name => /SECRET|TOKEN|PASSWORD|DATABASE_URL|API_KEY|KEYRING|SSL_CA/.test(name)))
    throw Error('UAT secret references unavailable');
  const result = structuredClone(Object.fromEntries(REGISTER_FIELDS.filter(k => k in task).map(k => [k, task[k]])));
  result.containerDefinitions[0].image = image;
  return result;
}

export async function publicAppSmoke(origin, request = fetch) {
  if (origin !== UAT_ORIGIN) throw Error('Use the fixed UAT origin');
  for (const path of ['/api/health', '/sign-in']) {
    const response = await request(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw Error(`UAT public smoke failed: ${path}`);
  }
  console.log('UAT public liveness/sign-in smoke passed; authenticated product acceptance is separate.');
}

function aws(args) {
  const result = spawnSync('aws', [...args, '--region', REGION, '--output', 'json', '--no-cli-pager',
    '--cli-connect-timeout', '10', '--cli-read-timeout', '30'], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' }, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`AWS UAT operation failed: ${args.slice(0, 2).join(' ')}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function requireDatabaseReview() {
  try {
    const review = JSON.parse(process.env.ACQUIRE_UAT_DATABASE_REVIEW || 'null');
    if (process.env.ACQUIRE_UAT_DEPLOYMENT_ENABLED !== 'true' || review.accountId !== ACCOUNT
      || review.cluster !== 'acquire-n8n-develop' || review.database !== 'acquire'
      || !/^[a-f0-9]{64}$/.test(review.artifactSha256) || !review.approvalReference?.trim()
      || process.env.UAT_APPROVAL_REFERENCE !== review.approvalReference) throw Error();
  } catch { throw Error('Configure the exact approved UAT database review before registering a deployment'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let directory;
  try {
    const [operation, configPath, image, ...extra] = process.argv.slice(2);
    if (operation === 'smoke' && !configPath && !image) await publicAppSmoke(UAT_ORIGIN);
    else if (['render', 'register'].includes(operation) && configPath && image && !extra.length) {
      const config = validateReleaseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
      if (operation === 'register') {
        requireDatabaseReview();
        if (!process.env.GITHUB_OUTPUT) throw Error('Use the manual GitHub release workflow for registration');
      }
      const identity = aws(['sts', 'get-caller-identity']);
      if (identity.Account !== ACCOUNT) throw Error('Incorrect AWS account');
      const source = aws(['ecs', 'describe-task-definition', '--task-definition', config.baseTaskDefinition]).taskDefinition;
      const task = renderAppTask(config, source, image);
      if (operation === 'render') console.log(JSON.stringify(task, null, 2));
      else {
        const previous = aws(['ecs', 'describe-services', '--cluster', config.cluster, '--services', config.service]).services?.[0];
        if (!previous || previous.status !== 'ACTIVE' || previous.desiredCount > 1
          || previous.deploymentConfiguration?.minimumHealthyPercent !== 0
          || previous.deploymentConfiguration?.maximumPercent !== 100) throw Error('UAT single-task deployment configuration unavailable');
        const digest = image.split('@')[1];
        const found = aws(['ecr', 'describe-images', '--repository-name', 'acquire-acquire-develop', '--image-ids', `imageDigest=${digest}`]).imageDetails?.[0];
        if (!found || (process.env.GITHUB_SHA && !found.imageTags?.some(t => t.startsWith(`app-${process.env.GITHUB_SHA}-`))))
          throw Error('UAT image does not match the selected source revision');
        directory = mkdtempSync(join(tmpdir(), 'acquire-uat-'));
        const path = join(directory, 'task.json'); writeFileSync(path, JSON.stringify(task), { mode: 0o600 });
        const arn = aws(['ecs', 'register-task-definition', '--cli-input-json', `file://${path}`]).taskDefinition.taskDefinitionArn;
        const outputs = { candidate: arn, previous: previous.taskDefinition, previous_count: String(previous.desiredCount) };
        appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
        console.log('Reviewed UAT task revision registered; service update is a separate workflow step.');
      }
    } else throw Error('Usage: aws-uat-release.mjs render|register <config.json> <image@sha256:digest>, or smoke');
  } catch {
    process.stderr.write('AWS UAT release failed; inspect configuration, account, database review and image prerequisites.\n');
    process.exitCode = 1;
  } finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
}
