// 连接的目录：预设的服务，加上用户自己添加的远程 MCP。目录是数据，不是代码分支：
// 新服务只要支持 MCP 授权规范，就能当作「自定义 MCP」接进来，不用改这里。
// 调研结论（2026-10-16，见 .scratch/settings-connections/spec.md）：Atlassian 和 Notion 支持 DCR，能一键连接；
// GitHub 的远程 MCP 不支持 DCR，先复用 gh 的登录；Slack 要一个预注册的 app；Google 还在预览期，先不做。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, type Locale } from "@pi-lead-child/protocol";
import { catalogMessages } from "./catalog.messages.js";

export type ProviderId = "atlassian" | "notion" | "github" | "slack" | "google" | "custom";

// oauth：MCP 授权规范的一键 OAuth（发现 + 预注册客户端或 DCR）。
// github：先 gh auth token，再设备码，最后 PAT。
export type ProviderAuth = "oauth" | "github" | "none";

export interface CatalogEntry {
  id: Exclude<ProviderId, "custom">;
  label: string;
  // 一句话说明能用它做什么，在 catalog.messages.ts 里按 id 写（capabilityText）。设置页和 Lead 的提示词都用这一句。
  serverUrl: string | null;
  auth: ProviderAuth;
  // 授权有固定期限时的天数（Notion：首次授权 180 天后一定失效），用来提前提醒。
  grantLifetimeDays?: number;
  // 必须用预注册客户端（不支持 DCR）。没有配置时，这个服务显示「需要额外设置」。
  requiresClient?: boolean;
  // 暂不支持。原因在 catalog.messages.ts 的 unavailable 里按 id 写（unavailableText）。设置页显示「即将支持」。
  unavailable?: true;
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: "atlassian", label: "Jira & Confluence",
    serverUrl: "https://mcp.atlassian.com/v2/mcp", auth: "oauth",
  },
  {
    id: "github", label: "GitHub",
    serverUrl: "https://api.githubcopilot.com/mcp/", auth: "github",
  },
  {
    id: "notion", label: "Notion",
    serverUrl: "https://mcp.notion.com/mcp", auth: "oauth", grantLifetimeDays: 180,
  },
  {
    id: "slack", label: "Slack",
    serverUrl: "https://mcp.slack.com/mcp", auth: "oauth", requiresClient: true,
  },
  {
    id: "google", label: "Google",
    serverUrl: null, auth: "none", unavailable: true,
  },
];

// 认得出的自定义 MCP（landing.md C5）：用户照常用「添加自定义 MCP」（hub 的 addCustom）接进来，连接中心按服务器地址认出它，
//   - 给它一个别名（权限清单和 Lead 按别名写，例如 cdp），和一句能力说明（catalog.messages.ts 里按别名写）；
//   - readTools 不为空时只开放这几个只读工具：别的工具对谁都看不到、调不了（包括 Lead），服务器以后加了写工具也一样。
//     服务器没标 readOnlyHint 也按只读算：这几个是查过它的文档定下的只读工具。
// 加一个认得出的服务只要在这里加一行；中间的检查不按服务分支。
export type KnownServerAlias = "cdp";

export interface KnownServer {
  url: string;
  alias: KnownServerAlias;
  label: string;
  readTools: readonly string[];
}

export const KNOWN_SERVERS: readonly KnownServer[] = [
  {
    // Acme 的客户数据平台。工具名照 using-cdp 技能的说明（9 个只读工具，没有写操作）。
    url: "https://mcp.acme.org/cdp/mcp", alias: "cdp", label: "CDP",
    readTools: [
      "get_audience_definitions", "search_audiences", "aggregate_audiences", "search_cohorts", "list_cohort_audiences",
      "search_key_actions", "get_key_action", "search_activities", "search_event_definitions",
    ],
  },
];

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/** 按服务器地址认出的服务。地址末尾的 / 不算。 */
export function knownServer(serverUrl: string | null | undefined): KnownServer | null {
  if (!serverUrl) return null;
  const url = withoutTrailingSlash(serverUrl.trim());
  return KNOWN_SERVERS.find((entry) => withoutTrailingSlash(entry.url) === url) ?? null;
}

export function knownServerByAlias(alias: string): KnownServer | null {
  const wanted = alias.trim().toLowerCase();
  return KNOWN_SERVERS.find((entry) => entry.alias === wanted) ?? null;
}

export function catalogEntry(id: string): CatalogEntry | null {
  return CATALOG.find((entry) => entry.id === id) ?? null;
}

/** 一句话的能力说明：目录里的服务按 id，认得出的服务按别名，别的自定义 MCP 用通用的一句。 */
export function capabilityText(locale: Locale, id: CatalogEntry["id"] | KnownServerAlias | null): string {
  const m = catalogMessages(locale);
  return id ? m.capability[id] : m.customCapability;
}

/** 暂不支持的原因。服务没有标 unavailable 时返回 null。 */
export function unavailableText(locale: Locale, entry: CatalogEntry | null): string | null {
  if (!entry?.unavailable) return null;
  const reasons: Partial<Record<CatalogEntry["id"], string>> = catalogMessages(locale).unavailable;
  return reasons[entry.id] ?? null;
}

// 预注册的 OAuth 客户端。client ID 不是密钥，放在 config.json 或环境变量里；client secret 是密钥，
// 只从 Keychain 读（见 ConnectionSecrets），不进 config.json，也不进 process.env。
export interface PreregisteredClient {
  clientId: string;
  // 读 client secret 时用的名字（Keychain 里是 dev-secret:<name>）。只在 PKCE 走不通时才需要。
  secretName: string;
}

export interface ConnectionsConfig {
  clients: Partial<Record<"slack" | "github", PreregisteredClient>>;
}

const CLIENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

// 读 config.json 的 connections 一节：
//   { "connections": { "slack": { "clientId": "..." }, "github": { "clientId": "..." } } }
// 环境变量 PLC_SLACK_CLIENT_ID / PLC_GITHUB_CLIENT_ID 优先。
export function loadConnectionsConfig(dataDir: string, env: Record<string, string | undefined> = process.env): ConnectionsConfig {
  let section: Record<string, unknown> = {};
  const path = join(dataDir, "config.json");
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { connections?: unknown };
      if (parsed.connections && typeof parsed.connections === "object" && !Array.isArray(parsed.connections)) {
        section = parsed.connections as Record<string, unknown>;
      }
    } catch {
      // config.json 坏了时别的模块会报错；这里当作没有配置。
    }
  }
  const clients: ConnectionsConfig["clients"] = {};
  for (const provider of ["slack", "github"] as const) {
    const fromFile = section[provider] && typeof section[provider] === "object"
      ? (section[provider] as { clientId?: unknown }).clientId
      : undefined;
    const clientId = env[`PLC_${provider.toUpperCase()}_CLIENT_ID`]?.trim() || (typeof fromFile === "string" ? fromFile.trim() : "");
    if (clientId && CLIENT_ID.test(clientId)) {
      clients[provider] = { clientId, secretName: `PLC_${provider.toUpperCase()}_CLIENT_SECRET` };
    }
  }
  return { clients };
}


// 一个自定义 MCP 地址：只接受 HTTPS，不带用户名密码和片段。返回规范化的地址。错误按 locale 写（设置页显示）。
export function normalizeCustomServerUrl(input: string, locale: Locale = DEFAULT_LOCALE): string {
  const m = catalogMessages(locale);
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(m.urlNotValid);
  }
  if (url.protocol !== "https:") throw new Error(m.urlNotHttps);
  if (url.username || url.password) throw new Error(m.urlHasCredentials);
  url.hash = "";
  return url.toString();
}
