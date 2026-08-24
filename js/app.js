// app.js - UI wiring and application logic
"use strict";

const App = (() => {
  let files = [];          // in-memory mirror of VFS [{path, content}]
  let chatHistory = [];    // [{role, content}] user/assistant only
  let busy = false;

  const $ = (sel) => document.querySelector(sel);

  // ================= toasts =================
  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function setStatusLeft(text) { $("#status-left").textContent = text; }
  function setStatusRight(text) {
    let el = $("#status-pos");
    if (!el) {
      el = document.createElement("span");
      el.id = "status-pos";
      $("#statusbar").insertBefore(el, $("#status-model"));
    }
    el.textContent = text;
  }

  // ================= settings =================
  function getSettings() { return Store.getSettings(); }

  function openSettings() {
    const s = getSettings();
    $("#set-apikey").value = s.apiKey || "";
    $("#set-model").value = s.model || AI.DEFAULT_MODEL;
    $("#set-ghtoken").value = s.ghToken || "";
    $("#set-ghrepo").value = s.ghRepo || "";
    $("#set-ghbranch").value = s.ghBranch || "";
    $("#settings-modal").showModal();
  }

  function saveSettingsFromForm() {
    Store.saveSettings({
      apiKey: $("#set-apikey").value.trim(),
      model: $("#set-model").value.trim() || AI.DEFAULT_MODEL,
      ghToken: $("#set-ghtoken").value.trim(),
      ghRepo: $("#set-ghrepo").value.trim(),
      ghBranch: $("#set-ghbranch").value.trim()
    });
    updateConnStatus();
    toast("Settings saved", "ok");
  }

  function updateConnStatus() {
    const s = getSettings();
    const el = $("#status-conn");
    if (s.apiKey) {
      el.textContent = "\u2713 Connected";
      el.className = "ok";
    } else {
      el.innerHTML = "No API key &#8212; open Settings";
      el.className = "warn";
    }
    $("#status-model").textContent = s.model || AI.DEFAULT_MODEL;
  }

  // ================= file tree =================
  function renderTree() {
    const treeEl = $("#file-tree");
    treeEl.innerHTML = "";

    // build nested structure from flat paths
    const root = {};
    for (const f of files) {
      const parts = f.path.split("/").filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        node[part] = node[part] || (isLeaf ? { __file: true } : {});
        if (!isLeaf && node[part].__file) node[part] = {}; // path conflict guard
        node = node[part];
      }
    }

    const activePath = Editor.activePath;

    function walk(node, prefix, parentEl, depth) {
      const dirNames = Object.keys(node).filter((k) => !node[k].__file).sort();
      const fileNames = Object.keys(node).filter((k) => node[k].__file).sort();

      for (const d of dirNames) {
        const row = document.createElement("div");
        row.className = "tree-item tree-folder";
        row.style.paddingLeft = `${10 + depth * 14}px`;
        row.innerHTML = `<span>&#128193;</span><span class="label"></span>`;
        row.querySelector(".label").textContent = d;
        const children = document.createElement("div");
        children.className = "tree-children";
        row.addEventListener("click", () => children.classList.toggle("hidden"));
        parentEl.appendChild(row);
        parentEl.appendChild(children);
        walk(node[d], `${prefix}${d}/`, children, depth + 1);
      }

      for (const f of fileNames) {
        const path = `${prefix}${f}`;
        const row = document.createElement("div");
        row.className = `tree-item${path === activePath ? " active" : ""}`;
        row.style.paddingLeft = `${10 + depth * 14}px`;
        row.innerHTML = `<span>&#128196;</span><span class="label"></span>
          <span class="file-actions">
            <button class="mini-btn act-rename" title="Rename">&#9998;</button>
            <button class="mini-btn act-delete" title="Delete">&#128465;</button>
          </span>`;
        row.querySelector(".label").textContent = f;
        row.addEventListener("click", () => openFile(path));
        row.querySelector(".act-rename").addEventListener("click", (e) => {
          e.stopPropagation();
          renameFilePrompt(path);
        });
        row.querySelector(".act-delete").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm(`Delete ${path}?`)) {
            await Editor.deleteFile(path);
            files = files.filter((x) => x.path !== path);
            renderTree(); renderTabs();
            toast(`Deleted ${path}`);
          }
        });
        parentEl.appendChild(row);
      }
    }

    if (!files.length) {
      treeEl.innerHTML = `<div class="tree-empty">No files yet.<br>Use <b>+ File</b> above or ask the AI agent.</div>`;
    } else {
      walk(root, "", treeEl, 0);
    }
  }

  // ================= tabs =================
  function renderTabs() {
    const strip = $("#tabstrip");
    strip.innerHTML = "";
    for (const path of Editor.tabs) {
      const tab = document.createElement("div");
      tab.className = `tab${Editor.isActive(path) ? " active" : ""}${Editor.isDirty(path) ? " dirty" : ""}`;
      tab.title = path;
      const nameSpan = document.createElement("span");
      nameSpan.textContent = path.split("/").pop();
      const closeBtn = document.createElement("button");
      closeBtn.className = "close";
      closeBtn.innerHTML = "&times;";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        Editor.closeTab(path);
      });
      tab.append(nameSpan, closeBtn);
      tab.addEventListener("click", () => Editor.setActiveTab(path));
      strip.appendChild(tab);
    }
  }

  function toggleWelcome(show) {
    $("#welcome").classList.toggle("hidden", !show);
  }

  async function openFile(path) {
    const content = await Store.getFile(path);
    Editor.openTab(path, content ?? "");
  }

  async function newFilePrompt() {
    const path = prompt("New file path:", "untitled.js");
    if (!path) return;
    await createFile(path.normalize("NFC").replace(/^\/+|\/+$/g, ""));
  }

  async function createFile(path) {
    if (!path) return;
    if (files.some((f) => f.path === path)) {
      toast("File already exists", "err");
      return;
    }
    await Store.putFile(path, "");
    files.push({ path, content: "" });
    files.sort((a, b) => a.path.localeCompare(b.path));
    renderTree();
    Editor.openTab(path, "");
  }

  function newFolderPrompt() {
    const name = prompt("New folder path:", "src/");
    if (!name) return;
    const p = name.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/?$/, "/");
    createFile(`${p}.gitkeep`);
  }

  async function renameFilePrompt(oldPath) {
    const newPath = prompt("Rename to:", oldPath);
    if (!newPath || newPath === oldPath) return;
    await Editor.renameFile(oldPath, newPath);
    const f = files.find((x) => x.path === oldPath);
    if (f) {
      f.path = newPath;
      files.sort((a, b) => a.path.localeCompare(b.path));
    }
    renderTree(); renderTabs();
  }

  // ================= chat =================
  function appendMsg(role, text, extraHTML = "") {
    const log = $("#chat-log");
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    if (extraHTML) div.innerHTML += extraHTML;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  async function refreshFiles() {
    // IndexedDB is the source of truth, but the editor may hold unsaved edits.
    const stored = await Store.listFiles();
    files = stored.map((f) => {
      const live = Editor.getContent(f.path);
      return { path: f.path, content: live !== null ? live : f.content };
    });
  }

  function getContextFiles(mode) {
    if (mode === "none") return [];
    if (mode === "all") return files;
    const active = Editor.activePath;
    if (!active) return [];
    const live = Editor.getContent(active);
    const f = files.find((x) => x.path === active);
    if (live === null && !f) return [];
    const content = live !== null ? live : f.content;
    return [{ path: active, content }];
  }

  async function sendMessage() {
    if (busy) return;
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;

    const s = getSettings();
    if (!s.apiKey) {
      toast("Add your free OpenRouter API key in Settings first", "err");
      openSettings();
      return;
    }

    input.value = "";
    appendMsg("user", text);

    busy = true;
    $("#btn-send").disabled = true;
    const statusEl = $("#chat-status");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Contacting model\u2026";

    try {
      await refreshFiles();
      const contextMode = $("#context-mode").value;
      const contextFiles = getContextFiles(contextMode);
      const fileCount = contextFiles.length;

      const { text: reply, filesChanged } = await AI.chat({
        apiKey: s.apiKey,
        model: s.model,
        history: chatHistory,
        userMessage: text,
        contextFiles,
        onProgress: (state) => {
          statusEl.textContent =
            `${AI.describeProgress(state)}  \u00b7  ${s.model}, ${fileCount} file${fileCount === 1 ? "" : "s"} of context`;
        }
      });

      // apply file changes to the workspace
      let appliedNote = "";
      const displayText = AI.stripFileBlocks(reply) || "(wrote files, see below)";
      if (filesChanged.length) {
        for (const change of filesChanged) {
          const normPath = change.path.replace(/^\.?\//, "");
          const existing = files.find((f) => f.path === normPath);
          if (existing) existing.content = change.content;
          else files.push({ path: normPath, content: change.content });
          await Store.putFile(normPath, change.content);
          if (Editor.tabs.includes(normPath)) Editor.setValue(normPath, change.content);
          else Editor.openTab(normPath, change.content);
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        renderTree(); renderTabs();
        appliedNote = `<div class="applied">&#10003; Applied changes to ${filesChanged.length} file(s): ${
          filesChanged.map((c) => escapeHtml(c.path)).join(", ")
        }</div>`;
      }

      appendMsg("assistant", displayText, appliedNote);
      chatHistory.push({ role: "user", content: text });
      // keep only the prose in history: files are re-sent as workspace context
      chatHistory.push({ role: "assistant", content: displayText });
      persistChat();
      setStatusLeft(filesChanged.length ? `AI updated ${filesChanged.length} file(s)` : "Ready");
    } catch (e) {
      appendMsg("error", e.message);
    } finally {
      busy = false;
      $("#btn-send").disabled = false;
      statusEl.classList.add("hidden");
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function persistChat() {
    const session = Store.getSession() || {};
    session.chat = chatHistory.slice(-40);
    if (!Store.saveSession(session)) {
      // storage full - drop chat history and retry
      session.chat = [];
      Store.saveSession(session);
    }
  }

  // ================= export / import =================
  function getFiles() { return files; }

  async function doExport(kind) {
    try {
      setStatusLeft("Exporting...");
      const how = kind === "compressed"
        ? await IO.exportCompressed()
        : await IO.exportJSON();
      toast(how === "gzip" ? "Exported compressed .sourcecode file" : "Exported JSON file", "ok");
      $("#export-modal").close();
    } catch (e) {
      toast(`Export failed: ${e.message}`, "err");
    } finally {
      setStatusLeft("Ready");
    }
  }

  async function doImport(file) {
    try {
      const payload = await IO.importSession(file);
      if (files.length && !confirm(`Replace current workspace (${files.length} files) with the imported session (${payload.files.length} files)?`)) {
        return;
      }
      await Store.clearFiles();
      for (const f of payload.files) {
        await Store.putFile(f.path, f.content ?? "");
      }
      files = payload.files.map((f) => ({ path: f.path, content: f.content ?? "" }));
      chatHistory = Array.isArray(payload.session?.chat) ? payload.session.chat : [];

      // restore tabs
      const tabsToOpen = payload.session?.tabs || [];
      for (const t of tabsToOpen.filter((p) => files.some((f) => f.path === p))) {
        const f = files.find((x) => x.path === t);
        Editor.openTab(t, f.content);
      }
      if (!Editor.tabs.length && files.length) {
        Editor.openTab(files[0].path, files[0].content);
      } else {
        Editor.setActiveTab(Editor.tabs.includes(payload.session?.activePath)
          ? payload.session.activePath
          : (Editor.tabs[0] || null));
      }
      renderTree();
      rebuildChatLog();
      toast(`Imported ${files.length} files`, "ok");
    } catch (e) {
      toast(`Import failed: ${e.message}`, "err");
    }
  }

  function rebuildChatLog() {
    $("#chat-log").innerHTML = "";
    for (const m of chatHistory) appendMsg(m.role === "user" ? "user" : "assistant", m.content);
  }

  // ================= save to disk =================
  async function saveToDisk() {
    if (!files.length) { toast("Workspace is empty", "err"); return; }
    if (window.showDirectoryPicker) {
      try {
        const dir = await showDirectoryPicker({ mode: "readwrite" });
        setStatusLeft("Saving to disk...");
        for (const f of files) {
          const parts = f.path.split("/");
          const fileName = parts.pop();
          let cur = dir;
          for (const part of parts) {
            cur = await cur.getDirectoryHandle(part, { create: true });
          }
          const fh = await cur.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(f.content);
          await w.close();
        }
        toast(`Saved ${files.length} files to "${dir.name}"`, "ok");
      } catch (e) {
        if (e.name !== "AbortError") toast(`Save failed: ${e.message}`, "err");
      } finally {
        setStatusLeft("Ready");
      }
    } else {
      // fallback: ZIP download
      try {
        setStatusLeft("Building ZIP...");
        const zip = new JSZip();
        for (const f of files) zip.file(f.path, f.content);
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "sourcecode-project.zip"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast("Downloaded project ZIP (your browser can't write folders directly)", "ok");
      } catch (e) {
        toast(`ZIP failed: ${e.message}`, "err");
      } finally {
        setStatusLeft("Ready");
      }
    }
  }

  // ================= github =================
  function openGithubModal() {
    const s = getSettings();
    if (!s.ghToken || !s.ghRepo) {
      toast("Configure GitHub token + repo in Settings first", "err");
      openSettings();
      return;
    }
    $("#gh-summary").textContent = `Commit ${files.length} file(s) to ${s.ghRepo}.`;
    $("#gh-branch-name").textContent = s.ghBranch || "(default branch)";
    $("#github-modal").showModal();
  }

  async function pushToGithub() {
    const s = getSettings();
    const btn = $("#btn-gh-push");
    btn.disabled = true;
    btn.textContent = "Pushing...";
    try {
      const result = await GitHub.pushFiles({
        token: s.ghToken,
        repo: s.ghRepo,
        branch: s.ghBranch,
        files,
        message: `SourceCode update (${new Date().toISOString().slice(0, 16).replace("T", " ")})`
      });
      $("#github-modal").close();
      toast(`Pushed to ${result.branch}: ${result.sha.slice(0, 7)}`, "ok");
      window.open(result.url, "_blank");
    } catch (e) {
      toast(`GitHub push failed: ${e.message}`, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Commit & Push";
    }
  }

  // ================= upload =================
  function normalizeUploadPath(path) {
    return path.replace(/\\/g, "/").replace(/^\.?\/*/, "").replace(/\/+$/g, "");
  }

  async function importUploadEntries(entries) {
    if (!entries.length) return;
    let importedCount = 0;
    for (const { path, content } of entries) {
      if (!path) continue;
      const existing = files.find((f) => f.path === path);
      if (existing && !confirm(`Replace existing file "${path}"?`)) continue;
      if (existing) existing.content = content;
      else files.push({ path, content });
      await Store.putFile(path, content);
      importedCount++;
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    renderTree();
    for (const { path } of entries) {
      const f = files.find((x) => x.path === path);
      if (f) Editor.openTab(f.path, f.content);
    }
    renderTabs();
    toast(`Uploaded ${importedCount} file(s)`, "ok");
    toggleWelcome(files.length === 0);
  }

  async function uploadFiles(fileList) {
    const entries = [];
    for (const file of fileList) {
      const path = normalizeUploadPath(file.webkitRelativePath || file.name);
      const content = await file.text();
      entries.push({ path, content });
    }
    await importUploadEntries(entries);
  }

  async function walk(dirHandle, prefix, entries) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        await walk(handle, `${prefix}${name}/`, entries);
      } else {
        const file = await handle.getFile();
        const content = await file.text();
        entries.push({ path: `${prefix}${name}`, content });
      }
    }
  }

  async function uploadFolderModern() {
    if (!window.showDirectoryPicker) return false;
    let dir;
    try {
      dir = await window.showDirectoryPicker();
    } catch (e) {
      if (e.name === "AbortError") return true;
      throw e;
    }
    const entries = [];
    await walk(dir, "", entries);
    await importUploadEntries(entries);
    return true;
  }

  async function uploadFolderModernOrLegacy() {
    try {
      const handled = await uploadFolderModern();
      if (!handled) $("#upload-folder").click();
    } catch (e) {
      toast(`Upload failed: ${e.message}`, "err");
    }
  }

  // ================= beforeunload guard =================
  function setupUnloadGuard() {
    window.addEventListener("beforeunload", (e) => {
      if (files.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  // ================= boot =================
  async function init() {
    // toast container
    const toasts = document.createElement("div");
    toasts.id = "toasts";
    document.body.appendChild(toasts);

    // load files from IndexedDB
    files = await Store.listFiles();

    // editor
    await Editor.init($("#editor-container"));

    // restore session (open tabs)
    const session = Store.getSession();
    chatHistory = Array.isArray(session.chat) ? session.chat : [];
    rebuildChatLog();
    const tabsToOpen = (session.tabs || []).filter((p) => files.some((f) => f.path === p));
    if (tabsToOpen.length) {
      for (const p of tabsToOpen) {
        const f = files.find((x) => x.path === p);
        Editor.openTab(p, f.content);
      }
      Editor.setActiveTab(session.activePath && Editor.tabs.includes(session.activePath)
        ? session.activePath : tabsToOpen[tabsToOpen.length - 1]);
    } else if (files.length) {
      Editor.openTab(files[0].path, files[0].content);
    } else {
      toggleWelcome(true);
    }

    renderTree();
    updateConnStatus();
    setupUnloadGuard();

    // wire up events
    $("#btn-new-file").addEventListener("click", newFilePrompt);
    $("#btn-new-file-side").addEventListener("click", newFilePrompt);
    $("#btn-new-folder").addEventListener("click", newFolderPrompt);
    $("#btn-refresh-tree").addEventListener("click", async () => {
      files = await Store.listFiles();
      renderTree();
    });

    $("#btn-settings").addEventListener("click", openSettings);
    $("#btn-settings-save").addEventListener("click", (e) => {
      // dialog form submit handles closing; just save values
      saveSettingsFromForm();
    });

    $("#btn-export").addEventListener("click", () => $("#export-modal").showModal());
    $("#btn-export-json").addEventListener("click", () => doExport("json"));
    $("#btn-export-compressed").addEventListener("click", () => doExport("compressed"));

    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = "";
    });

    $("#btn-upload").addEventListener("click", () => {
      const choice = confirm("Click OK to upload a folder, or Cancel to upload individual files.");
      if (choice) uploadFolderModernOrLegacy();
      else $("#upload-files").click();
    });
    $("#upload-files").addEventListener("change", (e) => {
      if (e.target.files.length) uploadFiles(e.target.files);
      e.target.value = "";
    });
    $("#upload-folder").addEventListener("change", (e) => {
      if (e.target.files.length) uploadFiles(e.target.files);
      e.target.value = "";
    });

    // drag-and-drop onto sidebar
    const sidebar = $("#sidebar");
    sidebar.addEventListener("dragover", (e) => {
      e.preventDefault();
      sidebar.classList.add("drag-over");
    });
    sidebar.addEventListener("dragleave", (e) => {
      if (!sidebar.contains(e.relatedTarget)) sidebar.classList.remove("drag-over");
    });
    sidebar.addEventListener("drop", async (e) => {
      e.preventDefault();
      sidebar.classList.remove("drag-over");
      const items = Array.from(e.dataTransfer.items || []);
      const entries = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        if (item.getAsFileSystemHandle) {
          const handle = await item.getAsFileSystemHandle();
          if (handle.kind === "directory") {
            await walk(handle, handle.name + "/", entries);
          } else {
            const file = await handle.getFile();
            entries.push({ path: normalizeUploadPath(file.name), content: await file.text() });
          }
        } else {
          const file = item.getAsFile();
          if (file) entries.push({ path: normalizeUploadPath(file.webkitRelativePath || file.name), content: await file.text() });
        }
      }
      if (entries.length) await importUploadEntries(entries);
    });

    $("#btn-save-disk").addEventListener("click", saveToDisk);
    $("#btn-github").addEventListener("click", openGithubModal);
    $("#btn-gh-push").addEventListener("click", pushToGithub);

    $("#btn-send").addEventListener("click", sendMessage);
    $("#chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    $("#btn-clear-chat").addEventListener("click", () => {
      chatHistory = [];
      rebuildChatLog();
      persistChat();
    });

    // panel resizing
    setupResizer($("#sidebar-resizer"), $("#sidebar"), "width", 120, 480);
    setupResizer($("#chat-resizer"), $("#chat-panel"), "width", 240, 720);

    // warn if no key on first visit
    if (!getSettings().apiKey && !localStorage.getItem("sc_seen_intro")) {
      localStorage.setItem("sc_seen_intro", "1");
      setTimeout(() => {
        toast("Welcome! Add a free OpenRouter API key in Settings to use the AI agent.");
      }, 800);
    }

    setStatusLeft(`Ready \u2014 ${files.length} file(s)`);
  }

  function setupResizer(handle, panel, prop, min, max) {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const dir = handle.id === "chat-resizer" ? -1 : 1; // drag left grows right-side panel
      function move(ev) {
        let w = startW + dir * (ev.clientX - startX);
        w = Math.max(min, Math.min(max, w));
        panel.style[prop] = `${w}px`;
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    toast, renderTabs, renderTree, toggleWelcome,
    setStatusLeft, setStatusRight,
    getFiles, openFile
  };
})();
