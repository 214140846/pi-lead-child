// P0-7 返工的实测：「登录项与扩展」按什么显示后台项目的名字（做法见 lib/probe-btm.ts）。在主机上运行，不能在执行器沙箱里运行：
//   node --import tsx scripts/desktop/probe-btm.ts install [p5 p6 …]   装探测项（不点名时全部），打开「登录项与扩展」
//   node --import tsx scripts/desktop/probe-btm.ts status  [p5 p6 …]   打印探测项的签名、状态、进程名和 sfltool 里它们的记录
//   node --import tsx scripts/desktop/probe-btm.ts remove  [p5 p6 …]   卸掉探测项，删掉 plist 和目录
// 所有路径都用参数数组传给子进程，不经 shell。
import { constants, copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { adhocSign, installAgent, makeAgentBundle } from "./lib/agent-bundle.js";
import {
  launchdPid, probeExecutable, probePlist, probeRecords, runCommand, selectVariants, type ProbeVariant,
} from "./lib/probe-btm.js";

const ROOT = join(homedir(), "Library", "Application Support", "Bytezard Lead Probe", "btm");
const AGENTS = join(homedir(), "Library", "LaunchAgents");
const DOMAIN = `gui/${process.getuid!()}`;
const SETTINGS_URL = "x-apple.systempreferences:com.apple.LoginItems-Settings.extension";

const plistFile = (variant: ProbeVariant) => join(AGENTS, `${variant.label}.plist`);

// 每个子命令最多等 COMMAND_TIMEOUT_MS（lib/probe-btm.ts），卡住就记成失败，接着做下一步。
const tryRun = (file: string, args: string[]) => runCommand(file, args);

// 把 Node 放到 dest：APFS 上用克隆，不占空间。
const placeNode = (dest: string) => copyFileSync(process.execPath, dest, constants.COPYFILE_FICLONE);

async function install(variants: ProbeVariant[]): Promise<void> {
  for (const variant of variants) {
    if ((await tryRun("launchctl", ["print", `${DOMAIN}/${variant.label}`])).ok) {
      throw new Error(`${variant.label} 已经装着。先运行 remove。`);
    }
  }
  mkdirSync(AGENTS, { recursive: true });
  const idle = join(ROOT, "idle.cjs");
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(idle, "// 探测项：只空等，让登录项留在列表里。\nsetInterval(() => {}, 1 << 30);\n");
  for (const variant of variants) {
    const dir = join(ROOT, variant.id);
    mkdirSync(dir, { recursive: true });
    if (variant.shipped) {
      // 和打包脚本同一个函数：bin/lead-agent 重签，软链接 bin/Bytezard Lead。
      await installAgent({ root: dir, placeBinary: placeNode });
    } else if (variant.bundle) {
      await makeAgentBundle({ parentDir: dir, spec: variant.bundle, placeBinary: placeNode });
    } else {
      placeNode(probeExecutable(ROOT, variant));
      if (variant.signIdentifier) await adhocSign(probeExecutable(ROOT, variant), variant.signIdentifier);
      // 软链接和程序在同一个目录，写相对路径。
      if (variant.launchName) symlinkSync(variant.executable, join(dir, variant.launchName));
    }
    writeFileSync(plistFile(variant), probePlist(ROOT, variant, idle));
    const lint = await tryRun("plutil", ["-lint", plistFile(variant)]);
    if (!lint.ok) throw new Error(`${variant.label} 的 plist 不合法：${lint.out}`);
    const boot = await tryRun("launchctl", ["bootstrap", DOMAIN, plistFile(variant)]);
    console.log(`${variant.id}: bootstrap ${boot.ok ? "ok" : `失败：${boot.out}`}`);
  }
  await status(variants);
  await tryRun("open", [SETTINGS_URL]);
  console.log("\n已打开「系统设置 → 通用 → 登录项与扩展」。请看「允许在后台」里出现了哪些名字，截图。每个探测项可能显示的名字：");
  for (const variant of variants) console.log(`  ${variant.id}: ${variant.expect}`);
  console.log(`看完运行：node --import tsx scripts/desktop/probe-btm.ts remove ${variants.map((v) => v.id).join(" ")}`);
}

async function status(variants: ProbeVariant[]): Promise<void> {
  console.log(`macOS：${(await tryRun("sw_vers", ["-productVersion"])).out}（${(await tryRun("sw_vers", ["-buildVersion"])).out}）`);
  for (const variant of variants) {
    const exe = probeExecutable(ROOT, variant);
    const loaded = await tryRun("launchctl", ["print", `${DOMAIN}/${variant.label}`]);
    const state = /^\s*state = (.+)$/m.exec(loaded.out)?.[1] ?? (loaded.ok ? "loaded" : "not loaded");
    const sign = existsSync(exe) ? await tryRun("codesign", ["-dv", exe]) : { ok: false, out: "" };
    const facts = sign.out.split("\n").filter((line) => /^(Identifier|TeamIdentifier|Signature)=/.test(line)).join("，");
    // 进程名：ucomm 是内核记的短名字，comm 是可执行文件的路径。只打这两列，不打参数和环境变量。
    const pid = launchdPid(loaded.out);
    const ps = pid ? await tryRun("/bin/ps", ["-o", "ucomm=", "-o", "comm=", "-p", String(pid)]) : null;
    console.log(`${variant.id}: ${variant.label}，${state}；${facts || "没有程序"}；进程：${ps?.ok ? ps.out.replace(/\s+/g, " ") : "没在运行"}`);
  }
  // sfltool dumpbtm 可能要管理员权限；不行时就看系统设置里的列表。只打印和探测有关的记录。
  const dump = await tryRun("sfltool", ["dumpbtm"]);
  const records = dump.ok ? probeRecords(dump.out) : [];
  if (!dump.ok) console.log(`sfltool dumpbtm 不可用：${dump.out.split("\n")[0]}`);
  else if (!records.length) console.log("sfltool dumpbtm 里没有探测项的记录。");
  else console.log(`sfltool dumpbtm 里探测项的记录：\n${records.join("\n\n")}`);
  // 程序包会不会出现在聚焦搜索里（会的话，搜索 Bytezard Lead 会看到两个）。
  const spotlight = await tryRun("mdfind", ["kMDItemCFBundleIdentifier == 'com.bytezard.plc.agent'"]);
  console.log(`聚焦搜索里的 com.bytezard.plc.agent：${spotlight.out || "没有"}`);
}

async function remove(variants: ProbeVariant[]): Promise<void> {
  for (const variant of variants) {
    await tryRun("launchctl", ["bootout", `${DOMAIN}/${variant.label}`]);
    rmSync(plistFile(variant), { force: true });
    rmSync(join(ROOT, variant.id), { recursive: true, force: true });
  }
  // 全部卸掉时，连同 idle.cjs 和整个探测目录一起删。
  if (variants.length === selectVariants([]).length) rmSync(ROOT, { recursive: true, force: true });
  console.log(`已卸掉 ${variants.map((v) => v.id).join("、")}，删掉了它们的 plist 和目录（在 ${ROOT} 下）。`);
}

const [command, ...ids] = process.argv.slice(2);
const actions: Record<string, (variants: ProbeVariant[]) => Promise<void>> = { install, status, remove };
if (!command || !actions[command]) {
  console.error("用法：node --import tsx scripts/desktop/probe-btm.ts install|status|remove [p1 … p8]");
  process.exit(2);
}
try {
  await actions[command]!(selectVariants(ids));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
