import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
let harness;
try {
  const cli = fs.realpathSync(
    process.env.CLINE_BIN || execFileSync('which', ['cline'], { encoding: 'utf8' }).trim(),
  );
  let root = path.dirname(cli);
  while (!fs.existsSync(path.join(root, 'node_modules/@cline/core/package.json'))) {
    const next = path.dirname(root);
    if (next === root) throw new Error('Cline CLI installation not found.');
    root = next;
  }
  const { ClineCore, ProviderSettingsManager } = await import(
    pathToFileURL(path.join(root, 'node_modules/@cline/core/dist/index.js')).href
  );
  const settings = new ProviderSettingsManager().getProviderSettings('cline');
  if (!settings?.model) throw new Error('Configure a model with cline auth.');
  const { system, input } = JSON.parse(fs.readFileSync(0, 'utf8'));
  harness = await ClineCore.create({
    // Keep the original runtime identity for existing local sessions after the service rename.
    clientName: 'daily-me',
    backendMode: 'local',
    capabilities: { requestToolApproval: async () => ({ approved: false }) },
  });
  const session = await harness.start({
    prompt: JSON.stringify(input),
    config: {
      providerId: 'cline',
      modelId: settings.model,
      systemPrompt: system,
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      enableTools: false,
      enableSpawnAgent: false,
      enableAgentTeams: false,
    },
    toolPolicies: { '*': { enabled: false } },
    plugins: { '*': { enabled: false } },
    localRuntime: { configExtensions: [] },
  });
  const r = session.result;
  if (!r?.text || r.finishReason !== 'completed') throw new Error('Cline did not finish.');
  if (r.toolCalls?.length) throw new Error('Unexpected tool call in a tool-free editorial run.');
  process.stdout.write(
    JSON.stringify({
      type: 'run_result',
      text: r.text,
      usage: r.usage,
      model: r.model?.id,
      durationMs: r.durationMs,
      finishReason: r.finishReason,
    }) + '\n',
  );
} catch (e) {
  process.stderr.write(JSON.stringify({ type: 'error', message: e.message }) + '\n');
  process.exitCode = 1;
} finally {
  if (harness) await harness.dispose();
  process.exit(process.exitCode || 0);
}
