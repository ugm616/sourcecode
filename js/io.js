// io.js - session export/import (JSON + gzip-compressed .sourcecode)
"use strict";

const IO = (() => {

  function buildPayload() {
    return {
      app: "SourceCode",
      version: 1,
      exportedAt: new Date().toISOString(),
      files: App.getFiles(),          // [{path, content}]
      session: Editor.getSessionState() // {tabs, activePath}
    };
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportJSON() {
    const payload = buildPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    download(blob, `sourcecode-${dateStamp()}.json`);
  }

  async function exportCompressed() {
    const payload = buildPayload();
    const json = JSON.stringify(payload);
    if (typeof CompressionStream === "undefined") {
      // older browsers: fall back to JSON with .sourcecode extension
      const blob = new Blob([json], { type: "application/json" });
      download(blob, `sourcecode-${dateStamp()}.sourcecode`);
      return "plain";
    }
    const cs = new CompressionStream("gzip");
    const stream = new Blob([json]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    download(new Blob([buf], { type: "application/octet-stream" }), `sourcecode-${dateStamp()}.sourcecode`);
    return "gzip";
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function isGzip(buf) {
    return buf && buf[0] === 0x1f && buf[1] === 0x8b;
  }

  async function importSession(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    if (isGzip(buf)) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot decompress .sourcecode files. Import a .json export instead.");
      }
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([buf]).stream().pipeThrough(ds);
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    const payload = JSON.parse(text);
    if (!payload || payload.app !== "SourceCode" || !Array.isArray(payload.files)) {
      throw new Error("Not a valid SourceCode session file.");
    }
    return payload;
  }

  return { exportJSON, exportCompressed, importSession };
})();
