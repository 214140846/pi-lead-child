// 服务地址的问题说明（service-url.ts）。设置页取 serviceUrlMessages(locale)。
import { defineMessages } from "./i18n.ts";
import type { ServiceUrlProblem } from "./service-url.ts";

export const serviceUrlMessages = defineMessages({
  en: {
    invalid_url: "The address is not a valid URL",
    userinfo: "The address cannot contain a user name or password",
    secret_query: "The query parameters of the address cannot contain values such as a key or token",
  } satisfies Record<ServiceUrlProblem, string>,
  zh: {
    invalid_url: "地址不是合法的 URL",
    userinfo: "地址里不能带用户名或密码",
    secret_query: "地址的查询参数里不能带 key、token 一类的值",
  },
});
