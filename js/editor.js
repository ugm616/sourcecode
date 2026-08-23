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

  async function init(el) {
    container = el;
    await loadMonaco();
    monaco.editor.setTheme("vs-dark");
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
    renameFile, deleteFile, getSessionState, restoreSession,
    isDirty: (p) => dirty.has(p),
    isActive: (p) => activePath === p,
    get tabs() { return [...tabs]; },
    get activePath() { return activePath; }
  };
})();
