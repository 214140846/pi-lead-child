import {
  Box, Button, Card, Chip, Column, Icon, Popover, RecordRow, Row, SegmentedControl, Switch, Text, TextField,
} from '@pi-lead-child/components';
import type {
  ChannelHandbook, ChannelHandbookDto, HandbookAbility, HandbookCapSender, HandbookMode, HandbookRehearsal, HandbookRehearsalSender,
  HandbookSituation, HandbookSuggestion, HandbookSuggestions,
} from '@pi-lead-child/protocol';
import { useEffect, useState } from 'react';

import { useLocale } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useLeadName } from '@/state/hooks';

import { handbookMessages } from './handbook.messages';
import {
  addedMeta, addProblem, capLead, capOptions, floorCountText, floorText, HANDBOOK_CAP_SENDERS, HANDBOOK_FLOORS, handbookErrorText, handbookSections,
  loosenFor, modeLabel, modeOptions, modePhrase, notInEffect, orderLine, proposalView, rehearsalExamples, rehearsalSenders, rehearsalView,
  sentenceLead, suggestionView, withAdded, withCap, withExceptionMode, withMode, withoutSituation, withSwitch, type AddInput,
} from './handbookModel';
import { ReplyStyleSection } from './ReplyStyleSection';

// 设置 → 消息通道 → 自动代你处理（交接说明，方案 B，2026-10-30，.scratch/auto-handling-handbook issue 07）。
// 你写给助手的一份交接说明，对所有外部来源生效：每种情况一句话，带下划线的短语点开选做法，选了马上保存、马上生效。
// 从上到下三张卡：开关（打开以后同一张卡里是代回复风格）；预演一条消息（收件判断真的选一句，按交接说明算结论，只读）；
// 交接说明正文（各段的句子、看对方是谁的上限、一直生效的底线、加一种情况）。
// 页边批注（issue 08，P9.6 注脚）：一句下面挂放宽的建议，「加一种情况」上面挂加一句的建议，底线下面写最近 7 天拦下几次。
// 建议只显示，你点「放宽」「加上这一句」才改（channel_handbook.accept_suggestion），点「不用」以后不再出现。
// 改、预演都是操作层的 channel_handbook（Lead 走 perform_action，调同一个函数）。助手的名字从 useLeadName 取（P14.3）。

type Message = { text: string; error: boolean };

export function HandbookSection() {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = handbookMessages(locale);
  const [dto, setDto] = useState<ChannelHandbookDto | null>(null);
  // 存原始的错误，显示时按当前语言写。
  const [loadError, setLoadError] = useState<{ reason: unknown } | null>(null);

  useEffect(() => {
    let live = true;
    runtime.channelHandbook()
      .then((next) => live && setDto(next))
      .catch((reason: unknown) => live && setLoadError({ reason }));
    return () => {
      live = false;
    };
  }, [runtime]);

  if (loadError) return <Text testID="handbook-error" size="note" tone="danger-dark">{m.loadFailed(handbookErrorText(loadError.reason, locale))}</Text>;
  if (!dto) return <Text testID="handbook-loading" size="note" tone="muted">{m.loading}</Text>;
  return <Panel dto={dto} onSaved={setDto} />;
}

function Panel({ dto, onSaved }: { dto: ChannelHandbookDto; onSaved: (next: ChannelHandbookDto) => void }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = handbookMessages(locale);
  const handbook = dto.handbook;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // 改动马上保存：交给 PUT /v1/channels/handbook，用响应替换页面上的交接说明。
  const save = (next: ChannelHandbook, done: string): Promise<boolean> => {
    setSaving(true);
    setMessage(null);
    return runtime.updateChannelHandbook(next)
      .then((saved) => {
        onSaved(saved);
        setMessage({ text: done, error: false });
        return true;
      })
      .catch((reason: unknown) => {
        setMessage({ text: m.notSaved(handbookErrorText(reason, locale)), error: true });
        return false;
      })
      .finally(() => setSaving(false));
  };
  const on = handbook.autoReply;
  const pending = notInEffect(dto, locale);
  // 页边批注读不到时不显示，不影响交接说明。
  const [suggestions, setSuggestions] = useState<HandbookSuggestions | null>(null);
  useEffect(() => {
    let live = true;
    runtime.channelHandbookSuggestions()
      .then((next) => live && setSuggestions(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runtime]);
  const accept = (suggestion: HandbookSuggestion) => {
    setSaving(true);
    setMessage(null);
    runtime.acceptChannelHandbookSuggestion(suggestion.key)
      .then((next) => {
        onSaved(next.handbook);
        setSuggestions(next.suggestions);
        setMessage({ text: suggestion.kind === 'loosen' ? m.loosened(suggestion.situation?.text ?? '') : m.added, error: false });
      })
      .catch((reason: unknown) => setMessage({ text: m.notChanged(handbookErrorText(reason, locale)), error: true }))
      .finally(() => setSaving(false));
  };
  const dismiss = (suggestion: HandbookSuggestion) => {
    runtime.dismissChannelHandbookSuggestion(suggestion.key)
      .then(setSuggestions)
      .catch((reason: unknown) => setMessage({ text: m.notDismissed(handbookErrorText(reason, locale)), error: true }));
  };
  const additions = suggestions?.suggestions.filter((item) => item.kind === 'add') ?? [];

  return (
    <Column testID="handbook" gap="page-section">
      <Card testID="handbook-switch-card" rounded="xl" p="page-card" gap="card-section">
        <Row items="flex-start" gap="side-item">
          <Column flex={1} minW={0} gap="text-stack">
            <Text size="card-title" weight="bold">{m.title}</Text>
            <Text size="secondary" tone="secondary">
              {on ? m.onDescription(leadName) : m.offDescription(leadName)}
            </Text>
          </Column>
          <Switch
            testID="handbook-switch"
            value={on}
            label={on ? m.on : m.off}
            disabled={saving}
            onValueChange={(next) => void save(withSwitch(handbook, next), next ? m.turnedOn : m.turnedOff)}
          />
        </Row>
        <Text testID="handbook-order" size="meta" tone="muted">{orderLine(dto, leadName, locale)}</Text>
        {on ? (
          <>
            <Box borderTopWidth={1} borderColor="border-soft" />
            <ReplyStyleSection />
          </>
        ) : null}
      </Card>

      <RehearsalCard leadName={leadName} />

      <Card testID="handbook-letter" rounded="xl" p="page-card" gap="card-section" opacity={on ? 1 : 0.6}>
        <Column gap="text-stack">
          <Text size="card-title" weight="bold">{m.letterTitle(leadName)}</Text>
          <Text size="secondary" tone="secondary">{m.letterIntro(leadName)}</Text>
        </Column>
        {message ? <Text testID="handbook-message" size="note" tone={message.error ? 'danger-dark' : 'secondary'}>{message.text}</Text> : null}
        {pending.length ? (
          <Text testID="handbook-pending" size="note" tone="warning-dark">
            {m.pending(leadName, pending)}
          </Text>
        ) : null}

        {handbookSections(handbook, locale).map((group) => (
          <Column key={group.section} testID={`handbook-section-${group.section}`} gap="card-row">
            <Text size="label" tone="secondary">{group.title}</Text>
            {group.situations.map((situation) => (
              <SentenceRow
                key={situation.id}
                situation={situation}
                leadName={leadName}
                disabled={saving}
                onPick={(mode) => void save(withMode(handbook, situation.id, mode), m.savedSentence(`${sentenceLead(situation, locale)}${modePhrase(situation, mode, locale)}`))}
                onPickException={(mode) => void save(withExceptionMode(handbook, situation.id, mode), m.savedException(modeLabel(mode, locale)))}
                onRemove={situation.section === 'mine'
                  ? () => void save(withoutSituation(handbook, situation.id), m.removed(situation.text))
                  : undefined}
                note={loosenFor(suggestions, situation.id)}
                onAccept={accept}
                onDismiss={dismiss}
              />
            ))}
          </Column>
        ))}

        <Column testID="handbook-caps" gap="card-row">
          <Text size="label" tone="secondary">{m.capsTitle}</Text>
          {HANDBOOK_CAP_SENDERS.map((sender) => (
            <CapRow
              key={sender}
              sender={sender}
              mode={handbook.caps[sender]}
              leadName={leadName}
              disabled={saving}
              onPick={(mode) => void save(withCap(handbook, sender, mode), m.savedSentence(`${capLead(sender, locale)}${modePhrase({}, mode, locale)}`))}
            />
          ))}
        </Column>

        <Column testID="handbook-floors" gap="card-row">
          <Row items="center" gap="icon-label">
            <Icon name="shield" size={14} color="text-secondary" />
            <Text size="label" tone="secondary">{m.floorsTitle}</Text>
          </Row>
          {HANDBOOK_FLOORS.map((floor) => {
            const count = floorCountText(suggestions, floor.id, locale);
            return (
              <Column key={floor.id} gap="text-stack">
                <Text testID={`handbook-floor-${floor.id}`} size="body" tone="strong">{floorText(floor.id, locale)}</Text>
                {count ? <Text testID={`handbook-floor-count-${floor.id}`} size="meta" tone="muted">{count}</Text> : null}
              </Column>
            );
          })}
        </Column>

        <Box borderTopWidth={1} borderColor="border-soft" />
        {additions.map((suggestion) => (
          <MarginNote key={suggestion.key} suggestion={suggestion} disabled={saving} onAccept={accept} onDismiss={dismiss} />
        ))}
        <AddSentence leadName={leadName} disabled={saving} onAdd={(input) => save(withAdded(handbook, input), m.addedSentence(`${sentenceLead(input, locale)}${modePhrase({}, input.mode, locale)}`))} />
      </Card>
    </Column>
  );
}

// 页边批注（P9.6 注脚）：一句说明，加「放宽」或「加上这一句」（默认按钮）和「不用」（文字按钮）。
function MarginNote({ suggestion, disabled, onAccept, onDismiss }: {
  suggestion: HandbookSuggestion; disabled: boolean; onAccept: (suggestion: HandbookSuggestion) => void; onDismiss: (suggestion: HandbookSuggestion) => void;
}) {
  const locale = useLocale();
  const view = suggestionView(suggestion, locale);
  return (
    <Column testID={`handbook-suggestion-${suggestion.key}`} gap="text-stack" pl="group-indent">
      <Text size="note" tone="secondary">{view.text}</Text>
      <Row gap="actions">
        <Button testID={`handbook-suggestion-accept-${suggestion.key}`} label={view.accept} variant="outline" tone="neutral" size="sm"
          disabled={disabled} onPress={() => onAccept(suggestion)} />
        <Button testID={`handbook-suggestion-dismiss-${suggestion.key}`} label={handbookMessages(locale).notNow} variant="ghost" tone="neutral" size="sm"
          disabled={disabled} onPress={() => onDismiss(suggestion)} />
      </Row>
    </Column>
  );
}

// 一句话：前半截，加上带下划线的做法（点开选），加上句号。有例外时下一行是例外，也能选。你加的句子可以删。下面可能挂一条放宽的建议。
function SentenceRow({ situation, leadName, disabled, onPick, onPickException, onRemove, note, onAccept, onDismiss }: {
  situation: HandbookSituation; leadName: string; disabled: boolean;
  onPick: (mode: HandbookMode) => void; onPickException: (mode: HandbookMode) => void; onRemove?: () => void;
  note: HandbookSuggestion | null; onAccept: (suggestion: HandbookSuggestion) => void; onDismiss: (suggestion: HandbookSuggestion) => void;
}) {
  const locale = useLocale();
  const m = handbookMessages(locale);
  const options = modeOptions(leadName, locale).map((option) => ({ ...option, phrase: modePhrase(situation, option.mode, locale), disabled: null }));
  return (
    <Column testID={`handbook-sentence-${situation.id}`} gap="text-stack">
      <Row items="center" gap="side-item">
        <Row flex={1} minW={0} items="center" flexWrap="wrap">
          <Text size="body">{sentenceLead(situation, locale)}</Text>
          <PhraseMenu
            testID={`handbook-mode-${situation.id}`}
            label={m.changeMode(situation.text, modePhrase(situation, situation.mode, locale))}
            title={situation.text}
            current={situation.mode}
            options={options}
            disabled={disabled}
            onPick={onPick}
          />
          <Text size="body">{m.periodEnd}</Text>
        </Row>
        {onRemove ? (
          <Popover testID={`handbook-more-${situation.id}`} label={m.moreActions(situation.text)} title={situation.text} width={300}
            trigger={<Icon name="more" size={16} color="text-secondary" />}>
            {(close) => (
              <RecordRow
                testID={`handbook-remove-${situation.id}`}
                title={m.removeSentence}
                detail={m.removeDetail}
                onPress={disabled ? undefined : () => { close(); onRemove(); }}
              />
            )}
          </Popover>
        ) : null}
      </Row>
      {situation.does && (situation.mode === 'auto' || situation.mode === 'review') ? (
        <Text size="meta" tone="muted">{m.does(leadName, situation.does)}</Text>
      ) : null}
      {situation.exception ? (
        <Row pl="group-indent" items="center" flexWrap="wrap">
          <Text size="body" tone="strong">{m.exceptionLead(situation.exception.text)}</Text>
          <PhraseMenu
            testID={`handbook-exception-${situation.id}`}
            label={m.changeException(situation.text, modePhrase(situation, situation.exception.mode, locale))}
            title={m.exceptionTitle(situation.exception.text)}
            current={situation.exception.mode}
            options={options}
            disabled={disabled}
            onPick={onPickException}
          />
          <Text size="body" tone="strong">{m.periodEnd}</Text>
        </Row>
      ) : null}
      {note ? <MarginNote suggestion={note} disabled={disabled} onAccept={onAccept} onDismiss={onDismiss} /> : null}
    </Column>
  );
}

function CapRow({ sender, mode, leadName, disabled, onPick }: {
  sender: HandbookCapSender; mode: HandbookMode; leadName: string; disabled: boolean; onPick: (mode: HandbookMode) => void;
}) {
  const locale = useLocale();
  const m = handbookMessages(locale);
  const lead = capLead(sender, locale);
  return (
    <Row testID={`handbook-cap-${sender}`} items="center" flexWrap="wrap">
      <Text size="body">{lead}</Text>
      <PhraseMenu
        testID={`handbook-cap-mode-${sender}`}
        label={m.changeCap(lead, modePhrase({}, mode, locale))}
        title={lead}
        current={mode}
        options={capOptions(sender, leadName, locale).map((option) => ({ ...option, phrase: modePhrase({}, option.mode, locale) }))}
        disabled={disabled}
        onPick={onPick}
      />
      <Text size="body">{m.periodEnd}</Text>
    </Row>
  );
}

// 带下划线的短语：强调色的字加一个向下的箭头，点开是锚定浮层（手机上是底部面板，P2、P13.2），一行一种做法。
function PhraseMenu({ testID, label, title, current, options, disabled, onPick }: {
  testID: string; label: string; title: string; current: HandbookMode; disabled: boolean;
  options: Array<{ mode: HandbookMode; phrase: string; detail: string; disabled: string | null }>;
  onPick: (mode: HandbookMode) => void;
}) {
  const m = handbookMessages(useLocale());
  const selected = options.find((option) => option.mode === current);
  return (
    <Popover testID={testID} label={label} title={title} width={320}
      trigger={(
        <Row items="center" gap="text-stack">
          <Text size="body" weight="semibold" tone="accent">{selected?.phrase ?? current}</Text>
          <Icon name="chevron-down" size={14} color="accent" />
        </Row>
      )}>
      {(close) => (
        <Column>
          {options.map((option, index) => (
            <RecordRow
              key={option.mode}
              testID={`${testID}-${option.mode}`}
              divider={index > 0}
              title={option.phrase}
              detail={option.disabled ?? option.detail}
              trailing={option.mode === current ? <Icon name="check" size={16} color="accent" /> : undefined}
              onPress={disabled || option.disabled || option.mode === current ? undefined : () => { close(); onPick(option.mode); }}
            />
          ))}
          <Text size="meta" tone="muted" px="row-x" py="row-y">{m.pickHint}</Text>
        </Column>
      )}
    </Popover>
  );
}

// 加一种情况：写是什么情况（可以加一个例句），选做法，点「加上」。放在「你加的」一段。
// 「帮我整理」把第一个框里随口写的话交给便宜模型整理成一句（channel_handbook.propose，只读），填进表单，你看过再点「加上」。
function AddSentence({ leadName, disabled, onAdd }: {
  leadName: string; disabled: boolean; onAdd: (input: AddInput) => Promise<boolean>;
}) {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = handbookMessages(locale);
  const [text, setText] = useState('');
  const [example, setExample] = useState('');
  const [mode, setMode] = useState<HandbookMode>('hand');
  // 整理出来的「会做什么」和能力：自己写的一句没有。
  const [does, setDoes] = useState('');
  const [abilities, setAbilities] = useState<HandbookAbility[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const reset = () => {
    setText('');
    setExample('');
    setMode('hand');
    setDoes('');
    setAbilities([]);
    setNote(null);
  };
  const add = () => {
    const found = addProblem(text, example, locale);
    setProblem(found);
    if (found) return;
    void onAdd({ text, example, mode, does, abilities }).then((ok) => {
      if (ok) reset();
    });
  };
  const propose = () => {
    if (!text.trim()) return;
    setProposing(true);
    setProblem(null);
    setNote(null);
    runtime.proposeChannelHandbookSituation({ text: text.trim() })
      .then((result) => {
        const view = proposalView(result, locale);
        if (view.fill) {
          setText(view.fill.text);
          setExample(view.fill.example);
          setMode(view.fill.mode);
          setDoes(view.fill.does ?? '');
          setAbilities(view.fill.abilities ?? []);
        }
        setNote(view.note);
      })
      .catch((reason: unknown) => setNote(m.proposeFailed(handbookErrorText(reason, locale))))
      .finally(() => setProposing(false));
  };
  const meta = addedMeta({ mode, does, abilities }, leadName, locale);
  return (
    <Column testID="handbook-add" gap="card-row">
      <Text size="label" tone="secondary">{m.addTitle}</Text>
      <TextField testID="handbook-add-text" value={text} onChangeText={setText} variant="filled" size="sm" maxLength={120}
        placeholder={m.addTextPlaceholder} accessibilityLabel={m.addTextLabel} />
      <TextField testID="handbook-add-example" value={example} onChangeText={setExample} variant="filled" size="sm" maxLength={120}
        placeholder={m.addExamplePlaceholder} accessibilityLabel={m.addExampleLabel} />
      <Row items="center" flexWrap="wrap">
        <Text size="body" tone="strong">{text.trim() ? sentenceLead({ text: text.trim(), example: example.trim() || undefined }, locale) : m.addLeadEmpty}</Text>
        <PhraseMenu
          testID="handbook-add-mode"
          label={m.newSentenceMode(modePhrase({}, mode, locale))}
          title={m.newSentence}
          current={mode}
          options={modeOptions(leadName, locale).map((option) => ({ ...option, phrase: modePhrase({}, option.mode, locale), disabled: null }))}
          disabled={disabled}
          onPick={setMode}
        />
        <Text size="body" tone="strong">{m.periodEnd}</Text>
      </Row>
      {meta ? <Text testID="handbook-add-meta" size="meta" tone="muted">{meta}</Text> : null}
      {note ? <Text testID="handbook-add-note" size="note" tone="secondary">{note}</Text> : null}
      {problem ? <Text testID="handbook-add-problem" size="note" tone="danger-dark">{problem}</Text> : null}
      <Row gap="actions">
        <Button testID="handbook-add-button" label={disabled ? m.saving : m.add} size="sm" disabled={disabled || proposing} onPress={add} />
        <Button
          testID="handbook-add-propose"
          label={proposing ? m.proposing : m.propose}
          variant="outline"
          tone="neutral"
          size="sm"
          disabled={disabled || proposing || !text.trim()}
          onPress={propose}
        />
      </Row>
    </Column>
  );
}

// 预演一条消息：收件判断真的读一遍，再按交接说明算结论。只读，不发任何东西。
function RehearsalCard({ leadName }: { leadName: string }) {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = handbookMessages(locale);
  const [text, setText] = useState('');
  const [sender, setSender] = useState<HandbookRehearsalSender>('colleague');
  const [result, setResult] = useState<HandbookRehearsal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    runtime.rehearseChannelHandbook({ text: text.trim(), sender })
      .then(setResult)
      .catch((reason: unknown) => setError(handbookErrorText(reason, locale)))
      .finally(() => setBusy(false));
  };
  const view = result ? rehearsalView(result, leadName, locale) : null;
  return (
    <Card testID="handbook-rehearsal" rounded="xl" p="page-card" gap="card-section">
      <Column gap="text-stack">
        <Text size="card-title" weight="bold">{m.rehearsalTitle}</Text>
        <Text size="secondary" tone="secondary">{m.rehearsalIntro(leadName)}</Text>
      </Column>
      <Row gap="chips" flexWrap="wrap">
        {rehearsalExamples(locale).map((example) => (
          <Chip key={example} label={example} selected={text === example} onPress={() => setText(example)} />
        ))}
      </Row>
      <TextField testID="handbook-rehearsal-text" value={text} onChangeText={setText} variant="filled" size="sm" maxLength={1_500}
        placeholder={m.rehearsalPlaceholder} accessibilityLabel={m.rehearsalLabel} onSubmit={() => run()} />
      {/* 四段的字长短不一（「认不出的人」）：分段控件单独占一行，不和按钮挤在一行里被截断。 */}
      <Column gap="text-stack">
        <Text size="label" tone="secondary">{m.rehearsalSender}</Text>
        <Box w="100%">
          <SegmentedControl testID="handbook-rehearsal-sender" options={rehearsalSenders(locale)} value={sender} onChange={setSender} size="sm" />
        </Box>
      </Column>
      <Row>
        <Button testID="handbook-rehearsal-run" label={busy ? m.rehearsing : m.rehearse} disabled={busy || !text.trim()} onPress={run} />
      </Row>
      {error ? <Text testID="handbook-rehearsal-error" size="note" tone="danger-dark">{m.rehearsalError(error)}</Text> : null}
      {view ? (
        <Column testID="handbook-rehearsal-result" gap="text-stack" px="inset-x" py="inset-y" rounded="lg" bg="surface-subtle">
          <Text testID="handbook-rehearsal-sentence" size="body" weight="semibold">{view.sentence}</Text>
          {view.override ? <Text testID="handbook-rehearsal-override" size="secondary" tone="warning-dark">{view.override}</Text> : null}
          {view.ruleChange ? <Text testID="handbook-rehearsal-rule-change" size="secondary" tone="warning-dark">{view.ruleChange}</Text> : null}
          <Text testID="handbook-rehearsal-outcome" size="body">{view.outcome}</Text>
          <Text size="meta" tone={view.tone}>{view.detail}</Text>
        </Column>
      ) : null}
    </Card>
  );
}
