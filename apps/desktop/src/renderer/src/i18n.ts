import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type Locale = "en" | "zh-CN";

export const resources = {
  en: {
    translation: {
      live: {
        web: {
          title: "Web research",
          bundle: "Available bundle",
          install: "Install bundled plugin",
          installed: "Plugin installed",
          enable: "Enable web-tools in the shared Forge user configuration",
          provider: "Default service",
          actual: "Service selected for the next request",
          keyReady: "Brave key is configured in the Agent environment.",
          keyMissing:
            "No Brave key in the Agent environment. Set BRAVE_SEARCH_API_KEY before launching Forge to use Brave; the key is never shown here.",
          scope:
            "Optional Forge Engine plugin. Installation alone does not enable it. Every network request requires approval. Codex uses its own tools; its search support and source metadata are not verified by this plugin.",
          auto: "Auto selects Brave when a key exists, otherwise DuckDuckGo. A failed request never switches services. Tool activity shows the actual requested service.",
          report:
            "Ask for a sourced Markdown report and, if needed, a .md file. Reports distinguish snippets, retrieved text, truncation and failed reads; inspect source links beside claims and the Sources section.",
        },
        errors: {
          "web-settings-invalid":
            "Web plugin settings are invalid. Choose a service to repair them; no search can run until repaired.",
          "web-bundle-unavailable":
            "The bundled web plugin is missing. Rebuild or reinstall the desktop app.",
          "web-plugin-exists":
            "A web-tools directory already exists; your plugin was preserved. Remove or move it yourself before installing the bundled version.",
          "web-plugin-missing":
            "Install the web plugin before enabling or configuring it.",
          "workspace-unavailable":
            "The workspace directory is missing or inaccessible. Choose an existing directory.",
          "workspace-changed":
            "The workspace boundary has changed. Restore the original directory before resuming.",
          "auto-workspace-boundary":
            "An ancestor Git repository would expose more than this task's directory. Choose a separate workspace.",
          "session-busy":
            "This session is occupied. Wait for the other run to finish.",
          "session-conflict":
            "The saved session changed. Reload it before continuing.",
          "session-storage-failed":
            "The session could not be read or saved. Check disk access and session integrity; reload before retrying.",
          "configuration-invalid":
            "Forge configuration is invalid. Correct it before retrying.",
          "outside-workspace": "The file is outside the selected workspace.",
          outside_workspace:
            "The file resolves outside the selected workspace.",
          "already-exists":
            "The destination already exists; choose whether to replace it.",
          limit_reached: "The file exceeds the supported preview limit.",
          io_error: "The file could not be read or copied.",
          "source-changed":
            "The source changed while it was being copied. Nothing was replaced; retry from the current file.",
        },

        send: "Send",
        "new": "New task",
        folder: "Choose workspace",
        automatic: "A private workspace is created on submission",
        engine: "Engine",
        model: "Model",
        defaultModel: "Codex default",
        context: "Context",
        error:
          "The operation failed. Check configuration, directory access and session ownership; inspect activity details.",
        nativeConfig:
          "Forge reads your existing Forge configuration and credentials inside the Agent process.",
        authCheck: "Check status and models",
        login: "Sign in to Codex",
        cancelLogin: "Cancel sign-in",
        openLogin: "Open sign-in page",
        codexLimits:
          "Codex uses its own tools and sandbox. Command/file approval is supported; full patches, sources and tool counts are not provided by this bridge.",
        approval: "Approve this action once",
        switchNotice:
          "Switching engines carries text history only; tool state and approvals do not transfer.",
        stopping: "Stopping…",
        stop: "Stop",
        compact: "Compact context",
        activity: "Run activity",
        verification:
          "Completion reports the run outcome. Inspect tool output for actual verification; changes are not rolled back on cancellation.",
        addMaterial: "Add file copy",
        files: "Files and previews",
        filePath: "Workspace-relative file path",
        preview: "Preview",
        reveal: "Show in folder",
        saveAs: "Save as…",
        previewLimited: "Partial preview — the source contains more content.",
        changes: "Changes since baseline",
        baseline: "Comparison baseline",
        baselines: {
          "task-start": "task start",
          "resume-time": "resume time",
          "workspace-selection": "workspace selection",
          unavailable: "unavailable",
        },
        refreshChanges: "Refresh change review",
        noChanges: "No changes since the task baseline.",
        reviewLimits: {
          "no-baseline":
            "No in-memory baseline is available; no changes are attributed.",
          "no-agent-attribution":
            "These are baseline changes, not claims of Agent authorship.",
          "concurrent-edits-indistinguishable":
            "Concurrent user or external edits cannot be separated from engine edits.",
          "bounded-snapshot":
            "The bounded snapshot omitted some content; those entries have metadata only.",
        },
        engineCoverage: {
          "approval-plus-baseline":
            "approval diffs are separate; this is the cumulative workspace comparison.",
          "baseline-only":
            "no authoritative per-edit patch is available; only the workspace comparison is shown.",
        },
        changeStatus: {
          added: "Added",
          modified: "Modified",
          deleted: "Deleted",
        },
        bytes: "{{count}} bytes",
        imageScope:
          "Preview is available; model analysis depends on the selected engine's image-input support.",
        rowRange:
          "Rows {{start}}–{{end}} of {{total}} · preview range; analysis uses the full parsed file",
        calculation:
          "{{operation}} column {{column}}: {{value}} · {{count}} rows calculated",
        noNumericValues: "no numeric values",
        rowError: "Row {{row}}: {{message}}",
        pageRange: "Pages {{start}}–{{end}} of {{total}}",
        page: "Page {{page}}",
        noPdfText: "No extractable text (OCR was not performed).",
        diffUnavailable: "Binary or oversized file: content diff unavailable.",
        ready: "Ready",
        running: "Running",
        completed: "Completed",
        cancelled: "Stopped",
        failed: "Failed",
        interrupted: "Interrupted",
        auth: {
          unknown: "Status not checked",
          unavailable: "Codex unavailable; install/configure the Codex CLI",
          "signed-out": "Not signed in",
          authenticated: "Signed in",
          "signing-in": "Signing in…",
          failed: "Sign-in failed",
        },
      },
      common: {
        forge: "Forge",
        simulation: "Interactive prototype · no real actions",
        newTask: "New task",
        recentTasks: "Recent tasks",
        project: "Project",
        settings: "Settings",
        home: "Home",
        close: "Close",
        open: "Open",
        approve: "Approve",
        deny: "Deny",
        retry: "Retry simulation",
      },
      status: {
        interrupted: "Run interrupted: Agent disconnected",
        running: "Running",
        approval: "Needs approval",
        failed: "Failed",
        stopped: "Stopped",
        completed: "Completed",
        ready: "Ready",
        unavailable: "Agent resources unavailable",
      },
      home: {
        eyebrow: "Start something useful",
        title: "What would you like Forge to work on?",
        subtitle:
          "Bring a folder or start globally. This prototype only simulates the workflow.",
        placeholder: "Describe the result you want…",
        folder: "Working folder",
        chooseFolder: "Choose folder",
        material: "Add material",
        send: "Create simulated task",
        examples: "Try an example",
        exampleCode: "Explain the architecture of this repository",
        exampleFiles: "Review a change and summarize the risks",
        exampleResearch: "Research a topic and create a sourced report",
      },
      workbench: {
        location: "Working location",
        changes: "Changes",
        files: "files",
        hidePanel: "Hide results panel",
        showPanel: "Show results panel",
        followup: "Ask a follow-up or add more context…",
        stop: "Stop",
        send: "Send",
        model: "Model",
        engine: "Engine",
        activity: "Activity",
        userPrompt:
          "Add a login page that follows our existing components and auth API.",
        assistantLead:
          "I’ll add the login page and keep the current routing and authentication behavior intact.",
        implementation: "Implementation",
        longBody:
          "The form uses the existing input and button patterns, validates both fields, and keeps error feedback near the action. On success it returns to the original destination. No authentication contract was changed.",
        checkStructure: "Project structure reviewed",
        buildPage: "Login page in progress",
        verify: "Verification pending",
        approvalTitle: "Permission required",
        approvalBody:
          "The simulated agent wants to run the test command below. No command will run in this prototype.",
        failureTitle: "Research source unavailable",
        failureBody:
          "One source could not be reached. The simulated report was not marked complete, and no network request was made.",
        stoppedBody:
          "The simulated run stopped. No additional action was dispatched.",
        completedBody:
          "Simulation completed. This does not claim the task or tests were verified.",
      },
      settings: {
        title: "Settings",
        general: "General",
        language: "Language",
        languageHelp:
          "Changes interface text only. Task content and drafts stay untouched.",
        followSystem: "Follow system",
        chinese: "简体中文",
        english: "English",
        appearance: "Appearance",
        appearanceHelp:
          "The D03 prototype uses the selected light visual direction.",
        about: "About this prototype",
        aboutHelp:
          "All runs, approvals, failures, folders, and file changes shown here are simulated.",
      },
      tasks: {
        login: "Add login page",
        refactor: "Refactor form validation",
        research: "Research Next.js middleware",
        generated: "Untitled simulated task",
      },
      errors: { emptyPrompt: "Describe a task before continuing." },
    },
  },
  "zh-CN": {
    translation: {
      live: {
        web: {
          title: "联网研究",
          bundle: "随应用提供的版本",
          install: "安装随应用提供的插件",
          installed: "插件已安装",
          enable: "在 Forge 共享用户配置中启用 web-tools",
          provider: "默认搜索服务",
          actual: "下一次请求将选择的服务",
          keyReady: "Agent 环境中已配置 Brave 密钥。",
          keyMissing:
            "Agent 环境中没有 Brave 密钥。使用 Brave 前请在启动 Forge 的环境中设置 BRAVE_SEARCH_API_KEY；此处不会显示密钥。",
          scope:
            "可选的 Forge 引擎插件。安装不会自动启用，每次网络请求都需要审批。Codex 使用自己的工具；此插件的验证不代表 Codex 搜索或来源字段已验证。",
          auto: "Auto 在有密钥时选择 Brave，否则选择 DuckDuckGo；请求失败不会切换服务。工具活动中可查看实际请求的服务。",
          report:
            "可以要求生成带来源的 Markdown 报告并保存为 .md 文件。报告区分搜索摘要、已读取正文、截断与读取失败；请检查事实旁的来源链接及来源清单。",
        },
        errors: {
          "web-settings-invalid":
            "搜索插件配置无效。请重新选择服务修复配置；修复前搜索无法执行。",
          "web-bundle-unavailable":
            "未找到随应用提供的搜索插件，请重新构建或安装桌面应用。",
          "web-plugin-exists":
            "web-tools 目录已存在，已保留原插件。安装内置版本前请自行移走或删除原目录。",
          "web-plugin-missing": "请先安装搜索插件，再启用或配置。",
          "workspace-unavailable": "工作目录缺失或无法访问，请选择现有目录。",
          "workspace-changed": "工作空间边界已变化，请恢复原目录后再续聊。",
          "auto-workspace-boundary":
            "祖先 Git 仓库会扩大自动目录的访问范围，请选择独立工作空间。",
          "session-busy": "会话已被占用，请等待另一运行结束。",
          "session-conflict": "已保存的会话发生变化，请重新加载后继续。",
          "session-storage-failed":
            "无法读取或保存会话，请检查磁盘权限和会话文件，重新加载后重试。",
          "configuration-invalid": "Forge 配置无效，请修正后重试。",
          "outside-workspace": "该文件不在所选工作空间内。",
          outside_workspace: "该文件解析后位于工作空间之外。",
          "already-exists": "目标文件已存在，请明确选择是否覆盖。",
          limit_reached: "文件超过支持的预览上限。",
          io_error: "无法读取或复制文件。",
          "source-changed":
            "复制过程中源文件发生变化。没有覆盖任何目标，请基于当前文件重试。",
        },

        send: "发送",
        "new": "新任务",
        folder: "选择工作空间",
        automatic: "提交时创建独立工作空间",
        engine: "引擎",
        model: "模型",
        defaultModel: "Codex 默认模型",
        context: "上下文",
        error:
          "操作失败。请检查配置、目录权限和会话占用，查看运行活动中的详情。",
        nativeConfig: "Forge 在 Agent 进程中读取已有的 Forge 配置和凭据。",
        authCheck: "检查状态与模型",
        login: "登录 Codex",
        cancelLogin: "取消登录",
        openLogin: "打开登录页面",
        codexLimits:
          "Codex 使用自己的工具与沙箱。支持命令/文件审批；当前桥接不提供完整补丁、来源和工具计数。",
        approval: "批准这一次操作",
        switchNotice: "跨引擎续聊只携带文本历史，不传递工具状态和审批授权。",
        stopping: "正在停止…",
        stop: "停止",
        compact: "压缩上下文",
        activity: "运行活动",
        verification:
          "完成状态表示运行结果；验证依据请查看工具输出。取消不会回滚已发生的修改。",
        addMaterial: "添加文件副本",
        files: "文件与预览",
        filePath: "工作空间相对路径",
        preview: "预览",
        reveal: "在文件夹中显示",
        saveAs: "另存为…",
        previewLimited: "当前为部分预览，源文件还有更多内容。",
        changes: "比较基线后的更改",
        baseline: "比较基线",
        baselines: {
          "task-start": "任务开始时",
          "resume-time": "恢复会话时",
          "workspace-selection": "选择工作空间时",
          unavailable: "不可用",
        },
        refreshChanges: "刷新变更审查",
        noChanges: "任务基线之后没有更改。",
        reviewLimits: {
          "no-baseline": "当前没有内存中的比较基线，因此不会归属任何更改。",
          "no-agent-attribution":
            "这些只是基线后的变化，不表示它们都由 Agent 产生。",
          "concurrent-edits-indistinguishable":
            "无法把同期用户或外部修改与引擎修改分离。",
          "bounded-snapshot": "有界快照省略了部分内容；这些条目只提供元数据。",
        },
        engineCoverage: {
          "approval-plus-baseline":
            "单次审批差异单独显示；这里展示累计工作空间比较。",
          "baseline-only": "没有权威的逐次编辑补丁，只展示工作空间基线比较。",
        },
        changeStatus: { added: "新增", modified: "修改", deleted: "删除" },
        bytes: "{{count}} 字节",
        imageScope: "可进行预览；模型分析能力取决于所选引擎是否支持图片输入。",
        rowRange:
          "第 {{start}}–{{end}} 行，共 {{total}} 行；预览为局部，分析使用完整解析结果",
        calculation:
          "第 {{column}} 列 {{operation}}：{{value}}；实际计算 {{count}} 行",
        noNumericValues: "没有数值",
        rowError: "第 {{row}} 行：{{message}}",
        pageRange: "第 {{start}}–{{end}} 页，共 {{total}} 页",
        page: "第 {{page}} 页",
        noPdfText: "没有可提取文字（未执行 OCR）。",
        diffUnavailable: "二进制或超大文件：无法提供内容差异。",
        ready: "就绪",
        running: "运行中",
        completed: "已完成",
        cancelled: "已停止",
        failed: "失败",
        interrupted: "已中断",
        auth: {
          unknown: "尚未检查状态",
          unavailable: "Codex 不可用，请安装或配置 Codex CLI",
          "signed-out": "未登录",
          authenticated: "已登录",
          "signing-in": "正在登录…",
          failed: "登录失败",
        },
      },
      common: {
        forge: "Forge",
        simulation: "交互原型 · 不执行真实操作",
        newTask: "新建任务",
        recentTasks: "最近任务",
        project: "项目",
        settings: "设置",
        home: "首页",
        close: "关闭",
        open: "打开",
        approve: "批准",
        deny: "拒绝",
        retry: "重新模拟",
      },
      status: {
        interrupted: "运行中断：Agent 连接已断开",
        running: "正在执行",
        approval: "需要批准",
        failed: "失败",
        stopped: "已停止",
        completed: "已完成",
        ready: "就绪",
        unavailable: "Agent 资源不可用",
      },
      home: {
        eyebrow: "开始一件有用的事",
        title: "你想让 Forge 完成什么？",
        subtitle:
          "可以选择工作目录，也可以从全局任务开始。本原型只模拟工作流程。",
        placeholder: "描述你想得到的结果……",
        folder: "工作目录",
        chooseFolder: "选择目录",
        material: "添加材料",
        send: "创建模拟任务",
        examples: "试试这些示例",
        exampleCode: "解释这个仓库的架构",
        exampleFiles: "审查一项改动并总结风险",
        exampleResearch: "研究一个主题并生成带来源的报告",
      },
      workbench: {
        location: "工作位置",
        changes: "更改",
        files: "个文件",
        hidePanel: "收起结果面板",
        showPanel: "展开结果面板",
        followup: "补充需求或添加上下文……",
        stop: "停止",
        send: "发送",
        model: "模型",
        engine: "引擎",
        activity: "活动",
        userPrompt: "帮我增加一个登录页面，沿用现有组件与认证接口。",
        assistantLead: "我会为项目增加登录页面，并保持现有路由和认证行为不变。",
        implementation: "实现内容",
        longBody:
          "表单沿用现有输入框和按钮样式，对两个字段进行校验，并在操作位置附近显示错误反馈。成功后返回原目标页面，没有改变认证契约。",
        checkStructure: "已查看项目结构",
        buildPage: "正在实现登录页面",
        verify: "等待验证",
        approvalTitle: "需要你的许可",
        approvalBody:
          "模拟 Agent 想运行下面的测试命令。本原型不会执行任何命令。",
        failureTitle: "研究来源不可用",
        failureBody:
          "一个来源无法访问。模拟报告未被标为完成，并且没有发起网络请求。",
        stoppedBody: "模拟运行已停止，没有派发后续操作。",
        completedBody: "模拟已完成，但这不代表任务目标或测试已经验证。",
      },
      settings: {
        title: "设置",
        general: "通用",
        language: "语言",
        languageHelp: "只改变界面文字；任务内容和草稿保持不变。",
        followSystem: "跟随系统",
        chinese: "简体中文",
        english: "English",
        appearance: "外观",
        appearanceHelp: "D03 原型采用已确定的浅色视觉方向。",
        about: "关于本原型",
        aboutHelp: "这里展示的运行、审批、失败、目录和文件改动全部是模拟内容。",
      },
      tasks: {
        login: "添加登录页面",
        refactor: "重构表单校验",
        research: "研究 Next.js 中间件",
        generated: "未命名模拟任务",
      },
      errors: { emptyPrompt: "请先描述任务。" },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "zh-CN",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
