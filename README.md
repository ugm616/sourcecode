# &lt;/&gt; SourceCode

A browser-based coding workspace you can use from anywhere — no install, no backend. Powered by the **Ox Alpha** AI agent (via [OpenRouter](https://openrouter.ai/stealth/ox-alpha)), hosted for free on **GitHub Pages**.

## Features

- **Full code editor** — Monaco (the VS Code editor) with tabs, syntax highlighting, and auto-save
- **AI agent** — ask it to build features, fix bugs, or write whole files; changes are applied directly to your workspace
- **Save to GitHub** — commit every file in your workspace to any repo with a single click
- **Save to hard drive** — pick a folder on disk and SourceCode writes your files straight into it (Chrome/Edge), or download a ZIP anywhere else
- **Session export/import** — export open tabs + files as readable `.json` or a compressed `.sourcecode` file; re-import later to continue where you left off
- **Private by design** — a fully static site: your API keys and files live only in *your* browser, never on a server

Everything runs client-side. There is no server, no database, and no account system.

## Quick Start

1. Get a **free API key** at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Open SourceCode and click **⚙ Settings**
3. Paste your key (the model defaults to `stealth/ox-alpha` — Ox Alpha Free)
4. Create a file with **+ File**, or just describe what you want in the AI panel

### Run locally

Any static file server works:

```bash
npx serve SourceCode
# or
python -m http.server 8000 --directory SourceCode
```

Then visit `http://localhost:8000`.

> Note: serving over `http://` is required — opening `index.html` directly via `file://` will block the Monaco web workers.

## Deploying to GitHub Pages

1. Push the contents of `SourceCode/` to a GitHub repository
2. In the repo: **Settings → Pages → Source: Deploy from a branch**
3. Choose your branch and `/ (root)`, then save

Your copy of SourceCode will be live at `https://<your-username>.github.io/<your-repo>/`.

## Saving Your Work

| Method | How | Notes |
| --- | --- | --- |
| Auto-save | Automatic | Files persist in your browser's IndexedDB |
| Hard drive | **Save to Disk** button | Direct folder writes on Chrome/Edge; ZIP fallback elsewhere |
| GitHub repo | **GitHub ▾ → Commit & Push** | Requires setup below |
| Session file | **Export** button | `.json` (readable) or `.sourcecode` (gzip-compressed); import anytime |

If you try to close the tab with unsaved work, your browser will warn you first.

### Setting up GitHub saving

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
2. Give it access to the repo you want to push to, with **Contents: Read and Write** permission
3. In SourceCode's **⚙ Settings**, paste:
   - the token,
   - your repository as `owner/name`,
   - an optional branch name (defaults to the repo's default branch)

Each push commits all workspace files as a single commit.

## Privacy Notes

- API keys are stored in your browser's `localStorage` and sent only to OpenRouter / GitHub directly from your machine.
- Prompts and code you send to Ox Alpha pass through OpenRouter. Their stealth-model terms currently state prompts/completions may be retained by the provider (not used for training). Avoid pasting secrets or confidential data.
- "Free" reflects the current preview price of `stealth/ox-alpha` and could change — if it does, edit the **Model ID** field in Settings to point at another model.

## Tech Stack

- Vanilla HTML/CSS/JS — no framework, no build step
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) via CDN
- [JSZip](https://stuk.github.io/jszip/) via CDN (ZIP fallback)
- IndexedDB + localStorage for persistence
- [OpenRouter API](https://openrouter.ai/docs) for AI, [GitHub REST API](https://docs.github.com/en/rest) for pushes
- Native [`CompressionStream`](https://developer.mozilla.org/docs/Web/API/CompressionStream) for `.sourcecode` compression

## License

MIT
