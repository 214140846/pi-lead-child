// 设置页「记忆」和「模型」的纯规则：现状怎样说、下载进度怎样写、数据会去哪里、表单怎样检查。
// 契约在 packages/protocol/src/memory.ts。
import {
  CORE_MEMORY_CONTENT_MAX, CORE_MEMORY_TITLE_MAX, isPlaintextServiceUrl, serviceUrlProblem,
  type CoreMemoryEntryDto, type CoreMemoryUpdateRequest, type MemoryBankStatsDto, type MemoryDataFlow, type MemoryDownload, type MemoryInvalidatedFactDto,
  type Locale, type MemoryPreferencesDto, type MemorySettingsDto, type MemoryWritesDto, type SummaryModelSlot, type SummaryModelSlotDto,
} from '@pi-lead-child/protocol';

import { cachedLocale } from '@/i18n/localeCache';
import { leadNameNow } from '@/state/leadName';

import { memoryMessages } from './memory.messages';
import { shortTime } from './standingOrderModel';

// 文字按界面语言写（2026-11-01，docs/i18n.md）。记忆页自己的组件都传 locale；别的分组也调的几个函数
// （memoryErrorText、endpointProblem、testResultLabel 等）的 locale 可以不传，这时用最近一次记住的界面语言（localeCache）。

// leadName 是 Lead 的名字（useLeadName）。
export function memoryDescription(leadName: string, locale: Locale = cachedLocale()): string {
  return memoryMessages(locale).description(leadName);
}
// 设置页没有「关闭」：没选 embedding 时，配过的远程照样在用（用户的决定）。只用全文检索要在 daemon 上设环境变量。
// 两句说明（reloadNote、offNote）在 memory.messages.ts。
export function modelDescription(leadName: string, locale: Locale = cachedLocale()): string {
  return memoryMessages(locale).modelDescription(leadName);
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

// 记忆服务没在跑（service.state 是 off）的原因。daemon 用 PLC_MEMORY_BACKEND=sqlite 关掉了记忆时，service.backend 是 sqlite；
// 否则按 embedding 的设置判断。uv 没装这类原因只有 daemon 知道，在 service.message 里。
// 现状卡、重排的说明和回退卡都用它，同一页上的说法才不会互相矛盾（例如一处说「先选」，另一处说「已选 · 下载好后切换」）。
export type MemoryOffReason = 'sqlite' | 'choose' | 'download' | 'download_failed' | 'waiting';

export function memoryOffReason(memory: MemorySettingsDto): MemoryOffReason | null {
  if (memory.service.state !== 'off') return null;
  if (memory.service.backend === 'sqlite') return 'sqlite';
  const { embedding } = memory;
  if (embedding.mode === 'unset' && !embedding.remote.baseUrl) return 'choose';
  if (embedding.mode === 'local' && embedding.local.download.state === 'failed') return 'download_failed';
  if (embedding.mode === 'local' && embedding.local.download.state !== 'ready') return 'download';
  return 'waiting';
}

export function memoryStatus(memory: MemorySettingsDto, locale: Locale): { title: string; detail: string; tone: StatusTone } {
  const m = memoryMessages(locale);
  const { service } = memory;
  // service.index.indexed 是 Hindsight 写完的笔记条数（2026-10-29 起），不是同步游标。写入失败的原因在 service.message 里。
  const index = m.indexed(service.index.indexed.toLocaleString('en-US'), service.index.notes.toLocaleString('en-US'));
  switch (service.state) {
    case 'healthy':
      return {
        title: m.statusHealthy(service.embedding || null),
        detail: service.message ? `${index} · ${service.message}` : index,
        tone: 'success',
      };
    case 'starting':
      return { title: m.statusStarting, detail: service.message ?? m.statusStartingDetail, tone: 'warning' };
    case 'down':
      return { title: m.statusDown, detail: service.message ?? m.statusDownDetail, tone: 'danger' };
    case 'off':
    default:
      return {
        title: m.statusOff,
        detail: service.backend !== 'sqlite' && service.message
          ? m.statusOffBecause(service.message)
          : m.off[memoryOffReason(memory) ?? 'choose'].status,
        tone: 'muted',
      };
  }
}

// 一个待确认的切换：要你点「切换」或「先不切换」。只有 needsConfirmation 的才算要你处理。
export function memoryNeedsUser(memory: MemorySettingsDto | null | undefined): boolean {
  return Boolean(memory?.pendingSwitch && memory.pendingSwitch.state === 'pending' && memory.pendingSwitch.needsConfirmation);
}

// 待确认的切换是不是压着 embedding：parts 里有 embedding 时，选的 embedding 要等用户确认才生效。
// 只差外部重排（parts 是 ["reranker"]）时，embedding 已经生效。
export function embeddingWaits(memory: MemorySettingsDto): boolean {
  const pending = memory.pendingSwitch;
  return Boolean(pending && pending.state === 'pending' && pending.parts.includes('embedding'));
}

// 实际在用哪一个 embedding。选了本地但还没下好、或者 embedding 的切换还等你确认时，远程照旧在用。
export function embeddingInUse(memory: MemorySettingsDto): 'local' | 'remote' | null {
  const { embedding, service } = memory;
  if (service.state === 'off') return null;
  if (embedding.mode === 'local' && embedding.local.download.state === 'ready' && !embeddingWaits(memory)) return 'local';
  return embedding.remote.baseUrl ? 'remote' : null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function downloadPercent(download: MemoryDownload): number {
  return download.total > 0 ? Math.round((download.bytes / download.total) * 100) : 0;
}

// 下载进度的一行字。idle 时返回 null（还没开始，什么都不写）。
export function downloadLabel(download: MemoryDownload, locale: Locale): string | null {
  const m = memoryMessages(locale);
  switch (download.state) {
    case 'downloading':
      return download.total > 0
        ? m.downloaded(formatBytes(download.bytes), formatBytes(download.total))
        : m.downloading(formatBytes(download.bytes));
    case 'ready':
      return m.downloadReady;
    case 'failed':
      return m.downloadFailed(download.error || null);
    case 'idle':
    default:
      return null;
  }
}

// 已知模型的大小，写在选项旁边。别的模型不写数字。
const KNOWN_SIZES: Record<string, string> = {
  'intfloat/multilingual-e5-large': '2.2 GB',
};

export function localEmbeddingHint(model: string, locale: Locale): string {
  const m = memoryMessages(locale);
  const size = KNOWN_SIZES[model];
  return [size ? m.knownSize(size) : '', m.localHint].filter(Boolean).join(locale === 'zh' ? '' : ' ');
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function remotePrivacyNote(baseUrl: string | null | undefined, locale: Locale): string {
  return memoryMessages(locale).remotePrivacy(hostOf(baseUrl));
}

export function rerankerLabels(locale: Locale): Record<MemorySettingsDto['reranker']['mode'], string> {
  return memoryMessages(locale).rerankerLabels;
}

// 用决策模型重排时，什么会离开这台 Mac。maxCandidates 来自 daemon（reranker.external 或切换的 dataFlows）；没有时不写数字。
export function externalRerankNote(host: string, maxCandidates: number | null, locale: Locale): string {
  return memoryMessages(locale).externalRerank(host, maxCandidates);
}

// 一个切换新增的外发，一条一句。用户在切换卡上点「同意并切换」之前读到的就是这些句子。
export function dataFlowNote(flow: MemoryDataFlow, locale: Locale): string {
  return flow.kind === 'rerank'
    ? externalRerankNote(flow.host, flow.maxCandidates, locale)
    : memoryMessages(locale).embeddingFlow(flow.host);
}

// 待确认的切换里要开始的外部重排。没有时返回 null。
export function pendingRerankFlow(memory: MemorySettingsDto): MemoryDataFlow | null {
  const pending = memory.pendingSwitch;
  if (!pending || pending.state !== 'pending') return null;
  return pending.dataFlows.find((flow) => flow.kind === 'rerank') ?? null;
}

// 决策模型的现状，给重排的说明用。还没读到时是 null。
export type DecisionState = { host: string | null; apiKeySet: boolean } | null;

// 重排选项「决策模型」下面的那句话。外发要先经用户在切换卡上同意（daemon 按切换的 id 和主机检查），
// 所以这里只说现状：在发、等确认、为什么还没发，或者选了以后会先问。
export function decisionRerankDescription(memory: MemorySettingsDto, decision: DecisionState, locale: Locale): string {
  const m = memoryMessages(locale);
  // 中文的句子之间不空格，英文空一格。
  const join = (...parts: string[]) => parts.join(locale === 'zh' ? '' : ' ');
  const { reranker } = memory;
  const host = decision?.host ?? null;
  if (reranker.mode !== 'decision') return join(m.decisionLead, m.decisionNotChosen(host));
  const pending = pendingRerankFlow(memory);
  if (pending) return join(m.decisionLead, m.decisionPending(dataFlowNote(pending, locale)));
  if (reranker.external && reranker.effective === 'decision') {
    return join(m.decisionLead, externalRerankNote(reranker.external.host, reranker.external.maxCandidates, locale), m.externalRerankStop);
  }
  return join(m.decisionLead, rerankIdleReason(memory, decision, locale));
}

// 选了决策模型却还没往外发的原因。记忆服务不跑时，daemon 实际用的重排总是「不用」：先说为什么不跑，不要说成没有 key。
function rerankIdleReason(memory: MemorySettingsDto, decision: DecisionState, locale: Locale): string {
  const m = memoryMessages(locale);
  const off = memoryOffReason(memory);
  if (off) return m.off[off].rerank;
  switch (memory.service.state) {
    case 'starting':
      return m.rerankStarting;
    case 'down':
      return m.rerankDown;
    default:
      break;
  }
  if (decision && !decision.apiKeySet) return m.rerankNoKey;
  return m.rerankIdle;
}

// 选的和实际在用的不一样时，说清楚为什么。setUpKey 表示要去「模型」里设置 key。
// 不写的情况：一样时；在等用户同意外发时（最上面的切换卡已经说了）；记忆服务在启动或停了时（现状卡片已经说了）。
export function rerankerFallbackNote(memory: MemorySettingsDto, decision: DecisionState, locale: Locale): { text: string; setUpKey: boolean } | null {
  const m = memoryMessages(locale);
  const { reranker, service } = memory;
  if (reranker.mode === reranker.effective) return null;
  const off = memoryOffReason(memory);
  if (off) return { text: m.off[off].fallback, setUpKey: false };
  if (service.state !== 'healthy') return null;
  if (reranker.mode === 'decision') {
    if (pendingRerankFlow(memory) || !decision || decision.apiKeySet) return null;
    return { text: m.fallbackNoKey, setUpKey: true };
  }
  if (reranker.mode === 'local' && reranker.local.download.state !== 'ready') {
    return { text: m.fallbackLocal(m.rerankerLabels[reranker.effective]), setUpKey: false };
  }
  return null;
}

// 带 key 的服务地址（远程 embedding、决策模型）。规则和文字用 protocol 的 serviceUrlProblem，和 daemon 一样。
// 前面先查格式（和契约的 HttpUrlSchema 一样：非空、没有空白、最多 500 个字符），好给出准确的原因。
const MAX_URL_LENGTH = 500;

export function endpointProblem(input: string, locale: Locale = cachedLocale()): string | null {
  const m = memoryMessages(locale);
  const value = input.trim();
  if (!value) return m.urlEmpty;
  if (/\s/.test(value)) return m.urlSpaces;
  if (value.length > MAX_URL_LENGTH) return m.urlTooLong(MAX_URL_LENGTH);
  // 原因的文字在 memory.messages.ts，按 protocol 的 ServiceUrlProblem 取（protocol 的 SERVICE_URL_MESSAGES 是给 daemon 的中文）。
  const problem = serviceUrlProblem(value);
  return problem ? m.urlProblem[problem] : null;
}

// http 地址、主机又不是本机时的提示：key 和内容明文传输。https 或本机地址时是 null。
export function plaintextNote(input: string, locale: Locale = cachedLocale()): string | null {
  if (!isPlaintextServiceUrl(input)) return null;
  return memoryMessages(locale).plaintext(hostOf(input.trim()));
}

// 存的 key 绑定在一个主机上（daemon 给的 apiKeyHost）。表单里换了主机：保存后 daemon 删掉旧 key，不会把它发给新主机。
// 没换主机，或者没有 key 时返回 null。
export function keyHostChange(apiKeyHost: string | null | undefined, formUrl: string, apiKeySet: boolean): { from: string; to: string } | null {
  if (!apiKeySet || !apiKeyHost) return null;
  const to = hostOf(formUrl.trim())?.toLowerCase() ?? null;
  return to && to !== apiKeyHost ? { from: apiKeyHost, to } : null;
}

// source 是 key 从哪来：Keychain 或环境变量里的 key（external）只发给它的主机，不会被删掉。
export function keyHostChangeNote(
  change: { from: string; to: string },
  source: 'settings' | 'external' | null = 'settings',
  locale: Locale = cachedLocale(),
): string {
  const m = memoryMessages(locale);
  return source === 'external' ? m.keyHostChangeExternal(change.from, change.to) : m.keyHostChangeSaved(change.from, change.to);
}

// 换了主机、又没粘贴新 key 时，保存成功以后说什么。
export function keyDroppedNote(
  change: { from: string; to: string },
  source: 'settings' | 'external' | null = 'settings',
  locale: Locale = cachedLocale(),
): string {
  const m = memoryMessages(locale);
  return source === 'external' ? m.keyDroppedExternal(change.from, change.to) : m.keyDroppedSaved(change.from, change.to);
}

// daemon 存着 key，但它属于别的主机（例如手改了 config.json），所以不会发出去。没有这种情况时返回 null。
export function keyHostMismatchNote(
  apiKeyHost: string | null | undefined,
  baseUrl: string | null | undefined,
  apiKeySet: boolean,
  locale: Locale = cachedLocale(),
): string | null {
  const host = hostOf(baseUrl)?.toLowerCase() ?? null;
  if (apiKeySet || !apiKeyHost || !host || apiKeyHost === host) return null;
  return memoryMessages(locale).keyHostMismatch(apiKeyHost, host);
}

// 远程 embedding 的表单。和契约的 schema 一致：模型不带空白，维度 1 到 8192 或者留空。
export type RemoteForm = { baseUrl: string; model: string; dimensions: string; apiKey: string };

export function remoteFormProblem(form: RemoteForm, apiKeySet: boolean, locale: Locale): string | null {
  const m = memoryMessages(locale);
  const urlProblem = endpointProblem(form.baseUrl, locale);
  if (urlProblem) return urlProblem;
  if (!/^\S{1,128}$/.test(form.model.trim())) return m.modelNameRequired;
  const dimensions = form.dimensions.trim();
  if (dimensions && !(/^\d+$/.test(dimensions) && Number(dimensions) >= 1 && Number(dimensions) <= 8192)) {
    return m.dimensionsInvalid;
  }
  if (!apiKeySet && !form.apiKey.trim()) return m.apiKeyRequired;
  return null;
}

export function remoteRequest(form: RemoteForm) {
  const dimensions = form.dimensions.trim();
  return {
    mode: 'remote' as const,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    dimensions: dimensions ? Number(dimensions) : null,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  };
}

export type DecisionForm = { baseUrl: string; model: string; apiKey: string };

export function decisionFormProblem(form: DecisionForm, locale: Locale = cachedLocale()): string | null {
  const urlProblem = endpointProblem(form.baseUrl, locale);
  if (urlProblem) return urlProblem;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.model.trim())) return memoryMessages(locale).decisionModelName;
  return null;
}

// —— Hindsight 的摘要模型和写入（2026-10-29，.scratch/hindsight-primary-memory/spec.md D3、D13、D16）——

export function summarySlotLabel(slot: SummaryModelSlot, locale: Locale): string {
  return memoryMessages(locale).summarySlots[slot];
}

// 一个槽的模型是怎样选出来的。写在格子的第二行，所以要短。
export function summarySourceLabel(slot: SummaryModelSlotDto, locale: Locale): string {
  return memoryMessages(locale).summarySource[slot.source];
}

// 格子下面的一句：选的模型用不了的原因，或者环境变量盖住了这里的选择。daemon 写的原因已经说了环境变量时，不再说一遍。
export function summarySlotNote(slot: SummaryModelSlotDto, locale: Locale): string | null {
  if (slot.problem) return slot.problem;
  if (slot.source === 'env') return memoryMessages(locale).summaryEnvNote;
  return null;
}

const count = (value: number) => value.toLocaleString('en-US');

// 笔记写进 Hindsight 的情况（D3）。
export function writesLabel(writes: MemoryWritesDto, locale: Locale): string {
  return memoryMessages(locale).writes(count(writes.completed), count(writes.pending), count(writes.failed));
}

export function writesFailedNote(writes: MemoryWritesDto, locale: Locale): string | null {
  if (writes.failed === 0) return null;
  const m = memoryMessages(locale);
  const failed = m.writesFailed(writes.failed, count(writes.failed));
  return writes.lastError ? m.writesLastError(failed, writes.lastError) : failed;
}

// 记忆库的统计（D13）。服务没在运行时 daemon 给 null，这时不写。
export function bankStatsLabel(stats: MemoryBankStatsDto | null, locale: Locale): string | null {
  if (!stats) return null;
  const m = memoryMessages(locale);
  const parts = [m.bankFacts(count(stats.facts)), m.bankObservations(count(stats.observations))];
  if (stats.pendingConsolidation > 0) parts.push(m.bankPending(stats.pendingConsolidation, count(stats.pendingConsolidation)));
  return m.bank(parts.join(' · '));
}

// —— 常驻偏好（2026-10-29，.scratch/hindsight-primary-memory/spec.md D15）——
// 界面上只叫「常驻偏好」，不分类别，也不出现「笔记」这类说法（用户 2026-10-29：「这里就是记忆偏好」）。

// leadName 是 Lead 的名字（useLeadName）。
export function preferencesHint(leadName: string, locale: Locale): string {
  return memoryMessages(locale).preferencesHint(leadName);
}

// 改了以后什么时候生效（P15.2）：常驻偏好在系统提示词里，下一次开新会话或压缩上下文时才换。
export function preferencesEffectNote(leadName: string, locale: Locale): string {
  return memoryMessages(locale).preferencesEffect(leadName);
}

export function preferencesEmptyNote(leadName: string, locale: Locale): string {
  return memoryMessages(locale).preferencesEmpty(leadName);
}

// 所有常驻偏好一共用了多少字。写满以后改动会被拒，所以写满时用文字说出来，不只靠颜色。
export function preferencesUsageLabel(preferences: Pick<MemoryPreferencesDto, 'used' | 'cap'>, locale: Locale): string {
  const m = memoryMessages(locale);
  const label = m.preferencesUsage(count(preferences.used), count(preferences.cap));
  return preferences.cap > 0 && preferences.used >= preferences.cap ? m.preferencesFull(label) : label;
}

export function preferencesFull(preferences: Pick<MemoryPreferencesDto, 'used' | 'cap'>): boolean {
  return preferences.cap > 0 && preferences.used >= preferences.cap;
}

// 一条最近一次是谁、在什么时候、怎样改的：「Fairy 改的 · 10-29 14:00」。没有改动记录（以前写的）时只写时间。
export function preferenceChangeLine(entry: CoreMemoryEntryDto, leadName: string, locale: Locale): string {
  const m = memoryMessages(locale);
  const change = entry.lastChange;
  if (!change) return m.lastChanged(shortTime(entry.updatedAt));
  // 中文名字后面空一格（「Fairy 改的」），「你改的」不空：在目录的 leadWho 里。
  const who = change.actor === 'lead' ? m.leadWho(leadName) : m.you;
  const what = change.undoOf !== null ? m.changeBy.undo(who)
    : change.action === 'create' ? m.changeBy.create(who) : change.action === 'update' ? m.changeBy.update(who) : m.changeBy.delete(who);
  return m.changeLine(what, shortTime(change.at));
}

// Lead 改的写出依据。你自己在设置页改的，依据是系统的默认说法，不写。
export function preferenceReasonLine(entry: CoreMemoryEntryDto, locale: Locale): string | null {
  const change = entry.lastChange;
  if (!change || change.actor !== 'lead' || !change.reason.trim()) return null;
  return memoryMessages(locale).reason(change.reason.trim());
}

export type PreferenceForm = { title: string; content: string };

// 就地编辑的检查，和操作的输入一致：去掉前后空白以后不能是空的，标题最多 200 字，正文最多 4000 字。
export function preferenceFormProblem(form: PreferenceForm, locale: Locale): string | null {
  const m = memoryMessages(locale);
  const title = form.title.trim();
  const content = form.content.trim();
  if (!title) return m.titleEmpty;
  if (!content) return m.contentEmpty;
  if (title.length > CORE_MEMORY_TITLE_MAX) return m.titleTooLong(count(CORE_MEMORY_TITLE_MAX));
  if (content.length > CORE_MEMORY_CONTENT_MAX) return m.contentTooLong(count(CORE_MEMORY_CONTENT_MAX));
  return null;
}

// 操作的输入只带改了的字段。什么都没改时是 null。
export function preferenceUpdateInput(entry: Pick<CoreMemoryEntryDto, 'title' | 'content'>, form: PreferenceForm): CoreMemoryUpdateRequest | null {
  const title = form.title.trim();
  const content = form.content.trim();
  const input: CoreMemoryUpdateRequest = {
    ...(title !== entry.title ? { title } : {}),
    ...(content !== entry.content ? { content } : {}),
  };
  return Object.keys(input).length ? input : null;
}

// 删掉以后撤销用的改动编号：操作的结果是 {id, change: {id, …}, eventSeq}。读不到时是 null（这时不给「撤销」）。
export function changeIdOf(result: unknown): number | null {
  const change = (result as { change?: { id?: unknown } | null } | null)?.change;
  return typeof change?.id === 'number' && Number.isInteger(change.id) && change.id > 0 ? change.id : null;
}

// —— 失效的事实（2026-10-29，spec D5：「hindsight 的 invalidate 机制要有啊」）——

// 谁在什么时候让它失效的：「Fairy 让它失效 · 10-29 14:00」。说明（invalidatedHint）在 memory.messages.ts。
export function invalidatedFactLine(fact: MemoryInvalidatedFactDto, leadName: string, locale: Locale): string {
  const m = memoryMessages(locale);
  return m.invalidatedBy(fact.actor === 'lead' ? m.leadWho(leadName) : m.you, shortTime(fact.at));
}

// 它来自哪里：来源偏好的标题；外部对话整理来的写明。都不知道时是 null。
export function invalidatedFactSource(fact: MemoryInvalidatedFactDto, locale: Locale): string | null {
  const m = memoryMessages(locale);
  if (fact.note && fact.external) return m.fromExternal(fact.note.title);
  if (fact.note) return m.from(fact.note.title);
  return fact.external ? m.fromExternalOnly : null;
}

// 测试结果的一行字。
export function testResultLabel(result: { ok: boolean; message: string; latencyMs: number | null }, locale: Locale = cachedLocale()): string {
  const m = memoryMessages(locale);
  if (result.ok) return m.testOk(result.latencyMs);
  return result.message || m.testFailed;
}

// 网关校验请求体时回的英文说明，和客户端自己的一句（device is not paired），译文在 memory.messages.ts 的 server。
// 别的错误是 daemon 写的，原样显示。
// 另一句客户端的话要写 Lead 的名字。错误文字离组件太远，读最近一次取到的名字（leadNameNow）。
const OLD_CLIENT_MESSAGE = 'this client cannot manage Lead memory';

export function memoryErrorText(reason: unknown, locale: Locale = cachedLocale()): string {
  const m = memoryMessages(locale);
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (message === OLD_CLIENT_MESSAGE) return m.oldClient(leadNameNow());
  return (Object.hasOwn(m.server, message) ? m.server[message] : undefined) ?? (message || m.requestFailed);
}
