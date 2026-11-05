// 令牌保险库：连接的令牌只以密文进账本。AES-256-GCM，每次加密一个随机的 12 字节 nonce，
// 附加数据（AAD）绑定连接 id 和密文版本号，所以一行的旧密文搬不到别的行，也换不回同一行的旧版本。
//
// 为什么要加密：同一个系统用户的进程本来就隔离不了（README 的「凭证和信任边界」）。加密防的是副本：
// 部署前的备份和预览用的快照会复制整个数据库，没有 Keychain 里的密钥，副本里的令牌没有用。
//
// 密钥是 32 个随机字节。macOS 上存在 Keychain，写入时命令走 `security -i` 的标准输入，密钥不进 argv。
// 其他系统上退回到数据目录里一个 0600 的文件。密钥不进 process.env：child 继承 daemon 的全部环境。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Keychain 锁着、弹出授权框时 security 会一直等：最多等这么久，不让 daemon 停住（2026-11-03 以前没有上限）。
const KEYCHAIN_TIMEOUT_MS = 10_000;
// security find-generic-password 找不到这一项时的退出码。
const KEYCHAIN_ITEM_NOT_FOUND = 44;

const FORMAT = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface VaultKeySource {
  // 返回 32 字节的密钥。没有、并且这个来源允许新建时，创建一个并保存。
  load(): Buffer;
  // 只读不建：在后台异步读已有的密钥，没有时返回 null（创建留给 load，免得两边各建一个、互相覆盖）。
  read?(): Promise<Buffer | null>;
}

// hub 只需要这两个操作。lazyVault 在第一次用到时才读密钥：没用过连接的 daemon 不碰 Keychain。
export interface SecretVault {
  seal(value: unknown, aad: string): Buffer;
  open<T>(sealed: Buffer, aad: string): T;
}

export function lazyVault(source: VaultKeySource): SecretVault & { preload(): Promise<void> } {
  let vault: Vault | null = null;
  const get = () => (vault ??= new Vault(source.load()));
  return {
    seal: (value, aad) => get().seal(value, aad),
    open: <T>(sealed: Buffer, aad: string) => get().open<T>(sealed, aad),
    // daemon 启动后在后台读一次密钥：第一次用到连接时就不用在请求里同步读 Keychain。读不到时什么也不做。
    async preload() {
      if (vault || !source.read) return;
      const key = await source.read().catch(() => null);
      if (key && !vault) vault = new Vault(key);
    },
  };
}

export class Vault implements SecretVault {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) throw new Error(`vault key must be ${KEY_BYTES} bytes`);
    this.#key = Buffer.from(key);
  }

  seal(value: unknown, aad: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([FORMAT]), nonce, cipher.getAuthTag(), body]);
  }

  open<T>(sealed: Buffer, aad: string): T {
    if (sealed.length < 1 + NONCE_BYTES + TAG_BYTES || sealed[0] !== FORMAT) throw new Error("vault: unknown secret format");
    const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
    const tag = sealed.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
    const body = sealed.subarray(1 + NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as T;
  }
}

// 一行连接的密文的 AAD。version 是写入后这一行的 secret_version。
export function connectionSecretAad(connectionId: number, version: number): string {
  return `connection:${connectionId}:v${version}`;
}

// 一行连接的权限设置（roles、write_policy）的封印的 AAD。封印绑定连接 id、清单的 epoch 和版本：搬不到别的行，
// 旧版本的封印、上一代清单下的封印都换不回来（epoch 和版本记在清单里）。
export function connectionSettingsAad(connectionId: number, epoch: string, version: number): string {
  return `connection-settings:${connectionId}:${epoch}:v${version}`;
}

export const CONNECTION_SETTINGS_MANIFEST_AAD = "connection-settings-manifest";

export function oauthClientSecretAad(issuer: string, redirectUri: string): string {
  return `oauth-client:${issuer}:${redirectUri}`;
}

export const KEYCHAIN_VAULT_SERVICE = "pi-lead-child:connections-vault";
const SAFE_KEYCHAIN_NAME = /^[A-Za-z0-9._:@-]{1,128}$/;

// macOS Keychain 里的密钥。读和写都用 /usr/bin/security，和 supervisor 的 keychain.ts 一样，
// 所以读的时候不弹授权框。
//
// 「读不到」不等于「没有」（工单 #242、#243）：在沙箱里、或者 HOME 被换成别的目录时，已有的条目也会返回 44。
// 这时新建一个密钥会盖掉真密钥，保险库里加密过的令牌就再也解不开了；找不到默认钥匙串时，系统还会弹窗请用户新建登录钥匙串。
// 所以新建要过三道关：调用方许可新建并且保险库里还没有任何密文、进程不在沙箱里且 HOME 是真实的 home、
// `security default-keychain -d user` 能找到默认钥匙串。任一项不过就报错。写入不带 -U：条目已存在时 security 返回 45，
// 不覆盖，再读一次已有的。
export interface KeychainKeyOptions {
  // 新建密钥的许可。不给时只读：钥匙串里没有密钥也只报错。给了时，返回 true 表示保险库里已经有密文，同样不能新建。
  hasSealedData?: () => boolean;
  // 前置检查读的环境，缺省是 process.env。
  env?: NodeJS.ProcessEnv;
}

// security add-generic-password 遇到已有条目（没带 -U）时的退出码：errSecDuplicateItem。
const KEYCHAIN_DUPLICATE_ITEM = 45;

function findKeychainKey(account: string, service: string): Buffer | null {
  try {
    const hex = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: KEYCHAIN_TIMEOUT_MS,
    }).trim();
    const key = Buffer.from(hex, "hex");
    if (key.length !== KEY_BYTES) throw new Error(`vault: the key in the Keychain is not ${KEY_BYTES} bytes`);
    return key;
  } catch (error) {
    if ((error as Error).message?.startsWith("vault:")) throw error;
    // 超时（Keychain 锁着）或别的错误：不能当成没有密钥。
    if ((error as { status?: number | null }).status !== KEYCHAIN_ITEM_NOT_FOUND) {
      throw new Error("vault: could not read the key from the Keychain (is it locked?)");
    }
    return null;
  }
}

/** 写钥匙串以前的只读检查：不在沙箱里，HOME 是真实的 home，能找到默认钥匙串。不通过时抛错，说明原因。 */
export function checkKeychainWritable(env: NodeJS.ProcessEnv = process.env): void {
  if (env.SANDBOX_RUNTIME) {
    throw new Error("vault: refusing to create a Keychain key inside a sandbox, where an existing key can look missing");
  }
  const home = userInfo().homedir;
  if (env.HOME !== home) {
    throw new Error(`vault: refusing to create a Keychain key because HOME (${env.HOME ?? "unset"}) is not the user's home (${home})`);
  }
  // 找不到默认钥匙串时 security 直接报错退出，不弹窗；通过 Security.framework 新建条目时才会弹窗请用户新建登录钥匙串。
  const result = spawnSync("security", ["default-keychain", "-d", "user"], { stdio: "ignore", timeout: KEYCHAIN_TIMEOUT_MS });
  if (result.status !== 0) {
    throw new Error("vault: refusing to create a Keychain key because no default keychain was found");
  }
}

export function keychainKeySource(
  account = userInfo().username, service = KEYCHAIN_VAULT_SERVICE, options: KeychainKeyOptions = {},
): VaultKeySource {
  return {
    load() {
      const found = findKeychainKey(account, service);
      if (found) return found;
      if (!options.hasSealedData) {
        throw new Error("vault: the Keychain has no key, and this process only reads it");
      }
      // 读不到但已经有密文：密钥一定存在过，新建的密钥解不开这些密文。
      if (options.hasSealedData()) {
        throw new Error("vault: the vault already has encrypted data, but the key in the Keychain cannot be read; not creating a new key");
      }
      checkKeychainWritable(options.env);
      // 账号名和服务名会拼进 `security -i` 的命令行，所以只接受不需要转义的字符。密钥是十六进制。
      if (!SAFE_KEYCHAIN_NAME.test(account) || !SAFE_KEYCHAIN_NAME.test(service)) {
        throw new Error("vault: the Keychain account or service name has characters that are not allowed");
      }
      const key = randomBytes(KEY_BYTES);
      // 命令走标准输入，不进 argv。不带 -U：已有的条目不会被覆盖。
      const result = spawnSync("security", ["-i"], {
        input: `add-generic-password -a "${account}" -s "${service}" -w ${key.toString("hex")}\n`,
        stdio: ["pipe", "ignore", "ignore"], timeout: KEYCHAIN_TIMEOUT_MS,
      });
      if (result.status === 0) return key;
      if (result.status === KEYCHAIN_DUPLICATE_ITEM) {
        // 条目已经在了（别的进程刚建好，或者刚才读不到）：用已有的。
        const existing = findKeychainKey(account, service);
        if (existing) return existing;
        throw new Error("vault: the Keychain already has a key, but it cannot be read");
      }
      throw new Error("vault: could not save the key to the Keychain");
    },
    async read() {
      try {
        const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS,
        });
        const key = Buffer.from(stdout.trim(), "hex");
        return key.length === KEY_BYTES ? key : null;
      } catch {
        return null;
      }
    },
  };
}

// 数据目录里的密钥文件（0600）。给没有 Keychain 的系统和测试用。
export function fileKeySource(path: string): VaultKeySource {
  return {
    load() {
      if (existsSync(path)) {
        const key = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
        if (key.length !== KEY_BYTES) throw new Error(`vault: key file ${path} is not ${KEY_BYTES} bytes`);
        chmodSync(path, 0o600);
        return key;
      }
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const key = randomBytes(KEY_BYTES);
      writeFileSync(path, key.toString("hex"), { mode: 0o600, flag: "wx" });
      return key;
    },
  };
}

// 环境变量 PLC_VAULT_KEY_SOURCE=file 时改用数据目录里的文件，不碰 Keychain。运行包的冒烟测试用它（工单 #243）。
export const VAULT_KEY_SOURCE_ENV = "PLC_VAULT_KEY_SOURCE";

// 缺省：macOS 用 Keychain，其他系统用数据目录里的文件。options 不给 hasSealedData 时，Keychain 只读不建。
export function defaultKeySource(keyFilePath: string, options: KeychainKeyOptions = {}): VaultKeySource {
  const env = options.env ?? process.env;
  if (env[VAULT_KEY_SOURCE_ENV] === "file" || process.platform !== "darwin") return fileKeySource(keyFilePath);
  return keychainKeySource(undefined, undefined, options);
}
