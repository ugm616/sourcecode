// github.js - commit workspace to a GitHub repo via the REST Git Data API
"use strict";

const GitHub = (() => {
  const API = "https://api.github.com";

  function headers(token) {
    return {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  async function ghFetch(token, path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...headers(token), ...(opts.headers || {}) }
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message; } catch { /* ignore */ }
      throw new Error(`GitHub API ${res.status}: ${detail || res.statusText}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function parseRepo(repoStr) {
    const m = repoStr.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) throw new Error("Repository must look like owner/name");
    return { owner: m[1], repo: m[2] };
  }

  // Commit all files as a single commit onto the branch.
  // files: [{path, content}]
  async function pushFiles({ token, repo, branch, files, message }) {
    const { owner, name } = parseRepo(repo);

    // 0. verify access + default branch
    const repoInfo = await ghFetch(token, `/repos/${owner}/${name}`);
    const branchName = branch || repoInfo.default_branch;

    // 1. get head commit of the branch (create orphan branch if missing)
    let baseCommitSha, baseTreeSha;
    const refRes = await fetch(`${API}/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branchName)}`, {
      headers: headers(token)
    });
    if (refRes.ok) {
      const refData = await refRes.json();
      baseCommitSha = refData.object.sha;
      const commit = await ghFetch(token, `/repos/${owner}/${name}/git/commits/${baseCommitSha}`);
      baseTreeSha = commit.tree.sha;
    } else if (refRes.status === 404) {
      // create branch from default branch head (or empty tree if repo itself is empty)
      try {
        const defRef = await ghFetch(token, `/repos/${owner}/${name}/git/ref/heads/${repoInfo.default_branch}`);
        baseCommitSha = defRef.object.sha;
        const commit = await ghFetch(token, `/repos/${owner}/${name}/git/commits/${baseCommitSha}`);
        baseTreeSha = commit.tree.sha;
      } catch (e) {
        baseCommitSha = null;   // empty repository
        baseTreeSha = null;
      }
    } else {
      throw new Error(`Cannot read branch "${branchName}": ${refRes.status}`);
    }

    // 2. create blobs
    const treeItems = [];
    for (const f of files) {
      const blob = await ghFetch(token, `/repos/${owner}/${name}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: f.content, encoding: "utf-8" })
      });
      treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    // 3. create tree
    const treeBody = baseTreeSha ? { base_tree: baseTreeSha, tree: treeItems } : { tree: treeItems };
    const tree = await ghFetch(token, `/repos/${owner}/${name}/git/trees`, {
      method: "POST",
      body: JSON.stringify(treeBody)
    });

    // 4. create commit
    const commitBody = { message: message || "Update from SourceCode", tree: tree.sha };
    if (baseCommitSha) commitBody.parents = [baseCommitSha];
    const commit = await ghFetch(token, `/repos/${owner}/${name}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitBody)
    });

    // 5. update/create branch ref
    if (baseCommitSha !== null && refRes.ok) {
      await ghFetch(token, `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha })
      });
    } else {
      await ghFetch(token, `/repos/${owner}/${name}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha })
      });
    }

    return { sha: commit.sha, url: commit.html_url, branch: branchName };
  }

  return { pushFiles };
})();
