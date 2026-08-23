// ai.js - OpenRouter chat client for the Ox Alpha agent
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
   * Send the conversation to the model.
   * history: [{role, content}] (user/assistant only)
   * contextFiles: [{path, content}]
   * Returns {text, filesChanged:[{path,content}]}
   */
  async function chat({ apiKey, model, history, userMessage, contextFiles }) {
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
        temperature: 0.3
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

    const data = await res.json();
    const choice = data.choices && data.choices[0];
    const text = choice ? (choice.message.content || "") : "";
    return { text, filesChanged: extractFileBlocks(text) };
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

  return { chat, extractFileBlocks, DEFAULT_MODEL };
})();
