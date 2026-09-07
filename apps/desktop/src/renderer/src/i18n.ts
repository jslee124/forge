import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type Locale = "en" | "zh-CN";

export const resources = {
  en: {
    translation: {
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
