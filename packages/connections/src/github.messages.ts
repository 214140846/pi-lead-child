// GitHub 设备码流程结束时的说明（2026-11-01 多语言）。设置页的连接流程显示它，按用户选的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const githubMessages = defineMessages({
  en: {
    deviceExpired: "The device code expired. Connect again",
    deviceDenied: "You refused the authorization on GitHub",
    deviceError: (error: string) => `GitHub returned ${error}`,
  },
  zh: {
    deviceExpired: "设备码过期了，请重新连接",
    deviceDenied: "你在 GitHub 上拒绝了授权",
    deviceError: (error) => `GitHub 返回了 ${error}`,
  },
});
