import { useState } from 'react';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { Box, Column, Row } from '../primitives/layout';
import { Text } from '../primitives/Text';
import { useColorValue } from '../theme/preferences';
import { formatNumber, withUnit } from './format';
import { dataToneFill, type DataTone } from './tones';
import { useMessages } from '../i18n';
import { dataMessages } from './data.messages';

export type SparklineProps = {
  /** 按时间排好的数，至少 2 个。 */
  points: readonly number[];
  /** 这条线是什么，进无障碍标签。 */
  label?: string;
  unit?: string;
  tone?: DataTone;
  /** 参照线，例如昨天收盘。画成虚线，线上下的颜色不变。 */
  baseline?: number;
  /** 起点和终点的说明，写在线下面，例如「10-01」「今天」。 */
  start?: string;
  end?: string;
  testID?: string;
};

// 组件自己的规格（docs/genui-design.md 第 8 节 Sparkline）：线高 48，线宽 2，最后一个点半径 3。
// 上下各留出点的半径，圆点和线头不被裁掉。
const HEIGHT = 48;
const STROKE = 2;
const DOT = 3;
const PAD = DOT + 1;

// 走势小图：一条折线，最后一个点是「现在」。用 react-native-svg 画（三端同一份）。宽度量到以前先画同高的占位（P1.5）。
export function Sparkline({ points, label, unit, tone, baseline, start, end, testID }: SparklineProps) {
  const m = useMessages(dataMessages);
  const [width, setWidth] = useState(0);
  const stroke = useColorValue(dataToneFill(tone));
  const muted = useColorValue('border');
  const values = baseline === undefined ? points : [...points, baseline];
  const high = Math.max(...points);
  const low = Math.min(...points);
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = top - bottom || 1;
  const x = (index: number) => PAD + (index / (points.length - 1)) * (width - PAD * 2);
  const y = (value: number) => PAD + (1 - (value - bottom) / span) * (HEIGHT - PAD * 2);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const summary = m.sparklineSummary(label, withUnit(first, unit), withUnit(last, unit), withUnit(high, unit), withUnit(low, unit));
  const onLayout = (event: { nativeEvent: { layout: { width: number } } }) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured !== width) setWidth(measured);
  };
  return (
    <Column testID={testID} gap="card-row" role="img" aria-label={summary}>
      <Box h={HEIGHT} w="100%" onLayout={onLayout}>
        {width > PAD * 2 ? (
          <Svg width={width} height={HEIGHT}>
            {baseline === undefined ? null : (
              <Line x1={PAD} x2={width - PAD} y1={y(baseline)} y2={y(baseline)} stroke={muted} strokeWidth={1} strokeDasharray="4 4" />
            )}
            <Polyline
              points={points.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={x(points.length - 1)} cy={y(last)} r={DOT} fill={stroke} />
          </Svg>
        ) : null}
      </Box>
      <Row items="baseline" gap="inline-item">
        <Text flex={1} minW={0} size="meta" tone="secondary" numberOfLines={1}>
          {[start, end].filter(Boolean).join(' → ')}
        </Text>
        <Text size="meta" mono tone="secondary" shrink={0}>{m.sparklineRange(formatNumber(high), formatNumber(low))}</Text>
      </Row>
    </Column>
  );
}
