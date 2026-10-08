import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
const execute = promisify(execFile);

// Uses a separate Playwright CLI session. No stored user browser/account is used.
export async function checkCampaignBrowser({ app, mandateId, cookie, sequenceName, run }) {
  const session = `campaign-integration-${run}`;
  const cli = async (...args) => {
    let stdout, stderr;
    try {
      ({ stdout, stderr } = await execute("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", `-s=${session}`, ...args], { timeout: 90_000, maxBuffer: 2_000_000 }));
    } catch (error) {
      // Child-process errors include their command arguments. Never propagate
      // an argument containing a session cookie into the public test report.
      throw new Error(`Browser ${args[0]} failed: ${error.stdout?.split("### Error")[1]?.slice(0, 1000) || "CLI unavailable or timed out"}`);
    }
    if (/^### Error/m.test(stdout)) throw new Error(`Browser check failed: ${stdout.split("### Error")[1]?.slice(0, 1000)}`);
    // CLI echoes run-code, which contains the synthetic cookie. Keep output
    // private; only report the stage and assertion failures to the suite.
    if (stderr && !stdout) throw new Error("Playwright CLI failed");
    return stdout;
  };
  await mkdir("output/playwright", { recursive: true });
  try {
    await cli("open", `${app}/sign-in`);
    const split = cookie.indexOf("=");
    await cli("run-code", `async page => {
      await page.context().addCookies([{ name: ${JSON.stringify(cookie.slice(0, split))}, value: ${JSON.stringify(cookie.slice(split + 1))}, url: ${JSON.stringify(app)}, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(${JSON.stringify(`${app}/mandates/${mandateId}/outreach/sequences`)});
      await page.getByRole('button', { name: 'Save draft', exact: true }).waitFor();
    }`);
    await cli("snapshot");
    await cli("run-code", `async page => {
      await page.getByRole('button', { name: ${JSON.stringify(`${sequenceName} Published v1`)}, exact: true }).click();
      await page.getByText('Introduction', { exact: true }).first().click();
      await page.getByLabel('Subject', { exact: true }).first().fill('Browser regression <img src=x onerror=alert(1)>');
      const saved = page.waitForResponse(r => r.url().includes('/api/campaigns/') && r.request().method() === 'PUT' && r.ok());
      await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await saved;
      await page.reload();
      await page.getByRole('button', { name: ${JSON.stringify(`${sequenceName} Published v1`)}, exact: true }).click();
      await page.getByText('Introduction', { exact: true }).first().click();
      if (await page.getByLabel('Subject', { exact: true }).first().inputValue() !== 'Browser regression <img src=x onerror=alert(1)>') throw new Error('Saved subject did not survive reload');
      await page.getByRole('button', { name: 'Sequence flow', exact: true }).click();
      await page.getByLabel('Sequence flow editor', { exact: true }).waitFor();
      const published = page.waitForResponse(r => r.url().endsWith('/publish') && r.ok());
      await page.getByRole('button', { name: 'Publish new version', exact: true }).click(); await published;
      await page.getByRole('button', { name: ${JSON.stringify(`${sequenceName} Published v2`)}, exact: true }).waitFor();
    }`);
    await cli("snapshot");
    await cli("goto", `${app}/mandates/${mandateId}/people`);
    await cli("snapshot");
    await cli("run-code", `async page => {
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
      await dialog.waitFor();
      if (await dialog.locator('input[required]').count()) throw new Error('Person fields must all be optional');
      await dialog.getByLabel('Full name', { exact: true }).fill('LinkedIn Only Person');
      await dialog.getByLabel('LinkedIn profile URL', { exact: true }).fill('https://www.linkedin.com/in/synthetic-optional-browser');
      const added = page.waitForResponse(r => r.url().endsWith('/contacts') && r.request().method() === 'POST' && r.ok());
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click(); await added;
      await page.getByRole('button', { name: 'LinkedIn Only Person', exact: true }).waitFor();
    }`);
    await cli("snapshot");
    await cli("run-code", `async page => {
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
      const added = page.waitForResponse(r => r.url().endsWith('/contacts') && r.request().method() === 'POST' && r.ok());
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click(); await added;
      await page.getByRole('button', { name: 'Unnamed person', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      await dialog.getByLabel('Full name', { exact: true }).fill('Phone Only Person');
      await dialog.getByLabel('Phone', { exact: true }).fill('+61412345678');
      const phoneAdded = page.waitForResponse(r => r.url().endsWith('/contacts') && r.request().method() === 'POST' && r.ok());
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click(); await phoneAdded;
      await page.getByRole('button', { name: 'Phone Only Person', exact: true }).waitFor();
    }`);
    await cli("snapshot");
    await cli("run-code", `async page => {
      const filter = page.getByRole('combobox', { name: 'Filter people by contact details' });
      await filter.selectOption('linkedin');
      await page.getByRole('button', { name: 'LinkedIn Only Person', exact: true }).waitFor();
      if (await page.getByRole('button', { name: 'Browser Person', exact: true }).count()) throw new Error('Email-only person appears in LinkedIn filter');
      await page.getByRole('button', { name: 'Select all shown', exact: true }).click();
      await page.getByRole('button', { name: 'Subscribe 1', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Confirm automation', exact: true });
      await confirm.waitFor();
      if (!(await confirm.innerText()).includes('LinkedIn Only Person: needs email')) throw new Error('Email sequence must explain missing email');
      if (!(await confirm.getByRole('button', { name: 'Confirm and start', exact: true }).isDisabled())) throw new Error('Email sequence accepted a LinkedIn-only recipient');
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await filter.selectOption('email');
      if (await page.getByRole('button', { name: 'LinkedIn Only Person', exact: true }).count()) throw new Error('LinkedIn-only person appears in email filter');
      await filter.selectOption('phone');
      await page.getByRole('button', { name: 'Phone Only Person', exact: true }).waitFor();
      if (await page.getByRole('button', { name: 'LinkedIn Only Person', exact: true }).count()) throw new Error('LinkedIn-only person appears in phone filter');
      if (await page.getByRole('checkbox', { checked: true }).count()) throw new Error('Changing filters retained hidden selections');
      await filter.selectOption('all');
      await page.screenshot({ path: 'output/playwright/optional-people-filters.png', fullPage: true });
    }`);
    await cli("snapshot");
    await cli("run-code", `async page => {
      await page.getByRole('checkbox', { name: 'Select Browser Person', exact: true }).check();
      await page.getByRole('button', { name: 'Subscribe 1', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Confirm automation', exact: true });
      await confirm.waitFor();
      if (!(await confirm.innerText()).includes('A reply on any monitored channel stops')) throw new Error('Missing reply-enforcement confirmation');
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (await confirm.count()) throw new Error('Cancellation did not close confirmation');
      await page.getByRole('button', { name: 'Subscribe 1', exact: true }).click();
      await page.getByRole('dialog', { name: 'Confirm automation' }).getByRole('combobox').selectOption({ label: ${JSON.stringify(`${sequenceName} · v2`)} });
      const subscribed = page.waitForResponse(r => r.url().endsWith('/enrolments') && r.ok());
      await page.getByRole('button', { name: 'Confirm and start', exact: true }).click(); await subscribed;
      await page.getByRole('button', { name: 'Browser Person', exact: true }).click();
      const paused = page.waitForResponse(r => r.url().endsWith('/action') && r.ok());
      await page.getByRole('button', { name: 'Pause', exact: true }).click(); await paused;
      await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
      const stopped = page.waitForResponse(r => r.url().endsWith('/action') && r.ok());
      await page.getByRole('button', { name: 'Stop permanently', exact: true }).click(); await stopped;
      await page.getByRole('dialog', { name: 'Browser Person automation' }).getByText(/Status:.*Stopped/).waitFor();
      await page.screenshot({ path: 'output/playwright/campaign-integration.png', fullPage: true });
    }`);
    console.log("Browser optional fields, channel filters, save/reload, flow rendering, publish, cancel/confirm subscription, pause and stop passed");
  } finally { await cli("close").catch(() => undefined); }
}
