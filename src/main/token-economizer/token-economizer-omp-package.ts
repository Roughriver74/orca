import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TOKEN_ECONOMIZER_OMP_PACKAGE = 'tokeneconomizer-orca'

const OMP_EXTENSION_FILE = 'tokeneconomizer-omp.ts'

export function getTokenEconomizerOmpPackageDir(dataRoot: string): string {
  return join(dataRoot, 'token-economizer', 'omp')
}

export function renderOmpPackageJson(): string {
  return `${JSON.stringify(
    {
      name: TOKEN_ECONOMIZER_OMP_PACKAGE,
      version: '0.1.0',
      private: true,
      description: 'TokenEconomizer for omp, installed by Orca.',
      license: 'Apache-2.0',
      omp: { extensions: [`./${OMP_EXTENSION_FILE}`] }
    },
    null,
    2
  )}\n`
}

/** Adapts TE's Pi extension to omp's event shapes; paths are JSON-quoted so Windows backslashes survive. */
export function renderOmpExtension(input: { cloneDir: string; shimDir: string }): string {
  const entry = join(input.cloneDir, 'plugin', 'pi', 'tokeneconomizer.ts')
  return String.raw`import { delimiter } from "node:path";
import tokeneconomizer from ${JSON.stringify(entry)};

const SECTION = "tokeneconomizer";
const SHIM_DIR = ${JSON.stringify(input.shimDir)};

type OmpEvent = {
  systemPrompt?: string[];
  systemPromptOptions?: unknown;
  toolName?: string;
  isError?: boolean;
  details?: { exitCode?: number; wallTimeMs?: number };
  structuredContent?: unknown;
};
type Handler = (event: OmpEvent, ctx: unknown) => unknown;
type Pi = { on: (name: string, handler: Handler) => unknown };

function adapt(name: string, handler: Handler): Handler {
  if (name === "before_agent_start") {
    return async (event, ctx) => {
      const options: { sections?: Record<string, string> } = {};
      await handler({ ...event, systemPromptOptions: options }, ctx);
      const text = options.sections?.[SECTION];
      if (!text) return undefined;
      return { systemPrompt: [...(event.systemPrompt ?? []), "<" + SECTION + ">\n" + text + "\n</" + SECTION + ">"] };
    };
  }
  if (name === "tool_result") {
    return (event, ctx) => {
      const d = event.details ?? {};
      // omp's bash details carry exitCode only on a non-zero exit; a finished foreground call that is not an error exited 0.
      const exit = d.exitCode ?? (event.toolName === "bash" && !event.isError && d.wallTimeMs !== undefined ? 0 : undefined);
      return handler({ ...event, structuredContent: event.structuredContent ?? { ...d, exit_code: exit } }, ctx);
    };
  }
  return handler;
}

export default function tokeneconomizerOmp(pi: Pi) {
  if (process.platform !== "win32") process.env.PATH = SHIM_DIR + delimiter + (process.env.PATH ?? "");
  const proxy = new Proxy(pi, {
    get(target, key) {
      if (key === "on") return (name: string, handler: Handler) => target.on(name, adapt(name, handler));
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  tokeneconomizer(proxy);
}
`
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// TE's side-model calls hardcode the `pi` binary and Pi-only flags; here `pi` may be a different tool entirely.
export function renderPiShim(ompPath: string): string {
  return `#!/bin/sh
for arg do
  shift
  case "$arg" in
    --no-prompt-templates|--offline|--no-mcp) ;;
    *) set -- "$@" "$arg" ;;
  esac
done
exec ${shellSingleQuote(ompPath)} "$@"
`
}

/** Rewritten on every enable so paths stay current after a clone or omp move. */
export async function writeTokenEconomizerOmpPackage(input: {
  packageDir: string
  cloneDir: string
  ompPath: string
}): Promise<void> {
  const shimDir = join(input.packageDir, 'shim')
  await mkdir(shimDir, { recursive: true })
  await writeFile(join(input.packageDir, 'package.json'), renderOmpPackageJson())
  await writeFile(
    join(input.packageDir, OMP_EXTENSION_FILE),
    renderOmpExtension({ cloneDir: input.cloneDir, shimDir })
  )
  if (process.platform !== 'win32') {
    const shim = join(shimDir, 'pi')
    await writeFile(shim, renderPiShim(input.ompPath), { mode: 0o755 })
    await chmod(shim, 0o755)
  }
}
