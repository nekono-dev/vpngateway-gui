#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverInfo = { name: "codex-cli", version: "1.0.0" };
const tools = [
  {
    name: "codex_exec",
    description:
      "Run a task with Codex CLI in this repository. Codex can read files and, by default, edit files within the selected sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task or question for Codex." },
        cwd: {
          type: "string",
          description: "Optional working directory inside this repository. Defaults to the repository root.",
        },
        sandbox: {
          type: "string",
          enum: ["read-only", "workspace-write"],
          description: "Codex command sandbox. Defaults to workspace-write.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function resolveWorkingDirectory(requested) {
  const candidate = await realpath(requested ? path.resolve(projectRoot, requested) : projectRoot);
  const relative = path.relative(projectRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("cwd must be inside this repository");
  }
  return candidate;
}

async function runCodex({ prompt, cwd, sandbox }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt must be a non-empty string");
  if (sandbox !== undefined && !["read-only", "workspace-write"].includes(sandbox)) {
    throw new Error("sandbox must be read-only or workspace-write");
  }

  const workingDirectory = await resolveWorkingDirectory(cwd);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "codex-mcp-"));
  const lastMessagePath = path.join(tempDirectory, "last-message.txt");
  try {
    const args = [
      "exec",
      "--json",
      "--ask-for-approval",
      "never",
      "--sandbox",
      sandbox ?? "workspace-write",
      "--cd",
      workingDirectory,
      "--output-last-message",
      lastMessagePath,
      "-",
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, 10 * 60 * 1000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-12000);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ code, signal, stderr });
      });
      child.stdin.end(prompt);
    });

    let message = "Codex finished without a final message.";
    try {
      message = await readFile(lastMessagePath, "utf8");
    } catch {
      // Use stderr below when Codex failed before it could write the final message.
    }
    if (result.code !== 0) {
      throw new Error(
        `Codex exited ${result.code ?? `after signal ${result.signal}`}.\n${message}\n${result.stderr}`.trim(),
      );
    }
    return message;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo,
      },
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    if (params.name !== "codex_exec") {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
      return;
    }
    try {
      const text = await runCodex(params.arguments ?? {});
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        },
      });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    continue;
  }
  void handleRequest(request).catch((error) => {
    if (request.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: String(error) } });
    }
  });
}
