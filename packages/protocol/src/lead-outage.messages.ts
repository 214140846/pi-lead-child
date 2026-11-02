// 停摆卡片的说法（lead-outage.ts）。界面按用户的语言取；daemon 写进数据库的标题暂时取 zh。
import { defineMessages } from "./i18n.ts";

export const leadOutageMessages = defineMessages({
  en: {
    cause: {
      network: "network down",
      unavailable: "model service not available",
      busy: "model service busy",
      auth: "model authentication failed",
      config: "model configuration error",
      context: "context full, compaction did not succeed",
      unknown: "model call failed",
      silent: "no response",
    },
    rangeOpen: (start: string) => `since ${start}`,
    rangeBrief: (start: string) => `${start}, less than a minute`,
    recovered: (end: string) => `recovered at ${end}`,
    recoveredNow: "recovered",
    resumed: (recovered: string) => `${recovered}, waiting work handled`,
    headline: (name: string, range: string, cause: string, pending: number, tail: string) =>
      `${name} offline ${range} (${cause}) · ${pending === 1 ? "1 item" : `${pending} items`} waited${tail ? ` · ${tail}` : ""}`,
    followUpDue: (name: string) => `A follow-up that ${name} set is due`,
  },
  zh: {
    cause: {
      network: "网络中断",
      unavailable: "模型服务连不上",
      busy: "模型服务正忙",
      auth: "模型认证失败",
      config: "模型配置有误",
      context: "上下文满了，压缩没有成功",
      unknown: "模型调用失败",
      // 标题的开头已经是 Lead 的名字（「Paimon 离线 …（没有响应）」），这里不再写一遍。
      silent: "没有响应",
    },
    rangeOpen: (start) => `${start} 起`,
    rangeBrief: (start) => `${start}，不到一分钟`,
    recovered: (end) => `${end} 已恢复`,
    recoveredNow: "已恢复",
    resumed: (recovered) => `${recovered}并补处理`,
    headline: (name, range, cause, pending, tail) => `${name} 离线 ${range}（${cause}）· 期间积压 ${pending} 件${tail ? ` · ${tail}` : ""}`,
    followUpDue: (name) => `${name} 设的一次跟进到点了`,
  },
});
