// components/ 里共用组件自己的文案：新版本提示。
import { defineMessages } from '@/i18n';

export const componentsMessages = defineMessages({
  en: {
    updateShort: 'New version',
    updateLong: 'New version. Reload to use it.',
    reload: 'Reload',
    dismissUpdate: 'Do not show this version again',
  },
  zh: {
    updateShort: '有新版本',
    updateLong: '有新版本，刷新后生效',
    reload: '刷新',
    dismissUpdate: '不再提示这个版本',
  },
});
