// 选执行器这一步（FirstRunRuntimes）做过没有，记在本机（网页的 localStorage）：这一步只在首次引导出现一次。
// 原生上和隐私模式下读写失败时只记在内存里：这次打开 App 时不再出现；下次只有大脑又不能用、在第一步重新接好时才会再出现。
const KEY = 'plc.firstRunRuntimesDone';
let done = false;

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function firstRunRuntimesDone(): boolean {
  if (done) return true;
  try {
    return storage()?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberFirstRunRuntimesDone(): void {
  done = true;
  try {
    storage()?.setItem(KEY, '1');
  } catch {
    // 存不下时只记在内存里。
  }
}

// 测试用：忘掉内存里的记录。
export function resetFirstRunMemoryForTests(): void {
  done = false;
}
