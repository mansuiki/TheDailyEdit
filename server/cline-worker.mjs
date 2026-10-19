import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findClineRuntime, configuredClineSettings } from './cline-runtime.mjs';
let harness;
try {
  const root = findClineRuntime();
  const core = await import(
    pathToFileURL(path.join(root, 'node_modules/@cline/core/dist/index.js')).href
  );
  const { ClineCore } = core;
  const settings = configuredClineSettings(core);
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
  process.stderr.write(JSON.stringify({ type: 'error', code: e.code, message: e.message }) + '\n');
  process.exitCode = 1;
} finally {
  if (harness) await harness.dispose();
  process.exit(process.exitCode || 0);
}
