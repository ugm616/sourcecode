// editor.js - Monaco wrapper, tabs, dirty tracking
"use strict";

const Editor = (() => {
  let monacoReady = null;
  const editors = new Map();   // path -> monaco editor model
  let activePath = null;
  const tabs = [];             // ordered array of open paths
  const dirty = new Set();     // paths with unsaved changes
  let container = null;
  let editorInstance = null;

  function languageFor(path) {
    const ext = path.split(".").pop().toLowerCase();
    const map = {
      js: "javascript", mjs: "javascript", cjs: "javascript",
      ts: "typescript", jsx: "javascript", tsx: "typescript",
      html: "html", htm: "html", css: "css", scss: "scss", less: "less",
      json: "json", md: "markdown", py: "python", rb: "ruby",
      go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp",
      cs: "csharp", php: "php", sh: "shell", bash: "shell", yml: "yaml",
      yaml: "yaml", xml: "xml", sql: "sql", txt: "plaintext"
    };
    return map[ext] || "plaintext";
  }

  function loadMonaco() {
    if (monacoReady) return monacoReady;
    monacoReady = new Promise((resolve, reject) => {
      require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs" } });
      window.MonacoEnvironment = { getWorkerUrl: () => URL.createObjectURL(new Blob([`
        self.MonacoEnvironment = { baseUrl: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/" };
        importScripts("https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/base/worker/workerMain.js");
      `], { type: "text/javascript" })) };
      require(["vs/editor/editor.main"], resolve, reject);
    });
    return monacoReady;
  }

  function defineMonacoThemes() {
    monaco.editor.defineTheme("ox-amber", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "ffb454", fontStyle: "bold" },
        { token: "string", foreground: "e8c98a" },
        { token: "comment", foreground: "7a6649", fontStyle: "italic" },
        { token: "number", foreground: "ffcd7d" },
        { token: "type", foreground: "e08d28" },
        { token: "function", foreground: "ffb454" },
        { token: "variable", foreground: "e8c98a" }
      ],
      colors: {
        "editor.background": "#0d0b08",
        "editor.foreground": "#e8c98a",
        "editorLineNumber.foreground": "#7a6649",
        "editor.selectionBackground": "#4a3b2880",
        "editor.lineHighlightBackground": "#1c181380",
        "editorCursor.foreground": "#ffb454",
        "editorWidget.background": "#15120e",
        "editorWidget.border": "#2e2720"
      }
    });

    monaco.editor.defineTheme("vs-theme", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "6c8cff", fontStyle: "bold" },
        { token: "string", foreground: "a8c0ff" },
        { token: "comment", foreground: "5a6478", fontStyle: "italic" },
        { token: "number", foreground: "85a1ff" },
        { token: "type", foreground: "5d7df2" },
        { token: "function", foreground: "85a1ff" }
      ],
      colors: {
        "editor.background": "#0f1117",
        "editor.foreground": "#e8eaf0",
        "editorLineNumber.foreground": "#8b93a3",
        "editor.selectionBackground": "#3c4a7a80",
        "editor.lineHighlightBackground": "#1a1e2880",
        "editorCursor.foreground": "#6c8cff",
        "editorWidget.background": "#14171f",
        "editorWidget.border": "#262b36"
      }
    });

    monaco.editor.defineTheme("phosphor", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "4ade80", fontStyle: "bold" },
        { token: "string", foreground: "b7f0c0" },
        { token: "comment", foreground: "3a6644", fontStyle: "italic" },
        { token: "number", foreground: "6eed9a" },
        { token: "type", foreground: "22c55e" },
        { token: "function", foreground: "4ade80" }
      ],
      colors: {
        "editor.background": "#0a0e0a",
        "editor.foreground": "#b7f0c0",
        "editorLineNumber.foreground": "#3a6644",
        "editor.selectionBackground": "#1a4a2880",
        "editor.lineHighlightBackground": "#0e130e80",
        "editorCursor.foreground": "#4ade80",
        "editorWidget.background": "#0e130e",
        "editorWidget.border": "#1f2b1f"
      }
    });

    monaco.editor.defineTheme("paper", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "8e2f2f", fontStyle: "bold" },
        { token: "string", foreground: "276748" },
        { token: "comment", foreground: "9a8c7c", fontStyle: "italic" },
        { token: "number", foreground: "7a2626" },
        { token: "type", foreground: "8e2f2f" },
        { token: "function", foreground: "b03e3e" }
      ],
      colors: {
        "editor.background": "#faf6ee",
        "editor.foreground": "#1c1a17",
        "editorLineNumber.foreground": "#9a8c7c",
        "editor.selectionBackground": "#ccc4b080",
        "editor.lineHighlightBackground": "#f2ede380",
        "editorCursor.foreground": "#8e2f2f",
        "editorWidget.background": "#f2ede3",
        "editorWidget.border": "#ccc4b0"
      }
    });
  }

  function applyTheme(name) {
    if (!editorInstance) return;
    const themeMap = { "ox-amber": "ox-amber", "vs": "vs-theme", "phosphor": "phosphor", "paper": "paper" };
    monaco.editor.setTheme(themeMap[name] || "ox-amber");
  }

  async function init(el) {
    container = el;
    await loadMonaco();
    defineMonacoThemes();
    monaco.editor.setTheme("ox-amber");
    editorInstance = monaco.editor.create(el, {
      value: "",
      language: "plaintext",
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 14,
      fontFamily: '"Courier New", Courier, monospace',
      wordWrap: "on",
      renderWhitespace: "selection"
    });
    editorInstance.onDidChangeCursorPosition((e) => {
      App.setStatusRight(`Ln ${e.position.lineNumber}, Col ${e.position.column}`);
    });
  }

  // Show a file's model in the single editor instance
  function show(path) {
    if (!editorInstance) return;
    const model = path ? getModel(path) : null;
    if (model) {
      editorInstance.setModel(model);
      editorInstance.focus();
    } else {
      if (!show._blankModel) show._blankModel = monaco.editor.createModel("");
      editorInstance.setModel(show._blankModel);
    }
  }

  function getModel(path) {
    return editors.get(path) || null;
  }

  function openTab(path, content) {
    if (!editors.has(path)) {
      const model = monaco.editor.createModel(content ?? "", languageFor(path));
      model.onDidChangeContent(() => {
        if (!dirty.has(path)) {
          dirty.add(path);
          App.renderTabs();
        }
        scheduleSave(path);
      });
      editors.set(path, model);
    }
    if (!tabs.includes(path)) tabs.push(path);
    setActiveTab(path);
  }

  function setActiveTab(path) {
    activePath = path;
    show(path);
    App.renderTabs();
    App.renderTree();
    App.toggleWelcome(!path);
    persistSession();
  }

  function closeTab(path) {
    const i = tabs.indexOf(path);
    if (i === -1) return;
    if (dirty.has(path)) flushSave(path);
    tabs.splice(i, 1);
    if (activePath === path) {
      activePath = tabs[Math.min(i, tabs.length - 1)] || null;
      setActiveTab(activePath);
    } else {
      App.renderTabs();
      persistSession();
    }
  }

  // ---- debounced auto-save to VFS ----
  const saveTimers = new Map();
  function scheduleSave(path) {
    clearTimeout(saveTimers.get(path));
    saveTimers.set(path, setTimeout(() => flushSave(path), 800));
  }
  async function flushSave(path) {
    clearTimeout(saveTimers.get(path));
    saveTimers.delete(path);
    const model = editors.get(path);
    if (!model) return;
    await Store.putFile(path, model.getValue());
    if (dirty.has(path)) {
      dirty.delete(path);
      App.renderTabs();
    }
  }

  async function renameFile(oldPath, newPath) {
    const content = await Store.getFile(oldPath);
    await Store.putFile(newPath, content);
    await Store.deleteFile(oldPath);
    if (editors.has(oldPath)) {
      const wasActive = activePath === oldPath;
      closeTabHard(oldPath);
      openTab(newPath, content);
      if (wasActive) setActiveTab(newPath);
    }
  }

  function closeTabHard(path) {
    const model = editors.get(path);
    if (model) model.dispose();
    editors.delete(path);
    dirty.delete(path);
    const i = tabs.indexOf(path);
    if (i !== -1) tabs.splice(i, 1);
    if (activePath === path) activePath = null;
  }

  async function deleteFile(path) {
    closeTabHard(path);
    await Store.deleteFile(path);
    App.renderTabs();
    setActiveTab(activePath);
  }

  function getContent(path) {
    const model = editors.get(path);
    return model ? model.getValue() : null;
  }

  function setValue(path, content) {
    const model = editors.get(path);
    if (model && model.getValue() !== content) {
      model.setValue(content);   // marks dirty; auto-save will persist
    }
  }

  function persistSession() {
    Store.saveSession({ tabs: [...tabs], activePath });
  }

  function getSessionState() {
    return { tabs: [...tabs], activePath };
  }

  function restoreSession(sessionState) {
    if (!sessionState || !Array.isArray(sessionState.tabs)) return;
    return sessionState; // consumed by app.js after files are loaded
  }

  return {
    init, show, openTab, closeTab, setActiveTab, getModel, getContent, setValue,
    renameFile, deleteFile, getSessionState, restoreSession, applyTheme,
    isDirty: (p) => dirty.has(p),
    isActive: (p) => activePath === p,
    get tabs() { return [...tabs]; },
    get activePath() { return activePath; }
  };
})();
