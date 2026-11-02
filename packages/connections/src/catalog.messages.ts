// 连接目录里给人看的文字（2026-11-01 多语言）：每个服务的能力说明、暂不支持的原因、自定义地址的校验错误。
// 设置 → 连接页面和 Lead 的连接列表都用它，按读的时候用户选的语言（store 的 getLocale）算。
import { defineMessages } from "@pi-lead-child/protocol";

export const catalogMessages = defineMessages({
  en: {
    // 一句话说明能用这个服务做什么。键是目录的 id，或者认得出的服务的别名。
    capability: {
      atlassian: "Find, create and change Jira issues. Search and read Confluence pages",
      github: "Read repositories, PRs and issues. Write comments",
      notion: "Search, read and edit Notion pages",
      slack: "Search messages, read channels and direct messages, and send messages as you",
      google: "Gmail, Calendar and Drive",
      cdp: "Read-only queries on customer data: audiences (contacts, companies, organizations, stores), cohorts, key actions and event records",
    },
    customCapability: "The tools that this remote MCP server gives",
    unavailable: {
      google: "The Google MCP is still in preview. You cannot connect it with one click yet",
    },
    urlNotValid: "Type a full address, for example https://mcp.example.com/mcp",
    urlNotHttps: "The address of a remote MCP must start with https://",
    urlHasCredentials: "The address cannot contain a user name or a password",
  },
  zh: {
    capability: {
      atlassian: "查、建、改 Jira issue，搜索和读 Confluence 页面",
      github: "读仓库、PR 和 issue，写评论",
      notion: "搜索、读和编辑 Notion 页面",
      slack: "搜索消息，读频道和私信，以你的身份发消息",
      google: "Gmail、日历和云端硬盘",
      cdp: "只读查询客户数据：audience（联系人、公司、组织、店铺）、cohort、key action 和事件记录",
    },
    customCapability: "这个远程 MCP 服务器提供的工具",
    unavailable: {
      google: "Google 的 MCP 还在预览期，暂时不能一键连接",
    },
    urlNotValid: "请输入一个完整的地址，例如 https://mcp.example.com/mcp",
    urlNotHttps: "远程 MCP 的地址必须以 https:// 开头",
    urlHasCredentials: "地址里不能带用户名或密码",
  },
});
