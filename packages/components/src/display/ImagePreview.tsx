import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { View } from '@tamagui/core';

import { Icon } from './Icon';
import { useMessages } from '../i18n';
import { displayMessages } from './display.messages';

// 还不知道图片的宽高比时用的比例：占位块和图片先按它画，取到尺寸后换成图片自己的比例。
const FALLBACK_RATIO = 4 / 3;

export type ImagePreviewProps = {
  // 图片地址（data: URI 或本机文件）。还没取到时为 null，显示浅灰的占位块。
  uri: string | null;
  // 无障碍名称，例如文件名。
  label: string;
  // 取图失败：占位块里显示一个提示图标。
  failed?: boolean;
  testID?: string;
};

// 一张图片的大图（工单附件点开以后，放在 Sheet 里）：宽度不超过容器，也不超过原图（小截图不放大发糊），居中；
// 高按图片自己的比例，整张显示不裁。和 ImageThumbnail 同样的圆角盒子和细边。
export function ImagePreview({ uri, label, failed = false, testID }: ImagePreviewProps) {
  const m = useMessages(displayMessages);
  const [size, setSize] = useState<{ uri: string; ratio: number; width: number } | null>(null);
  useEffect(() => {
    if (!uri) return undefined;
    let live = true;
    Image.getSize(uri, (width, height) => {
      if (live && width > 0 && height > 0) setSize({ uri, ratio: width / height, width });
    }, () => {});
    return () => { live = false; };
  }, [uri]);
  const known = size && size.uri === uri ? size : null;
  const ratio = known?.ratio ?? FALLBACK_RATIO;
  return (
    <View
      testID={testID}
      role="img"
      aria-label={label}
      w="100%"
      items="center"
      rounded="xl"
      overflow="hidden"
      bg="surface-muted"
      borderWidth={1}
      borderColor="border-soft"
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="contain" accessibilityIgnoresInvertColors style={{ width: '100%', aspectRatio: ratio, ...(known ? { maxWidth: known.width } : {}) }} />
      ) : (
        <View w="100%" items="center" justify="center" style={{ aspectRatio: ratio }}>
          {failed ? <Icon name="error-outline" size={18} color="text-muted" accessibilityLabel={m.imageFailed} /> : null}
        </View>
      )}
    </View>
  );
}
