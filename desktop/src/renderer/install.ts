// 安装页的脚本：从 preload 给的 window.bytezardInstaller 取画面、收更新、把按钮交回主进程。
import { renderInstallView, type RenderedView } from "./render.js";

interface Installer {
  getView(): Promise<RenderedView | null>;
  onView(callback: (view: RenderedView) => void): void;
  act(action: string): Promise<void>;
}

const installer = (window as unknown as { bytezardInstaller?: Installer }).bytezardInstaller;
const root = document.getElementById("root");

if (installer && root) {
  const draw = (view: RenderedView | null) => {
    if (view) renderInstallView(document, root, view, (action) => void installer.act(action));
  };
  installer.onView(draw);
  void installer.getView().then(draw);
}
