// Lead 的模型选择（2026-10-26）：会话输入框的模型浮层按分组列出目录里的模型。
// 分组规则和设置页、首次启动共用一个函数（protocol 的 model-groups.ts，用户 2026-11-05 定的方案）：
// provider → 「group · channel」分段。账号（group）只在服务商的 accountPrefix 生效时才有，目录 DTO 里写在 prefix 字段。
// 浮层的界面由另一张单改（左栏 provider、右栏分段）；这里只把新的分组交给现在的列表。
import {
  flatModelSections, groupModelsByProvider, modelSectionTitle, parseLeadModelSpec, type LeadModelOption,
} from '@pi-lead-child/protocol';

export interface LeadModelGroup {
  key: string;
  // 分段标题：group · channel，有多个 provider 时前面加 provider。都没有时是空字符串。
  title: string;
  models: LeadModelOption[];
}

export function groupLeadModels(models: readonly LeadModelOption[]): LeadModelGroup[] {
  const providers = groupModelsByProvider(models.map((model) => ({ ...model, group: model.prefix })));
  const withProvider = providers.length > 1;
  return flatModelSections(providers).map((section) => ({
    key: section.key,
    title: modelSectionTitle(section, withProvider),
    models: section.models,
  }));
}

// 输入框右下角写的：模型 id（不带 provider）和推理强度。不知道账号时写完整的 id（auto/deepseek-flash 和
// deepseek/deepseek-flash 不能显示成同一个名字）；知道账号时去掉它。
export function leadModelLabel(spec: string, group: string | null = null): { id: string; effort: string | null } {
  const parsed = parseLeadModelSpec(spec, group);
  return { id: parsed.bareId, effort: parsed.effort };
}

// 换到另一个模型时用的推理强度：这个模型也支持现在的强度就留着，不支持时用模型自己的缺省（不加后缀）。
export function effortForModel(model: LeadModelOption, current: string | null): string | null {
  return current && model.efforts.includes(current) ? current : null;
}
