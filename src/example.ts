/**
 * example.ts — Runnable demo of the agent spawner
 *
 * Run with: npx ts-node src/example.ts
 */

import { spawnAgent, getAgent, sendCommand, getAgentsByCapability } from './spawner';

async function main() {
  console.log('\n=== Agent Spawner Demo ===\n');

  // ── 1. Spawn an orchestrator (inherits from tpl-communication) ──────────
  const result = await spawnAgent({
    templateId: 'tpl-orchestrator',
    name: 'MyOrchestrator',
    config: { subordinateAgentIds: ['agent-finance', 'agent-hr'] },
    autoStart: true,
  });

  if (!result.success || !result.agentId) {
    console.error('Spawn failed:', result.error);
    process.exit(1);
  }

  const id = result.agentId;
  const agent = getAgent(id)!;

  console.log(`\nSpawned: ${id}  status=${agent.status}`);
  console.log(`Capabilities: ${agent.capabilities.join(', ')}\n`);
  // Note: includes 'email_analysis' and 'response_drafting' inherited from tpl-communication

  // ── 2. Assign a task ────────────────────────────────────────────────────
  await sendCommand(id, {
    type: 'assignTask',
    task: { id: 'task-001', description: 'Synthesise weekly finance + HR reports', payload: { week: '2026-W15' } },
  });
  const afterTask = getAgent(id)!;
  console.log(`After task assignment: status=${afterTask.status}  currentTask=${afterTask.currentTask?.id}`);

  // ── 3. Update config at runtime ─────────────────────────────────────────
  await sendCommand(id, {
    type: 'updateConfig',
    config: { maxEscalationDepth: 5 },
  });
  const afterConfig = getAgent(id)!;
  console.log(`After config update: maxEscalationDepth=${afterConfig.config.maxEscalationDepth}`);

  // ── 4. Query by capability ──────────────────────────────────────────────
  const llmAgents = getAgentsByCapability('llm_reasoning');
  console.log(`\nAgents with llm_reasoning: ${llmAgents.map((a) => a.id).join(', ')}`);

  // ── 5. Spawn a document processor (different template, no inheritance) ──
  const docResult = await spawnAgent({
    templateId: 'tpl-document-processor',
    config: { documentTypes: ['invoice', 'purchase-order'] },
    autoStart: true,
  });
  console.log(`\nDocument processor spawned: ${docResult.agentId}`);

  // ── 6. Terminate the orchestrator ───────────────────────────────────────
  await sendCommand(id, { type: 'terminate' });
  const terminated = getAgent(id);
  console.log(`\nAfter terminate: ${terminated} (should be undefined — removed from registry)`);

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
