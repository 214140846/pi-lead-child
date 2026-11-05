// 沙箱外的命令（docs/ticket-246-user-turn-bypass.md 5.5，实施单 C）：免沙箱的 bash（hostBashOperations）和确认卡上跑的
// run_on_host 都写 host_command.started 和 finished，命令和输出都脱敏。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { HOST_COMMAND_FINISHED_KIND, HOST_COMMAND_STARTED_KIND } from "@pi-lead-child/protocol";
import { createLoopbackBinding, listEvents, openDb, type Binding, type Db } from "@pi-lead-child/store";
import { hostBashOperations, newHostCommandId, requestRuleChangeConfirmation, runUiAction, type HostCommandRecord } from "../src/index.js";

let db: Db;
let dir: string;
let owner: Binding;

beforeEach(() => {
  dir = tempDir("plc-host-bash-");
  process.env.PLC_DATA_DIR = dir;
  db = openDb(join(dir, "plc.db"));
  owner = createLoopbackBinding(db, { name: "Mac 网页" }).binding;
});

const started = () => listEvents(db, { kind: HOST_COMMAND_STARTED_KIND }).map((event) => event.payload as Record<string, unknown>);
const finished = () => listEvents(db, { kind: HOST_COMMAND_FINISHED_KIND }).map((event) => event.payload as Record<string, unknown>);

function record(command: string): Omit<HostCommandRecord, "cwd" | "timeoutSeconds"> {
  return {
    id: newHostCommandId(), turnId: "turn-1", turnOrigin: "live_user_companion", via: "bash", confirmationId: null, command,
    screen: { verdict: "allow", rule: null }, spendsMoney: false,
  };
}

async function exec(command: string, options: { timeout?: number; signal?: AbortSignal } = {}) {
  const chunks: string[] = [];
  const ops = hostBashOperations(db, { record: record(command), dataDir: dir });
  const result = await ops.exec(command, dir, {
    onData: (chunk) => chunks.push(chunk.toString("utf8")), ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
  }).catch((error: unknown) => error);
  return { result, output: chunks.join("") };
}

describe("hostBashOperations", () => {
  it("runs outside the sandbox, streams redacted output and records both events", async () => {
    const { result, output } = await exec("echo host-ok; echo 'Bearer abc123def456ghi'; exit 3");
    expect(result).toEqual({ exitCode: 3 });
    expect(output).toContain("host-ok");
    expect(output).not.toContain("abc123def456ghi");
    const [start] = started();
    expect(start).toMatchObject({
      turnId: "turn-1", turnOrigin: "live_user_companion", via: "bash", confirmationId: null, cwd: dir, timeoutSeconds: null,
      screen: { verdict: "allow", rule: null }, spendsMoney: false,
    });
    expect(String(start!.command)).toContain("echo host-ok");
    expect(String(start!.command)).not.toContain("abc123def456ghi");
    const [end] = finished();
    expect(end).toMatchObject({ id: start!.id, exitCode: 3, timedOut: false, truncated: false });
    const log = readFileSync(String(end!.outputPath), "utf8");
    expect(log).toContain("host-ok");
    expect(log).not.toContain("abc123def456ghi");
  });

  it("stops at the time limit the way pi's bash expects, and still records the end", async () => {
    const { result } = await exec("sleep 5; echo late", { timeout: 1 });
    expect((result as Error).message).toBe("timeout:1");
    expect(started()[0]).toMatchObject({ timeoutSeconds: 1 });
    expect(finished()[0]).toMatchObject({ timedOut: true });
  }, 20_000);

  it("stops when the call is aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const { result } = await exec("sleep 5; echo late", { signal: controller.signal });
    expect((result as Error).message).toBe("aborted");
    expect(finished()).toHaveLength(1);
  }, 20_000);
});

describe("run_on_host confirmed on the card", () => {
  it("records host_command events with the card as the origin", async () => {
    const { id } = requestRuleChangeConfirmation(db, {
      confirm: {
        operation: { kind: "lead_tool", tool: "run_on_host", input: { command: "echo from-card", cwd: dir, timeout_seconds: 30 } },
        reason: "test", why: "沙箱里做不了", externalContent: [],
      },
      label: "在你的 Mac 上跑一条命令（沙箱外）", name: null, where: "会话里的确认卡",
    });
    await runUiAction(db, {
      target: { type: "rule_change", id }, action: "resolve", input: { decision: "confirm" }, reason: "在确认卡上决定",
      caller: { kind: "user", credential: owner, source: { client: "web", deviceName: owner.display_name, loopback: true, fromThisMachine: true } },
    });
    expect(started()).toEqual([expect.objectContaining({
      id, turnId: null, turnOrigin: "confirmed_card", via: "run_on_host", confirmationId: id, command: "echo from-card", cwd: dir,
      timeoutSeconds: 30, screen: null, spendsMoney: false,
    })]);
    expect(finished()).toEqual([expect.objectContaining({ id, exitCode: 0, timedOut: false })]);
    expect(existsSync(join(dir, "lead-scratch", "host-commands", `${id}.log`))).toBe(true);
    // rule_change.executed 照旧写。
    expect(listEvents(db, { kind: "rule_change.executed" })).toHaveLength(1);
  });
});
