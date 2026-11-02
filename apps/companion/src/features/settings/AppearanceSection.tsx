import { Box, Button, Card, Column, Row, SegmentedControl, Text, TextField, type ColorToken } from '@pi-lead-child/components';
import {
  DENSITY_ZONES, DESIGN_NOTES_MAX_LENGTH, PALETTE_ROLES, designPreferenceLabels,
  designPreferencesFields, type DensityLevel, type DesignPreferencesDto, type LineHeightLevel, type RadiusLevel, type TextScaleLevel,
} from '@pi-lead-child/protocol';
import { useState, type ReactNode } from 'react';

import { useLocale, useMessages, type Locale } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useDesignPreferences, useLeadName } from '@/state/hooks';

import { appearanceMessages } from './appearance.messages';
import {
  appearanceChanges, appearanceForm, appearanceFormProblem, appearanceOptions, appearanceResetRequest, appearanceUpdatedLine,
} from './appearanceModel';
import { memoryErrorText } from './memoryModel';
import { useServerForm } from './useServerForm';

// 设置 → 外观（2026-10-22）：语言（2026-11-01）、密度、圆角、行高、字号、颜色和设计说明。
// 保存走 POST /v1/design/preferences；Lead 的 update_design_preferences 工具改的是同一份（engine 的 updateDesignPreferences）。
// 保存成功后 store 里的偏好立刻换成新值，整个界面随之重画。
export function AppearanceSection() {
  const { designPreferences, resource } = useDesignPreferences();
  const m = useMessages(appearanceMessages);
  if (!designPreferences) {
    return (
      <Text testID="appearance-loading" size="note" tone={resource?.state === 'error' ? 'danger-dark' : 'muted'}>
        {resource?.state === 'error'
          ? m.loadFailed(resource.error ? memoryErrorText(resource.error) : m.notStarted)
          : m.loading}
      </Text>
    );
  }
  return (
    <Column gap="page-section">
      <LanguageCard locale={designPreferences.locale} />
      <AppearanceFormCard preferences={designPreferences} />
    </Column>
  );
}

// 界面语言：选了立即保存，不等表单的「保存」。换完整个界面立即用新语言重画（设计规范 P15.2：这一行写明立即生效）。
function LanguageCard({ locale }: { locale: Locale }) {
  const runtime = useCompanionRuntime();
  const m = useMessages(appearanceMessages);
  const options = appearanceOptions(locale).locale;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (next: Locale) => {
    if (next === locale || saving) return;
    setSaving(true);
    setError(null);
    runtime.updateDesignPreferences({ locale: next })
      .catch((reason: unknown) => setError(memoryErrorText(reason)))
      .finally(() => setSaving(false));
  };
  return (
    <Card testID="appearance-language" rounded="xl" p="page-card" gap="form-field">
      <Field label={m.language} help={m.languageHelp}>
        <Box w={240}>
          <SegmentedControl<Locale> options={options} value={locale} onChange={choose} size="sm" optionTestID={(value) => `appearance-locale-${value}`} />
        </Box>
      </Field>
      {error ? <Text testID="appearance-language-error" size="note" tone="danger-dark">{error}</Text> : null}
    </Card>
  );
}

function AppearanceFormCard({ preferences }: { preferences: DesignPreferencesDto }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = useMessages(appearanceMessages);
  const labels = designPreferenceLabels(locale);
  const options = appearanceOptions(locale);
  const saved = designPreferencesFields(preferences);
  const { form, field, setForm } = useServerForm(appearanceForm(saved));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const changes = appearanceChanges(form, saved);
  const reset = appearanceResetRequest(saved);
  const updated = appearanceUpdatedLine(preferences, leadName, new Date(), locale);

  const send = (request: NonNullable<typeof changes>, done: string) => {
    const problem = appearanceFormProblem(request, locale);
    if (problem) {
      setMessage({ text: problem, error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    runtime.updateDesignPreferences(request)
      .then(() => setMessage({ text: done, error: false }))
      .catch((reason: unknown) => setMessage({ text: memoryErrorText(reason), error: true }))
      .finally(() => setSaving(false));
  };

  const choose = (name: string) => (value: string) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <Column testID="appearance-section" gap="page-section">
      <Card rounded="xl" p="page-card" gap="form-field">
        <Field label={m.density} help={m.densityHelp}>
          <Column gap="field">
            {DENSITY_ZONES.map((zone) => (
              <Row key={zone} items="center" gap="side-item" flexWrap="wrap">
                <Text size="label" tone="secondary" w={72}>{labels.zone[zone]}</Text>
                <Box w={240}>
                  <SegmentedControl<DensityLevel>
                    options={options.density}
                    value={form[`density.${zone}`] as DensityLevel}
                    onChange={choose(`density.${zone}`)}
                    size="sm"
                    optionTestID={(value) => `appearance-density-${zone}-${value}`}
                  />
                </Box>
              </Row>
            ))}
          </Column>
        </Field>
        <Field label={m.radius} help={m.radiusHelp}>
          <SegmentedControl<RadiusLevel> options={options.radius} value={form.radius as RadiusLevel} onChange={choose('radius')} size="sm" optionTestID={(value) => `appearance-radius-${value}`} />
        </Field>
        <Field label={m.textScale} help={m.textScaleHelp}>
          <SegmentedControl<TextScaleLevel> options={options.textScale} value={form.textScale as TextScaleLevel} onChange={choose('textScale')} size="sm" optionTestID={(value) => `appearance-text-${value}`} />
        </Field>
        <Field label={m.lineHeight} help={m.lineHeightHelp}>
          <SegmentedControl<LineHeightLevel> options={options.lineHeight} value={form.lineHeight as LineHeightLevel} onChange={choose('lineHeight')} size="sm" optionTestID={(value) => `appearance-leading-${value}`} />
        </Field>
        <Field label={m.colors} help={m.colorsHelp}>
          <Column gap="field">
            {PALETTE_ROLES.map((role) => {
              const value = form[`colors.${role}`] ?? '';
              const valid = /^#[0-9a-fA-F]{6}$/.test(value.trim());
              return (
                <Row key={role} items="center" gap="side-item">
                  <Text size="label" tone="secondary" w={72}>{labels.palette[role]}</Text>
                  {/* 色块预览：用户填的十六进制值直接当底色。它不是 token，所以按 token 的类型断言一次；Tamagui 把它原样交给平台。 */}
                  <Box w={20} h={20} rounded="sm" borderWidth={1} borderColor="border" bg={(valid ? value.trim() : 'transparent') as ColorToken} />
                  <Box w={132}>
                    <TextField
                      testID={`appearance-color-${role}`}
                      value={value}
                      onChangeText={field(`colors.${role}`)}
                      variant="filled"
                      size="sm"
                      maxLength={7}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                  </Box>
                </Row>
              );
            })}
          </Column>
        </Field>
        <Field label={m.notes} help={m.notesHelp}>
          <TextField
            testID="appearance-notes"
            value={form.notes ?? ''}
            onChangeText={field('notes')}
            placeholder={m.notesPlaceholder}
            variant="filled"
            size="sm"
            multiline
            height={112}
            maxLength={DESIGN_NOTES_MAX_LENGTH}
          />
        </Field>
        <Row items="center" gap="actions" flexWrap="wrap">
          <Button testID="appearance-save" label={m.save} size="sm" disabled={saving || !changes} onPress={() => changes && send(changes, m.saved)} />
          <Button testID="appearance-reset" label={m.reset} size="sm" variant="ghost" disabled={saving || !reset} onPress={() => reset && send(reset, m.resetDone)} />
          {message ? (
            <Text testID="appearance-message" size="note" tone={message.error ? 'danger-dark' : 'secondary'}>{message.text}</Text>
          ) : null}
        </Row>
      </Card>
      {updated ? <Text testID="appearance-updated" size="label" tone="muted">{updated}</Text> : null}
    </Column>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <Column gap="field">
      <Text size="label" weight="bold" tone="secondary">{label}</Text>
      {children}
      <Text size="note" tone="muted">{help}</Text>
    </Column>
  );
}
