// 免沙箱的 bash（docs/ticket-246-user-turn-bypass.md 3.1，实施单 C）。免沙箱开关开着、用户本人正在发话、这一轮没读过
// 外部内容、命令过了筛查器时，Lead 的 bash 换成这里的执行函数：不经 sandbox-exec，用用户的登录 shell 跑，和 run_on_host
// 共用 spawn、时限、脱敏和落盘（ui-actions/host-commands.ts）。spawn 之前写 host_command.started，结束以后写 finished。
// 每次调用新建一个：事件里要记这一次的轮次、来源和筛查结果。
import { existsSync } from "node:fs";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { Db } from "@pi-lead-child/store";
import {
  recordHostCommandFinished, recordHostCommandStarted, saveHostCommandOutput, spawnHostProcess, type HostCommandRecord,
} from "../ui-actions/host-commands.js";

export interface HostBashCall {
  // 写进 host_command.started 的记录。command 是 Lead 写的原样命令（跑的可能是换成脚本副本路径的那一条）。
  record: Omit<HostCommandRecord, "cwd" | "timeoutSeconds">;
  dataDir: string;
  shell?: string;
}

export function hostBashOperations(db: Db, call: HostBashCall): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) throw new Error(`工作目录不存在：${cwd}`);
      recordHostCommandStarted(db, { ...call.record, cwd, timeoutSeconds: timeout ?? null });
      const result = await spawnHostProcess(command, {
        cwd, timeoutSeconds: timeout, signal, onData, ...(call.shell ? { shell: call.shell } : {}),
      });
      const outputPath = saveHostCommandOutput(call.dataDir, call.record.id, result);
      recordHostCommandFinished(db, call.record.id, result, outputPath);
      // 和沙箱里的 bash 一样的错误写法：pi 的 bash 工具据此写「Command aborted」「Command timed out after N seconds」。
      if (result.aborted) throw new Error("aborted");
      if (result.timedOut) throw new Error(`timeout:${timeout}`);
      return { exitCode: result.exitCode };
    },
  };
}
