// 壳启动的子进程。路径一律放在参数数组里传，不经 shell（设计第 2.2 节：新路径里有空格）。
import { execFile as nodeExecFile, spawn } from "node:child_process";

export type ExecFile = (file: string, args: string[], options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string }>;

export const execFile: ExecFile = (file, args, options = {}) => new Promise((resolve, reject) => {
  nodeExecFile(file, args, { timeout: options.timeoutMs ?? 0, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
      return;
    }
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

export interface LineProcess {
  /** 进程退出时的退出码；被信号杀掉时为 null。 */
  exitCode: Promise<number | null>;
}

export type SpawnLines = (file: string, args: string[], onLine: (line: string) => void, onStderr: (text: string) => void) => LineProcess;

/** 运行一个按行输出的进程（desktop-install --progress-json），每读到一整行就交给 onLine。 */
export const spawnLines: SpawnLines = (file, args, onLine, onStderr) => {
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  const lines = lineSplitter(onLine);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", lines.push);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", onStderr);
  return {
    exitCode: new Promise((resolve) => {
      child.once("error", (error) => {
        onStderr(error.message);
        resolve(1);
      });
      child.once("close", (code) => {
        lines.flush();
        resolve(code);
      });
    }),
  };
};

/** 把分块到达的文字切成整行。最后一行没有换行时，flush 交出它。 */
export function lineSplitter(onLine: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
        newline = buffer.indexOf("\n");
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = "";
      if (line) onLine(line);
    },
  };
}
