// 测试用的假二进制：只有 Mach-O 文件头，够 macho.ts 判断架构。
const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;
export const CPU = { arm64: ARM64, x86_64: X86_64 } as const;

export function thinMachO(cpu: number): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeInt32LE(cpu, 4);
  return header;
}

export function fatMachO(cpus: number[]): Buffer {
  const header = Buffer.alloc(8 + cpus.length * 20);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(cpus.length, 4);
  cpus.forEach((cpu, i) => header.writeInt32BE(cpu, 8 + i * 20));
  return header;
}
