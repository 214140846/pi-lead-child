// P0-7 的实测工具：App 带 --notification-probe 启动时只发一条测试通知，记下 Electron 报的事件，写进临时目录后退出。
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { NOTIFICATION_PROBE_FILE, runNotificationProbe, type NotificationProbeResult } from "../src/notification-probe.js";

function fakeElectron(o: { supported: boolean; failWith?: string }) {
  const temp = tempDir("plc-desktop-probe-");
  const created: Array<{ title: string; body: string }> = [];
  class FakeNotification extends EventEmitter {
    static isSupported = () => o.supported;
    constructor(options: { title: string; body: string }) {
      super();
      created.push(options);
    }
    show() {
      if (o.failWith) this.emit("failed", {}, o.failWith);
      else this.emit("show");
    }
  }
  const app = {
    getPath: vi.fn((_name: string) => temp),
    setPath: vi.fn(),
    whenReady: async () => {},
    getPreferredSystemLanguages: () => ["zh-Hans-CN"],
    getName: () => "Bytezard Lead",
    getVersion: () => "1.3.0",
    quit: vi.fn(),
  };
  return { electron: { app, Notification: FakeNotification } as never, app, created, temp };
}

async function probe(o: { supported: boolean; failWith?: string }) {
  const fake = fakeElectron(o);
  const writes: Array<[string, string]> = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  runNotificationProbe(fake.electron, {
    env: { PLC_DATA_DIR: join(fake.temp, "data") },
    waitMs: 0,
    write: (file, text) => writes.push([file, text]),
  });
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  vi.restoreAllMocks();
  return { ...fake, file: writes[0]![0], result: JSON.parse(writes[0]![1]) as NotificationProbeResult };
}

describe("notification probe", () => {
  it("shows one notification titled with the Lead name, records the events and quits", async () => {
    const { app, created, file, result, temp } = await probe({ supported: true });
    expect(app.setPath).toHaveBeenCalledWith("userData", join(temp, "bytezard-lead-notification-probe"));
    expect(created).toEqual([{ title: "Paimon", body: "这是 Bytezard Lead 的测试通知，可以关掉。" }]);
    expect(file).toBe(join(temp, NOTIFICATION_PROBE_FILE));
    expect(result).toMatchObject({ appName: "Bytezard Lead", supported: true, title: "Paimon" });
    expect(result.events.map((e) => e.event)).toEqual(["show", "called show()"]);
    expect(app.quit).toHaveBeenCalled();
  });

  it("records the failed event that an unsigned app gets", async () => {
    const { result } = await probe({ supported: true, failWith: "Notifications are not allowed" });
    expect(result.events[0]).toMatchObject({ event: "failed", error: "Notifications are not allowed" });
  });

  it("does not create a notification when Electron says it cannot", async () => {
    const { created, result } = await probe({ supported: false });
    expect(created).toEqual([]);
    expect(result).toMatchObject({ supported: false, events: [] });
  });
});
