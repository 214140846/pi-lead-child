import { DEFAULT_LOCALE, type Locale } from '@/i18n';

import { ChatImageError, type ComposerImage } from './chatImagePicker.types';
import { imagePickerMessages } from './imagePicker.messages';

export { ChatImageError, type ComposerImage } from './chatImagePicker.types';

// 兜底实现：Metro 在 web 上选 .web.ts。原生应用还没有选图片的模块（要加 expo-image-picker），
// canPickImages 为 false，输入框不显示「+」。
export const canPickImages = false;

export async function pickImageFiles(): Promise<Blob[]> {
  return [];
}

export async function prepareChatImage(_file: Blob, locale: Locale = DEFAULT_LOCALE): Promise<ComposerImage> {
  throw new ChatImageError(imagePickerMessages(locale).chatUnsupported);
}
