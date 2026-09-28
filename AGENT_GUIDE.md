# Agent Foundations Guide

A practical reference for this project — how everything fits together, how to extend the agent with new tools, and how the three tracks relate to each other.

---

## Table of Contents

### Track 1 — Shopping Agent
1. [Project Setup](#1-project-setup)
2. [Chat Agent](#2-the-chat-agent)
3. [Tools — How to Add New Ones](#3-tools--how-to-add-new-ones)
4. [Generative UI — Rendering Tool Results as Components](#4-generative-ui--rendering-tool-results-as-components)
5. [Workflows — Making the Agent Durable](#5-workflows--making-the-agent-durable)

### Track 2 — Store Admin Agent
6. [Admin Agent Setup](#6-admin-agent-setup)
7. [Sandbox — Code Execution](#7-sandbox--code-execution)
8. [Persistent Memory](#8-persistent-memory)

### Track 3 — Agent Framework (Eve)
9. [Eve Setup](#9-eve-setup)
10. [Eve Tools](#10-eve-tools)
11. [Eve Skills](#11-eve-skills)
12. [Eve Subagents](#12-eve-subagents)

### Reference
13. [Quick Reference & File Map](#13-quick-reference--file-map)

---

## Track 1 — Shopping Agent

---

## 1. Project Setup

### Prerequisites

- Node.js (managed via Volta)
- pnpm — install via `volta install pnpm` if missing
- A Vercel account

### First-time setup

```bash
# 1. Clone the repo
git clone https://github.com/<your_username>/vercel-agent-foundations-certification.git
cd vercel-agent-foundations-certification

# 2. Install the Vercel CLI and link the project
npm i -g vercel
vercel link

# 3. Pull environment variables from Vercel
vercel env pull

# 4. Install dependencies
pnpm install

# 5. Start the dev server
pnpm dev
```

The app runs at **http://localhost:3000**.

### Setup with an API key (alternative)

If you were given an AI Gateway API key instead of Vercel project access, create `.env.local` manually:

```bash
BYPASS_SECRET=<provided value>
API_BASE_URL=https://vercel-agentic-swag-store-api.vercel.app/api
AI_GATEWAY_API_KEY=<your key>
```

Add `AI_GATEWAY_API_KEY` to your Vercel project environment variables and redeploy.

### Environment variables explained

| Variable | Purpose |
|---|---|
| `BYPASS_SECRET` | Sent as `x-vercel-protection-bypass` on every API call. **Never** expose to the client — no `NEXT_PUBLIC_` prefix. |
| `API_BASE_URL` | Base URL for the Swag Store API. Defaults to the hosted API if omitted. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (API-key setup only). |

---

## 2. The Chat Agent

### Where it lives

| File | Purpose |
|---|---|
| `lib/agent.ts` | Agent definition, model, tools, instructions, exported UI types |
| `app/api/chat/route.ts` | HTTP endpoint the frontend posts messages to |
| `components/agent-chat.tsx` | Chat UI — renders messages and tool results |

### Creating the agent

```typescript
// lib/agent.ts
import { ToolLoopAgent } from "ai";

export const shoppingAgent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions: `You are a friendly shopping assistant for Ship It Shop...`,
  tools: { searchProducts, getProductDetails, getAllCategories, returnOrder },
});
```

`ToolLoopAgent` runs the agent loop for you: it calls tools, feeds results back to the model, and repeats until the model produces a final text response. No orchestration code needed.

### The API route

```typescript
// app/api/chat/route.ts
import { createAgentUIStreamResponse } from "ai";
import { shoppingAgent } from "@/lib/agent";

export const POST = async (req: Request) => {
  const { messages } = await req.json();
  return createAgentUIStreamResponse({ agent: shoppingAgent, uiMessages: messages });
};
```

### The frontend hook

```typescript
// components/agent-chat.tsx
const { messages, sendMessage } = useChat<ShoppingAgentUIMessage>();
```

`useChat` manages message state, streaming, and posts to the API route. The generic type parameter gives full TypeScript types for every tool's message parts.

### Writing good instructions

The `instructions` string is the system prompt. Think of it as briefing a new employee:

- **Role** — who the agent is, what store it works for
- **Scope** — what to help with, what to decline
- **Tone** — helpful, concise, professional, etc.
- **Tool guidance** — explicit rules for when to reach for which tool

Example structure:

```
You are a friendly and knowledgeable shopping assistant for Ship It Shop.

## What you help with
- Browsing and discovering products
- Answering questions about specific items, sizing, availability
- Making recommendations

## Tone
- Warm and concise. Light dev humor is fine, no sales pressure.

## What's out of scope
- General coding help or unrelated tech questions

## Tool usage
- Broad product questions → searchProducts
- Specific product details → getProductDetails (chain after searchProducts if no slug yet)
- Category browsing → getAllCategories before searchProducts
- Returns → returnOrder (ask for order ID and reason if not provided)
```

---

## 3. Tools — How to Add New Ones

Tools are server-side functions the agent can call to fetch data or take actions. They all live in `lib/tools.ts`.

### Anatomy of a tool

Every tool has three parts:

```typescript
import { tool } from "ai";
import { z } from "zod";

export const myTool = tool({
  // 1. DESCRIPTION — the model reads this to decide when to call the tool.
  //    Write it for the model, not the developer. Cover phrasings users might say.
  description: `Fetch current weather for a city. Use when the user asks about weather conditions.`,

  // 2. INPUT SCHEMA — Zod schema for what arguments the tool accepts.
  //    Add .describe() to each field — the model uses these as hints when filling inputs.
  inputSchema: z.object({
    city: z.string().describe("The city name, e.g. 'San Francisco'"),
    units: z.enum(["celsius", "fahrenheit"]).optional().describe("Temperature units"),
  }),

  // 3. EXECUTE — runs server-side when the model calls the tool.
  //    Return plain JSON; the model reads this as the tool result.
  execute: async ({ city, units }) => {
    const data = await fetchWeather(city, units);
    return { temperature: data.temp, condition: data.condition };
  },
});
```

### Step-by-step: adding a new tool

**Step 1 — Write the tool in `lib/tools.ts`**

```typescript
export const getProductDetails = tool({
  description: `Fetch full details for a single product by its ID or slug.
    Use when the user asks about a specific product — e.g. "tell me more about
    the black hoodie", "is X in stock?", "what sizes does Y come in?".
    Prefer this over searchProducts once you know which product the user means.`,
  inputSchema: z.object({
    idOrSlug: z.string().describe("Product ID or URL slug from a prior searchProducts result"),
  }),
  execute: async ({ idOrSlug }) => {
    try {
      const [product, stock] = await Promise.all([
        getProductById(idOrSlug),
        getProductStock(idOrSlug),
      ]);
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        currency: product.currency,
        images: product.images,      // all images, not just the first
        tags: product.tags,
        inStock: stock.inStock,
        lowStock: stock.lowStock,
        stock: stock.stock,
      };
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Unknown error";
      return { error: message };
    }
  },
});
```

**Step 2 — Register it on the agent in `lib/agent.ts`**

```typescript
import { searchProducts, getProductDetails, getAllCategories, returnOrder } from "@/lib/tools";

export const shoppingAgent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  tools: { searchProducts, getProductDetails, getAllCategories, returnOrder },
  instructions: `...`,
});
```

**Step 3 — Update the instructions**

Tell the model when to use the new tool. Be explicit — the model reasons from your description:

```
When the user asks about a specific product, use getProductDetails.
If you don't have its ID or slug yet, call searchProducts first to find it,
then call getProductDetails with the slug.
```

That's it. `ToolLoopAgent` handles chaining calls automatically.

### Key patterns

**Tool chaining** — the agent can call tools in sequence. Outputs from one tool become inputs to the next. You don't write orchestration code — you describe the intent in the instructions.

**Dynamic lookup instead of hardcoded enums** — instead of a static list of valid categories, use `getAllCategories` at runtime. Catalog changes require no code changes:

```typescript
// Don't do this — breaks when the catalog changes
category: z.enum(["tshirts", "hoodies", "hats"])

// Do this instead
category: z.string().optional().describe(
  "Category slug. Use the getAllCategories tool to get valid slugs."
)
```

**Graceful error handling** — always catch and return structured errors so the model can explain the failure rather than crashing:

```typescript
execute: async ({ query }) => {
  try {
    return await someApiCall(query);
  } catch (err) {
    const message = err instanceof ApiRequestError ? err.message : "Unknown error";
    return { error: message };
  }
},
```

**Parallel fetches** — when a tool needs data from multiple sources, fetch them together:

```typescript
const [product, stock] = await Promise.all([
  getProductById(idOrSlug),
  getProductStock(idOrSlug),
]);
```

**Making a tool durable** — add `"use step"` as the very first line of `execute` when using Workflows. This makes the tool independently retried and cached (see [Workflows](#5-workflows--making-the-agent-durable)):

```typescript
execute: async ({ query }) => {
  "use step";
  // rest of function...
},
```

---

## 4. Generative UI — Rendering Tool Results as Components

By default the agent describes tool results in plain text. Generative UI lets you render real React components instead — a product card, a list of results, a terminal block, etc.

### How it works

The AI SDK encodes each tool call as a typed message part: `type: "tool-{toolName}"`. You export types from the agent, build one component per tool, then switch on the part type in the chat renderer.

### Step 1 — Export invocation types from `lib/agent.ts`

```typescript
import {
  ToolLoopAgent,
  type InferAgentUIMessage,
  type UIToolInvocation,
} from "ai";

export const shoppingAgent = new ToolLoopAgent({ ... });

// Derive the full message type — pass this to useChat<T>
export type ShoppingAgentUIMessage = InferAgentUIMessage<typeof shoppingAgent>;

// One invocation type per tool you want to render as a component
export type SearchProductsToolInvocation = UIToolInvocation<typeof searchProducts>;
export type ProductDetailsToolInvocation = UIToolInvocation<typeof getProductDetails>;
```

### Step 2 — Build a component for the tool

Handle three states: loading, error, success.

```typescript
// components/agent-product-card.tsx
"use client";
import type { ProductDetailsToolInvocation } from "@/lib/agent";

export function AgentProductCard({
  invocation,
}: {
  invocation: ProductDetailsToolInvocation;
}) {
  // Loading — tool input is streaming in or available but not yet executed
  if (
    invocation.state === "input-streaming" ||
    invocation.state === "input-available"
  ) {
    return <div>Looking up "{invocation.input?.idOrSlug}"…</div>;
  }

  if (invocation.state !== "output-available") return null;

  const output = invocation.output;
  if (!output) return null;

  // Error
  if ("error" in output) {
    return <div className="text-destructive">{output.error as string}</div>;
  }

  // Success
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <img src={output.images[0]} alt={output.name} className="w-full aspect-4/3 object-cover" />
      <div className="p-4 space-y-2">
        <h3 className="font-semibold">{output.name}</h3>
        <p className="text-sm text-muted-foreground">{output.description}</p>
        <span>{output.inStock ? "In stock" : "Out of stock"}</span>
        <a href={`/products/${output.slug}`}>View product →</a>
      </div>
    </div>
  );
}
```

### Step 3 — Add a case in the chat renderer

```typescript
// components/agent-chat.tsx
import type {
  ShoppingAgentUIMessage,
  SearchProductsToolInvocation,
  ProductDetailsToolInvocation,
} from "@/lib/agent";
import { AgentProductList } from "./agent-product-list";
import { AgentProductCard } from "./agent-product-card";

const { messages } = useChat<ShoppingAgentUIMessage>();

// Inside the message parts map:
switch (p.type) {
  case "text":
    return <MessageResponse>{p.text}</MessageResponse>;

  case "tool-searchProducts":
    return <AgentProductList invocation={p as SearchProductsToolInvocation} />;

  case "tool-getProductDetails":
    return <AgentProductCard invocation={p as ProductDetailsToolInvocation} />;

  default:
    return null;
}
```

> **Naming rule**: the case is always `"tool-"` + the exact object key used in `tools: { ... }` on the agent.

---

## 5. Workflows — Making the Agent Durable

### The problem

Long-running operations are fragile when run inline in a tool. If the server restarts, progress is lost. If step 3 of 4 fails, steps 1–2 must repeat (with real side-effects: duplicate notifications, duplicate charges).

### The solution: Vercel Workflows

Workflows give you:

- **Automatic retries** — failed steps retry up to 3× by default
- **Checkpointing** — completed steps are cached; crashes resume from where they left off, never re-running completed work
- **Background execution** — the agent responds immediately; work continues in the background

Under the hood: Vercel Functions execute the code, Vercel Queues schedule retries, and a managed event log records every step for deterministic replay.

### Setup

```bash
pnpm add workflow
pnpm add @workflow/ai
```

Wrap `next.config.mjs` with `withWorkflow` — this applies build-time transforms that register all `"use workflow"` functions:

```javascript
import { withWorkflow } from "workflow/next";
export default withWorkflow(nextConfig);
```

> **After adding `withWorkflow` or any new `"use workflow"` file, always restart the dev server** — and clear the cache if needed: `rm -rf .next && pnpm dev`.

### The two directives

| Directive | Where you put it | What it does |
|---|---|---|
| `"use workflow"` | First line of a `async function` | Durable orchestrator — survives restarts, resumes exactly where it left off |
| `"use step"` | First line of a `async function` | Unit of work — retried automatically on failure, result cached so it never re-runs on replay |

### Example: return workflow with individual steps

```typescript
// lib/workflows/return-flow.ts
import { getOrder, notifyReturnInProcess, preauthorizeRefund, createReturn } from "@/lib/api";
import type { Order, Return } from "@/lib/types";

export async function returnFlow(orderId: string, reason: string) {
  "use workflow";

  const order = await getOrderStep(orderId);           // step 1 — fetch order
  await notifyReturnInProcessStep(orderId);            // step 2 — notify customer
  await preauthorizeRefundStep(orderId);               // step 3 — slow ~30s, only runs once
  const filed = await createReturnStep(order, reason); // step 4 — may fail & retry

  return { orderId, returnId: filed.id };
}

async function getOrderStep(orderId: string): Promise<Order> {
  "use step";
  return getOrder(orderId);
}

async function notifyReturnInProcessStep(orderId: string): Promise<void> {
  "use step";
  await notifyReturnInProcess(orderId);
}

async function preauthorizeRefundStep(orderId: string): Promise<void> {
  "use step";
  await preauthorizeRefund(orderId);
}

async function createReturnStep(order: Order, reason: string): Promise<Return> {
  "use step";
  return createReturn({
    orderId: order.id,
    items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    reason,
  });
}
```

> **Why separate steps matter**: if everything is in one step and `createReturn` fails, all three previous API calls repeat on retry — the customer is notified again, the refund is pre-authorized again. With separate steps, only the failing step retries; the rest replay from cache.

### Starting a workflow from a tool

Use `start()` — fires the workflow in the background and returns a `runId` immediately:

```typescript
import { start } from "workflow/api";
import { returnFlow } from "./workflows/return-flow";

execute: async ({ orderId, reason }) => {
  "use step"; // required: wrapping start() in a step lets the parent workflow track it
  const run = await start(returnFlow, [orderId, reason]);
  return { runId: run.runId, message: `Return started for order ${orderId}.` };
},
```

### Making the whole agent durable

Replace `ToolLoopAgent` with `DurableAgent` inside a workflow:

```typescript
// lib/workflows/chat-flow.ts
import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";
import { convertToModelMessages, type UIMessage, type UIMessageChunk } from "ai";
import { searchProducts, getAllCategories, returnOrder, getProductDetails } from "@/lib/tools";

export async function chatFlow(messages: UIMessage[]) {
  "use workflow";

  const agent = new DurableAgent({
    model: "anthropic/claude-sonnet-4.6",
    instructions: `...`,
    tools: { searchProducts, getAllCategories, returnOrder, getProductDetails },
  });

  await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<UIMessageChunk>(), // streams output to the run's readable
  });
}
```

Update the chat route to start the workflow:

```typescript
// app/api/chat/route.ts
import { start } from "workflow/api";
import { chatFlow } from "@/lib/workflows/chat-flow";
import { createUIMessageStreamResponse } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const run = await start(chatFlow, [messages]);
  return createUIMessageStreamResponse({ stream: run.readable });
}
```

Add `"use step"` to every tool's `execute` so each tool call is independently durable.

### Debugging workflows

```bash
npx workflow inspect runs --web
```

Opens a dashboard showing every run, step status, retry counts, inputs and outputs.

### Common errors

| Error | Cause | Fix |
|---|---|---|
| `WorkflowNotRegisteredError` | Stale dev server — new `"use workflow"` function not picked up | `rm -rf .next && pnpm dev` |
| `Could not resolve "@workflow/ai/agent"` | `@workflow/ai` not installed | `pnpm add @workflow/ai` |
| `Could not find executable "pnpm"` (Volta) | pnpm not in Volta toolchain | `volta install pnpm` |

---

## Track 2 — Store Admin Agent

---

## 6. Admin Agent Setup

A separate agent at `/admin` for store back-office operations. It has read-only access to returns, inventory, sales, and support data. It cannot modify store data.

**Access:** http://localhost:3000/admin — password: `letmeinadminagent`

### Files

| File | Purpose |
|---|---|
| `lib/workflows/admin-chat-flow.ts` | DurableAgent definition with admin tools and instructions |
| `app/api/admin/chat/route.ts` | HTTP endpoint — starts the adminChatFlow workflow |
| `components/admin-agent-chat.tsx` | Chat UI pointing to `/api/admin/chat` |

### Admin-only tools (added to `lib/tools.ts`)

All admin tools use `"use step"` for durable, retried execution.

| Tool | What it does |
|---|---|
| `getSupportTickets` | Lists tickets — filterable by date range, status, priority, category, assignee |
| `getReturnsHistory` | Historical returns with decisions (approved/rejected/needs_info) and refund amounts in cents |
| `getInventoryStock` | Stock levels sorted by availability — out-of-stock and low-stock items first |
| `getSalesAnalytics` | Sales totals by product — units sold, order count, revenue in cents |

The admin agent also reuses `searchProducts` and `getAllCategories` from the shopping agent tools.

### Admin agent instructions

The system prompt should emphasize:
- Give concrete numbers and date ranges, not vague summaries
- Summarize across data rows rather than dumping raw output
- Clearly state it has **read-only** access — it cannot modify orders, prices, or inventory

### Example queries the admin agent handles

- "Which products have the worst return rate this month?"
- "What's our refund total vs revenue ratio for last week?"
- "Are there any low-stock items that are also top sellers?"
- "Summarize the open urgent support tickets"

These require the agent to call multiple tools and synthesize the results — `ToolLoopAgent` / `DurableAgent` handles the sequencing automatically.

---

## 7. Sandbox — Code Execution

The admin agent can run arbitrary shell and Python commands in an isolated, persistent environment. This is useful for multi-step computations the model can't reliably do by reasoning alone — aggregations, ratio calculations, data joins across tool outputs.

### Install

```bash
pnpm add @vercel/sandbox
```

### How sandboxes work

Named sandboxes **snapshot their filesystem** when they stop. The next call resumes from that snapshot — installed packages, files written to disk, and scripts all persist across chat turns.

### Sandbox utility

```typescript
// lib/sandbox.ts
import { Sandbox } from "@vercel/sandbox";

export const SANDBOX_NAME = "admin-agent";

export async function getSandbox() {
  try {
    return await Sandbox.get({ name: SANDBOX_NAME });
  } catch {
    return await Sandbox.create({
      name: SANDBOX_NAME,
      snapshotExpiresInSeconds: 60 * 60 * 24 * 7, // 7 days
      timeoutInSeconds: 60 * 45,                   // 45 min max
    });
  }
}
```

### Bash tool

```typescript
export const bash = tool({
  description: `Run a shell command in a persistent sandbox. Use for multi-step computation,
    Python scripts, and data aggregation. Write JSON to /tmp with a heredoc, then process
    with Python. Note: all currency values from the API are in cents.`,
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
  }),
  execute: async ({ command }) => {
    "use step";
    const sandbox = await getSandbox();
    const result = await sandbox.runCommand("bash", ["-lc", command]);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
});
```

### Recommended agent instructions for the sandbox

```
You have access to a persistent bash sandbox. For multi-step inference across many rows,
write JSON to /tmp using a heredoc, then run Python to compute. Never eyeball aggregates
manually. Use python3 (never python). All prices are in cents — divide by 100 for dollars.
```

### Rendering the bash tool in the UI

Add a `case "tool-bash"` to the message renderer with a terminal-style component:
- Show the command being run
- Stdout in light monospace text
- Stderr in red
- A spinner while `state !== "output-available"`

### Verifying in production

After deploying, go to the Vercel dashboard → **Sandboxes** section. You'll see configuration, resource allocation, activity logs, and automatic snapshots.

---

## 8. Persistent Memory

The admin agent can remember things across conversation sessions — user preferences, business context, recurring script locations — by reading and writing a `memories.md` file in the sandbox.

### How it works

At the start of each run, the workflow reads `memories.md` from the sandbox and folds it into the system prompt. The agent can then write to it during the conversation using the bash tool.

### Reading memories

```typescript
// lib/sandbox.ts (add alongside getSandbox)
export async function readMemories(): Promise<string | null> {
  const sandbox = await getSandbox();
  const buffer = await sandbox.readFileToBuffer({ path: "memories.md" });
  return buffer ? new TextDecoder().decode(buffer) : null;
}
```

### Injecting memories into the agent instructions

```typescript
// lib/workflows/admin-chat-flow.ts
const memories = await readMemories();

const agent = new DurableAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions: [
    backOfficeInstructions,
    "## Memory protocol",
    memories
      ? `## Current memories\n\n${memories}`
      : "No memories yet.",
  ].join("\n"),
  tools: { ... },
});
```

### What to save — and what not to

**Save:**
- Presentation preferences ("show as percentages, not raw counts")
- Business context not derivable from data ("Q4 is always high-return season")
- Explanations for past anomalies ("the spike on Nov 3 was a promo code leak")
- Corrections to prior answers

**Don't save:**
- One-off lookups or routine questions
- Data that tools can re-derive on demand

The agent captures preferences opportunistically during conversation — no interview needed. When a user says "show that as a percentage," the agent appends it to memory via bash:

```bash
echo "$(date): User prefers percentages over raw counts" >> memories.md
```

Future sessions automatically apply the preference.

### Reusable scripts pattern

For recurring operational questions, the agent creates Python scripts in `/vercel/sandbox/scripts/` and logs them in memory:

```
## Scripts for common tasks
- top_sellers_last_week.py: top 10 SKUs by units sold in last 7 days
- return_rate_by_category.py: return rate per category for a given date range
```

Script requirements:
- Standard library only — no external packages
- Self-contained and well-commented
- Invoked with `python3` (never `python`)

On the next relevant question, the agent checks memory first, finds the script, and runs it directly — no recomputation needed.

---

## Track 3 — Agent Framework (Eve)

Eve is Vercel's higher-level agent framework: "Next.js, but for agents instead of web apps." It builds on the AI SDK and adds a durable runtime, channels (CLI, web, Slack, cron), and file-based auto-discovery for tools and skills — so you write domain logic, not infrastructure.

---

## 9. Eve Setup

### Requirements

Node.js 24 or newer. Check with `node -v`; upgrade via `nvm install 24` if needed.

### Initialize a new agent

```bash
npx eve@latest init my-agent
```

The CLI will ask:
- **Continuation method**: Start `eve dev`
- **Model provider**: AI Gateway via Project
- **Deployment**: Create a new Vercel project

### Project structure

```
agent/
├── agent.ts          ← agent definition
└── instructions.md   ← identity / system prompt
.env.local
package.json
```

### Agent definition

```typescript
// agent/agent.ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-4.6",
});
```

### Identity instructions

Write `agent/instructions.md` in plain markdown. Define the agent's role, what it knows, and how it should behave. This becomes the system prompt.

### Built-in tools

Every Eve agent automatically includes these tools — no code required:

| Tool | What it does |
|---|---|
| `bash` | Run shell commands |
| `read_file` | Read a file from the filesystem |
| `write_file` | Write a file to the filesystem |
| `web_fetch` | Fetch a URL and return its content |
| `web_search` | Search the web |
| `todo` | Manage a task list |

### Start the dev server

```bash
eve dev
# or for a specific deployment:
pnpm dev https://your-app.vercel.app
```

---

## 10. Eve Tools

In Eve, tools are **auto-discovered from the filesystem**. Drop one file per tool into `agent/tools/` and Eve registers it automatically. The filename becomes the tool name the model sees.

### Environment setup

Add to `.env.local`:

```bash
API_BASE_URL=https://vercel-agentic-swag-store-api.vercel.app/api
BYPASS_SECRET=<your bypass secret>
```

### API helper layer

Create `lib/api.ts` to centralize HTTP logic — URL construction, auth headers, error handling. Export typed functions for each endpoint:

```typescript
// lib/api.ts (excerpt)
export async function listProducts(params?: { page?: number; limit?: number; search?: string; category?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>);
  const res = await fetch(`${process.env.API_BASE_URL}/products?${qs}`, {
    headers: { "x-vercel-protection-bypass": process.env.BYPASS_SECRET! },
  });
  return res.json();
}
```

Endpoints to wrap:

| Function | What it fetches |
|---|---|
| `listProducts` | Products with search, category, featured filters |
| `getProductDetails` | Single product by ID or slug |
| `listHistoricalReturns` | Returns by date range, status, decision |
| `listSupportTickets` | Tickets by status, priority, category, assignee |
| `listStockLevelForProducts` | Inventory with low-stock prioritization |
| `salesTotalsByProduct` | Revenue by product with date range |

### Tool definition pattern

Each file in `agent/tools/` exports a `defineTool`:

```typescript
// agent/tools/list_products.ts
import { defineTool } from "eve";
import { z } from "zod";
import { listProducts } from "../../lib/api";

export default defineTool({
  description: "Search and filter products in the swag store catalog.",
  inputSchema: z.object({
    search: z.string().optional().describe("Free-text search query"),
    category: z.string().optional().describe("Category slug filter"),
    limit: z.number().optional().describe("Max results to return"),
  }),
  execute: async ({ search, category, limit }) => {
    return listProducts({ search, category, limit });
  },
});
```

The file is named `list_products.ts` → the model sees a tool called `list_products`.

### All six tools to create

- `list_products.ts`
- `get_product_details.ts`
- `list_historical_returns.ts`
- `list_support_tickets.ts`
- `list_stock_level_for_products.ts`
- `sales_totals_by_product.ts`

---

## 11. Eve Skills

Skills are **on-demand instruction packages** — markdown files stored in `agent/skills/` that the agent loads when needed, keeping the context window lean. Instead of embedding every workflow in the system prompt permanently, the agent only loads the relevant skill when a user's request matches.

### Why skills

The system prompt has a cost: every token in it is processed on every turn. Skills let you define rich, multi-step workflows in markdown without paying that cost until they're needed.

### Structure

```
agent/skills/
└── weekly-briefing/
    └── SKILL.md
```

`SKILL.md` uses YAML frontmatter:

```markdown
---
name: weekly-briefing
description: >
  Generate a weekly store briefing. Use when the user asks for a weekly recap,
  Monday-morning rundown, store status summary, or similar periodic review.
---

# Weekly Briefing

## Step 1: Gather data in parallel

Issue these four tool calls in a single turn:
- `list_stock_level_for_products` with low-stock filter
- `sales_totals_by_product` with a 7-day window
- `list_historical_returns` with a 7-day window
- `list_support_tickets` with open status, 7-day window

## Step 2: Synthesize

Highlight out-of-stock bestsellers, return clusters, and dominant ticket categories.
Do not dump raw rows — give a concise, scannable brief.

## Step 3: Output format

Use this structure every time for consistency:

## Weekly Store Brief — {date}
### Inventory alerts
### Sales highlights
### Return patterns
### Support summary
```

### How the description is used

The `description` frontmatter is the routing signal. Write it broadly to cover phrasings the user might actually type — not just the formal name:

```yaml
description: >
  Generate a weekly store briefing. Use when the user asks for a weekly recap,
  Monday-morning rundown, store status summary, weekly digest, or similar periodic review.
```

### Loading a skill

The agent has a built-in `load_skill` tool. When a user's message matches a skill's description, the model calls `load_skill("weekly-briefing")` and reads the instructions before proceeding. You write zero orchestration code.

### Key pattern: fan out, then synthesize

Skills work best when they instruct the model to issue multiple tool calls in a single turn (parallel), then synthesize the results into a structured output:

```markdown
## Step 1: Call these in a single turn (parallel):
- `tool_a`
- `tool_b`
- `tool_c`

## Step 2: Combine results and produce a summary.
```

---

## 12. Eve Subagents

Subagents are **specialist agents** that the parent agent can delegate work to. Each has its own model, instructions, tool access, and isolated context window. Eve auto-discovers them and exposes each as a callable tool on the parent.

### When to use subagents

- Tasks needing a different context (e.g., web research that shouldn't pollute the store agent's conversation)
- Work that benefits from a focused, specialized prompt
- Parallelizable specialist work

### Structure

```
agent/subagents/
└── researcher/
    ├── agent.ts
    └── instructions.md
```

### Agent definition

```typescript
// agent/subagents/researcher/agent.ts
import { defineAgent } from "eve";

export default defineAgent({
  // description is the routing signal — the parent reads this to decide when to delegate
  description: `Investigate a topic on the open web and return a concise written brief
    with sources. Use when the parent needs fresh external information like recent
    announcements, product launches, or industry trends not already in the parent's tools.`,
  model: "anthropic/claude-sonnet-4.6",
});
```

### Instructions

```markdown
<!-- agent/subagents/researcher/instructions.md -->
# Researcher

You are a research specialist. The parent agent delegated a topic to you because it
needs fresh external information. You will not see the parent's conversation — the
`message` you received is your entire context.

## How to work

1. **Plan the search.** Identify 2–4 useful queries. Prefer specific, recent phrasing
   ("Vercel announcements 2026") over generic ones ("Vercel news").
2. **Search in parallel.** Issue all `web_search` calls in a single turn.
3. **Read selectively.** Only call `web_fetch` when a snippet suggests the full page is
   worth the context cost.
4. **Synthesize, don't dump.** Combine across sources, call out what's actually new.
```

### Critical design rule

**Subagents receive no parent conversation context.** The only information they get is the `message` string the parent passes when delegating. The subagent's prompt must be fully self-contained — it cannot ask for clarification or reference earlier turns.

This means the parent must embed all necessary context in the delegation message:

```markdown
# In a skill, delegating to the researcher subagent:
- `researcher` subagent with `message`:
  "Investigate Vercel announcements and product launches from the last 60 days.
   The Vercel Swag Store sells t-shirts, hoodies, mugs, hats, stationery, and
   tech accessories. Identify themes that could inspire new swag designs.
   Return a short brief with the most promotable themes and sources."
```

### Example: product ideation skill with subagent

This skill fans out one subagent call and three tool calls in parallel, then synthesizes a structured report:

```markdown
---
name: product-ideation
description: >
  Generate new product ideas for the swag store. Use when the user asks what new
  products to add, wants swag ideas, or asks "what should we make next?"
---

# Product Ideation

## Step 1: Gather inputs in parallel

Issue these four calls in a single turn:

- `researcher` subagent: ask it to find Vercel announcements from the last 60 days
  and identify themes that could inspire new swag
- `sales_totals_by_product` with `from` set to 30 days ago
- `list_historical_returns` with `from` set to 30 days ago
- `list_products` with no filters

## Step 2: Apply noise floors

- Returns are a "pattern" only at 3+ of the same product
- Sales rankings need real volume — if top seller moved <10 units, say "signal is thin"
- Research themes need recency and authority — prefer Vercel's own announcements

## Step 3: Output format

# Product Ideation: {today's date}

## Candidates

### 1. {Product name}
**Category:** {t-shirts | mugs | hoodies | …}
**Pitch:** {One sentence.}
**Why:**
- *Research:* {Specific Vercel theme + source}
- *Sales:* {Category rank, units, revenue}
- *Returns:* {"No pattern" OR "N returns, addressed by…"}
- *Catalog gap:* {Why this isn't already in the store}
```

### The four-layer architecture

| Layer | What it does |
|---|---|
| **Tools** | Typed access to APIs and data |
| **Skills** | Multi-step workflows loaded on demand |
| **Subagents** | Specialist agents with isolated context |
| **Integration skills** | Orchestrate across tools, skills, and subagents together |

---

## 13. Quick Reference & File Map

### Adding a new tool — checklist

- [ ] Write the tool in `lib/tools.ts` with description, Zod input schema, and execute function
- [ ] Add `"use step"` as the first line of `execute` if using workflows
- [ ] Import and add it to `tools: { ... }` in `lib/agent.ts` (or the relevant workflow)
- [ ] Update the `instructions` string — tell the model explicitly when to use it
- [ ] Export a `UIToolInvocation` type in `lib/agent.ts` if you want to render it as a component
- [ ] Create a component in `components/` handling loading, error, and success states
- [ ] Add a `case "tool-{name}"` in the chat renderer switch in `components/agent-chat.tsx`

### File map

```
lib/
  agent.ts                    ← ToolLoopAgent + exported UI types
  tools.ts                    ← all tool definitions (shopping + admin)
  api.ts                      ← typed fetch wrappers (server-only)
  format.ts                   ← formatPrice() helper
  sandbox.ts                  ← getSandbox() + readMemories()
  workflows/
    chat-flow.ts              ← DurableAgent for the shopping chat
    admin-chat-flow.ts        ← DurableAgent for the admin chat
    return-flow.ts            ← return order workflow with individual steps

app/
  (store)/
    page.tsx                  ← homepage (static)
    products/[param]/         ← product detail page (SSG)
    search/                   ← search page (dynamic)
  admin/                      ← admin UI (password protected)
  api/
    chat/route.ts             ← POST handler for shopping agent
    admin/chat/route.ts       ← POST handler for admin agent

components/
  agent-chat.tsx              ← shopping chat UI + message part renderer
  admin-agent-chat.tsx        ← admin chat UI
  agent-product-list.tsx      ← renders searchProducts tool call
  agent-product-card.tsx      ← renders getProductDetails tool call

agent/ (Eve framework)
  agent.ts                   ← defineAgent() config
  instructions.md            ← system prompt / identity
  tools/                     ← one file per tool (auto-discovered)
  skills/                    ← one folder per skill, each with SKILL.md
  subagents/                 ← one folder per subagent, each with agent.ts + instructions.md
```

### Invocation state reference

| State | Meaning |
|---|---|
| `input-streaming` | Tool arguments are still being generated by the model |
| `input-available` | Arguments ready, tool hasn't executed yet |
| `output-available` | Tool has run and returned a result |

### Key package commands

```bash
pnpm dev                          # start dev server
pnpm build                        # production build
rm -rf .next && pnpm dev          # clear cache and restart (after workflow changes)
npx workflow inspect runs --web   # open workflow run dashboard
volta install pnpm                # install pnpm via Volta if missing
pnpm add workflow                 # core workflow runtime
pnpm add @workflow/ai             # DurableAgent (workflow + AI SDK bridge)
pnpm add @vercel/sandbox          # sandbox for code execution
npx eve@latest init my-agent      # scaffold a new Eve agent
```
