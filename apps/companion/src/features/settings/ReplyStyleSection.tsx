import { Box, Button, Column, Row, SegmentedControl, Text, TextField } from '@pi-lead-child/components';
import {
  REPLY_STYLE_EXTRACT_DEFAULT_DAYS, REPLY_STYLE_TEXT_MAX_LENGTH,
  type ReplyStyleDto, type ReplyStyleExtractResult,
} from '@pi-lead-child/protocol';
import { useEffect, useState } from 'react';

import { useLocale } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useLeadName } from '@/state/hooks';

import { replyStyleMessages } from './replyStyle.messages';
import {
  replyStyleAppendedLength, replyStyleAppendProblem, replyStyleBasisLine,
  replyStyleChanged, replyStyleCountLine, replyStyleDayOptions, replyStyleErrorText,
} from './replyStyleModel';

// 设置 → 消息通道 → 代回复风格（2026-10-28，.scratch/channel-reply-style/spec.md）。
// 2026-10-29 用户：放进「自动代你处理」开关所在的那张卡，打开以后才看得到（HandbookSection）。所以这里画的是卡里的两段，
// 不是独立的卡；段和段之间一条 border-soft 分隔线，和「形象」卡的「Slack 署名」一段一样（主题 11.15）。
// 上面一段是框：你写的代回复风格，保存走操作层的 reply_style.update（Lead 的 perform_action 调同一个函数）。
// 下面一段是提炼：从最近 N 天你本人的消息里提炼风格特征（reply_style.extract，只读），结果在这一段里给你预览、能改，
// 点「追加」才以 mode=append 写进框里（带日期小标题，原来的内容不动）。

type Message = { text: string; error: boolean };

export function ReplyStyleSection() {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = replyStyleMessages(locale);
  const [style, setStyle] = useState<ReplyStyleDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    runtime.replyStyle()
      .then((dto) => live && setStyle(dto))
      .catch((reason: unknown) => live && setLoadError(replyStyleErrorText(reason, locale)));
    return () => {
      live = false;
    };
  }, [runtime, locale]);

  if (loadError) return <Text testID="reply-style-error" size="note" tone="danger-dark">{m.loadFailed(loadError)}</Text>;
  if (!style) return <Text testID="reply-style-loading" size="note" tone="muted">{m.loading}</Text>;
  return <Panel current={style} onSaved={setStyle} />;
}

// 属性不叫 style：uiBoundary.test.ts 把传给组件的 style 都当成内联样式。
function Panel({ current, onSaved }: { current: ReplyStyleDto; onSaved: (next: ReplyStyleDto) => void }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = replyStyleMessages(locale);
  const [draft, setDraft] = useState(current.text);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const changed = replyStyleChanged(draft, current);

  const saved = (next: ReplyStyleDto, text: string) => {
    onSaved(next);
    setDraft(next.text);
    setMessage({ text, error: false });
  };

  const save = () => {
    if (!changed) return;
    setSaving(true);
    setMessage(null);
    runtime.updateReplyStyle({ mode: 'replace', text: draft })
      .then((next) => saved(next, m.saved(leadName)))
      .catch((reason: unknown) => setMessage({ text: replyStyleErrorText(reason, locale), error: true }))
      .finally(() => setSaving(false));
  };

  return (
    <Column testID="reply-style-section" gap="card-section">
      <Column gap="card-section">
        <Column gap="text-stack">
          <Text size="label" weight="bold">{m.title}</Text>
          <Text size="secondary" tone="secondary">
            {m.description(leadName)}
          </Text>
        </Column>
        <Column gap="field">
          <TextField
            testID="reply-style-text"
            value={draft}
            onChangeText={setDraft}
            placeholder={m.placeholder}
            variant="filled"
            size="sm"
            multiline
            height={160}
            maxLength={REPLY_STYLE_TEXT_MAX_LENGTH}
            accessibilityLabel={m.label}
          />
          <Text testID="reply-style-count" size="meta" tone="muted">{m.countNote(replyStyleCountLine(draft, locale))}</Text>
        </Column>
        <Text size="note" tone="secondary">{m.boundary(leadName)}</Text>
        <Row items="center" gap="field" flexWrap="wrap">
          <Button testID="reply-style-save" label={saving ? m.saving : m.save} size="sm" disabled={saving || !changed} onPress={save} />
          {message ? <Text testID="reply-style-message" size="note" tone={message.error ? 'danger-dark' : 'secondary'}>{message.text}</Text> : null}
        </Row>
      </Column>
      <Box borderTopWidth={1} borderColor="border-soft" />
      <ExtractSegment current={current} dirty={changed} onAppended={(next) => saved(next, m.appended)} />
    </Column>
  );
}

function ExtractSegment({ current, dirty, onAppended }: { current: ReplyStyleDto; dirty: boolean; onAppended: (next: ReplyStyleDto) => void }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = replyStyleMessages(locale);
  const [days, setDays] = useState(String(REPLY_STYLE_EXTRACT_DEFAULT_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplyStyleExtractResult | null>(null);
  const [proposal, setProposal] = useState('');
  const [appending, setAppending] = useState(false);

  const extract = () => {
    setBusy(true);
    setError(null);
    runtime.extractReplyStyle({ days: Number(days) })
      .then((next) => {
        setResult(next);
        setProposal(next.proposal);
      })
      .catch((reason: unknown) => setError(replyStyleErrorText(reason, locale)))
      .finally(() => setBusy(false));
  };

  const now = new Date();
  const problem = result && proposal.trim() ? replyStyleAppendProblem(current, proposal, result.label, now, locale) : null;
  const total = result && proposal.trim() ? replyStyleAppendedLength(current, proposal, result.label, now) : null;
  const append = () => {
    if (!result || !proposal.trim() || problem || dirty) return;
    setAppending(true);
    setError(null);
    runtime.updateReplyStyle({ mode: 'append', text: proposal, label: result.label })
      .then((next) => {
        onAppended(next);
        setResult(null);
        setProposal('');
      })
      .catch((reason: unknown) => setError(replyStyleErrorText(reason, locale)))
      .finally(() => setAppending(false));
  };

  return (
    <Column testID="reply-style-extract" gap="card-section">
      <Column gap="text-stack">
        <Text size="label" weight="bold">{m.extractTitle}</Text>
        <Text size="secondary" tone="secondary">
          {m.extractDescription(leadName)}
        </Text>
      </Column>
      <Row items="center" gap="actions" flexWrap="wrap">
        <Box w={240}><SegmentedControl options={replyStyleDayOptions(locale)} value={days} onChange={setDays} size="sm" /></Box>
        <Button testID="reply-style-extract-run" label={busy ? m.extracting : m.extract} variant="outline" tone="neutral" size="sm" disabled={busy} onPress={extract} />
      </Row>
      {error ? <Text testID="reply-style-extract-error" size="note" tone="danger-dark">{error}</Text> : null}
      {result ? (
        <Column testID="reply-style-preview" gap="card-row">
          {result.note ? <Text testID="reply-style-preview-note" size="note" tone="secondary">{result.note}</Text> : null}
          {result.conflicts.length ? (
            <Column testID="reply-style-conflicts" gap="text-stack">
              <Text size="label" weight="semibold">{m.conflicts}</Text>
              {result.conflicts.map((conflict, index) => (
                <Text key={index} size="note" tone="secondary">{m.conflict(conflict.existing, conflict.observed)}</Text>
              ))}
            </Column>
          ) : null}
          {result.status === 'ok' && result.proposal ? (
            <Column gap="field">
              <Text size="label" weight="semibold">{m.proposal}</Text>
              <TextField
                testID="reply-style-proposal"
                value={proposal}
                onChangeText={setProposal}
                variant="filled"
                size="sm"
                multiline
                height={120}
                maxLength={REPLY_STYLE_TEXT_MAX_LENGTH}
                accessibilityLabel={m.proposal}
              />
              <Text testID="reply-style-basis" size="meta" tone="muted">
                {total !== null
                  ? `${replyStyleBasisLine(result, locale)}${m.sentenceGap}${m.totalAfterAppend(total, REPLY_STYLE_TEXT_MAX_LENGTH)}`
                  : replyStyleBasisLine(result, locale)}
              </Text>
            </Column>
          ) : (
            <Text size="meta" tone="muted">{replyStyleBasisLine(result, locale)}</Text>
          )}
          {problem ? <Text testID="reply-style-append-problem" size="note" tone="danger-dark">{problem}</Text> : null}
          {dirty ? <Text testID="reply-style-append-dirty" size="note" tone="secondary">{m.dirty}</Text> : null}
          <Row items="center" gap="actions" flexWrap="wrap">
            {result.status === 'ok' && result.proposal ? (
              <Button
                testID="reply-style-append"
                label={appending ? m.appending : m.append}
                size="sm"
                disabled={appending || !proposal.trim() || problem !== null || dirty}
                onPress={append}
              />
            ) : null}
            <Button testID="reply-style-discard" label={m.discard} variant="ghost" tone="neutral" size="sm" onPress={() => { setResult(null); setProposal(''); }} />
          </Row>
        </Column>
      ) : null}
    </Column>
  );
}
