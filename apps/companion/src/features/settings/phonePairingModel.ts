// 设置 → 设备 → 添加手机 的纯函数：设备名的校验、倒计时和地址的写法、错误的说明。
import type { Locale } from '@pi-lead-child/protocol';

import { reasonText } from './deviceModel';
import { devicesMessages } from './devices.messages';

export const PHONE_NAME_MAX = 80;

/** 设备名的缺省值，按界面语言。 */
export function defaultPhoneName(locale: Locale): string {
  return devicesMessages(locale).phone.defaultName;
}

// 网关按去掉首尾空白后的长度校验（1 到 80）。这里先校验一遍，给出界面语言的说明。
export function phoneNameError(name: string, locale: Locale): string | null {
  const m = devicesMessages(locale).phone;
  const trimmed = name.trim();
  if (!trimmed) return m.nameRequired;
  if (trimmed.length > PHONE_NAME_MAX) return m.nameTooLong(PHONE_NAME_MAX);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return m.nameControl;
  return null;
}

// 剩下的时间，写成「分:秒」。不足一秒的部分向上取整，到 0 才算过期。
export function countdownLabel(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ws://192.168.1.20:47130 → 192.168.1.20:47130。
export function endpointLabel(endpoint: string): string {
  return endpoint.replace(/^wss?:\/\//, '');
}

// 一个模块几个像素：码的边长（含静区）尽量接近 300，最少 3。一份邀请大约是 61×61 的码，每个模块 4 像素。
export function qrModuleSize(size: number): number {
  return Math.max(3, Math.floor(300 / (size + 8)));
}

function statusOf(reason: unknown): number | undefined {
  if (typeof reason !== 'object' || reason === null) return undefined;
  const status = (reason as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isNotFound(reason: unknown): boolean {
  return statusOf(reason) === 404;
}

// 生成邀请失败时的说明。网关的几种拒绝各有原因，按状态码说清楚怎么办。
export function invitationErrorText(reason: unknown, locale: Locale): string {
  const m = devicesMessages(locale).phone;
  switch (statusOf(reason)) {
    case 409:
      return m.gatewayLocalOnly;
    case 404:
      return m.loopbackOff;
    case 403:
      return m.onlyLocal;
    default:
      return reasonText(reason, locale);
  }
}
