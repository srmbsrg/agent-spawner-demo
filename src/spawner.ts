/**
 * Agent Spawner
 *
 * The heart of the dynamic agent system. Creates, tracks, and commands
 * agent instances at runtime without any system restart.
 *
 * Architecture overview
 * ─────────────────────
 *  1. Caller provides a SpawnRequest with a templateId + optional config overrides.
 *  2. Spawner resolves the full capability set by walking the template inheritance chain.
 *  3. Config is merged (defaults → overrides) and validated against the JSON Schema.
 *  4. An AgentInstance is created, registered in the in-memory map, and (optionally)
 *     persisted to a database.
 *  5. A lifecycle event is emitted so other agents / UIs can react.
 *
 * In production you would replace the in-memory Map with Redis or a database table
 * to survive restarts and enable horizontal scaling. The interface contract stays
 * identical — just swap the storage layer inside `activeAgents`.
 *
 * The in-memory design deliberately mirrors how many real agent platforms work:
 * the registry is the source of truth for *running* state; the database is the
 * authoritative store for *persisted* state. On startup, call `loadAgentsFromStore`
 * to reconcile the two.
 */

import { randomUUID } from 'crypto';
import type {
  AgentInstance,
  AgentCommand,
  AgentMetrics,
  AgentHealth,
  AgentStatus,
  AgentTask,
  CapabilityType,
  SpawnRequest,
  SpawnResult,
} from './types';
import { getTemplate, builtInTemplates } from './templates';
import type { AgentTemplate } from './types';

// ---------------------------------------------------------------------------
// In-memory registry — swap for Redis / database in production
// ---------------------------------------------------------------------------
const activeAgents = new Map<string, AgentInstance>();

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Spawn a new agent from a template.
 *
 * Key behaviours:
 *  - Resolves inherited capabilities by walking the template chain
 *  - Validates the merged config against the template's configSchema
 *  - Assigns a unique `agent-<8-char-uuid>` identifier
 *  - Optionally auto-starts the agent immediately
 */
export async function spawnAgent(request: SpawnRequest): Promise<SpawnResult> {
  try {
    const template = getTemplate(request.templateId);
    if (!template) {
      return { success: false, error: `Template not found: ${request.templateId}` };
    }

    // Walk the inheritance chain to collect all capabilities
    const capabilities = resolveCapabilities(template);

    // Merge config: template defaults → caller overrides
    const config: Record<string, unknown> = {
      ...template.defaultConfig,
      ...(request.config ?? {}),
    };

    // Validate merged config against schema
    const validationError = validateConfig(config, template.configSchema);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const agentId = `agent-${randomUUID().slice(0, 8)}`;
    const now = new Date();

    const agent: AgentInstance = {
      id: agentId,
      templateId: template.id,
      name: request.name ?? `${template.name}-${agentId.slice(-4)}`,
      status: request.autoStart ? 'initializing' : 'idle',
      config,
      capabilities,
      metrics: initMetrics(),
      health: initHealth(),
      createdAt: now,
    };

    // Register in memory
    activeAgents.set(agentId, agent);

    // Emit event (replace with your event bus / pub-sub in production)
    emitEvent('agent.spawned', { agentId, templateId: template.id, name: agent.name, capabilities });

    if (request.autoStart) {
      await startAgent(agentId);
    }

    return { success: true, agentId, agent };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Start (or resume) an agent */
export async function startAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
  const agent = activeAgents.get(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` };
  if (agent.status === 'active') return { success: true };

  agent.status = 'active';
  agent.startedAt = new Date();
  agent.lastActiveAt = new Date();

  emitEvent('agent.started', { agentId, name: agent.name });
  return { success: true };
}

/** Pause an agent — it keeps its config and metrics but stops accepting tasks */
export async function pauseAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
  const agent = activeAgents.get(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` };

  agent.status = 'paused';
  emitEvent('agent.paused', { agentId, name: agent.name });
  return { success: true };
}

/** Permanently stop an agent and remove it from the registry */
export async function terminateAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
  const agent = activeAgents.get(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` };

  agent.status = 'terminated';
  agent.terminatedAt = new Date();
  activeAgents.delete(agentId);

  emitEvent('agent.terminated', { agentId, name: agent.name });
  return { success: true };
}

/**
 * Send a typed command to a running agent.
 *
 * The command union type ensures exhaustive handling at the type-level —
 * adding a new command variant forces you to handle it here or get a TS error.
 */
export async function sendCommand(
  agentId: string,
  command: AgentCommand
): Promise<{ success: boolean; error?: string }> {
  switch (command.type) {
    case 'start':
      return startAgent(agentId);

    case 'pause':
      return pauseAgent(agentId);

    case 'terminate':
      return terminateAgent(agentId);

    case 'restart': {
      const agent = activeAgents.get(agentId);
      if (!agent) return { success: false, error: `Agent not found: ${agentId}` };
      agent.status = 'initializing';
      agent.metrics = initMetrics();
      agent.health = initHealth();
      agent.currentTask = undefined;
      return startAgent(agentId);
    }

    case 'updateConfig': {
      const agent = activeAgents.get(agentId);
      if (!agent) return { success: false, error: `Agent not found: ${agentId}` };
      agent.config = { ...agent.config, ...command.config };
      emitEvent('agent.config_updated', { agentId, config: agent.config });
      return { success: true };
    }

    case 'assignTask': {
      const agent = activeAgents.get(agentId);
      if (!agent) return { success: false, error: `Agent not found: ${agentId}` };
      if (agent.status !== 'active' && agent.status !== 'idle') {
        return { success: false, error: `Agent not ready (status: ${agent.status})` };
      }
      const task: AgentTask = {
        id: command.task.id,
        description: command.task.description,
        startedAt: new Date(),
        progress: 0,
        metadata: command.task.payload,
      };
      agent.currentTask = task;
      agent.status = 'active';
      agent.lastActiveAt = new Date();
      emitEvent('agent.task_started', { agentId, name: agent.name, taskId: task.id });
      return { success: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getAgent(agentId: string): AgentInstance | undefined {
  return activeAgents.get(agentId);
}

export function getAllAgents(): AgentInstance[] {
  return Array.from(activeAgents.values());
}

export function getAgentsByStatus(status: AgentStatus): AgentInstance[] {
  return getAllAgents().filter((a) => a.status === status);
}

export function getAgentsByCapability(capability: CapabilityType): AgentInstance[] {
  return getAllAgents().filter((a) => a.capabilities.includes(capability));
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

/**
 * Resolve the full capability set for a template by recursively merging
 * parent capabilities. Handles diamond inheritance by deduplicating.
 *
 * Example:
 *   tpl-orchestrator extends tpl-communication
 *   → orchestrator gets its own caps + communication caps (deduplicated)
 */
function resolveCapabilities(template: AgentTemplate): CapabilityType[] {
  const caps = new Set<CapabilityType>(template.capabilities);

  if (template.extendsTemplate) {
    const parent = getTemplate(template.extendsTemplate);
    if (parent) {
      for (const cap of resolveCapabilities(parent)) {
        caps.add(cap);
      }
    }
  }

  return Array.from(caps);
}

/**
 * Validate a merged config against a simplified JSON Schema subset.
 * Returns an error string on failure, null on success.
 *
 * Handles: required fields, type checking, enum constraints.
 * Does NOT handle: nested object schemas, pattern matching, min/max.
 * Extend as needed for your use case.
 */
function validateConfig(
  config: Record<string, unknown>,
  schema: AgentTemplate['configSchema']
): string | null {
  for (const key of schema.required) {
    if (config[key] === undefined) return `Missing required config field: "${key}"`;
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = config[key];
    if (value === undefined) continue;

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== prop.type) {
      return `Config field "${key}": expected ${prop.type}, got ${actualType}`;
    }

    if (prop.enum && !prop.enum.includes(value)) {
      return `Config field "${key}": must be one of [${prop.enum.join(', ')}]`;
    }
  }

  return null;
}

function initMetrics(): AgentMetrics {
  return {
    tasksCompleted: 0,
    tasksFailed: 0,
    successRate: 100,
    averageTaskDuration: 0,
    totalRuntime: 0,
    memoryUsageMB: 0,
  };
}

function initHealth(): AgentHealth {
  return { status: 'healthy', lastCheck: new Date(), issues: [] };
}

/** Stub event emitter — replace with EventEmitter, EventBus, or pub-sub in prod */
function emitEvent(event: string, payload: Record<string, unknown>): void {
  console.log(`[AgentSpawner] ${event}`, JSON.stringify(payload));
}
