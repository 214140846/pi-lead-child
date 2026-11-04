// 安装页（设计第 4.1、4.3 节）：按 desktop-install 的进度显示三行；失败时有「重试」「查看日志」「复制诊断信息」。
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { InstallProgress } from "../src/install.js";
import { installView } from "../src/install-view.js";
import { renderInstallView } from "../src/renderer/render.js";

function progress(extra: Partial<InstallProgress>): InstallProgress {
  return {
    stage: "working",
    steps: { unpack: "done", service: "running", start: "pending" },
    detail: "Setting up the background service.",
    backgroundNotice: true,
    error: null,
    gatewayUrl: null,
    ...extra,
  };
}

// 根配置的 setup 文件不能在 jsdom 环境里跑，所以在 node 环境里自己建一个文档：渲染函数本来就收 document 参数。
let document: Document;

function draw(view: ReturnType<typeof installView>) {
  document = new JSDOM("<!doctype html><html><head><title></title></head><body></body></html>").window.document;
  const root = document.createElement("div");
  const act = vi.fn();
  renderInstallView(document, root, view, act);
  return { root, act };
}

describe("the install page", () => {
  it("shows the three steps, the step detail and the background item notice", () => {
    const { root } = draw(installView({ kind: "progress", progress: progress({}) }, { leadName: "Nina", locale: "en" }));
    expect(document.title).toBe("Nina");
    expect([...root.querySelectorAll("li")].map((li) => [li.dataset.step, li.dataset.state, li.textContent])).toEqual([
      ["unpack", "done", "Copy the program filesDone"],
      ["service", "running", "Set up the background serviceIn progress"],
      ["start", "pending", "Start the service (on a busy Mac, this can take several minutes)Waiting"],
    ]);
    expect(root.querySelector(".detail")?.textContent).toBe("Setting up the background service.");
    expect(root.querySelector(".notice")?.textContent).toContain("added a background item. This is normal");
    expect(root.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows the failure and three actions; the buttons call back with their action", () => {
    const failed = progress({
      stage: "failed",
      steps: { unpack: "done", service: "failed", start: "pending" },
      backgroundNotice: false,
      error: { code: "launchd_bootstrap_failed", message: "The background service could not start." },
    });
    const { root, act } = draw(installView({ kind: "progress", progress: failed }, { leadName: "Paimon", locale: "zh" }));
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(root.querySelector("[role=alert]")?.textContent).toBe("The background service could not start.");
    const buttons = [...root.querySelectorAll("button")];
    expect(buttons.map((button) => [button.textContent, button.className])).toEqual([
      ["重试", "button primary"],
      ["查看日志", "button"],
      ["复制诊断信息", "button"],
    ]);
    buttons[2]!.click();
    expect(act).toHaveBeenCalledWith("diagnostics");
  });

  it("writes every text as text, not as HTML", () => {
    const failed = progress({ stage: "failed", error: { code: "unexpected", message: "<img src=x onerror=alert(1)>" } });
    const { root } = draw(installView({ kind: "progress", progress: failed }, { leadName: "<b>Nina</b>", locale: "en" }));
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("[role=alert]")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("disables the buttons while the diagnostics are collected", () => {
    const failed = progress({ stage: "failed", error: { code: "x", message: "m" } });
    const { root } = draw(installView({ kind: "progress", progress: failed }, { leadName: "Paimon", locale: "en", busy: true }));
    expect([...root.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });

  it("asks to move the App before it installs anything", () => {
    const { root } = draw(installView({ kind: "move", error: null }, { leadName: "Paimon", locale: "en" }));
    expect(root.querySelector("h1")?.textContent).toBe("Move Bytezard Lead to Applications");
    expect(root.querySelectorAll("li")).toHaveLength(0);
    expect([...root.querySelectorAll("button")].map((button) => button.dataset.action)).toEqual(["move"]);
  });
});
