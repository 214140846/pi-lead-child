// 设置 → 模型保存时给用户看的文字（model-settings.ts）：结果的摘要（summary）、说明（note）和错误。
// 设置页直接显示它们，Lead 的工具也读它们：按用户现在的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const modelSettingsMessages = defineMessages({
  en: {
    brainSummary: (primary: string, backups: readonly string[]) =>
      `Brain: primary ${primary}, ${backups.length ? `backups ${backups.join(", ")}` : "no backups"}`,
    afterTurn: (leadName: string) => `${leadName} is answering now. The primary model changes when this turn ends.`,
    apiFormat: (apis: readonly string[]) => `The API format must be one of: ${apis.join(", ")}.`,
    keyDropped: (host: string | null, oldHost: string | null) =>
      `The address changed to ${host}. The old key was only for ${oldHost}, so the daemon deleted it.`,
    configKeyDropped: "The address changed to a different host, so the daemon deleted the old key in config.json.",
    joinNotes: (notes: readonly string[]) => notes.join(" "),
    providerAdded: (name: string, host: string | null) => `Added the provider ${name} (${host})`,
    providerChanged: (name: string, host: string | null) => `Changed the provider ${name} (${host})`,
    noProvider: (name: string) => `There is no provider with the name ${name}.`,
    providerInBrain: (models: readonly string[]) =>
      `The brain assignment still uses ${models.join(", ")}. Replace them in "Current assignment" first, then delete the provider.`,
    providerIsFallback: (model: string) =>
      `When no intuition model works, the daemon asks ${model}. Replace it first, then delete the provider.`,
    providerRemoved: (name: string) => `Deleted the provider ${name}`,
    noFastModel: (ids: readonly string[]) => `There is no intuition model with the ID ${ids.join(", ")}.`,
    tooManyFastModels: (max: number) => `You can have at most ${max} intuition models.`,
    fastAdded: (name: string, host: string | null) => `Added the intuition model ${name} (${host})`,
    fastChanged: (name: string, host: string | null) => `Changed the intuition model ${name} (${host})`,
    fastInChain: (name: string) => `${name} is still in the intuition assignment. Remove it in "Current assignment" first, then delete it.`,
    fastRemoved: (name: string) => `Deleted the intuition model ${name}`,
    fastSummary: (primary: string | null, backups: readonly string[], fallback: string | null) =>
      (primary
        ? `Intuition: primary ${primary}, ${backups.length ? `backups ${backups.join(", ")}` : "no backups"}`
        : "Intuition: no decision model, the brain makes all judgments")
      + `; when none works, ask ${fallback ?? "the brain model that the system selects"}`,
    noMemoryService: "This daemon does not manage the memory service, so it cannot test decision models.",
  },
  zh: {
    brainSummary: (primary, backups) => `大脑：主用 ${primary}${backups.length ? `，备用 ${backups.join("、")}` : "，没有备用"}`,
    afterTurn: (leadName) => `${leadName} 正在回答，这一轮结束后换主用。`,
    apiFormat: (apis) => `接口格式只能是 ${apis.join("、")}`,
    keyDropped: (host, oldHost) => `地址换到了 ${host}，原来的 key 只给 ${oldHost}，已经删掉。`,
    configKeyDropped: "地址换了主机，config.json 里原来的 key 已经删掉。",
    joinNotes: (notes) => notes.join(""),
    providerAdded: (name, host) => `接入了服务商 ${name}（${host}）`,
    providerChanged: (name, host) => `改了服务商 ${name}（${host}）`,
    noProvider: (name) => `没有这个服务商：${name}`,
    providerInBrain: (models) => `大脑的分工里还在用 ${models.join("、")}。先在「现在的分工」里换掉，再删服务商。`,
    providerIsFallback: (model) => `直觉都用不了时问的是 ${model}。先换掉它，再删服务商。`,
    providerRemoved: (name) => `删掉了服务商 ${name}`,
    noFastModel: (ids) => `没有这条直觉：${ids.join("、")}`,
    tooManyFastModels: (max) => `直觉最多 ${max} 条`,
    fastAdded: (name, host) => `添加了直觉 ${name}（${host}）`,
    fastChanged: (name, host) => `改了直觉 ${name}（${host}）`,
    fastInChain: (name) => `${name} 还在直觉的分工里。先在「现在的分工」里移出，再删。`,
    fastRemoved: (name) => `删掉了直觉 ${name}`,
    fastSummary: (primary, backups, fallback) =>
      (primary ? `直觉：主用 ${primary}${backups.length ? `，备用 ${backups.join("、")}` : "，没有备用"}` : "直觉：不用决策模型，判断都问大脑")
      + `；都用不了时问 ${fallback ?? "系统选的大脑模型"}`,
    noMemoryService: "这台 daemon 没有托管记忆服务，测不了决策模型",
  },
});
