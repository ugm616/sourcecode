// ai.js - OpenRouter streaming chat client for the Ox Alpha agent
"use strict";

const AI = (() => {
  const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  const DEFAULT_MODEL = "stealth/ox-alpha";

  const SYSTEM_PROMPT = `You are the SourceCode coding agent, embedded in a browser IDE.
The user has a virtual workspace of text files. You can create or modify files.

OUTPUT RULES (very important):
- To create or update a file, output it in a fenced code block whose info string starts with "file" and names a relative path, e.g.:
  \`\`\`file src/app.js
  <complete new file content>
  \`\`\`
- ALWAYS output the COMPLETE final content of each changed file, never partial diffs.
- Keep prose brief: explain what you did in a few bullet points after the code blocks.
- If you only need to answer a question, just answer normally without file blocks.`;

  function buildHeaders(apiKey) {
    return {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // optional attribution headers; harmless if blank
      "HTTP-Referer": location.origin,
      "X-Title": "SourceCode"
    };
  }

  function contextBlock(files) {
    if (!files.length) return "(workspace is empty)";
    return files.map((f) =>
      `--- FILE: ${f.path} ---\n${f.content}\n--- END FILE ---`
    ).join("\n\n");
  }

  /**
   * Send the conversation to the model (streaming).
   * history: [{role, content}] (user/assistant only)
   * contextFiles: [{path, content}]
   * onProgress: optional callback ({content, reasoning}) called as chunks arrive
   * Returns {text, filesChanged:[{path,content}]}
   */
  async function chat({ apiKey, model, history, userMessage, contextFiles, onProgress }) {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-20),
      {
        role: "user",
        content: `${userMessage}\n\n[Workspace files for reference]\n${contextBlock(contextFiles)}`
      }
    ];

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        temperature: 0.3,
        stream: true
      })
    });

    if (!res.ok) {
      let detail = "";
      try {
        const err = await res.json();
        detail = err.error ? err.error.message : JSON.stringify(err);
      } catch { /* ignore */ }
      throw new Error(`OpenRouter ${res.status}: ${detail || res.statusText}`);
    }

    // ---- consume the SSE stream ----
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";     // visible answer text
    let reasoning = "";   // hidden chain-of-thought, if the model emits one

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();   // keep incomplete trailing line

      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;   // skips ": OPENROUTER PROCESSING" comments too
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (!delta) continue;
        if (typeof delta.reasoning === "string") reasoning += delta.reasoning;
        if (typeof delta.content === "string") content += delta.content;
      }

      if (onProgress) onProgress({ content, reasoning });
    }

    return { text: content, filesChanged: extractFileBlocks(content), reasoning };
  }

  /**
   * Turn the raw stream state into a short human-readable status line,
   * e.g. "Thinking: comparing the two approaches..." or "Writing src/app.js..."
   */
  function describeProgress({ content, reasoning }) {
    const TAIL_LEN = 64;

    const tail = (s) => {
      const flat = s.replace(/\s+/g, " ").trim();
      return flat.length <= TAIL_LEN ? `\u201C${flat}\u201D` : `\u201C\u2026${flat.slice(-TAIL_LEN)}\u201D`;
    };

    // find the most recently named file block
    let lastFile = null;
    const re = /```(?:file|create|update)[ \t]+([^\n`]+)/g;
    let m;
    while ((m = re.exec(content)) !== null) lastFile = m[1].trim();

    const fenceCount = (content.match(/```/g) || []).length;
    const insideFence = fenceCount % 2 === 1;

    if (insideFence && lastFile) return `Writing ${lastFile}\u2026`;
    if (!insideFence && lastFile) return `Saved ${lastFile}`;

    if (!content.trim()) {
      if (reasoning.trim()) return `Thinking: ${tail(reasoning)}`;
      return "Waiting for first tokens\u2026";
    }

    return `Composing: ${tail(content)}`;
  }

  // Parse ```file path/to/file ...``` blocks from an assistant message
  function extractFileBlocks(text) {
    const out = [];
    const re = /```(?:file|create|update)[ \t]+([^\n`]+)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      let path = m[1].trim();
      // tolerate "path=foo" style
      const eq = path.match(/^path\s*=\s*(.+)$/);
      if (eq) path = eq[1].trim();
      path = path.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
      let content = m[2];
      if (content.endsWith("\n")) content = content.slice(0, -1);
      if (path) out.push({ path, content });
    }
    return out;
  }

  return { chat, describeProgress, extractFileBlocks, DEFAULT_MODEL };
})();
