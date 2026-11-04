// 窗口里能打开什么（设计第 8.4 节）：同源在窗口里打开，https: 交给系统浏览器，其他一律拒绝。
import { describe, expect, it } from "vitest";
import { navigationDecision, secureWebPreferences } from "../src/window-policy.js";

const GATEWAY = "http://127.0.0.1:47130";

describe("navigationDecision", () => {
  it("keeps same-origin addresses in the window", () => {
    expect(navigationDecision("http://127.0.0.1:47130/settings/model", GATEWAY)).toBe("allow");
    expect(navigationDecision("http://127.0.0.1:47130/?ticket=203#top", GATEWAY)).toBe("allow");
  });

  it("hands other https links to the system browser", () => {
    expect(navigationDecision("https://github.com/acme/x/pull/12", GATEWAY)).toBe("external");
    expect(navigationDecision("https://support.apple.com/en-us/102445", null)).toBe("external");
  });

  it("refuses every other protocol and other http origins", () => {
    for (const url of [
      "http://127.0.0.1:47131/",
      "http://localhost:47130/",
      "http://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "mailto:alice@example.com",
      "data:text/html,hi",
      "https://user:secret@example.com/",
      "not a url",
    ]) {
      expect(navigationDecision(url, GATEWAY), url).toBe("deny");
    }
  });

  it("keeps nothing in the window before the gateway opens", () => {
    expect(navigationDecision("http://127.0.0.1:47130/", null)).toBe("deny");
  });
});

describe("secureWebPreferences", () => {
  it("isolates the page from Node", () => {
    expect(secureWebPreferences("/app/preload.cjs", [])).toMatchObject({
      preload: "/app/preload.cjs", contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false,
    });
  });
});
