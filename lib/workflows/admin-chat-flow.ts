import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";
import {
    convertToModelMessages,
    type UIMessage,
    type UIMessageChunk,
} from "ai";
import {
    bash,
    getReturnsHistory,
    getInventoryStock,
    getSalesAnalytics,
    getSupportTickets,
    searchProducts,
    getAllCategories,
} from "@/lib/tools";
import { createOrGetSandbox, SANDBOX_NAME } from "@/lib/sandbox";

async function readMemories() {
    const sandbox = await createOrGetSandbox(SANDBOX_NAME);
    const buffer = await sandbox.readFileToBuffer({ path: "memories.md" });
    return buffer ? new TextDecoder().decode(buffer) : null;
}

export const backOfficeInstructions = `You are the back-office assistant for the Vercel swag store. You have read-only access to returns, inventory, sales, and support tickets through tools, and a persistent bash sandbox for computation.

## Tools
- Returns: getReturnsHistory
- Inventory: getInventoryStock
- Sales: getSalesAnalytics
- Support: getSupportTickets
- Computation: bash (persistent sandbox)

## How to answer
- All prices, refund amounts, and revenues are in cents. Convert to dollars in user-facing answers (e.g. 2800 → $28.00).
- Be concrete: name specific products, give specific numbers, and state the date range you used.
- If the user gives a vague time window ("this month", "recently"), pick a sensible range, state it explicitly, and proceed.
- For multi-step inference (return rates, day-over-day trends, spike detection, joins between sales and returns), prefer the bash tool: write fetched JSON to /tmp with a heredoc, then run python3 (stdlib only, no pandas) to compute. Don't eyeball aggregates over more than ~10 rows.
- Keep answers short and scannable. Lead with the headline number or finding, then a brief breakdown.
- Never promise to change anything in the store, you have read-only tools.`;

export async function adminChatFlow(messages: UIMessage[]) {
    "use workflow";

    const modelMessages = await convertToModelMessages(messages);
    const memories = await readMemories();

    const instructions = [
        backOfficeInstructions,

        "## Memory protocol",
        memories
            ? `## Current memories\n\n${memories}`
            : "No memories yet.",

        `## Priority order for any request
1. Check "## Scripts for common tasks" in memory — if a script matches, run it with bash.
2. Otherwise use data tools and bash to compute the answer.
3. If the task is likely to recur, save a reusable Python script to /vercel/sandbox/scripts/<name>.py and log it in memory under "## Scripts for common tasks" with a one-line description.`,

        `## When to save to memory
Save to memories.md when the user shares something that should persist across sessions:
- Presentation preferences (e.g. "show as percentages", "terse replies only")
- Business context not derivable from data (e.g. "Q4 is always high-return season")
- Explanations for past anomalies so you don't re-flag them
- Corrections or feedback on prior answers

Do NOT save routine questions, one-off lookups, or anything you can re-derive from the data tools.`,

        `## How to save memory
Append a timestamped note with bash:
  echo "$(date): <note>" >> memories.md

## How to save a reusable script
Write it to /vercel/sandbox/scripts/<name>.py (stdlib only, well-commented), then log it:
  echo "$(date): <name>.py — <one-line description>" >> memories.md`,

        `## How to use memory
Read the current memories above so prior context shapes your reply — apply saved preferences automatically without asking the user to repeat themselves.`,
    ].join("\n\n");

    const agent = new DurableAgent({
        model: "anthropic/claude-sonnet-4.6",
        instructions,
        tools: {
            bash,
            getReturnsHistory,
            getInventoryStock,
            getSalesAnalytics,
            getSupportTickets,
            searchProducts,
            getAllCategories,
        },
    });

    await agent.stream({
        messages: modelMessages,
        writable: getWritable<UIMessageChunk>(),
    });
}