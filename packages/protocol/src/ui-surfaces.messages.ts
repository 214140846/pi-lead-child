// 生成中的卡片在 fallback_text 还没到时显示的那句（ui-surfaces.ts 的 partialUiSurface）。
import { defineMessages } from "./i18n.ts";

export const partialSurfaceMessages = defineMessages({
  en: { generating: "Making the card…" },
  zh: { generating: "正在生成卡片…" },
});
