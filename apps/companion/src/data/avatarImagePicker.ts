import type { LeadAvatarUploadRequest } from '@pi-lead-child/protocol';

import { DEFAULT_LOCALE, type Locale } from '@/i18n';

import { AvatarImageError } from './avatarImagePicker.types';
import { imagePickerMessages } from './imagePicker.messages';

export { AvatarImageError } from './avatarImagePicker.types';

// 兜底实现：Metro 在 web 上选 .web.ts。原生应用还没有选图片的模块，canPickAvatar 为 false，设置页不显示「上传」。
export const canPickAvatar = false;

export async function pickAvatarFile(): Promise<Blob | null> {
  return null;
}

export async function prepareAvatarImage(_file: Blob, locale: Locale = DEFAULT_LOCALE): Promise<LeadAvatarUploadRequest> {
  throw new AvatarImageError(imagePickerMessages(locale).avatarUnsupported);
}
