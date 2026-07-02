import { agentApi, sunoApi } from "../../lib/api";

// OpenAI-style tool (function) schemas sent to the model in the request body.
export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the working directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the working directory." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders in a directory of the working directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path relative to the working directory. Use '.' for the root." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the working directory." },
          content: { type: "string", description: "Full file content to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace a unique snippet in a file with new text. The old string must appear exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old: { type: "string", description: "Exact existing text to replace (must be unique in the file)." },
          new: { type: "string", description: "Replacement text." },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the working directory and return stdout/stderr/exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run." } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_request",
      description: "Make an HTTP request to any URL and return the status, headers and body.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          url: { type: "string" },
          headers: { type: "object" },
          body: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_music",
      description:
        "Generate an original song with AI from a text prompt (Suno). Returns the finished track's title and audio URL. Generation takes ~1-2 minutes.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the song should be about / its lyrics or vibe." },
          style: { type: "string", description: "Musical style/genre, e.g. 'lofi hip hop', 'epic orchestral'." },
          title: { type: "string", description: "Optional song title." },
          instrumental: { type: "boolean", description: "If true, no vocals." },
        },
        required: ["prompt"],
      },
    },
  },
];

// Tools that don't need a working directory / agent mode (always available in
// chat). generate_music just calls the gateway.
export const ALWAYS_ON_TOOLS = TOOL_SCHEMAS.filter((t) => t.function.name === "generate_music");
// Coding-agent tools (filesystem/exec/http) — only sent when agent mode is on.
export const AGENT_TOOLS = TOOL_SCHEMAS.filter((t) => t.function.name !== "generate_music");

export type ToolName = "read_file" | "list_dir" | "write_file" | "edit_file" | "run_command" | "http_request" | "generate_music";

// Per-tool display metadata (verb label + which lucide icon name to use).
export const TOOL_META: Record<string, { label: string; icon: string }> = {
  read_file: { label: "read", icon: "file" },
  list_dir: { label: "list", icon: "folder" },
  write_file: { label: "create", icon: "edit" },
  edit_file: { label: "edit", icon: "edit" },
  run_command: { label: "run", icon: "terminal" },
  http_request: { label: "http", icon: "globe" },
  generate_music: { label: "music", icon: "music" },
};

export interface DiffRow {
  type: "ctx" | "add" | "del";
  text: string;
}

// lineDiff computes an LCS line diff between two strings (robloxkit style).
export function lineDiff(oldText: string, newText: string): { rows: DiffRow[]; added: number; removed: number } {
  const a = (oldText || "").replace(/\n$/, "").split("\n");
  const b = (newText || "").replace(/\n$/, "").split("\n");
  if (!oldText) return { rows: b.map((text) => ({ type: "add", text })), added: b.length, removed: 0 };
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: a[i] }); i++; removed++; }
    else { rows.push({ type: "add", text: b[j] }); j++; added++; }
  }
  while (i < n) { rows.push({ type: "del", text: a[i] }); i++; removed++; }
  while (j < m) { rows.push({ type: "add", text: b[j] }); j++; added++; }
  return { rows, added, removed };
}

// Which tools mutate/side-effect (need approval at the "Confirm writes" level).
export const WRITE_TOOLS = new Set<ToolName>(["write_file", "edit_file", "run_command", "http_request", "generate_music"]);

// Tools whose individual rows aren't worth their own card — collapsed into a
// single dropdown when several run in a row. write/edit/run keep their own block
// (their diffs/output are the point).
export const GROUPABLE_TOOLS = new Set<ToolName>(["read_file", "list_dir", "http_request"]);

// A summary verb for a run of one groupable tool: [verb, noun].
export const GROUP_VERB: Record<string, [string, string]> = {
  read_file: ["Read", "file"],
  list_dir: ["Listed", "folder"],
  http_request: ["Fetched", "URL"],
};

export type PermLevel = "need" | "medium" | "bypass";

// needsApproval decides whether a tool call must be confirmed before running.
export function needsApproval(level: PermLevel, tool: ToolName): boolean {
  if (level === "bypass") return false;
  if (level === "need") return true;
  return WRITE_TOOLS.has(tool); // medium
}

export interface ToolResult {
  ok: boolean;
  // A short string fed back to the model as the tool result.
  output: string;
  // Extra data for rich rendering (diff, exec output, etc.).
  meta?: Record<string, unknown>;
}

// runTool executes a tool call against the local agent endpoints and returns a
// result string for the model plus meta for the UI.
export async function runTool(
  cwd: string,
  tool: ToolName,
  args: Record<string, unknown>,
  onProgress?: (text: string) => void,
): Promise<ToolResult> {
  try {
    switch (tool) {
      case "read_file": {
        const r = await agentApi.fsRead(cwd, String(args.path ?? ""));
        return { ok: true, output: r.content + (r.truncated ? "\n…(truncated)" : ""), meta: { path: r.path } };
      }
      case "list_dir": {
        const r = await agentApi.fsList(cwd, String(args.path ?? "."));
        const lines = r.entries.map((e) => `${e.is_dir ? "d" : "-"} ${e.name}${e.is_dir ? "/" : ` (${e.size}b)`}`).join("\n");
        return { ok: true, output: lines || "(empty)", meta: { entries: r.entries } };
      }
      case "write_file": {
        const r = await agentApi.fsWrite(cwd, String(args.path ?? ""), String(args.content ?? ""));
        return { ok: true, output: `${r.created ? "Created" : "Wrote"} ${r.path}`, meta: { diff: { path: r.path, old: r.old, new: r.new } } };
      }
      case "edit_file": {
        const r = await agentApi.fsEdit(cwd, String(args.path ?? ""), String(args.old ?? ""), String(args.new ?? ""));
        return { ok: true, output: `Edited ${r.path}`, meta: { diff: { path: r.path, old: r.old, new: r.new } } };
      }
      case "run_command": {
        const r = await agentApi.exec(cwd, String(args.command ?? ""));
        const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, `exit: ${r.exit_code}${r.timed_out ? " (timed out)" : ""}`].filter(Boolean).join("\n");
        return { ok: r.exit_code === 0, output: out, meta: { exec: r } };
      }
      case "http_request": {
        const r = await agentApi.http(String(args.method ?? "GET"), String(args.url ?? ""), (args.headers as Record<string, string>) ?? undefined, args.body ? String(args.body) : undefined);
        return { ok: r.status < 400, output: `HTTP ${r.status}\n${r.body}`, meta: { http: r } };
      }
      case "generate_music": {
        onProgress?.("Starting…");
        const { task_id } = await sunoApi.generate({
          prompt: String(args.prompt ?? ""),
          style: args.style ? String(args.style) : undefined,
          title: args.title ? String(args.title) : undefined,
          instrumental: Boolean(args.instrumental),
        });
        onProgress?.("Queued — composing…");
        // Poll until done (or failed), ~5s apart, capped ~3 min.
        const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
        for (let i = 0; i < 36; i++) {
          await sleep(5000);
          const s = await sunoApi.status(task_id);
          onProgress?.(sunoProgress(s.status, s.tracks));
          if (s.failed) return { ok: false, output: `music generation failed (${s.status})`, meta: { suno: s } };
          if (s.done && s.tracks.length > 0) {
            const lines = s.tracks.map((t) => `- ${t.title} (${Math.round(t.duration)}s): ${t.audio_url}`).join("\n");
            return { ok: true, output: `Generated ${s.tracks.length} track(s):\n${lines}`, meta: { suno: s } };
          }
        }
        return { ok: false, output: "music generation timed out (still processing)", meta: { task_id } };
      }
      default:
        return { ok: false, output: `unknown tool: ${tool}` };
    }
  } catch (e) {
    return { ok: false, output: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// sunoProgress maps a Suno task status into a short human progress line.
function sunoProgress(status: string, tracks: { title: string }[]): string {
  switch (status) {
    case "PENDING":
      return "Composing…";
    case "TEXT_SUCCESS":
      return `Lyrics ready${tracks[0]?.title ? ` — "${tracks[0].title}"` : ""}, rendering audio…`;
    case "FIRST_SUCCESS":
      return "First track ready, finishing…";
    case "SUCCESS":
      return "Done";
    default:
      return status ? `Working (${status})…` : "Working…";
  }
}
