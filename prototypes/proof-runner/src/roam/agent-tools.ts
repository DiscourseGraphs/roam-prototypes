import type { ExtensionAPI } from "./build-loader";
import { controlsOnPage, snapshotPage } from "./executor";
import type { ProofRun } from "./runner";

// The runner's tools for an agent connected to Roam: Roam's AI API
// (extensionAPI.ai.addTool) hands tools an extension registers to agents
// that reach the graph through a Local API token (Roam's MCP). Through
// them an agent reads a kit and its run, sees the page, controls the run,
// and writes steps onto the page. Verdicts and allowing js stay with the
// person at the panel. A Roam without the API registers nothing.

type ToolContext = { tokenUserUid?: string };

type AiTool = {
  name: string;
  description: string;
  scope: "read" | "append" | "edit";
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: ToolContext) => unknown;
};

type AiApi = { addTool: (tool: AiTool) => unknown };

export type AgentHost = {
  // The run of a kit: its page (title or uid), else the open page's.
  runFor: (page?: string) => Promise<ProofRun>;
  // Marks an agent as there, for the panel's checklist.
  seen: () => void;
};

const PAGE = {
  type: "string",
  description: "The kit page's title or uid, or a block in it. The page open in the main window when left out.",
};

const STEP = {
  type: "object",
  properties: {
    why: { type: "string", description: "What the step does, in plain words; it becomes the step's block." },
    do: {
      type: "object",
      description:
        'One action, e.g. {"command_palette": "DG: Open Node Search"}, {"click": ".bp3-dialog button:has-text(\\"Next\\")"}, {"type": {"into": "input.bp3-input", "text": "claim"}}, {"press": "Escape"}, {"wait_for": ".bp3-toast"}, {"js": "…"}.',
    },
    use: { type: "string", description: "A recipe instead of an action, e.g. page.open." },
    with: { type: "object", description: "The recipe's parameters." },
  },
  required: ["why"],
  additionalProperties: false,
};

const text = (value: unknown): string => (typeof value === "string" && value.trim() ? value : "");

const outcome = (error: string | null, done: Record<string, unknown>): Record<string, unknown> => (error ? { error } : done);

export const agentTools = (host: AgentHost): AiTool[] => [
  {
    name: "proof_status",
    description:
      "Reads a proof kit open in Roam: its cases (intent, expected result, steps, verdicts), what the page still needs before Run (the checklist), and where a run stands, including a case waiting for steps or a step that failed with its error. Call it first, and again after acting.",
    scope: "read",
    inputSchema: { type: "object", properties: { page: PAGE }, additionalProperties: false },
    handler: async (args) => (await host.runFor(text(args.page) || undefined)).agentStatus(),
  },
  {
    name: "proof_snapshot",
    description:
      "What the Roam window shows now: the open page, any dialogs, popovers and toasts, and the controls in the topmost one with their classes and labels. Use it to write selectors for steps.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => ({ page: snapshotPage(), controls: controlsOnPage() }),
  },
  {
    name: "proof_control",
    description:
      "Controls a proof kit's run: run (starts it when the checklist is met), pause, resume, next (one step), retry (the failed step, as its block reads now), skip-step, skip-case, stop.",
    scope: "append",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "pause", "resume", "next", "retry", "skip-step", "skip-case", "stop"] },
        page: PAGE,
      },
      required: ["action"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const run = await host.runFor(text(args.page) || undefined);
      return outcome(await run.agentControl(text(args.action)), { done: text(args.action), status: run.agentStatus() });
    },
  },
  {
    name: "proof_add_steps",
    description:
      "Gives the steps for the case the run is waiting on (one written only as an intent). They're written under the case's block on the page, so the kit keeps them, and then run; a js step waits for the person's Allow in the panel.",
    scope: "append",
    inputSchema: {
      type: "object",
      properties: { caseId: { type: "string" }, steps: { type: "array", items: STEP, minItems: 1 }, page: PAGE },
      required: ["caseId", "steps"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const run = await host.runFor(text(args.page) || undefined);
      return outcome(await run.agentAddSteps(text(args.caseId), args.steps), { added: Array.isArray(args.steps) ? args.steps.length : 0 });
    },
  },
  {
    name: "proof_fix_step",
    description:
      "Replaces the step that failed with a fix: its block on the page is rewritten, and the fix runs in its place. A js fix waits for the person's Allow in the panel.",
    scope: "edit",
    inputSchema: { type: "object", properties: { step: STEP, page: PAGE }, required: ["step"], additionalProperties: false },
    handler: async (args) => {
      const run = await host.runFor(text(args.page) || undefined);
      return outcome(await run.agentFixStep(args.step), { fixed: true });
    },
  },
];

// Registers the tools with Roam when its AI API is there; says whether.
export const registerAgentTools = (extensionAPI: ExtensionAPI | undefined, host: AgentHost): boolean => {
  const ai = (extensionAPI as unknown as { ai?: AiApi } | undefined)?.ai;
  if (typeof ai?.addTool !== "function") return false;
  for (const tool of agentTools(host)) {
    ai.addTool({
      ...tool,
      handler: async (args, context) => {
        host.seen();
        try {
          return await tool.handler(args ?? {}, context);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  }
  return true;
};
