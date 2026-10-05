// What the page and this machine share: where the runner is published, the
// dg-proof:// links the panel opens, and the prompt an agent starts from.
// The links reach the machine's handler (roam/cli.ts open, registered by
// cli.ts install-handler), which takes nothing from a link but these names
// and ids, so a web page can't make it run anything else.

// The runner's published build. The stable address
// (…/releases/prototypes/proof-runner/) only exists once roam-prototypes
// PR #26 merges; until then it's the PR's preview.
export const RUNNER_URL = "https://discoursegraphs.com/releases/prototypes/previews/proof-runner/proof-runner/";

const SCHEME = "dg-proof:";

// Starts this machine's helper: the proof database, the embeddings stub and
// the keys server the runner asks.
export const CONNECT_LINK = "dg-proof://connect";

// Opens the person's agent on a kit, by its {{proof}} block.
export const agentLink = (graph: string, uid: string): string =>
  `dg-proof://agent?graph=${encodeURIComponent(graph)}&uid=${encodeURIComponent(uid)}`;

export type ProofLink = { kind: "connect" } | { kind: "agent"; graph: string; uid: string };

export const parseProofLink = (text: string): ProofLink => {
  const url = new URL(text);
  if (url.protocol !== SCHEME) throw new Error(`Not a dg-proof link: ${text}`);
  const kind = url.hostname || url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (kind === "connect") return { kind };
  if (kind === "agent") {
    const graph = url.searchParams.get("graph") ?? "";
    const uid = url.searchParams.get("uid") ?? "";
    if (!/^[\w-]{1,64}$/.test(graph)) throw new Error(`Not a graph name: ${graph}`);
    if (!/^[\w-]{9}$/.test(uid)) throw new Error(`Not a block uid: ${uid}`);
    return { kind, graph, uid };
  }
  throw new Error(`Unknown dg-proof link: ${kind}`);
};

// What an agent is told when the panel asks for one: which kit, and the
// runner's tools it drives the kit through.
export const agentPrompt = (graph: string, uid: string): string =>
  [
    `You're the agent for a proof kit open in Roam: graph ${graph}, the {{proof}} block ((${uid})).`,
    "Drive it through the proof runner's tools on Roam's MCP: proof_status first, proof_snapshot for the page's",
    "elements, proof_add_steps for a case waiting for steps, proof_fix_step for a failed step, and proof_control",
    "to run, pause, retry or skip. Prefer the command palette, clicks and typing over js: js waits for sid's",
    "Allow in the panel, and verdicts are his. How steps are written: /mnt/data/projects/dg-demo-videos/proof/README.md",
    "('The page' and 'The brain's loop'); recipes are in /mnt/data/projects/dg-demo-videos/proof/recipes.",
  ].join(" ");
