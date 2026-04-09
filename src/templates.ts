/**
 * Built-in Agent Templates
 *
 * Pre-defined blueprints for common agent types. Each template specifies:
 *  - Capabilities the agent possesses
 *  - A JSON Schema–style configSchema for spawn-time validation
 *  - Default config values (merged / overridden at spawn time)
 *  - Resource quotas
 *
 * Templates can extend each other via `extendsTemplate`.
 * The spawner resolves the full capability set by walking the inheritance chain.
 *
 * Adding a new template is as simple as pushing to `builtInTemplates` — no
 * registry wiring required.
 */

import type { AgentTemplate } from './types';

// ---------------------------------------------------------------------------
// Shared base — every template implicitly inherits these resource defaults.
// Concrete templates override the fields they need.
// ---------------------------------------------------------------------------
const BASE_RESOURCES = {
  maxConcurrentTasks: 5,
  memoryMB: 512,
  cpuPercent: 25,
  timeoutSeconds: 300,
  retryAttempts: 3,
};

const BASE_META = {
  version: '1.0.0',
  defaultConfig: {} as Record<string, unknown>,
  tags: [] as string[],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-03-05'),
};

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------
export const builtInTemplates: AgentTemplate[] = [
  // ── Document Processor ──────────────────────────────────────────────────
  {
    ...BASE_META,
    id: 'tpl-document-processor',
    name: 'Document Processor',
    type: 'document_processor',
    description:
      'Processes structured and unstructured documents (invoices, contracts, reports). ' +
      'Extracts fields, validates content, and stores memory for downstream agents.',
    capabilities: [
      'document_extraction',
      'data_validation',
      'llm_reasoning',
      'memory_access',
      'event_publishing',
    ],
    configSchema: {
      type: 'object',
      properties: {
        documentTypes: {
          type: 'array',
          description: 'Document types this agent handles',
          items: { type: 'string', description: 'e.g. invoice | contract | report' },
          default: ['invoice', 'contract', 'report'],
        },
        extractionConfidence: {
          type: 'number',
          description: 'Minimum extraction confidence score (0–1). Below this triggers human review.',
          default: 0.85,
        },
        autoValidate: {
          type: 'boolean',
          description: 'Whether to automatically run field-level validation after extraction.',
          default: true,
        },
      },
      required: ['documentTypes'],
    },
    defaultConfig: {
      documentTypes: ['invoice', 'contract', 'report'],
      extractionConfidence: 0.85,
      autoValidate: true,
    },
    resources: { ...BASE_RESOURCES, maxConcurrentTasks: 10, memoryMB: 1024, cpuPercent: 40, timeoutSeconds: 120 },
    tags: ['documents', 'extraction', 'validation'],
  },

  // ── Data Analyzer ────────────────────────────────────────────────────────
  {
    ...BASE_META,
    id: 'tpl-data-analyzer',
    name: 'Data Analyzer',
    type: 'data_analyzer',
    description:
      'Monitors metrics, detects anomalies using configurable z-score thresholds, ' +
      'and generates natural-language insight summaries via LLM.',
    capabilities: [
      'metric_analysis',
      'anomaly_detection',
      'llm_reasoning',
      'memory_access',
      'event_publishing',
    ],
    configSchema: {
      type: 'object',
      properties: {
        dataSource: {
          type: 'string',
          description: 'Primary data source identifier (e.g. "sales_db", "metrics_api")',
        },
        anomalyThreshold: {
          type: 'number',
          description: 'Standard deviations from mean before flagging as anomaly',
          default: 2.5,
        },
        monitoringIntervalSeconds: {
          type: 'number',
          description: 'Polling interval in seconds',
          default: 60,
        },
      },
      required: ['dataSource'],
    },
    defaultConfig: { anomalyThreshold: 2.5, monitoringIntervalSeconds: 60 },
    resources: BASE_RESOURCES,
    tags: ['data', 'analytics', 'monitoring'],
  },

  // ── Communication Agent ──────────────────────────────────────────────────
  {
    ...BASE_META,
    id: 'tpl-communication',
    name: 'Communication Agent',
    type: 'communication',
    description:
      'Monitors email/message channels, drafts context-aware replies, and escalates ' +
      'high-priority items to a human or parent agent.',
    capabilities: [
      'email_analysis',
      'response_drafting',
      'llm_reasoning',
      'memory_access',
      'event_publishing',
      'human_escalation',
    ],
    configSchema: {
      type: 'object',
      properties: {
        channels: {
          type: 'array',
          description: 'Message channels to monitor',
          items: { type: 'string', description: 'e.g. email | slack | sms' },
          default: ['email'],
        },
        autoReply: {
          type: 'boolean',
          description: 'Send drafted responses automatically without human approval',
          default: false,
        },
        urgencyKeywords: {
          type: 'array',
          description: 'Keywords that trigger immediate escalation',
          items: { type: 'string', description: 'Keyword' },
          default: ['urgent', 'critical', 'ASAP'],
        },
      },
      required: ['channels'],
    },
    defaultConfig: {
      channels: ['email'],
      autoReply: false,
      urgencyKeywords: ['urgent', 'critical', 'ASAP'],
    },
    resources: { ...BASE_RESOURCES, memoryMB: 768 },
    tags: ['communication', 'email', 'drafting'],
  },

  // ── Orchestrator (extends communication for cross-domain messaging) ──────
  {
    ...BASE_META,
    id: 'tpl-orchestrator',
    name: 'Orchestrator',
    type: 'orchestrator',
    description:
      'Top-level coordination agent. Delegates tasks to specialists, synthesises their ' +
      'outputs, and handles cross-domain conflicts or escalations.',
    capabilities: [
      'workflow_execution',
      'api_integration',
      'llm_reasoning',
      'memory_access',
      'event_publishing',
      'human_escalation',
    ],
    extendsTemplate: 'tpl-communication', // inherits communication capabilities at spawn time
    configSchema: {
      type: 'object',
      properties: {
        subordinateAgentIds: {
          type: 'array',
          description: 'IDs of agents this orchestrator coordinates',
          items: { type: 'string', description: 'Agent ID' },
          default: [],
        },
        maxEscalationDepth: {
          type: 'number',
          description: 'How many levels of sub-orchestrators before forcing human review',
          default: 2,
        },
      },
      required: [],
    },
    defaultConfig: { subordinateAgentIds: [], maxEscalationDepth: 2 },
    resources: { ...BASE_RESOURCES, maxConcurrentTasks: 20, memoryMB: 2048 },
    tags: ['orchestration', 'coordination', 'hierarchy'],
  },
];

// ---------------------------------------------------------------------------
// Template registry helpers
// ---------------------------------------------------------------------------

/** Lookup a template by ID (built-ins only — extend with a DB query in prod) */
export function getTemplate(id: string): AgentTemplate | undefined {
  return builtInTemplates.find((t) => t.id === id);
}

/** All registered template IDs */
export function listTemplateIds(): string[] {
  return builtInTemplates.map((t) => t.id);
}
