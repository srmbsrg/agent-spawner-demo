/**
 * Agent Spawning System — Core Types
 *
 * Defines the full type surface for a dynamic agent instantiation system.
 * Agents are created from templates, which support inheritance — a child template
 * merges capabilities from its parent, allowing specialised agents to build on
 * a shared base without duplication.
 */

// ---------------------------------------------------------------------------
// Agent lifecycle states
// ---------------------------------------------------------------------------
export type AgentStatus =
  | 'initializing'  // Bootstrapping — may be loading config or connecting
  | 'active'        // Running and accepting tasks
  | 'idle'          // Running but currently taskless
  | 'paused'        // Suspended; will resume without re-init
  | 'terminated'    // Permanently stopped; removed from registry
  | 'error';        // Unrecoverable failure state

// ---------------------------------------------------------------------------
// Agent type taxonomy
// ---------------------------------------------------------------------------
export type AgentType =
  | 'document_processor'
  | 'data_analyzer'
  | 'communication'
  | 'monitoring'
  | 'content_creator'
  | 'integration'
  | 'orchestrator'
  | 'custom';

// ---------------------------------------------------------------------------
// Capability surface — what an agent can DO
// ---------------------------------------------------------------------------
export type CapabilityType =
  | 'document_extraction'
  | 'data_validation'
  | 'email_analysis'
  | 'response_drafting'
  | 'metric_analysis'
  | 'anomaly_detection'
  | 'report_generation'
  | 'api_integration'
  | 'workflow_execution'
  | 'llm_reasoning'
  | 'memory_access'
  | 'event_publishing'
  | 'human_escalation';

// ---------------------------------------------------------------------------
// Template — blueprint for creating agents
// Supports single-level inheritance via `extendsTemplate`
// ---------------------------------------------------------------------------
export interface AgentTemplate {
  id: string;
  name: string;
  type: AgentType;
  description: string;
  version: string;

  /** Capabilities this template provides */
  capabilities: CapabilityType[];

  /** JSON Schema–style config validator */
  configSchema: ConfigSchema;

  /** Default config values merged with spawn-time overrides */
  defaultConfig: Record<string, unknown>;

  /** Parent template ID — capabilities are merged recursively */
  extendsTemplate?: string;

  /** Resource quotas for this agent type */
  resources: AgentResources;

  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigSchema {
  type: 'object';
  properties: Record<string, ConfigProperty>;
  required: string[];
}

export interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  default?: unknown;
  enum?: unknown[];
  items?: ConfigProperty;
}

export interface AgentResources {
  maxConcurrentTasks: number;
  memoryMB: number;
  cpuPercent: number;
  timeoutSeconds: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Agent instance — a running agent created from a template
// ---------------------------------------------------------------------------
export interface AgentInstance {
  id: string;
  templateId: string;
  name: string;
  status: AgentStatus;

  /** Merged config: template defaults + spawn-time overrides */
  config: Record<string, unknown>;

  /** Resolved capability set (includes parent template capabilities) */
  capabilities: CapabilityType[];

  /** Runtime performance counters */
  metrics: AgentMetrics;

  /** Last health check result */
  health: AgentHealth;

  createdAt: Date;
  startedAt?: Date;
  lastActiveAt?: Date;
  terminatedAt?: Date;

  /** Task currently being executed, if any */
  currentTask?: AgentTask;
}

export interface AgentTask {
  id: string;
  description: string;
  startedAt: Date;
  progress: number; // 0–100
  metadata?: Record<string, unknown>;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number;   // percentage
  averageTaskDuration: number; // ms
  totalRuntime: number;        // ms
  memoryUsageMB: number;
}

export interface AgentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Spawn request / result
// ---------------------------------------------------------------------------
export interface SpawnRequest {
  templateId: string;
  name?: string;
  config?: Record<string, unknown>;
  autoStart?: boolean;
  tags?: string[];
}

export interface SpawnResult {
  success: boolean;
  agentId?: string;
  agent?: AgentInstance;
  error?: string;
}

// ---------------------------------------------------------------------------
// Commands sent to running agents
// ---------------------------------------------------------------------------
export type AgentCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'terminate' }
  | { type: 'restart' }
  | { type: 'updateConfig'; config: Record<string, unknown> }
  | { type: 'assignTask'; task: { id: string; description: string; payload?: Record<string, unknown> } };
