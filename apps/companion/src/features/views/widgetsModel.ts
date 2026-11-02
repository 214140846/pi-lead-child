// 视图面板（2026-10-30，.scratch/custom-views/spec.md）上的文字和顺序。纯函数，node 环境的测试也能用。
import { DEFAULT_VIEW, type Locale, type WidgetDto } from '@pi-lead-child/protocol';

import { viewsMessages } from './views.messages';

const pad = (value: number) => String(value).padStart(2, '0');

// 短格式的时间（P14.2）：10-30 14:00，按本地时区。
export function widgetTimeText(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 间隔的说法：每 15 分钟、每 1 小时、每 1 天；不是整分钟的写秒。
export function everyText(seconds: number, locale: Locale): string {
  const m = viewsMessages(locale);
  if (seconds % 86_400 === 0) return m.every(seconds / 86_400, 'day');
  if (seconds % 3_600 === 0) return m.every(seconds / 3_600, 'hour');
  if (seconds % 60 === 0) return m.every(seconds / 60, 'minute');
  return m.every(seconds, 'second');
}

// 控件标题下面的一行。快照：谁建的、什么时候改的。有数据源：多久更新一次、上次成功是什么时候。
export function widgetMetaLine(widget: Pick<WidgetDto, 'createdBy' | 'updatedAt' | 'source'>, leadName: string, locale: Locale): string {
  const m = viewsMessages(locale);
  const source = widget.source;
  if (source) {
    const every = everyText(source.everySeconds, locale);
    return source.lastOkAt ? m.autoUpdateLast(every, widgetTimeText(source.lastOkAt)) : m.autoUpdate(every);
  }
  const when = widgetTimeText(widget.updatedAt);
  return widget.createdBy === 'lead' ? m.createdByLead(leadName, when) : m.createdByYou(when);
}

/** 数据源出了问题时的一句话（暂停了，或者上一次出错）。没问题时为 null。显示的内容是上一次成功的。 */
export function widgetSourceProblem(widget: Pick<WidgetDto, 'source'>, locale: Locale): string | null {
  const m = viewsMessages(locale);
  const source = widget.source;
  if (!source || (!source.paused && !source.lastError)) return null;
  const kept = source.lastOkAt ? m.keptData(widgetTimeText(source.lastOkAt)) : '';
  const reason = source.lastError ?? m.unknownReason;
  return source.paused ? m.paused(kept, reason) : m.lastFailed(kept, reason);
}

export function widgetsEmptyNote(leadName: string, locale: Locale): string {
  return viewsMessages(locale).emptyNote(leadName);
}

/** 面板现在显示哪个视图：选中的还在就是它，否则是第一个。 */
export function currentView(views: readonly string[], selected: string | null): string {
  return selected !== null && views.includes(selected) ? selected : views[0] ?? DEFAULT_VIEW;
}

/**
 * 在同一个视图里上移、下移一个控件以后，全部控件的顺序（widget_board / reorder 要全部的编号）。
 * 它和同一个视图里的上一个或下一个换位置，别的视图的控件不动。到头了时返回 null。
 */
export function movedOrder(widgets: readonly Pick<WidgetDto, 'id' | 'view'>[], id: number, step: -1 | 1): number[] | null {
  const ids = widgets.map((widget) => widget.id);
  const view = widgets.find((widget) => widget.id === id)?.view;
  if (view === undefined) return null;
  const sameView = widgets.filter((widget) => widget.view === view).map((widget) => widget.id);
  const neighbor = sameView[sameView.indexOf(id) + step];
  if (neighbor === undefined) return null;
  const from = ids.indexOf(id);
  const to = ids.indexOf(neighbor);
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return ids;
}

export function widgetErrorText(error: unknown, locale: Locale): string {
  return error instanceof Error && error.message ? error.message : viewsMessages(locale).actionFailed;
}
