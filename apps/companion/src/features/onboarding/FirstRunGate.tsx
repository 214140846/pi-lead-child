import { setupBrainReady } from '@pi-lead-child/protocol';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useConnectionPhase, useSetupStatus } from '@/state/hooks';

import { FirstRunBrain } from './FirstRunBrain';
import { firstRunRuntimesDone, rememberFirstRunRuntimesDone } from './firstRunMemory';
import { firstRunStep } from './firstRunModel';
import { FirstRunRuntimes } from './FirstRunRuntimes';

// 首次启动引导（2026-10-30，.scratch/onboarding/spec.md）：连上 daemon、设置状态说大脑不能用时，整页显示首次启动页，
// 盖住所有页签（RootTabs 的三端各用一次；设置、配对是别的路由，不受影响）。还没取到设置状态、旧 daemon 没有这条路由时
// 照常显示：不能因为一次没取到就把整个 App 挡住。「先进去看看」只在这次打开 App 时跳过。
// 在第一步接好大脑以后，接着选执行器（docs/desktop/macos-desktop-design.md 第 5.3 节，P0-6）。这一步只出现一次，
// 走到哪一步由 firstRunStep 判断。
export function FirstRunGate({ children }: { children: ReactNode }) {
  const phase = useConnectionPhase();
  const { setup } = useSetupStatus();
  const [skipped, setSkipped] = useState(false);
  const [brainShown, setBrainShown] = useState(false);
  const [runtimesDone, setRuntimesDone] = useState(firstRunRuntimesDone);
  const step = firstRunStep({
    connected: phase === 'ready', brainReady: setupBrainReady(setup), brainSkipped: skipped, brainShown, runtimesDone,
  });
  useEffect(() => {
    if (step === 'brain') setBrainShown(true);
  }, [step]);
  const finishRuntimes = useCallback(() => {
    rememberFirstRunRuntimesDone();
    setRuntimesDone(true);
  }, []);
  if (step === 'brain') return <FirstRunBrain onSkip={() => setSkipped(true)} />;
  if (step === 'runtimes') return <FirstRunRuntimes onDone={finishRuntimes} />;
  return <>{children}</>;
}
