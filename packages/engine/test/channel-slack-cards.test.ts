// Slack 消息带的卡片（2026-11-04：Ethan 在频道里 @ 了两个人，问「你们可以帮忙看一下么？」，同时转发了 Nina 的一条消息，
// 里面有问题的描述和一张截图。Lead 只读到了那一句，以为对方没给信息）。text 有字时，附件里的文字和文件以前整个丢了。
// 卡片的文字单独成行，写明是哪种卡片、谁写的；卡片里的 Slack 文件写文件编号，外链图片写一行说明。
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { getEvent, openDb, type Db } from "@pi-lead-child/store";
import { ChannelHub, ChannelRegistry, createSlackChannelAdapter, slackMessageText } from "../src/index.js";
import { FAKE_SLACK_USER_SCOPES, FakeSlack } from "../testing/index.js";

// 一个 1×1 的 PNG。
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64",
));

const FORWARDED = "<@U0ETHAN> 我用 impersonate 登录 Acme 这个客户的后台，页面一直加载不出来，不知道可以找哪位同学看下";

// 转发的消息在 attachments 里的样子（Slack 的「转发」：is_share、is_msg_unfurl，原消息的 block 在 message_blocks，
// 原消息的文件在 files）。人名、编号、地址都是编的。
function forward(file: Record<string, unknown>): Record<string, unknown> {
  return {
    ts: "1793770000.000100", channel_id: "C0HELP", channel_team: "T0ACME", is_msg_unfurl: true, is_share: true, id: 1,
    message_blocks: [{
      team: "T0ACME", channel: "C0HELP", ts: "1793770000.000100",
      message: { blocks: [{ type: "rich_text", block_id: "b1", elements: [{ type: "rich_text_section", elements: [
        { type: "user", user_id: "U0ETHAN" }, { type: "text", text: " 我用 impersonate 登录 Acme 这个客户的后台，页面一直加载不出来，不知道可以找哪位同学看下" },
      ] }] }] },
    }],
    files: [file],
    original_url: "https://acme.example.com/archives/C0HELP/p1793770000000100",
    from_url: "https://acme.example.com/archives/C0HELP/p1793770000000100",
    fallback: `[2026-11-04 13:06] Nina: ${FORWARDED}`,
    text: FORWARDED,
    author_id: "U0NINA", author_name: "Nina", author_subname: "Nina",
    author_link: "https://acme.example.com/team/U0NINA", author_icon: "https://avatars.example.com/nina.png",
    mrkdwn_in: ["text"], footer: "Posted in #help-admin",
  };
}

const SHOT = {
  id: "F0SHOT", name: "image.png", title: "image.png", mimetype: "image/png", filetype: "png", mode: "hosted",
  url_private: "https://files.slack.com/files-pri/T0ACME-F0SHOT/image.png", thumb_360: "https://files.slack.com/files-tmb/T0ACME-F0SHOT/image_360.png",
};

describe("the cards in a Slack message", () => {
  it("keeps a forwarded message with its author, its words and its picture next to the text", () => {
    expect(slackMessageText({
      text: "<@U0DAVE> <@U0MIN> 你们可以帮忙看一下么？",
      blocks: [{ type: "rich_text", block_id: "a1", elements: [{ type: "rich_text_section", elements: [
        { type: "user", user_id: "U0DAVE" }, { type: "text", text: " " }, { type: "user", user_id: "U0MIN" },
        { type: "text", text: " 你们可以帮忙看一下么？" },
      ] }] }],
      attachments: [forward(SHOT)],
    })).toBe([
      "<@U0DAVE> <@U0MIN> 你们可以帮忙看一下么？",
      `[转发的消息] Nina：${FORWARDED}`,
      "Posted in #help-admin",
      "[图片 image.png，文件编号 slack:F0SHOT]",
    ].join("\n"));
  });

  it("keeps an app's card next to the text", () => {
    expect(slackMessageText({ text: "普通消息", attachments: [{ text: "卡片的正文" }] })).toBe("普通消息\n[消息卡片] 卡片的正文");
    expect(slackMessageText({
      text: "部署结果",
      attachments: [{ author_name: "CI", title: "build #12", text: "失败：2 个测试", fields: [{ title: "分支", value: "main" }] }],
    })).toBe("部署结果\n[消息卡片] CI：build #12\n失败：2 个测试\n分支: main");
  });

  it("reads a message that is only a forwarded message", () => {
    expect(slackMessageText({ text: "", attachments: [forward(SHOT)] })).toBe([
      `[转发的消息] Nina：${FORWARDED}`,
      "Posted in #help-admin",
      "[图片 image.png，文件编号 slack:F0SHOT]",
    ].join("\n"));
  });

  it("names the Slack files inside a card, after the message's own files", () => {
    expect(slackMessageText({
      text: "两张图",
      files: [{ id: "F01", name: "a.png", mimetype: "image/png" }],
      attachments: [{ author_name: "Nina", text: "原图", files: [
        { id: "F02", name: "b.pdf", mimetype: "application/pdf" }, { id: "F03", mode: "tombstone" },
      ] }],
    })).toBe("两张图\n[消息卡片] Nina：原图\n[图片 a.png，文件编号 slack:F01]\n[文件 b.pdf，application/pdf，文件编号 slack:F02]");
  });

  it("says that a link preview's picture is not a Slack file, instead of dropping it", () => {
    expect(slackMessageText({
      text: "看这篇 <https://blog.example.com/post|文章>",
      attachments: [{
        from_url: "https://blog.example.com/post", original_url: "https://blog.example.com/post", service_name: "Example Blog",
        title: "新版本发布", title_link: "https://blog.example.com/post", text: "这次改了三件事",
        image_url: "https://blog.example.com/cover.png", thumb_url: "https://blog.example.com/cover_small.png",
      }],
    })).toBe([
      "看这篇 <https://blog.example.com/post|文章>",
      "[链接预览] Example Blog：新版本发布\n这次改了三件事",
      "[图片 卡片里的外链图片，不是 Slack 文件，没有文件编号：https://blog.example.com/cover.png]",
    ].join("\n"));
    // 只有小图时写小图。
    expect(slackMessageText({ text: "x", attachments: [{ from_url: "https://a.example.com", title: "A", thumb_url: "https://a.example.com/t.png" }] }))
      .toBe("x\n[链接预览] A\n[图片 卡片里的外链图片，不是 Slack 文件，没有文件编号：https://a.example.com/t.png]");
  });

  it("adds the words of blocks only when the text does not already have them", () => {
    expect(slackMessageText({
      text: "看 <https://a.example.com|文档> &amp; 回复 <@U0NINA>",
      blocks: [
        { type: "rich_text", elements: [{ type: "rich_text_section", elements: [
          { type: "text", text: "看 " }, { type: "link", url: "https://a.example.com", text: "文档" }, { type: "text", text: " & 回复 " },
          { type: "user", user_id: "U0NINA" },
        ] }] },
        { type: "section", text: { type: "mrkdwn", text: "截止：周五" } },
      ],
    })).toBe("看 <https://a.example.com|文档> &amp; 回复 <@U0NINA>\n截止：周五");
  });
});

describe("a forwarded message that reaches Lead", () => {
  let db: Db;
  let slack: FakeSlack;
  let hub: ChannelHub;

  beforeEach(() => {
    db = openDb(join(tempDir("plc-slack-cards-"), "plc.db"));
    slack = new FakeSlack({ users: { U0ETHAN: { name: "ethan" }, U0NINA: { name: "nina" } }, scopes: [...FAKE_SLACK_USER_SCOPES, "files:read"] });
    hub = new ChannelHub({
      db, registry: new ChannelRegistry([createSlackChannelAdapter({ api: slack.api })]),
      credentials: { credential: async () => slack.credential }, log: () => {},
    });
  });

  afterEach(async () => {
    await hub.idle();
    db.close();
  });

  it("gives Lead the forwarded words and a picture it can open", async () => {
    const shot = slack.addFile("image.png", "image/png", PNG);
    const received = (await hub.receive("slack", slack.mention("U0ETHAN", "你们可以帮忙看一下么？", {
      channel: "C0HELP", attachments: [forward(slack.wireFile(shot))],
    }))).items[0]!;
    await hub.idle();
    const text = String(getEvent(db, received.seq!)!.payload.text);
    expect(text).toContain("你们可以帮忙看一下么？");
    expect(text).toContain("[转发的消息] Nina：");
    expect(text).toContain("页面一直加载不出来");
    expect(text).toContain(`[图片 image.png，文件编号 slack:${shot.id}]`);
    const file = await hub.readFile(`slack:${shot.id}`, 1_000_000);
    expect(Buffer.from(file.data).equals(Buffer.from(PNG))).toBe(true);
    const read = await hub.readConversation("slack:C0HELP:main", 10);
    expect(read.messages.at(-1)!.text).toContain(`[图片 image.png，文件编号 slack:${shot.id}]`);
  });
});
