// Lead 模型的分组（用户 2026-11-05 定的方案，原型在 docs/prototypes/model-grouping）。
// 设置 → 模型的模型库和三个下拉（大脑、直觉兜底、记忆的摘要模型）、首次启动的模型列表、会话输入框的模型选择都用这一个函数。
//
//   左栏（外层）是 provider，按模型第一次出现的先后。
//   右栏（里层）按「group · channel」分段：
//     · group 是账号（vibeproxy 的 as1、as4），只有服务商的 accountPrefix 生效时才有（daemon 算好，这里只读）；
//     · channel（界面上叫「通道」，代码里沿用 source）是目录的 owned_by，同一个 provider 的 channel 都一样时不写；
//     · 有 group 的分段在前，按数字顺序（as1、as4、as10）；没有 group 的在后，按在目录里出现的先后；
//     · group 和 channel 都没有时，分段没有标题。有多个 provider 的下拉，标题前面加 provider（sectionTitle 的 withProvider）。

export interface GroupableModel {
  provider: string;
  // 账号。没有时为 null。
  group: string | null;
  // 通道（owned_by）。不知道时为 null。
  source: string | null;
}

export interface ModelSection<T> {
  key: string;
  provider: string;
  group: string | null;
  // 要写出来的通道。这个 provider 只有一种通道时为 null。
  channel: string | null;
  // 画出来的模型（keep 留下的）。
  models: T[];
  // 这一段一共几个模型（不看 keep）。
  total: number;
}

export interface ProviderModelSections<T> {
  provider: string;
  // 这个 provider 一共几个模型（不看 keep）。
  count: number;
  sections: ModelSection<T>[];
}

/**
 * 把模型分成「provider → group · channel」两层。keep 只决定哪些模型画出来（搜索、收起）：通道写不写、分段怎么排
 * 按全部模型算，搜索时标题不变。分段里一个模型也不剩时去掉，provider 一段也不剩时也去掉。
 */
export function groupModelsByProvider<T extends GroupableModel>(
  models: readonly T[], options: { keep?: (model: T) => boolean } = {},
): ProviderModelSections<T>[] {
  const byProvider = new Map<string, T[]>();
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }
  const result: ProviderModelSections<T>[] = [];
  for (const [provider, list] of byProvider) {
    const showChannel = new Set(list.map((model) => model.source ?? "")).size > 1;
    const sections = new Map<string, ModelSection<T>>();
    for (const model of list) {
      const channel = showChannel ? model.source : null;
      const key = `${provider}|${model.group ?? ""}|${channel ?? ""}`;
      const section = sections.get(key) ?? { key, provider, group: model.group, channel, models: [], total: 0 };
      sections.set(key, section);
      section.total += 1;
      if (!options.keep || options.keep(model)) section.models.push(model);
    }
    const ordered = [...sections.values()].sort((left, right) => {
      if ((left.group === null) !== (right.group === null)) return left.group === null ? 1 : -1;
      if (left.group && right.group && left.group !== right.group) return left.group.localeCompare(right.group, "en", { numeric: true });
      return 0;
    }).filter((section) => section.models.length > 0);
    if (ordered.length) result.push({ provider, count: list.length, sections: ordered });
  }
  return result;
}

/** 分段的标题：group · channel，有多个 provider 时前面加 provider。都没有时是空字符串（不画标题）。 */
export function modelSectionTitle(section: Pick<ModelSection<unknown>, "provider" | "group" | "channel">, withProvider: boolean): string {
  return [withProvider ? section.provider : null, section.group, section.channel].filter(Boolean).join(" · ");
}

/** 全部分段排成一列（下拉、输入框的列表用）。 */
export function flatModelSections<T>(providers: readonly ProviderModelSections<T>[]): ModelSection<T>[] {
  return providers.flatMap((provider) => provider.sections);
}
