# agent-spawner-demo

Dynamic agent instantiation with **template inheritance**, capability resolution, and full lifecycle management.

Extracted and cleaned from a production multi-agent ERP platform. The pattern scales from toy demos to systems running dozens of concurrent specialised agents.

---

## What problem does this solve?

Most agent systems hard-code agent types at compile time. When you need a new agent variant you fork the class, duplicate config, and manually track capabilities. This breaks down fast:

- Adding a "Senior Document Processor" that inherits everything from "Document Processor" means copy-pasting a 200-line class.
- Capabilities drift — the copy-paste variant quietly loses an update made to the original.
- Lifecycle management (start / pause / terminate / restart) is scattered across callers.

This codebase treats agents as **data** — templates define blueprints, the spawner resolves inheritance at instantiation time, and a single command dispatcher handles all lifecycle transitions.

---

## Architecture

```
SpawnRequest
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Spawner                                  │
│                                                                  │
│  1. Look up template (getTemplate)                              │
│  2. Walk inheritance chain → resolveCapabilities()              │
│  3. Merge config: defaults → caller overrides                   │
│  4. Validate config against configSchema                        │
│  5. Create AgentInstance, register in Map<id, AgentInstance>    │
│  6. Emit "agent.spawned" event                                  │
│  7. (optional) auto-start → startAgent()                        │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
AgentInstance (in-memory; swap Map for Redis for horizontal scale)
```

### Template inheritance chain

```
tpl-communication
  └── tpl-orchestrator  (extendsTemplate: "tpl-communication")
```

When you spawn an orchestrator, `resolveCapabilities` walks up to `tpl-communication` and merges its capabilities into the orchestrator's own set — deduplicating via a `Set`. Diamond inheritance is safe.

### Command dispatch

`sendCommand` accepts a discriminated union (`AgentCommand`) that TypeScript enforces exhaustive handling of. Adding a new command variant to the type will produce a compile error if you forget to handle it in the switch.

---

## File structure

```
src/
├── types.ts       — All types (AgentStatus, CapabilityType, AgentTemplate, SpawnRequest…)
├── templates.ts   — Built-in template definitions + getTemplate() / listTemplateIds()
├── spawner.ts     — Core spawn/start/pause/terminate/sendCommand logic
└── example.ts     — Runnable demo showing spawn, task assignment, config update, terminate
```

---

## Key technical decisions

### Why an in-memory Map?

It's the simplest possible registry that works correctly. In production you replace it with Redis (`HSET agent:{id} ...`) and the rest of the code doesn't change — the Map is fully encapsulated inside `spawner.ts`.

### Why not use classes?

Functions + plain objects avoid the pitfalls of prototype chains, `this`-binding bugs, and make serialisation trivial. Every `AgentInstance` is a plain JSON-serialisable object — you can `JSON.stringify` it and ship it over a WebSocket without any special logic.

### Why validate config at spawn time?

Fail fast. A misconfigured agent that starts up and then silently misbehaves is much harder to debug than a spawn-time error with a clear message like `Missing required config field: "dataSource"`.

### Why capability inheritance instead of composition?

Templates have a clear is-a relationship (orchestrator IS-A communication agent). Composition is better when you want mix-and-match; inheritance is better when you want a contract — "orchestrators always have all communication capabilities." Both patterns work; pick the one that fits your domain semantics.

---

## How to run the demo

```bash
# Prerequisites: Node.js 20+, TypeScript 5+
npm install
npx ts-node src/example.ts
```

Expected output:

```
[AgentSpawner] agent.spawned { agentId: "agent-a1b2c3d4", templateId: "tpl-orchestrator", ... }
[AgentSpawner] agent.started { agentId: "agent-a1b2c3d4", name: "MyOrchestrator" }
Spawned: agent-a1b2c3d4  status=active
Capabilities: workflow_execution, api_integration, llm_reasoning, memory_access,
              event_publishing, human_escalation, email_analysis, response_drafting
[AgentSpawner] agent.task_started { taskId: "task-001", ... }
After task assignment: status=active  currentTask=task-001
[AgentSpawner] agent.config_updated { ... }
After config update: maxEscalationDepth=5
[AgentSpawner] agent.terminated { agentId: "agent-a1b2c3d4" }
After terminate: undefined (removed from registry)
```

---

## Extending the system

**Add a new template:** Push to `builtInTemplates` in `templates.ts`. No other wiring needed.

**Persist agents:** Replace `activeAgents` Map operations with database calls. Keep the same function signatures — callers won't notice.

**Add a new lifecycle command:** Add a variant to the `AgentCommand` union in `types.ts`, then handle it in the `switch` in `sendCommand`. TypeScript will remind you if you forget.

**Real event bus:** Replace `emitEvent` in `spawner.ts` with your pub-sub client (EventEmitter, Redis Streams, Kafka, etc.).

---

## Where this fits in a larger system

```
External Trigger (cron / webhook / UI)
        │
        ▼
  Agent Spawner  ──creates──▶  AgentInstance
        │                           │
        │                      executes tasks
        │                           │
        ▼                           ▼
  Event Bus  ◀────────────  emitEvent()
        │
        ▼
  Other Agents / Monitoring / UI
```

In the source system this was extracted from, a fleet of 8–12 domain agents (Finance, HR, Sales, Inventory, Compliance…) ran concurrently, each with persistent memory and escalation paths to a top-level orchestrator agent.
