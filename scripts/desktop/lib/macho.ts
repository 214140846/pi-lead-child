// 读 Mach-O 文件头，看一个二进制是哪个架构。打包脚本用它确认 Node 和 better-sqlite3 的 .node 是 arm64：
// 在错的机器上装依赖时，装出来的原生模块是别的架构，运行包装上以后 daemon 起不来。
// 不调 file 命令：Linux 上没有 macOS 的 file 也能跑测试，输出格式也不用解析。
import { closeSync, openSync, readSync } from "node:fs";

const CPU_ARCH_ABI64 = 0x01000000;
const CPU_TYPES: Record<number, string> = {
  7: "i386",
  [7 | CPU_ARCH_ABI64]: "x86_64",
  12: "arm",
  [12 | CPU_ARCH_ABI64]: "arm64",
};

const MH_MAGIC_64 = 0xfeedfacf;
const MH_MAGIC = 0xfeedface;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
// fat 头之后最多读这么多个架构。真实的通用二进制只有两三个；更多时多半不是 Mach-O（Java class 文件也以 cafebabe 开头）。
const MAX_FAT_ARCHS = 16;

const cpuName = (type: number): string => CPU_TYPES[type] ?? `cpu-0x${(type >>> 0).toString(16)}`;

/** 文件头里的架构列表。不是 Mach-O 时返回 null。 */
export function machOArchitectures(header: Buffer): string[] | null {
  if (header.length < 8) return null;
  const little = header.readUInt32LE(0);
  if (little === MH_MAGIC_64 || little === MH_MAGIC) return [cpuName(header.readInt32LE(4))];
  const big = header.readUInt32BE(0);
  if (big === FAT_MAGIC || big === FAT_MAGIC_64) {
    const count = header.readUInt32BE(4);
    if (count === 0 || count > MAX_FAT_ARCHS) return null;
    const entry = big === FAT_MAGIC_64 ? 32 : 20;
    if (header.length < 8 + count * entry) return null;
    return Array.from({ length: count }, (_, i) => cpuName(header.readInt32BE(8 + i * entry)));
  }
  return null;
}

export function readMachOArchitectures(path: string): string[] | null {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(8 + MAX_FAT_ARCHS * 32);
    const read = readSync(fd, header, 0, header.length, 0);
    return machOArchitectures(header.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}

/** 二进制不能在 arch 上运行时抛错，消息写明文件和实际的架构。 */
export function assertMachOArch(path: string, label: string, arch: string): void {
  const found = readMachOArchitectures(path);
  if (found === null) throw new Error(`${label} 不是 Mach-O 二进制：${path}`);
  if (!found.includes(arch)) throw new Error(`${label} 的架构是 ${found.join("、")}，不是 ${arch}：${path}`);
}
