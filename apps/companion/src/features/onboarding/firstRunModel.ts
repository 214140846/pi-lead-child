import type {
  BrainModel, KernelRuntimeId, Locale, ModelProvider, ModelProviderApi, ModelSettingsDto, RuntimeSettingEntry, RuntimeSettingsDto,
  RuntimeSettingsRequest,
} from '@pi-lead-child/protocol';

import { onboardingMessages } from './onboarding.messages';

// 首次启动页（2026-10-30，.scratch/onboarding/spec.md，画布 A1、A3）的纯函数：服务商预设、接入时的请求、推荐哪个模型。
// 首次启动时还没有任何服务商（用户 2026-10-30）：先选接口类型、填 key 或地址，连接后读这家的模型列表，再选模型。

export type FirstRunPresetId = 'anthropic' | 'openai' | 'google' | 'custom';

export interface FirstRunPreset {
  id: FirstRunPresetId;
  label: string;
  description: string;
  // 预设的服务商。custom 的地址和接口格式由用户填。
  name: string | null;
  baseUrl: string | null;
  api: ModelProviderApi | null;
}

const PRESETS: readonly Omit<FirstRunPreset, 'label' | 'description'>[] = [
  { id: 'anthropic', name: 'anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { id: 'openai', name: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' },
  // Gemini 走 Google 的 OpenAI 兼容端点：目录和对话都用 Bearer key。
  { id: 'google', name: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', api: 'openai-completions' },
  { id: 'custom', name: null, baseUrl: null, api: null },
];

// 品牌名不翻译；其他服务的名字和每一项的说明按界面语言。
const BRAND_LABELS: Record<Exclude<FirstRunPresetId, 'custom'>, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };

/** 预设的服务商，名字和说明按界面语言。 */
export function firstRunPresets(locale: Locale): FirstRunPreset[] {
  const m = onboardingMessages(locale);
  return PRESETS.map((preset) => ({
    ...preset,
    label: preset.id === 'custom' ? m.customLabel : BRAND_LABELS[preset.id],
    description: m.presets[preset.id],
  }));
}

export function firstRunPreset(id: FirstRunPresetId, locale: Locale): FirstRunPreset {
  const presets = firstRunPresets(locale);
  return presets.find((preset) => preset.id === id) ?? presets[0]!;
}

/** 其他服务的名字：从主机名来（127.0.0.1:8317 → local-8317，api.example.com → example），和已有的重名时加编号。 */
export function customProviderName(baseUrl: string, existing: readonly string[]): string {
  let host = '';
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    host = '';
  }
  const [hostname = '', port] = host.split(':');
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const parts = hostname.split('.').filter((part) => part && part !== 'api' && part !== 'www');
  const base = local ? `local${port ? `-${port}` : ''}` : (parts.length > 1 ? parts.at(-2)! : parts[0] ?? 'custom');
  const cleaned = base.replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 28) || 'custom';
  if (!existing.includes(cleaned)) return cleaned;
  for (let index = 2; index < 100; index++) if (!existing.includes(`${cleaned}-${index}`)) return `${cleaned}-${index}`;
  return `${cleaned}-${Date.now() % 1000}`;
}

export interface FirstRunProviderForm {
  preset: FirstRunPresetId;
  apiKey: string;
  // 只有其他服务用：地址和接口格式。
  baseUrl: string;
  api: ModelProviderApi;
}

/** 接入请求（save_provider 的 input）。填得不对时返回原因。 */
export function firstRunProviderRequest(
  form: FirstRunProviderForm,
  existing: readonly string[],
  locale: Locale,
): { ok: true; input: { name: string; baseUrl: string; api: ModelProviderApi; apiKey?: string } } | { ok: false; problem: string } {
  const m = onboardingMessages(locale);
  const preset = firstRunPreset(form.preset, locale);
  const apiKey = form.apiKey.trim();
  if (preset.id !== 'custom') {
    if (!apiKey) return { ok: false, problem: m.keyMissing(preset.label) };
    return { ok: true, input: { name: preset.name!, baseUrl: preset.baseUrl!, api: preset.api!, apiKey } };
  }
  const baseUrl = form.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(baseUrl)) return { ok: false, problem: m.badUrl };
  return { ok: true, input: { name: customProviderName(baseUrl, existing), baseUrl, api: form.api, ...(apiKey ? { apiKey } : {}) } };
}

/** 刚接入的服务商（按名字找）。还没出现在模型设置里时为 null。 */
export function connectedProvider(dto: ModelSettingsDto | null, name: string | null): ModelProvider | null {
  if (!dto || !name) return null;
  return dto.brain.providers.find((provider) => provider.name === name) ?? null;
}

// 小、快、便宜的那一档不推荐当大脑。
const LIGHT_MODEL = /(haiku|mini|nano|flash|lite|small|tiny)/i;

/** 推荐当大脑的模型：目录里最新发布的、不是小模型的那个；都是小模型时取最新的。目录是空的时为 null。 */
export function recommendedBrainModel(models: readonly BrainModel[]): BrainModel | null {
  return models.find((model) => !LIGHT_MODEL.test(model.id)) ?? models[0] ?? null;
}

/** 页面上先列几个：推荐的排第一，再按目录的顺序（新的在前），一共 limit 个。 */
export function firstRunModelList(models: readonly BrainModel[], limit: number | null): BrainModel[] {
  const recommended = recommendedBrainModel(models);
  const ordered = recommended ? [recommended, ...models.filter((model) => model.model !== recommended.model)] : [...models];
  return limit === null ? ordered : ordered.slice(0, limit);
}

/** 模型名下面的一行：上下文窗口、能不能看图。 */
export function firstRunModelMeta(model: BrainModel, locale: Locale): string {
  const m = onboardingMessages(locale);
  const parts: string[] = [];
  if (model.image) parts.push(m.image);
  if (model.contextWindow) {
    parts.push(m.context(model.contextWindow >= 1_000_000 ? `${Math.round(model.contextWindow / 100_000) / 10}M` : `${Math.round(model.contextWindow / 1000)}K`));
  }
  if (model.released?.source === 'provider') parts.push(m.released(model.released.at.slice(0, 10)));
  return parts.join(' · ') || model.id;
}

// 页面要的事实都在这里算：网页包开着 React Compiler，组件里读一个可能是 null 的对象的属性时，编译器会把它提到渲染时读，
// 对象是 null 时整个组件崩掉（2026-10-29 设置 → 模型踩过）。组件只拿这个函数的结果。
export function firstRunProviderFacts(provider: ModelProvider | null, locale: Locale) {
  if (!provider) return { connected: false, name: null, modelCount: 0, models: [] as BrainModel[], problem: null };
  const connected = provider.problem === null && provider.models.length > 0;
  return {
    connected,
    name: provider.name,
    modelCount: provider.models.length,
    models: provider.models,
    // 接入了，但目录读不出来：说明原因，留在第一步。
    problem: connected ? null : provider.problem ?? onboardingMessages(locale).emptyCatalog(provider.name),
  };
}

/** 选中的模型的缺省推理强度（目录给的）。 */
export function modelEffort(models: readonly BrainModel[], model: string): string | null {
  return models.find((entry) => entry.model === model)?.defaultEffort ?? null;
}

// 首次启动引导走到哪一步（docs/desktop/macos-desktop-design.md 第 5.3 节，P0-6）。
//   brain：大脑不能用，显示第一步（FirstRunBrain）。「先进去看看」只在这次打开 App 时跳过。
//   runtimes：这次打开 App 时在第一步接好了大脑，接着选执行器（FirstRunRuntimes）。这一步只出现一次：
//     做完或跳过以后本机记下来（firstRunMemory），再也不出现；大脑本来就能用的人（老用户）不会看到它。
export type FirstRunStep = 'brain' | 'runtimes' | null;

export interface FirstRunStepInput {
  // 连上了 daemon。
  connected: boolean;
  brainReady: boolean;
  // 这次打开 App 时点了「先进去看看」。
  brainSkipped: boolean;
  // 这次打开 App 时显示过第一步。
  brainShown: boolean;
  // 选执行器这一步做过或跳过了（这次，或者本机以前记下的）。
  runtimesDone: boolean;
}

export function firstRunStep(input: FirstRunStepInput): FirstRunStep {
  if (!input.connected || input.brainSkipped) return null;
  if (!input.brainReady) return 'brain';
  return input.brainShown && !input.runtimesDone ? 'runtimes' : null;
}

// 第二步：选执行器。数据来自设置 → 执行器的同一个接口（GET /v1/runtimes/settings，每次 GET 都重新找可执行文件），
// 不另写探测。提交也走同一个操作（POST /v1/runtimes/settings → 操作层 runtime 的 disable、enable），
// Lead 用 perform_action 能做同样的事（AGENTS.md「UI Actions」）。

// 没找到时给的安装说明（官方页面）。pi 由 daemon 自带，不给链接。
export const RUNTIME_INSTALL_URLS: Partial<Record<KernelRuntimeId, string>> = {
  codex: 'https://github.com/openai/codex',
  claude: 'https://code.claude.com/docs/en/setup',
};

// built_in：pi，运行包自带，总是可以选。
export type FirstRunRuntimeStatus = 'installed' | 'not_found' | 'built_in';

// 用户在这一页拨过的开关。没拨过的项用缺省值。
export type FirstRunRuntimePicks = Partial<Record<KernelRuntimeId, boolean>>;

export interface FirstRunRuntimeRow {
  id: KernelRuntimeId;
  label: string;
  status: FirstRunRuntimeStatus;
  checked: boolean;
  installUrl: string | null;
}

function runtimeStatus(entry: RuntimeSettingEntry): FirstRunRuntimeStatus {
  if (entry.id === 'pi') return 'built_in';
  return entry.installed ? 'installed' : 'not_found';
}

/** 缺省勾不勾：已安装的勾上，pi 总是勾上。重新检测发现刚装好的，没拨过时自动勾上。 */
function runtimeChecked(entry: RuntimeSettingEntry, picks: FirstRunRuntimePicks): boolean {
  return picks[entry.id] ?? runtimeStatus(entry) !== 'not_found';
}

/** 页面上的每一行。还没取到设置时为空。 */
export function firstRunRuntimeRows(settings: RuntimeSettingsDto | null, picks: FirstRunRuntimePicks): FirstRunRuntimeRow[] {
  if (!settings) return [];
  return settings.runtimes.map((entry) => {
    const status = runtimeStatus(entry);
    return {
      id: entry.id,
      label: entry.label,
      status,
      checked: runtimeChecked(entry, picks),
      installUrl: status === 'not_found' ? RUNTIME_INSTALL_URLS[entry.id] ?? null : null,
    };
  });
}

/** 提交时要拨的开关：勾选的结果和现在的设置不同的那几项，一项一个请求。没勾的停用，勾上的启用。 */
export function firstRunRuntimeRequests(settings: RuntimeSettingsDto | null, picks: FirstRunRuntimePicks): RuntimeSettingsRequest[] {
  if (!settings) return [];
  return settings.runtimes
    .filter((entry) => runtimeChecked(entry, picks) !== entry.enabled)
    .map((entry) => ({ runtime: entry.id, enabled: runtimeChecked(entry, picks) }));
}
