// Lead 调用模型失败时给人看的说法（lead-failure.ts）。界面按用户的语言取；plc chat 和 daemon 暂时取 zh。
import { defineMessages } from "./i18n.ts";

export const leadFailureMessages = defineMessages({
  en: {
    // 原因里称呼 Lead 用它的名字。
    reason: {
      network: (_name: string) => "The network is not available",
      unavailable: (name: string) => `The model service of ${name} is not available now`,
      busy: (name: string) => `The model service of ${name} is busy`,
      auth: (name: string) => `The model account of ${name} failed authentication`,
      config: (name: string) => `The model configuration of ${name} is not correct`,
      context: (name: string) => `The context of ${name} is full, and compaction did not succeed`,
      unknown: (name: string) => `${name} could not call the model`,
    },
    short: {
      network: "Network not available",
      unavailable: "Model not available",
      busy: "Model busy",
      auth: "Model authentication failed",
      config: "Model configuration error",
      context: "Context full",
      unknown: "Model call failed",
    },
    account: "account",
    configuration: "configuration",
    failure: {
      restartSystem: (name: string) => `A restart stopped this turn of ${name}. The system continues after the restart. You do not need to do anything.`,
      restartUser: (name: string) => `A restart stopped the reply of ${name}. Work that is done is not done again. After the restart, ${name} continues the reply.`,
      networkSystem: (reason: string, name: string) =>
        `${reason}. ${name} could not call the model this time. The system continues when the network is back. You do not need to do anything.`,
      networkUser: (reason: string) => `${reason}. This message got no answer. You can send it again.`,
      needsUserSystem: (reason: string, name: string, what: string) =>
        `${reason}. The system cannot recover by itself. Check the model ${what} of ${name}.`,
      needsUserUser: (reason: string, name: string, what: string) =>
        `${reason}. This message got no answer. Check the model ${what} of ${name}, then send it again.`,
      retrySystem: (reason: string) => `${reason}. The system tries again automatically. You do not need to do anything.`,
      retryUser: (reason: string) =>
        `${reason}. This message got no answer. The system does not send it again automatically. You can send it again.`,
    },
    waiting: {
      restart: (name: string) => `${name} is restarting. This message has no answer yet. It gets an answer automatically after the restart.`,
      network: "The network is not available. This message has no answer yet. The system tries again automatically when the network is back.",
      model: (reason: string) => `${reason}. This message has no answer yet. The system tries again automatically soon.`,
    },
  },
  zh: {
    reason: {
      network: () => "网络不可用",
      unavailable: (name) => `${name} 的模型服务暂时连不上`,
      busy: (name) => `${name} 的模型服务正忙`,
      auth: (name) => `${name} 的模型账号认证失败`,
      config: (name) => `${name} 的模型配置有误`,
      context: (name) => `${name} 的上下文满了，压缩没有成功`,
      unknown: (name) => `${name} 调用模型失败`,
    },
    short: {
      network: "网络不可用",
      unavailable: "模型暂时连不上",
      busy: "模型正忙",
      auth: "模型认证失败",
      config: "模型配置有误",
      context: "上下文满了",
      unknown: "模型调用失败",
    },
    account: "账号",
    configuration: "配置",
    failure: {
      restartSystem: (name) => `${name} 的这一轮被重启打断；重启后系统会继续，你不需要操作。`,
      restartUser: (name) => `${name} 的回复被重启打断；已经做完的事不会重做，重启后 ${name} 会接着回复你。`,
      networkSystem: (reason, name) => `${reason}，${name} 这次没能调用模型；网络恢复后系统会继续，你不需要操作。`,
      networkUser: (reason) => `${reason}，这条消息没有得到回答；你可以再发一次。`,
      needsUserSystem: (reason, name, what) => `${reason}；系统没法自己恢复，请检查 ${name} 的模型${what}。`,
      needsUserUser: (reason, name, what) => `${reason}，这条消息没有得到回答；请先检查 ${name} 的模型${what}，再发一次。`,
      retrySystem: (reason) => `${reason}；系统会自动再试，你不需要操作。`,
      retryUser: (reason) => `${reason}，这条消息没有得到回答；系统不会自动重发，你可以再发一次。`,
    },
    waiting: {
      restart: (name) => `${name} 正在重启，这条消息还没有得到回答。重启后会自动再答一次。`,
      network: "网络不可用，这条消息还没有得到回答。网络恢复后会自动再试一次。",
      model: (reason) => `${reason}，这条消息还没有得到回答。稍后会自动再试一次。`,
    },
  },
});
