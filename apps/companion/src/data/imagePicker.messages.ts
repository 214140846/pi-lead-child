// 选图片（Lead 的形象图、发给 Lead 的图片）时给用户看的错误。
import { defineMessages } from '@/i18n';

export const imagePickerMessages = defineMessages({
  en: {
    avatarUnsupported: 'This platform cannot upload images yet.',
    avatarType: 'Use a PNG, GIF or WebP image.',
    avatarTooLarge: (size: string) => `This image is ${size}. The maximum is 2 MB.`,
    unreadable: 'Cannot read this image.',
    chatUnsupported: 'This platform cannot send images yet.',
    notImage: 'You can send only images.',
    cannotOpen: 'Cannot open this image.',
    tooLarge: 'This image is too large.',
  },
  zh: {
    avatarUnsupported: '这个平台还不能上传图片',
    avatarType: '只能用 PNG、GIF 或 WebP',
    avatarTooLarge: (size) => `这张图有 ${size}，最大 2 MB`,
    unreadable: '这张图片读不出来',
    chatUnsupported: '这个平台还不能发图片',
    notImage: '只能发图片',
    cannotOpen: '这张图片打不开',
    tooLarge: '这张图片太大了',
  },
});
