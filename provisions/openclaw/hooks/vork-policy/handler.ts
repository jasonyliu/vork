import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOOK_KEY = "vork-policy";
const DEFAULT_ATTACH_TO = "AGENTS.md";
const DEFAULT_TITLE = "Vork Policy Context";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hookDir = __dirname;
const configPath = path.join(hookDir, "config.json");

// Policy is sourced from a *release* deployment when config.json names one in
// `releaseRoot` (a path whose docs/policy/ exists — typically a `current` symlink
// that a deploy advances), so injected policy is the released policy regardless of
// which branch a run-session leaves the clone on. Without `releaseRoot`, or when
// its docs/policy/ is absent, the hook-relative clone root is used.
function resolvePolicyRoot(): string {
  const cloneRoot = path.resolve(hookDir, "../../../..");
  try {
    const releaseRoot = JSON.parse(readFileSync(configPath, "utf8"))?.releaseRoot;
    if (
      typeof releaseRoot === "string" &&
      releaseRoot.trim() &&
      existsSync(path.join(releaseRoot, "docs", "policy"))
    ) {
      return path.resolve(releaseRoot);
    }
  } catch {
    // fall through to clone root
  }
  return cloneRoot;
}
const repoRoot = resolvePolicyRoot();

// Marker format: <!-- vork-policy:start v=SHORTSHA -->
// Old marker without the v= attribute is also matched (treated as "no version"); next run will
// upsert with the current version stamp.
const MARKER_START_RE = new RegExp(
  `<!--\\s*${HOOK_KEY}:start(?:\\s+v=([0-9a-f]+))?\\s*-->`
);
const MARKER_END = `<!-- ${HOOK_KEY}:end -->`;
const HUMAN_EDIT_WARNING = `<!-- ${HOOK_KEY}: do not edit content between markers — managed by ${HOOK_KEY} hook -->`;

type HookFileConfig = {
  default?: string[];
  excludeAgentIds?: string[];
  agents?: Record<string, string[]>;
  attachTo?: string;
  title?: string;
};

function isBootstrapEvent(event: any): boolean {
  return event?.type === "agent" && event?.action === "bootstrap";
}

function parseAgentId(sessionKey?: string): string | null {
  if (!sessionKey || typeof sessionKey !== "string") return null;
  const m = sessionKey.match(/^agent:([^:]+):/);
  if (m?.[1]) return m[1];
  if (!sessionKey.includes(":")) return sessionKey;
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") return parts[1] || null;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

async function loadFileConfig(): Promise<Required<HookFileConfig>> {
  const rawText = await fs.readFile(configPath, "utf8").catch(() => "{}");
  let parsed: HookFileConfig = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = {};
  }

  const agents: Record<string, string[]> = {};
  for (const [agentId, paths] of Object.entries(parsed.agents ?? {})) {
    agents[agentId] = asStringArray(paths);
  }

  return {
    default: asStringArray(parsed.default),
    excludeAgentIds: asStringArray(parsed.excludeAgentIds),
    agents,
    attachTo:
      typeof parsed.attachTo === "string" && parsed.attachTo.trim()
        ? parsed.attachTo.trim()
        : DEFAULT_ATTACH_TO,
    title:
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : DEFAULT_TITLE
  };
}

function resolvePolicyPaths(cfg: Required<HookFileConfig>, agentId: string): string[] {
  const relPaths = cfg.agents[agentId]?.length ? cfg.agents[agentId] : cfg.default;
  return relPaths.map((p) => path.resolve(repoRoot, p));
}

async function safeReadAbsolute(absPath: string) {
  const realFile = await fs.realpath(absPath).catch(() => null);
  if (!realFile) return null;
  const content = await fs.readFile(realFile, "utf8").catch(() => null);
  if (!content) return null;
  // Display the path relative to the policy root (e.g. docs/policy/FRAMEWORK.md),
  // not the symlink-resolved realpath, so the injected header stays clean.
  return { relPath: path.relative(repoRoot, absPath), absPath: realFile, content };
}

async function resolvePolicyVersion(policyAbsPaths: string[]): Promise<string> {
  // Path-specific HEAD: short SHA of the most recent commit touching any policy file.
  // Returns "unknown" on any failure so the marker-vs-current comparison never matches and the
  // hook re-injects on every bootstrap (safer than silent skip).
  if (policyAbsPaths.length === 0) return "unknown";
  const relPaths = policyAbsPaths.map((p) => path.relative(repoRoot, p));
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%h", "--", ...relPaths],
      { cwd: repoRoot, timeout: 5000 }
    );
    const sha = stdout.trim();
    return sha || "unknown";
  } catch {
    return "unknown";
  }
}

function buildInjectionBlock(
  title: string,
  version: string,
  sections: Array<{ relPath: string; content: string }>
): string {
  const markerStart = `<!-- ${HOOK_KEY}:start v=${version} -->`;
  // Policy content is included as raw markdown (no ```md fences). Code-fenced wrapping makes
  // models read the body as illustrative snapshot rather than authoritative instructions.
  const sectionText = sections
    .map(
      (s) =>
        `\n\n### Policy source: \`${s.relPath}\`\n\n` +
        s.content.trim() +
        "\n"
    )
    .join("\n");
  return `\n\n${markerStart}\n${HUMAN_EDIT_WARNING}\n## ${title} (injected)\n${sectionText}\n${MARKER_END}\n`;
}

type ExistingMarker =
  | { found: false }
  | { found: true; version: string | null; startIdx: number; endIdx: number };

function extractExistingBlock(content: string): ExistingMarker {
  const m = MARKER_START_RE.exec(content);
  if (!m) return { found: false };
  const startIdx = m.index;
  const endRel = content.indexOf(MARKER_END, startIdx);
  if (endRel === -1) {
    // Corrupt block (start without end). Treat as "not found" so the next upsert appends a
    // clean new block; the orphan start marker becomes part of pre-block content.
    return { found: false };
  }
  return {
    found: true,
    version: m[1] ?? null,
    startIdx,
    endIdx: endRel + MARKER_END.length
  };
}

function upsertBlock(
  content: string,
  currentVersion: string,
  newBlock: string
): { content: string; action: "noop" | "append" | "replace" } {
  const existing = extractExistingBlock(content);
  if (!existing.found) {
    return { content: content + newBlock, action: "append" };
  }
  if (existing.version === currentVersion) {
    return { content, action: "noop" };
  }
  const before = content.slice(0, existing.startIdx);
  const after = content.slice(existing.endIdx);
  // newBlock starts with "\n\n" — when replacing in place, drop one leading newline so
  // refreshes don't accumulate blank lines around the block on each version bump.
  return {
    content: before + newBlock.replace(/^\n\n/, "\n") + after,
    action: "replace"
  };
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${HOOK_KEY}.tmp`;
  await fs.writeFile(tmpPath, content, { encoding: "utf8", mode: 0o644 });
  await fs.rename(tmpPath, filePath);
}

export default async function vorkPolicy(event: any) {
  if (!isBootstrapEvent(event)) return;

  const context = event?.context ?? {};
  const agentId =
    (typeof context?.agentId === "string" && context.agentId.trim()) ||
    parseAgentId(event?.sessionKey);
  if (!agentId) return;

  const cfg = await loadFileConfig();
  if (cfg.excludeAgentIds.includes(agentId)) return;

  const absPaths = resolvePolicyPaths(cfg, agentId);
  const sections: Array<{ relPath: string; absPath: string; content: string }> = [];
  for (const absPath of absPaths) {
    const item = await safeReadAbsolute(absPath);
    if (item) sections.push(item);
  }

  if (!sections.length) {
    console.log(`[${HOOK_KEY}] no readable policy files for agent=${agentId}`);
    return;
  }

  const currentVersion = await resolvePolicyVersion(absPaths);
  const block = buildInjectionBlock(cfg.title, currentVersion, sections);

  const files = Array.isArray(context.bootstrapFiles) ? context.bootstrapFiles : [];
  const workspaceDir = typeof context?.workspaceDir === "string" ? context.workspaceDir : repoRoot;
  const target = files.find(
    (f: any) => f?.name === cfg.attachTo && typeof f?.content === "string"
  );

  let memAction: "noop" | "append" | "replace" | "create" = "noop";
  let diskAction: "noop" | "append" | "replace" | "skip-no-target" | "error" = "skip-no-target";

  if (target) {
    // 1. In-memory mutation — feeds the codex/openai-direct path.
    const inMem = upsertBlock(target.content, currentVersion, block);
    target.content = inMem.content;
    memAction = inMem.action;

    // 2. Disk-write — feeds the claude-cli path (reads AGENTS.md from cwd at spawn).
    //    Only write when the bootstrap entry came from a real file (not a synthesized stub).
    const targetPath: string | undefined =
      typeof target?.path === "string" ? target.path : undefined;
    const targetIsReal = !!targetPath && target?.missing !== true;
    if (targetIsReal) {
      try {
        const diskRaw = await fs.readFile(targetPath, "utf8");
        const onDisk = upsertBlock(diskRaw, currentVersion, block);
        if (onDisk.action !== "noop") {
          await atomicWriteFile(targetPath, onDisk.content);
        }
        diskAction = onDisk.action;
      } catch (err) {
        console.log(
          `[${HOOK_KEY}] disk-write skipped for agent=${agentId} (${targetPath}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        diskAction = "error";
      }
    }
  } else {
    // Bootstrap had no AGENTS.md entry — synthesize one in-memory. Skip disk-write because
    // the workspace hasn't been deployed yet; writing a policy-only AGENTS.md here would be
    // worse than leaving the missing-file state visible.
    files.push({
      name: cfg.attachTo,
      path: path.join(workspaceDir, cfg.attachTo),
      content: block.trimStart(),
      missing: false
    });
    memAction = "create";
    diskAction = "skip-no-target";
  }

  console.log(
    `[${HOOK_KEY}] agent=${agentId} v=${currentVersion} memory=${memAction} disk=${diskAction} (${sections
      .map((s) => s.relPath)
      .join(", ")})`
  );

  context.bootstrapFiles = files;
}
