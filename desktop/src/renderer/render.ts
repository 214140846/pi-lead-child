// 安装页按主进程给的画面画（install-view.ts 的 InstallView）。文字一律用 textContent，不拼 HTML。
// 状态用 7px 圆点加同色文字（设计规范 P7.2、主题 C-11 到 C-15）；一页最多一个主按钮（P5.1）。

export interface RenderedView {
  lang: string;
  title: string;
  heading: string;
  body: string | null;
  steps: Array<{ id: string; label: string; state: string; stateLabel: string }>;
  detail: string | null;
  notice: string | null;
  error: string | null;
  status: string | null;
  actions: Array<{ id: string; label: string; primary: boolean }>;
  busy: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderInstallView(doc: Document, root: HTMLElement, view: RenderedView, act: (action: string) => void): void {
  doc.documentElement.lang = view.lang === "zh" ? "zh-CN" : "en";
  doc.title = view.title;
  root.replaceChildren();

  const card = element(doc, "main", "card");
  card.setAttribute("aria-busy", String(view.busy || view.steps.some((step) => step.state === "running")));
  card.append(element(doc, "p", "lead-name", view.title));
  card.append(element(doc, "h1", "heading", view.heading));
  if (view.body) card.append(element(doc, "p", "body", view.body));

  if (view.steps.length) {
    const list = element(doc, "ol", "steps");
    for (const step of view.steps) {
      const item = element(doc, "li", `step step-${step.state}`);
      item.dataset.step = step.id;
      item.dataset.state = step.state;
      const dot = element(doc, "span", "dot");
      dot.setAttribute("aria-hidden", "true");
      item.append(dot, element(doc, "span", "step-label", step.label), element(doc, "span", "step-state", step.stateLabel));
      list.append(item);
    }
    card.append(list);
  }

  if (view.detail) card.append(element(doc, "p", "detail", view.detail));
  if (view.notice) card.append(element(doc, "p", "notice", view.notice));
  if (view.error) {
    const error = element(doc, "p", "error", view.error);
    error.setAttribute("role", "alert");
    card.append(error);
  }

  if (view.actions.length) {
    const bar = element(doc, "div", "actions");
    for (const action of view.actions) {
      const button = element(doc, "button", action.primary ? "button primary" : "button", action.label);
      button.type = "button";
      button.dataset.action = action.id;
      button.disabled = view.busy;
      button.addEventListener("click", () => act(action.id));
      bar.append(button);
    }
    card.append(bar);
  }
  if (view.status) {
    const status = element(doc, "p", "status", view.status);
    status.setAttribute("role", "status");
    card.append(status);
  }
  root.append(card);
}
