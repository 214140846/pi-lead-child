// 「用户本人发话时免沙箱」到点的定时器（docs/ticket-246-user-turn-bypass.md 5.2，实施单 A）。
// 到点以后开关本来就不再生效（读的时候比较 until），这个定时器只是把 kv 置关、写 host_bypass.expired、让界面刷新、告诉 Lead。
// 启动时先清理一次：daemon 停着的时候过了时限的，直接置关。开、关以后操作层调 changed()，按新的 until 重新排。
// 定时器提前醒了（系统时钟被拨过）时不置关，按剩下的时间再排一次。
import { expireHostBypassIfDue } from "@pi-lead-child/engine";
import { readStoredHostBypass, type Db } from "@pi-lead-child/store";

export interface HostBypassClock {
  changed(): void;
  stop(): void;
}

export function startHostBypassClock(db: Db, opts: { log: (line: string) => void; now?: () => Date }): HostBypassClock {
  const now = opts.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const check = () => {
    try {
      expireHostBypassIfDue(db, now());
    } catch (error) {
      opts.log(`host bypass: expiry check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped) return;
    check();
    const stored = readStoredHostBypass(db);
    if (!stored.enabled || !stored.until) return;
    const delay = Math.max(0, Date.parse(stored.until) - now().getTime());
    timer = setTimeout(() => {
      timer = null;
      arm();
    }, delay);
    timer.unref();
  };

  arm();
  return {
    changed: arm,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
