// notes.html 用: work の notes.md を fetch して簡易Markdownパーサーで描画する

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseInline(line) {
  let s = escapeHtml(line);
  // インラインコード `code`
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // リンク [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const external = /^https?:\/\//.test(url);
    return `<a href="${url}"${external ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
  });
  // 太字 **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
  return s;
}

// 見出し(##/###)・段落・箇条書き(-)・コードブロック(```)・引用(>)のみに対応した
// 行ベースの簡易パーサー。blockquote内部は同じ関数で再帰的に解析する
function parseBlocks(lines) {
  const out = [];
  let i = 0;

  const isSpecialLine = (line) =>
    line.trim().startsWith("```") ||
    line.trim().startsWith(">") ||
    line.trim().startsWith("- ") ||
    /^#{2,3}\s+/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 閉じの```をスキップ
      out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${parseInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${parseBlocks(quoteLines)}</blockquote>`);
      continue;
    }

    if (line.trim().startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(`<li>${parseInline(lines[i].trim().slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !isSpecialLine(lines[i])) {
      paraLines.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${parseInline(paraLines.join(" "))}</p>`);
  }

  return out.join("\n");
}

function parseMarkdown(text) {
  return parseBlocks(text.replace(/\r\n/g, "\n").split("\n"));
}

async function init() {
  const content = document.getElementById("content");
  const slug = new URLSearchParams(location.search).get("slug");

  if (!slug) {
    content.textContent = "slugが指定されていません。";
    return;
  }

  try {
    const works = await fetch("labWorks.json").then((r) => r.json());
    const work = works.find((w) => w.slug === slug);
    if (!work) throw new Error(`labWorks.jsonに "${slug}" が見つかりません`);

    document.title = `${work.title} - 詳細メモ | huraru-lab`;

    const mdRes = await fetch(`works/${slug}/notes.md`);
    if (!mdRes.ok) throw new Error(`works/${slug}/notes.md の取得に失敗 (${mdRes.status})`);
    const bodyHtml = parseMarkdown(await mdRes.text());

    content.innerHTML = `
      <a class="back" href="index.html">← huraru-lab 一覧に戻る</a>
      <h1>${escapeHtml(work.title)}</h1>
      ${work.note ? `<p class="lede">${escapeHtml(work.note)}</p>` : ""}
      <a class="demo-link" href="works/${slug}/index.html">→ デモを開く</a>
      <div id="notes-body">${bodyHtml}</div>
    `;
  } catch (err) {
    content.textContent = `メモの読み込みに失敗しました: ${err.message}`;
    console.error(err);
  }
}

init();
