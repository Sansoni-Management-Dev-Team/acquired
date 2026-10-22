import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAppTask, validateReleaseConfig, publicAppSmoke } from './aws-uat-release.mjs';

const account = '352329340196';
const prefix = `arn:aws:ecs:ap-southeast-2:${account}`;
const secret = `arn:aws:secretsmanager:ap-southeast-2:${account}:secret:acquire-app-develop-ABC123`;
const image = `${account}.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop@sha256:${'a'.repeat(64)}`;
const config = () => ({ schemaVersion: 1, accountId: account, region: 'ap-southeast-2',
  cluster: 'acquire-acquire-develop', service: 'acquire-app-develop', origin: 'https://app.acquire.pajamaprofits.net',
  repository: `${account}.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop`,
  baseTaskDefinition: `${prefix}:task-definition/acquire-app-develop:1`, secretArn: secret });
const base = () => ({ taskDefinitionArn: config().baseTaskDefinition, status: 'ACTIVE', revision: 1,
  registeredAt: '2026-10-21', registeredBy: 'not-a-request-field', requiresAttributes: [], compatibilities: ['FARGATE'],
  family: 'acquire-app-develop', networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'], cpu: '512', memory: '2048',
  executionRoleArn: `arn:aws:iam::${account}:role/acquire-app-execution-develop`,
  taskRoleArn: `arn:aws:iam::${account}:role/acquire-app-task-develop`,
  volumes: [], runtimePlatform: { cpuArchitecture: 'X86_64', operatingSystemFamily: 'LINUX' },
  containerDefinitions: [{ name: 'app', image, essential: true, portMappings: [{ containerPort: 3000, protocol: 'tcp' }],
    environment: Object.entries({ NODE_ENV: 'production', DATABASE_DRIVER: 'postgres', APP_URL: config().origin,
      NEXT_PUBLIC_APP_URL: config().origin, AWS_UAT_DATABASE_HOST: 'acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com',
      AWS_UAT_DATABASE_NAME: 'acquire', RESEARCH_ENABLED: 'false', COMMUNICATIONS_RUNTIME_ENABLED: 'false', CAMPAIGN_N8N_ENABLED: 'false',
      TARGET_DATA_PROVIDER: 'fixture', OUTREACH_DRAFTING_PROVIDER: 'fixture', ALLOW_REAL_PERSONAL_DATA: 'false' }).map(([name, value]) => ({ name, value })),
    secrets: ['DATABASE_URL', 'DATABASE_SSL_CA_BASE64', 'BETTER_AUTH_SECRET', 'APP_READINESS_SECRET'].map(name => ({ name, valueFrom: `${secret}:${name}::` })),
    logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/acquire-app-develop', 'awslogs-region': 'ap-southeast-2', 'awslogs-stream-prefix': 'ecs' } },
    command: ['node', 'uat-start.mjs'], stopTimeout: 120 }] });

test('renders a complete register-task-definition request and leaves the source unchanged', () => {
  const source = base(), before = structuredClone(source);
  const next = image.replace('a'.repeat(64), 'b'.repeat(64));
  const rendered = renderAppTask(config(), source, next);
  assert.equal(rendered.containerDefinitions[0].image, next);
  assert.deepEqual(rendered.runtimePlatform, source.runtimePlatform);
  assert.deepEqual(rendered.volumes, source.volumes);
  for (const key of ['revision', 'status', 'taskDefinitionArn', 'registeredBy', 'registeredAt', 'requiresAttributes', 'compatibilities']) assert.equal(key in rendered, false);
  assert.deepEqual(source, before);
});

test('rejects another account, production service, mutable image or foreign image repository', () => {
  for (const patch of [{ accountId: '000000000000' }, { service: 'acquire-app-production' }, { region: 'us-east-1' }, { origin: 'https://acquire.mlai.au' }])
    assert.throws(() => validateReleaseConfig({ ...config(), ...patch }));
  for (const candidate of [image.replace(/@sha256:.+$/, ':latest'), image.replace(account, '000000000000')])
    assert.throws(() => renderAppTask(config(), base(), candidate));
});

test('rejects active research, messaging, scheduling, raw credentials and unreviewed task changes', () => {
  for (const name of ['RESEARCH_ENABLED', 'COMMUNICATIONS_RUNTIME_ENABLED', 'CAMPAIGN_N8N_ENABLED']) {
    const task = base(); task.containerDefinitions[0].environment.find(e => e.name === name).value = 'true';
    assert.throws(() => renderAppTask(config(), task, image));
  }
  const task = base(); task.containerDefinitions[0].environment.push({ name: 'DATABASE_URL', value: 'postgresql://private' });
  assert.throws(() => renderAppTask(config(), task, image));
  const changed = base(); changed.containerDefinitions[0].command = ['node', 'runtime.mjs'];
  assert.throws(() => renderAppTask(config(), changed, image));
  const foreign = base(); foreign.containerDefinitions[0].secrets[0].valueFrom = secret.replace('acquire-app-develop', 'production') + ':DATABASE_URL::';
  assert.throws(() => renderAppTask(config(), foreign, image));
});

test('smoke checks the UAT origin without following redirects or claiming database acceptance', async () => {
  const calls = [];
  await publicAppSmoke(config().origin, async (url, opts) => { calls.push([url, opts.redirect]); return { status: 200 }; });
  assert.deepEqual(calls, [['https://app.acquire.pajamaprofits.net/api/health', 'manual'], ['https://app.acquire.pajamaprofits.net/sign-in', 'manual']]);
  await assert.rejects(publicAppSmoke(config().origin, async () => ({ status: 302 })));
  await assert.rejects(publicAppSmoke('https://acquire.mlai.au', async () => ({ status: 200 })));
});
