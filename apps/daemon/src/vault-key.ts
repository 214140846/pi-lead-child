// daemon 的保险库密钥从哪里来（packages/connections 的 vault.ts）。
// macOS 上在 Keychain 里。Keychain 里读不到密钥时，只有保险库里还没有任何密文才能新建一个，也就是首次安装、第一次用到保险库时：
// 已经有密文就说明密钥存在过，读不到只能是读不到（沙箱、HOME 被换掉、钥匙串锁着），新建的密钥会让这些密文再也解不开（工单 #243）。
// PLC_VAULT_KEY_SOURCE=file 时用数据目录里的文件，不碰 Keychain（运行包的冒烟测试）。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultKeySource, type VaultKeySource } from "@pi-lead-child/connections";
import type { Db } from "@pi-lead-child/store";
import { hindsightSecretsPath } from "./memory-controller.js";

/** 保险库里有没有密文：连接的令牌、OAuth 客户端的密钥、设置页存的密钥（kv 的 secret.*）、连接设置的封印和清单、记忆服务的 secrets.sealed。 */
export function vaultHasSealedData(db: Db, dataDir: string): boolean {
  if (existsSync(hindsightSecretsPath(dataDir))) return true;
  try {
    const row = db.prepare(
      `SELECT 1 FROM connections WHERE secret_cipher IS NOT NULL
       UNION ALL SELECT 1 FROM oauth_clients WHERE secret_cipher IS NOT NULL
       UNION ALL SELECT 1 FROM kv WHERE substr(key, 1, 7) = 'secret.'
         OR key = 'connection.settings_manifest' OR substr(key, 1, 25) = 'connection.settings_seal:'
       LIMIT 1`,
    ).get();
    return row !== undefined;
  } catch {
    // 查不了（表不在、库坏了）：当作有密文，不新建。
    return true;
  }
}

export function daemonKeySource(db: Db, dataDir: string, env: NodeJS.ProcessEnv = process.env): VaultKeySource {
  return defaultKeySource(join(dataDir, "connections.key"), { env, hasSealedData: () => vaultHasSealedData(db, dataDir) });
}
