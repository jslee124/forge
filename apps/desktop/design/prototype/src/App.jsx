import {
  ArrowUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  Code,
  Copy,
  Desktop,
  FileText,
  FolderSimple,
  GearSix,
  Link,
  MagnifyingGlass,
  Moon,
  Plus,
  Shield,
  SidebarSimple,
  Stop,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

const commands = [
  ["help", "查看可用命令"],
  ["new", "新建任务"],
  ["model", "选择模型"],
  ["context", "查看上下文"],
  ["compact", "压缩上下文"],
  ["resume", "恢复历史任务"],
  ["permissions", "查看会话授权"],
  ["plugins", "管理项目插件"],
  ["resources", "查看 Skills 与资源"],
  ["login", "连接提供商或引擎"],
  ["logout", "退出连接"],
  ["effort", "设置推理强度"],
  ["clear", "清空当前上下文"],
  ["delete-model", "删除配置模型"],
  ["update-dismiss", "忽略更新提示"],
  ["exit", "退出应用"],
];
const tasks = ["工作台设计", "整理项目文档", "修复构建问题", "接口测试"],
  files = ["live-workbench.tsx", "studio.css", "theme.ts"];
const cssCode =
  ":root {\n  --background: #ffffff;\n  --surface: #f7f7f7;\n  --border: #e4e4e1;\n  --text: #171717;\n  --muted: #777773;\n}\n\n.workbench {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  background: var(--background);\n}";
function Mark() {
  return <img className="mark" src="/forge-mark.svg" alt="Forge" />;
}
function IB({ label, children, ...p }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...p}
    >
      {children}
    </button>
  );
}
export function App() {
  const [theme, setTheme] = useState("light"),
    [sidebar, setSidebar] = useState(true),
    [settings, setSettings] = useState(false),
    [empty, setEmpty] = useState(false),
    [title, setTitle] = useState(tasks[0]),
    [panel, setPanel] = useState(false),
    [tab, setTab] = useState("文件"),
    [file, setFile] = useState("studio.css"),
    [draft, setDraft] = useState(""),
    [menu, setMenu] = useState(null),
    [idx, setIdx] = useState(0),
    [engine, setEngine] = useState("Forge"),
    [model, setModel] = useState("DeepSeek V4"),
    [search, setSearch] = useState(""),
    [expanded, setExpanded] = useState(false),
    [running, setRunning] = useState(false),
    [message, setMessage] = useState(""),
    [notice, setNotice] = useState(""),
    [workspace, setWorkspace] = useState(true);
  useEffect(() => {
    document.getElementById("cmd-" + idx)?.scrollIntoView({ block: "nearest" });
  }, [idx]);
  useEffect(() => {
    const close = (e) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const input = useRef(null),
    timer = useRef(null),
    dark =
      theme === "dark" ||
      (theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
  const filtered = commands.filter(([c]) =>
      c.includes(draft.startsWith("/") ? draft.slice(1).split(" ")[0] : ""),
    ),
    slash = menu === "commands" && draft.startsWith("/"),
    models =
      engine === "Forge"
        ? ["DeepSeek V4", "DeepSeek V4 Pro"]
        : ["GPT-5.5", "GPT-5.6"];
  function toast(t) {
    setNotice(t);
    setTimeout(() => setNotice(""), 4500);
  }
  function open(v) {
    setMenu(menu === v ? null : v);
    setSearch("");
  }
  function newTask() {
    clearTimeout(timer.current);
    setRunning(false);
    setEmpty(true);
    setSettings(false);
    setPanel(false);
    setTitle("新任务");
    setDraft("");
    setMessage("");
    setMenu(null);
    setWorkspace(false);
  }
  function selectTask(t) {
    setTitle(t);
    setEmpty(false);
    setSettings(false);
    setWorkspace(true);
    setMessage("");
    setDraft("");
    setMenu(null);
  }
  function cmd(c) {
    setMenu(null);
    if (c === "new") return newTask();
    if (
      ["model", "context", "permissions", "resume", "help", "plugins"].includes(
        c,
      )
    ) {
      setMenu(c);
      setSearch("");
      return;
    }
    if (c === "compact") {
      toast("原型演示：压缩预览完成，未修改真实上下文。");
      setDraft("");
      return;
    }
    toast("/" + c + "：仅展示交互，未连接执行服务。");
  }
  function send() {
    if (!draft.trim()) return;
    if (draft.startsWith("/")) {
      const c = draft.slice(1).split(" ")[0];
      if (commands.some(([n]) => n === c)) cmd(c);
      else toast("未找到命令，草稿已保留。");
      return;
    }
    setEmpty(false);
    setTitle(title === "新任务" ? "新任务演示" : title);
    setMessage(draft);
    setDraft("");
    setMenu(null);
    setRunning(true);
    timer.current = setTimeout(() => setRunning(false), 1800);
  }
  function keys(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      setMenu(null);
      return;
    }
    if (slash && filtered.length) {
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setIdx(
          (idx + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) %
            filtered.length,
        );
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setDraft("/" + filtered[idx % filtered.length][0] + " ");
        setMenu(null);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        cmd(filtered[idx % filtered.length][0]);
      }
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }
  const code =
    file === "studio.css"
      ? cssCode
      : file === "theme.ts"
        ? "export type Theme = 'light' | 'dark' | 'system';\n\nexport function resolveTheme(theme: Theme) {\n  return theme === 'system'\n    ? getSystemTheme()\n    : theme;\n}"
        : "export function LiveWorkbench() {\n  return (\n    <Workbench>\n      <WorkspaceHeader />\n      <Conversation />\n      <ComposerControls />\n    </Workbench>\n  );\n}";
  return (
    <div className={"stage " + (dark ? "dark" : "")}>
      <div
        className={
          "app-shell " +
          (!sidebar ? "collapsed " : "") +
          (panel && !settings ? "with-panel" : "")
        }
      >
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-top">
              <div className="traffic">
                <i />
                <i />
                <i />
              </div>
              <IB label="折叠侧栏" onClick={() => setSidebar(false)}>
                <SidebarSimple />
              </IB>
            </div>
            <div className="brand">
              <Mark />
              <strong>FORGE</strong>
            </div>
            <button type="button" className="new-task" onClick={newTask}>
              <Plus />
              新建任务
            </button>
            <div className="recent">最近任务</div>
            <nav>
              {tasks.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={title === t && !settings ? "selected" : ""}
                  onClick={() => selectTask(t)}
                >
                  <ChatCircle />
                  <span>{t}</span>
                </button>
              ))}
            </nav>
            <button
              type="button"
              className={"settings-link " + (settings ? "selected" : "")}
              onClick={() => {
                setSettings(true);
                setMenu(null);
              }}
            >
              <GearSix />
              设置
            </button>
          </aside>
        )}
        <main>
          <header className="header">
            {!sidebar && (
              <>
                <div className="traffic">
                  <i />
                  <i />
                  <i />
                </div>
                <IB label="展开侧栏" onClick={() => setSidebar(true)}>
                  <Mark />
                </IB>
                <span className="divider" />
              </>
            )}
            <button
              type="button"
              className="workspace"
              title={workspace ? "/Users/mori/codes/forge" : "选择工作区"}
              onClick={() => open("workspace")}
            >
              <FolderSimple />
              <span>{workspace ? "forge" : "选择工作区"}</span>
              <CaretDown size={14} />
            </button>
            <span className="divider" />
            <span className="task-title">
              {settings ? "设置" : empty ? "" : title}
            </span>
            <div className="header-actions">
              {!sidebar && (
                <IB label="设置" onClick={() => setSettings(true)}>
                  <GearSix />
                </IB>
              )}
              <IB
                label="打开工作台"
                onClick={() => {
                  setPanel(!panel);
                  setSettings(false);
                }}
              >
                <SidebarSimple style={{ transform: "scaleX(-1)" }} />
              </IB>
            </div>
          </header>
          {settings ? (
            <section className="settings-page">
              <button
                type="button"
                className="back"
                onClick={() => setSettings(false)}
              >
                <CaretLeft />
                返回对话
              </button>
              <div className="settings-content">
                <h1>设置</h1>
                <p className="subtitle">管理外观与连接。</p>
                <section>
                  <h3>外观</h3>
                  <div className="theme-options">
                    {[
                      ["light", "浅色", Sun],
                      ["dark", "深色", Moon],
                      ["system", "跟随系统", Desktop],
                    ].map(([v, l]) => (
                      <button
                        type="button"
                        key={v}
                        className={theme === v ? "active" : ""}
                        onClick={() => setTheme(v)}
                      >
                        <img
                          className="theme-preview"
                          src={"/theme-" + v + ".png"}
                          alt={l + "界面预览"}
                        />
                        {l}
                        {theme === v && <Check className="theme-check" />}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>语言</h3>
                  <select
                    aria-label="语言"
                    defaultValue="zh"
                    onChange={() => toast("此轮原型以中文参考稿为准。")}
                  >
                    <option value="zh">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </section>
                <section>
                  <h3>连接</h3>
                  <div className="connection">
                    <span className="avatar">
                      <Mark />
                    </span>
                    <div>
                      <strong>Forge API</strong>
                      <p>当前提供商　DeepSeek</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        toast("提供商配置入口：原型未读取或写入凭证。")
                      }
                    >
                      管理配置
                    </button>
                  </div>
                  <div className="connection">
                    <span className="avatar">
                      <Link />
                    </span>
                    <div>
                      <strong>Codex</strong>
                      <p>未连接</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toast("登录需要在正式应用中完成。")}
                    >
                      登录
                    </button>
                  </div>
                </section>
                <section className="web-setting">
                  <div>
                    <h3>网页搜索</h3>
                    <p>按需安装与配置搜索插件。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(false);
                      setMenu("plugins");
                    }}
                  >
                    管理插件
                  </button>
                </section>
              </div>
            </section>
          ) : (
            <>
              <section className={"conversation " + (empty ? "empty" : "")}>
                {empty ? (
                  <div className="welcome">
                    <Mark />
                    <h1>今天想完成什么？</h1>
                    <p>从一个想法开始，让 Forge 帮你完成。</p>
                    <div className="suggestions">
                      {[
                        [
                          Code,
                          "编写代码",
                          "生成、重构或解释代码，\n支持多种编程语言。",
                          "请帮我梳理项目结构并解释核心代码。",
                        ],
                        [
                          FileText,
                          "阅读文档",
                          "总结、提取或查询文档\n内容，快速获取关键信息。",
                          "请阅读项目文档，整理关键内容。",
                        ],
                        [
                          MagnifyingGlass,
                          "研究问题",
                          "深入分析复杂问题，\n提供思路、对比和结论。",
                          "请帮我分析这个问题，并给出可行方案。",
                        ],
                      ].map(([I, t, d, s]) => (
                        <button
                          type="button"
                          key={t}
                          onClick={() => {
                            setDraft(s);
                            input.current?.focus();
                          }}
                        >
                          <I />
                          <strong>{t}</strong>
                          <span>{d}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="thread">
                    <div className="user-message">
                      {message || "调整工作台布局，让输入和操作更集中。"}
                    </div>
                    <div className="assistant-message">
                      <span className="avatar">
                        <Mark />
                      </span>
                      <div className="answer">
                        <p>
                          {running
                            ? "正在检查项目结构…"
                            : message
                              ? "这是原型中的示例回复。你可以继续查看文件、切换模型或探索命令菜单。"
                              : "我会把工作目录放在顶部，将引擎与模型选择移入输入框。"}
                        </p>
                        <button
                          type="button"
                          className="tool-card"
                          onClick={() => setExpanded(!expanded)}
                        >
                          {expanded ? <CaretDown /> : <CaretRight />}
                          <span>已检查 3 个文件</span>
                        </button>
                        {expanded && (
                          <div className="tool-details">
                            {files.map((f) => (
                              <button
                                type="button"
                                key={f}
                                onClick={() => {
                                  setFile(f);
                                  setPanel(true);
                                }}
                              >
                                <FileText />
                                {f}
                                <Check />
                              </button>
                            ))}
                          </div>
                        )}
                        <p>外观设置统一收进设置页，保留简洁的任务空间。</p>
                        {message && (
                          <small className="demo-label">
                            演示内容 · 未调用模型
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
              <div className="composer-wrap">
                <div className="composer">
                  {slash && (
                    <div className="command-menu popover">
                      <div className="menu-heading">
                        命令 <span>Esc 关闭</span>
                      </div>
                      <div
                        className="command-list"
                        role="listbox"
                        id="slash-list"
                      >
                        {filtered.length ? (
                          filtered.map(([c, d], i) => (
                            <button
                              type="button"
                              role="option"
                              aria-selected={i === idx % filtered.length}
                              id={"cmd-" + i}
                              className={
                                i === idx % filtered.length ? "active" : ""
                              }
                              key={c}
                              onMouseEnter={() => setIdx(i)}
                              onClick={() => cmd(c)}
                            >
                              <span>/{c}</span>
                              <span>{d}</span>
                            </button>
                          ))
                        ) : (
                          <p>未找到命令</p>
                        )}
                      </div>
                      <div className="menu-footer">
                        ↑ ↓ 选择　 Tab 补全　 Enter 确认　 Esc 关闭
                      </div>
                    </div>
                  )}
                  {["model", "engine", "permissions", "context"].includes(
                    menu,
                  ) && (
                    <div className={"control-menu popover " + menu}>
                      <div className="menu-heading">
                        {
                          {
                            model: "选择模型",
                            engine: "选择引擎",
                            permissions: "权限与会话授权",
                            context: "上下文用量",
                          }[menu]
                        }
                        <IB label="关闭菜单" onClick={() => setMenu(null)}>
                          <X />
                        </IB>
                      </div>
                      {menu === "model" && (
                        <>
                          <input
                            placeholder="搜索模型…"
                            aria-label="搜索模型"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                          {models
                            .filter((m) =>
                              m.toLowerCase().includes(search.toLowerCase()),
                            )
                            .map((m) => (
                              <button
                                type="button"
                                key={m}
                                onClick={() => {
                                  setModel(m);
                                  setMenu(null);
                                }}
                              >
                                {m}
                                {model === m && <Check />}
                              </button>
                            ))}
                          {!models.some((m) =>
                            m.toLowerCase().includes(search.toLowerCase()),
                          ) && <p>未找到匹配的模型</p>}
                          <small>原型示例列表</small>
                        </>
                      )}
                      {menu === "engine" &&
                        ["Forge", "Codex"].map((e) => (
                          <button
                            type="button"
                            key={e}
                            onClick={() => {
                              setEngine(e);
                              setModel(
                                e === "Forge" ? "DeepSeek V4" : "GPT-5.5",
                              );
                              setMenu(null);
                            }}
                          >
                            {e}
                            {engine === e && <Check />}
                          </button>
                        ))}
                      {menu === "permissions" && (
                        <>
                          <p>按需审批</p>
                          <small>需要授权的操作会在执行前请求确认。</small>
                          <hr />
                          <p>会话授权：无</p>
                          <button
                            type="button"
                            onClick={() => toast("当前没有可撤销的会话授权。")}
                          >
                            撤销会话授权
                          </button>
                        </>
                      )}
                      {menu === "context" && (
                        <>
                          <p className="context-number">
                            {empty ? "—" : "24%"} <small>已用</small>
                          </p>
                          <progress value={empty ? 0 : 24} max="100" />
                          <p>
                            {empty
                              ? "用量暂不可用"
                              : "已用 24,000 / 100,000 tokens"}
                          </p>
                          <small>
                            {empty
                              ? "开始任务后显示上下文用量。"
                              : "剩余 76% · 原型示例数据"}
                          </small>
                          <button type="button" onClick={() => cmd("compact")}>
                            预览上下文压缩
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <textarea
                    ref={input}
                    aria-label="描述任务"
                    role="combobox"
                    aria-expanded={slash}
                    aria-controls={slash ? "slash-list" : undefined}
                    aria-activedescendant={slash ? "cmd-" + idx : undefined}
                    placeholder="描述任务，或输入 / 查看命令"
                    value={draft}
                    onKeyDown={keys}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setIdx(0);
                      setMenu(
                        e.target.value.startsWith("/") ? "commands" : null,
                      );
                    }}
                  />
                  <div className="composer-controls">
                    <div className="composer-left">
                      <IB label="添加文件副本" onClick={() => open("attach")}>
                        <Plus />
                      </IB>
                      <button type="button" onClick={() => open("permissions")}>
                        <Shield />
                        按需审批
                        <CaretDown />
                      </button>
                    </div>
                    <div className="composer-right">
                      <button
                        type="button"
                        className="context"
                        onClick={() => open("context")}
                        title={
                          empty
                            ? "用量暂不可用"
                            : "已用 24,000 / 100,000 tokens · 剩余 76%"
                        }
                      >
                        <span className={"ring " + (empty ? "unknown" : "")} />
                        <span>{empty ? "—" : "24%"}</span>
                      </button>
                      <span className="control-label">引擎</span>
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => open("engine")}
                      >
                        {engine}
                        <CaretDown />
                      </button>
                      <span className="control-label">模型</span>
                      <button
                        type="button"
                        className="model-button"
                        disabled={running}
                        onClick={() => open("model")}
                      >
                        <span>{model}</span>
                        <CaretDown />
                      </button>
                      <IB
                        label={running ? "停止生成" : "发送消息"}
                        disabled={!running && !draft.trim()}
                        onClick={
                          running
                            ? () => {
                                clearTimeout(timer.current);
                                setRunning(false);
                                toast("演示已停止。");
                              }
                            : send
                        }
                        className="send"
                      >
                        {running ? <Stop weight="fill" /> : <ArrowUp />}
                      </IB>
                    </div>
                  </div>
                </div>
                <div className="composer-hint">
                  交互原型 · ⌘ / Ctrl + Enter 发送
                </div>
              </div>
            </>
          )}
        </main>
        {panel && !settings && (
          <aside className="workbench">
            <div className="panel-header">
              <strong>工作台</strong>
              <IB label="关闭工作台" onClick={() => setPanel(false)}>
                <X />
              </IB>
            </div>
            <div className="tabs">
              {["文件", "变更", "活动"].map((t) => (
                <button
                  type="button"
                  key={t}
                  className={t === tab ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "文件" ? (
              <>
                <div className="file-tree">
                  <div>
                    <CaretDown />
                    <FolderSimple />
                    forge
                  </div>
                  <div className="indent">
                    <CaretDown />
                    <FolderSimple />
                    src
                  </div>
                  <div className="indent2">
                    <CaretDown />
                    <FolderSimple />
                    renderer
                  </div>
                  {files.map((f) => (
                    <button
                      type="button"
                      key={f}
                      className={"indent3 " + (f === file ? "active" : "")}
                      onClick={() => setFile(f)}
                    >
                      <FileText />
                      {f}
                    </button>
                  ))}
                  <div className="indent">
                    <CaretRight />
                    <FolderSimple />
                    main
                  </div>
                  <div className="indent">
                    <CaretRight />
                    <FolderSimple />
                    shared
                  </div>
                  <div>
                    <Code />
                    package.json
                  </div>
                </div>
                <div className="file-preview">
                  <div>
                    <FileText />
                    <strong>{file}</strong>
                    <IB
                      label="复制代码"
                      onClick={() =>
                        navigator.clipboard
                          ?.writeText(code)
                          .then(() => toast("已复制示例代码。"))
                          .catch(() => toast("浏览器未允许剪贴板访问。"))
                      }
                    >
                      <Copy />
                    </IB>
                  </div>
                  <pre>
                    {code.split("\n").map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: This immutable sample is keyed by file and line number; lines are never reordered.
                      <div key={`${file}:${i}`}>
                        <span>{i + 1}</span>
                        <code>{line || " "}</code>
                      </div>
                    ))}
                  </pre>
                </div>
              </>
            ) : tab === "变更" ? (
              <div className="panel-content">
                <h3>相对基线的变更</h3>
                <p>演示工作区 · 1 个文件</p>
                <button
                  type="button"
                  className="changed-file"
                  onClick={() => {
                    setTab("文件");
                    setFile("studio.css");
                  }}
                >
                  <FileText />
                  studio.css <span>+3 −1</span>
                </button>
                <pre className="diff">
                  − padding: 32px;{"\n"}+ padding: 24px;{"\n"}+ gap: 12px;{"\n"}
                  + border-radius: 15px;
                </pre>
                <small>示例差异，不代表 Agent 实际修改。</small>
              </div>
            ) : (
              <div className="panel-content">
                <h3>任务活动</h3>
                {["读取项目结构", "检查 3 个文件", "准备布局建议"].map(
                  (t, i) => (
                    <div className="activity" key={t}>
                      <Check />
                      <div>
                        {t}
                        <small>10:2{i} · 演示记录</small>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {["workspace", "attach", "help", "resume", "plugins"].includes(menu) && (
        <div className="modal-backdrop">
          <button
            type="button"
            className="modal-dismiss"
            aria-label="关闭对话框"
            onClick={() => setMenu(null)}
          />
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="操作面板"
          >
            <div className="menu-heading">
              {
                {
                  workspace: "选择工作区",
                  attach: "添加文件副本",
                  help: "命令与能力",
                  resume: "恢复历史任务",
                  plugins: "搜索插件",
                }[menu]
              }
              <IB label="关闭对话框" onClick={() => setMenu(null)}>
                <X />
              </IB>
            </div>
            {menu === "workspace" ? (
              <>
                <p>选择演示工作区，继续体验任务流程。</p>
                <button
                  type="button"
                  className="modal-row"
                  onClick={() => {
                    setWorkspace(true);
                    setMenu(null);
                  }}
                >
                  <FolderSimple />
                  forge <small>演示工作区</small>
                  <Check />
                </button>
              </>
            ) : menu === "attach" ? (
              <>
                <p>导入文件副本到当前工作区。</p>
                <label className="file-input">
                  <Plus />
                  选择文件
                  <input
                    type="file"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        toast(
                          "已选择 " +
                            e.target.files[0].name +
                            "（仅演示，未复制文件）",
                        );
                        setMenu(null);
                      }
                    }}
                  />
                </label>
              </>
            ) : menu === "resume" ? (
              tasks.map((t) => (
                <button
                  type="button"
                  className="modal-row"
                  key={t}
                  onClick={() => selectTask(t)}
                >
                  <ChatCircle />
                  {t}
                  <CaretRight />
                </button>
              ))
            ) : menu === "plugins" ? (
              <>
                <p>web-tools</p>
                <small>未安装 · 搜索能力需要显式安装、配置和授权。</small>
                <button
                  type="button"
                  className="modal-row"
                  onClick={() => toast("原型演示：安装流程未连接服务。")}
                >
                  查看安装流程
                </button>
              </>
            ) : (
              <div className="help-list">
                {commands.map(([c, d]) => (
                  <button type="button" key={c} onClick={() => cmd(c)}>
                    <code>/{c}</code>
                    <span>{d}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
