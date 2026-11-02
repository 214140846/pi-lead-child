// 设置 → 模型（方案 B，2026-10-29，.scratch/model-settings/spec.md）的纯逻辑：分工的格子、模型库的分组和排序、文案。
// 页面（ModelSection.tsx、ModelPicker.tsx、ModelLibrary.tsx）只管画。
import {
  MODEL_MAX_BACKUPS, parseLeadModelSpec,
  DEFAULT_LOCALE,
  type BrainModel, type FastModel, type LeadModelChoice, type Locale, type ModelProvider, type ModelRelease, type ModelSettingsDto,
} from '@pi-lead-child/protocol';

import { intlLocale } from '@/i18n';

import { modelMessages } from './model.messages';

// 两类模型的名字（spec D1）、说明和生效时间（P15.2）在 model.messages.ts，界面上只从那里取。

// 模型库和下拉里，每个服务商先露出几个（最新的）。正在用的模型总会露出来。
export const LIBRARY_VISIBLE = 5;
export const PICKER_VISIBLE = 4;

export type BrainEntry = { provider: ModelProvider; model: BrainModel };

/** 目录里的模型：provider/id → 它和它的服务商。 */
export function brainIndex(dto: ModelSettingsDto): Map<string, BrainEntry> {
  const index = new Map<string, BrainEntry>();
  for (const provider of dto.brain.providers) {
    for (const model of provider.models) index.set(model.model, { provider, model });
  }
  return index;
}

/** 一个模型的显示名：目录的显示名，带账号前缀（as4）时写在后面。目录不在时是 id。 */
export function brainModelName(spec: string, entry: BrainEntry | undefined): string {
  const parsed = parseLeadModelSpec(spec);
  const name = entry?.model.name?.trim();
  if (!name) return parsed.id;
  return parsed.prefix ? `${name} · ${parsed.prefix}` : name;
}

/** 上下文窗口：1048576 → 1M，500000 → 500K。 */
export function contextLabel(tokens: number | null): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace('.0M', 'M');
  return `${Math.round(tokens / 1000)}K`;
}

/** 分工格子的第二行：服务商 · 图片 · 窗口 · 推理强度。 */
export function brainModelSub(spec: string, entry: BrainEntry | undefined, effort: string | null, locale: Locale): string {
  const m = modelMessages(locale);
  const parsed = parseLeadModelSpec(spec);
  if (!entry) return `${parsed.provider} · ${m.notInCatalog}`;
  return [
    parsed.provider,
    entry.model.image ? m.images : null,
    contextLabel(entry.model.contextWindow),
    effort ? m.reasoning(effort) : null,
  ].filter(Boolean).join(' · ');
}

/** 发布时间：服务商给的写日期，daemon 首见的写「首见 日期」。不知道时为 null。 */
export function releaseLabel(released: ModelRelease | null, locale: Locale): string | null {
  if (!released) return null;
  const date = localDate(released.at);
  return released.source === 'first_seen' ? modelMessages(locale).firstSeen(date) : date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function localDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 额度封禁到什么时候（P14.2）：一周以内写「周一 16:00」（英文 Mon 16:00），更远写「11-09 16:00」。 */
export function untilLabel(iso: string, now: Date, locale: Locale): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = (date.getTime() - now.getTime()) / 86_400_000;
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short' }).format(date);
  return days < 6.5 ? `${weekday} ${time}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

// ── 分工 ─────────────────────────────────────────────────────────────────────

export function slotLabel(index: number, locale: Locale): string {
  const m = modelMessages(locale);
  return index === 0 ? m.primary : m.backup(index);
}

/** 分工还能不能再加备用，能加几个。 */
export function backupsLeft(chainLength: number): number {
  return Math.max(0, MODEL_MAX_BACKUPS - Math.max(0, chainLength - 1));
}

/** 换掉第 index 格（index 等于长度时是加一格）。同一个模型再选一次时保留它的推理强度。 */
export function withSlot<T>(chain: readonly T[], index: number, value: T): T[] {
  const next = [...chain];
  next[index] = value;
  return next;
}

export function withoutSlot<T>(chain: readonly T[], index: number): T[] {
  return chain.filter((_, i) => i !== index);
}

/** 选中的模型在分工的哪一格（不看推理强度）。不在时为 -1。 */
export function brainSlotOf(chain: readonly LeadModelChoice[], model: string): number {
  return chain.findIndex((choice) => choice.model === model);
}

export function choiceFor(chain: readonly LeadModelChoice[], index: number, model: string): LeadModelChoice {
  const previous = chain[index];
  return { model, effort: previous?.model === model ? previous.effort : null };
}

/** 一个大脑模型在分工里的角色标签：主用、备用 n，以及是不是直觉的兜底。 */
export function brainRoles(dto: ModelSettingsDto, model: string, locale: Locale): string[] {
  const roles: string[] = [];
  const slot = brainSlotOf(dto.brain.chain, model);
  if (slot >= 0) roles.push(slotLabel(slot, locale));
  const fallback = dto.fast.llmFallback?.model ?? (dto.fast.effectiveLlm ? parseLeadModelSpec(dto.fast.effectiveLlm).model : null);
  if (fallback === model) roles.push(modelMessages(locale).fastFallbackRole);
  return roles;
}

export function fastRoles(dto: ModelSettingsDto, id: string, locale: Locale): string[] {
  const slot = dto.fast.chain.indexOf(id);
  return slot >= 0 ? [slotLabel(slot, locale)] : [];
}

/** 直觉一条的第二行：主机 · 模型。地址不合法时写问题。 */
export function fastModelSub(model: FastModel, locale: Locale): string {
  if (!model.baseUrl) return model.problem ?? modelMessages(locale).invalidAddress;
  return `${urlHost(model.baseUrl)} · ${model.model}`;
}

export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function fastKeyLabel(model: FastModel, locale: Locale): string {
  const m = modelMessages(locale);
  if (!model.apiKeySet) return m.noKey;
  return model.apiKeySource === 'env' ? m.keyInKeychain : m.keySet;
}

// ── 模型库的分组 ──────────────────────────────────────────────────────────────

export type ProviderGroupView = {
  provider: ModelProvider;
  // 要画出来的模型（最新的在前；收起「其余」时是最新的几个加上正在用的）。
  models: BrainModel[];
  // 收着没画的个数。
  hidden: number;
  // 分工里用了它几个模型（收起整组时行尾写出来）。
  inUse: string[];
  latest: string | null;
};

function matches(model: BrainModel, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return model.model.toLowerCase().includes(q) || (model.name?.toLowerCase().includes(q) ?? false);
}

/**
 * 一个服务商在模型库（或者下拉）里怎样画。搜索时露出全部匹配的；没搜索、也没点「显示其余」时露出最新的 visible 个，
 * 再加上正在用的（主用、备用、直觉兜底），不管它多旧。
 */
export function providerGroup(
  provider: ModelProvider, inUse: ReadonlySet<string>, options: { query?: string; showAll?: boolean; visible?: number } = {},
): ProviderGroupView {
  const query = options.query?.trim() ?? '';
  const matching = provider.models.filter((model) => matches(model, query));
  const limit = options.visible ?? LIBRARY_VISIBLE;
  const models = query || options.showAll
    ? matching
    : matching.filter((model, index) => index < limit || inUse.has(model.model));
  const latest = provider.models.find((model) => model.released?.source === 'provider')?.released ?? provider.models[0]?.released ?? null;
  return {
    provider, models, hidden: matching.length - models.length,
    inUse: provider.models.filter((model) => inUse.has(model.model)).map((model) => model.model),
    latest: latest ? localDate(latest.at) : null,
  };
}

/** 正在用的大脑模型：分工里的，和直觉兜底的那一个。 */
export function brainInUse(dto: ModelSettingsDto): Set<string> {
  const used = new Set(dto.brain.chain.map((choice) => choice.model));
  const fallback = dto.fast.llmFallback?.model ?? (dto.fast.effectiveLlm ? parseLeadModelSpec(dto.fast.effectiveLlm).model : null);
  if (fallback) used.add(fallback);
  return used;
}

/** 收起的组的行尾：组里有在用的模型时写出来（例如「主用 · 备用 1」）。 */
export function groupUseLabel(dto: ModelSettingsDto, group: ProviderGroupView, locale: Locale): string | null {
  const roles = group.inUse.flatMap((model) => brainRoles(dto, model, locale));
  return roles.length ? roles.join(' · ') : null;
}

/** 服务商一行的第二行：主机 · 接口 · key · 共 N 个 · 最新 日期。 */
export function providerSub(group: ProviderGroupView, locale: Locale): string {
  const m = modelMessages(locale);
  const { provider } = group;
  const key = provider.keySource === 'settings' ? m.keySet
    : provider.keySource === 'config' ? m.keyInConfig
    : provider.keySource === 'env' ? m.keyInEnv
    : m.keyNotNeeded;
  return [
    urlHost(provider.baseUrl), apiLabels(locale)[provider.api], key, m.modelCount(provider.models.length),
    group.latest ? m.latest(group.latest) : null,
  ].filter(Boolean).join(' · ');
}

// 接口格式的名字。只有「OpenAI 兼容」要翻译，其余是产品名。
export function apiLabels(locale: Locale = DEFAULT_LOCALE): Record<ModelProvider['api'], string> {
  return {
    'openai-completions': modelMessages(locale).apiCompatible,
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic',
    'google-generative-ai': 'Google',
  };
}

/** 有在用模型的服务商默认展开，其他默认收起（画布方案 B）。 */
export function defaultExpanded(dto: ModelSettingsDto): Set<string> {
  const used = brainInUse(dto);
  return new Set(dto.brain.providers.filter((provider) => provider.models.some((model) => used.has(model.model))).map((provider) => provider.name));
}

// ── 表单 ─────────────────────────────────────────────────────────────────────

export const PROVIDER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** 服务商表单的问题。没问题时为 null。地址的检查和 daemon 用同一句话（serviceUrlProblem）。 */
export function providerFormProblem(
  form: { name: string; baseUrl: string }, isNew: boolean, taken: readonly string[], urlProblem: string | null, locale: Locale,
): string | null {
  const m = modelMessages(locale);
  if (isNew) {
    if (!PROVIDER_NAME_PATTERN.test(form.name.trim())) return m.providerNameInvalid;
    if (taken.includes(form.name.trim())) return m.providerNameTaken(form.name.trim());
  }
  if (!form.baseUrl.trim()) return m.addressRequired;
  return urlProblem;
}

export function fastFormProblem(form: { name: string; baseUrl: string; model: string }, urlProblem: string | null, locale: Locale): string | null {
  const m = modelMessages(locale);
  if (!form.name.trim()) return m.nameRequired;
  if (form.name.trim().length > 40) return m.nameTooLong;
  if (!form.baseUrl.trim()) return m.addressRequired;
  if (urlProblem) return urlProblem;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.model.trim())) return m.modelNameInvalid;
  return null;
}
