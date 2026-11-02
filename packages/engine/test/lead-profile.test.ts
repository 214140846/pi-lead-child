// 改 Lead 的名字、人格和互动风格（2026-10-22）。设置页和 Lead 的 update_lead_profile 调同一个函数（updateLeadProfile）：
//   - 页面以你本人的名义改，记一次主人操作（lead.profile）；
//   - Lead 只能在你这一轮（当前已认证的配对用户轮次）明确要求时代你改：账本写 actor=lead、代你、凭哪一轮，主人操作记在那一轮来自的凭证名下；
//   - 没有变化时什么也不写；「不是我」恢复成改之前的样子，之后又改过的不动。
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  completeTurn, createLoopbackBinding, createTurn, getLeadProfile, leadDisplayName, listEvents, openDb, revokeBinding,
  type Db,
} from "@pi-lead-child/store";
import { updateDesignPreferences } from "../src/design-preferences.js";
import { LeadProfileError, revertLeadProfile, updateLeadProfile } from "../src/lead-profile.js";

let db: Db;

beforeEach(() => {
  db = openDb(join(tempDir("plc-lead-profile-"), "plc.db"));
});
afterEach(() => db.close());

function web() {
  return createLoopbackBinding(db, { name: "本机网页" }).binding;
}

const SOURCE = { client: "web" as const, deviceName: "本机网页", loopback: true, fromThisMachine: true };

function performed() {
  return listEvents(db, { kind: "owner_action.performed", limit: 100 });
}

describe("updateLeadProfile", () => {
  it("starts as Paimon with no persona or interaction style", () => {
    expect(getLeadProfile(db)).toEqual({ name: "Paimon", persona: "", interactionStyle: "", updatedAt: null, updatedBy: null });
    expect(leadDisplayName(db)).toBe("Paimon");
  });

  it("saves the user's change, records an owner action and asks clients to reload", () => {
    const binding = web();
    const published: string[] = [];
    const outcome = updateLeadProfile(db, {
      request: { name: "  Jarvis ", interactionStyle: "先给结论，最多三句" },
      caller: { kind: "user", credential: binding, source: SOURCE },
      now: new Date("2026-10-22T07:00:00.000Z"),
      publish: (resource) => published.push(resource),
    });
    expect(outcome).toMatchObject({ changed: true, by: { actor: "user" } });
    expect(getLeadProfile(db)).toEqual({
      name: "Jarvis", persona: "", interactionStyle: "先给结论，最多三句", updatedAt: "2026-10-22T07:00:00.000Z", updatedBy: "user",
    });
    expect(leadDisplayName(db)).toBe("Jarvis");
    expect(published).toEqual(["lead-profile"]);
    expect(performed()).toHaveLength(1);
    expect(performed()[0]!.payload).toMatchObject({
      action: "lead.profile",
      target: { label: "Identity and style of Jarvis" },
      summary: 'Changed the assistant name from "Paimon" to "Jarvis", changed how Jarvis interacts with you',
      detail: { fields: ["name", "interactionStyle"] },
      undo: {
        kind: "lead_profile",
        before: { name: "Paimon", persona: "", interactionStyle: "" },
        after: { name: "Jarvis", persona: "", interactionStyle: "先给结论，最多三句" },
      },
    });
  });

  it("writes nothing when nothing changed", () => {
    const binding = web();
    const published: string[] = [];
    const outcome = updateLeadProfile(db, {
      request: { name: "Paimon" }, caller: { kind: "user", credential: binding, source: SOURCE },
      publish: (resource) => published.push(resource),
    });
    expect(outcome.changed).toBe(false);
    expect(getLeadProfile(db).updatedAt).toBeNull();
    expect(performed()).toHaveLength(0);
    expect(published).toEqual([]);
  });

  it("refuses bad input before touching anything", () => {
    const attempt = (request: unknown) => {
      try {
        updateLeadProfile(db, { request: request as never, caller: { kind: "user" } });
      } catch (error) {
        return error;
      }
      return null;
    };
    expect(attempt({ name: "   " })).toMatchObject({ code: "invalid_input", message: "The name cannot be empty." });
    expect(attempt({})).toMatchObject({ code: "invalid_input", message: "Nothing to change." });
    expect(attempt({ name: 7 })).toMatchObject({ message: "You can change only name, persona and interactionStyle. Each value must be text." });
    expect(attempt({ name: 7 })).toBeInstanceOf(LeadProfileError);
    expect(attempt({ avatar: "x" })).toBeInstanceOf(LeadProfileError);
    expect(getLeadProfile(db).updatedAt).toBeNull();
  });

  it("lets Lead change it only inside the user's own active turn", () => {
    const binding = web();
    const refused = (turnId: string | null) => {
      try {
        updateLeadProfile(db, { request: { name: "Jarvis" }, caller: { kind: "lead", turnId } });
      } catch (error) {
        return error as LeadProfileError;
      }
      throw new Error("expected a refusal");
    };
    // Lead 自己发起的一轮（没有用户轮次）、已经结束的一轮、凭证作废了的一轮都不算。
    expect(refused(null).code).toBe("needs_user_turn");
    createTurn(db, { id: "turn-done", originBindingId: binding.id, originKind: "paired:companion", userText: "…", state: "streaming" });
    completeTurn(db, "turn-done");
    expect(refused("turn-done").code).toBe("needs_user_turn");
    const other = web();
    createTurn(db, { id: "turn-revoked", originBindingId: other.id, originKind: "paired:companion", userText: "…", state: "streaming" });
    revokeBinding(db, other.id);
    expect(refused("turn-revoked").message).toContain("设置 → 身份与风格");
    expect(getLeadProfile(db).name).toBe("Paimon");

    createTurn(db, { id: "turn-user", originBindingId: binding.id, originKind: "paired:companion", userText: "以后叫你 Jarvis", state: "streaming" });
    const outcome = updateLeadProfile(db, { request: { name: "Jarvis" }, caller: { kind: "lead", turnId: "turn-user" } });
    expect(outcome.by).toEqual({ actor: "lead", onBehalfOf: { actor: "user", sourceTurnId: "turn-user", bindingId: binding.id } });
    expect(getLeadProfile(db)).toMatchObject({ name: "Jarvis", updatedBy: "lead" });
    expect(performed()[0]).toMatchObject({
      level: "interrupt",
      payload: {
        action: "lead.profile",
        summary: 'Jarvis changed the assistant name from "Paimon" to "Jarvis" for you',
        detail: { sourceTurnId: "turn-user" },
        credential: { bindingId: binding.id },
        source: { client: "lead" },
        delivery: "push",
      },
    });
  });
});

describe("updateLeadProfile in Chinese", () => {
  it("writes the errors and the owner action in the language the user chose", () => {
    updateDesignPreferences(db, { request: { locale: "zh" }, caller: { kind: "user" } });
    const binding = web();
    updateLeadProfile(db, {
      request: { name: "Jarvis", persona: "管家" }, caller: { kind: "user", credential: binding, source: SOURCE },
    });
    expect(performed()[0]!.payload).toMatchObject({
      target: { label: "Jarvis 的身份与风格" },
      summary: "把助手的名字从「Paimon」改成「Jarvis」，改了 Jarvis 的人格",
    });
    expect(() => updateLeadProfile(db, { request: { name: "   " }, caller: { kind: "user" } })).toThrow("名字不能是空的");
    expect(() => updateLeadProfile(db, { request: { name: 7 } as never, caller: { kind: "user" } }))
      .toThrow("只能改 name、persona、interactionStyle，值是文字");
  });
});

describe("revertLeadProfile", () => {
  it("restores the earlier profile only while it is still the changed one", () => {
    const before = { name: "Paimon", persona: "", interactionStyle: "" };
    const after = { name: "Jarvis", persona: "管家", interactionStyle: "" };
    updateLeadProfile(db, { request: after, caller: { kind: "user" } });
    expect(revertLeadProfile(db, { before, after })).toBe("reverted");
    expect(getLeadProfile(db)).toMatchObject(before);
    expect(revertLeadProfile(db, { before, after })).toBe("unchanged");

    updateLeadProfile(db, { request: after, caller: { kind: "user" } });
    updateLeadProfile(db, { request: { name: "Friday" }, caller: { kind: "user" } });
    expect(revertLeadProfile(db, { before, after })).toBe("changed_since");
    expect(getLeadProfile(db).name).toBe("Friday");
  });
});
