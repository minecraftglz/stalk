// 拉取 Halo 博客文章列表，生成 AI 知识库 server/ai/knowledge/podcast-posts.md
// 用法：node scripts/build-knowledge.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BLOG_BASE || 'https://blog.minecraftglz.top';
const API = `${BASE}/apis/api.content.halo.run/v1alpha1/posts`;
const OUT = path.join(process.cwd(), 'server', 'ai', 'knowledge', 'podcast-posts.md');
const MAX_CHARS = parseInt(process.env.KB_MAX_CHARS || '11000', 10);

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v).slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  const res = await fetch(`${API}?page=0&size=200&sort=spec.publishTime,desc`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.items || []).map(it => ({
    title: (it.spec && it.spec.title) || '',
    date: fmtDate(it.spec && it.spec.publishTime),
    link: (it.status && it.status.permalink)
      ? new URL(it.status.permalink, BASE).href
      : '',
    excerpt: stripHtml(it.status && it.status.excerpt),
    name: (it.metadata && it.metadata.name) || '',
  })).filter(x => x.title).sort((a, b) => (a.date < b.date ? 1 : -1));

  const head = [
    '# 站点播客 / 博客文章知识库',
    '',
    `来源：${BASE}（Halo 博客 API）`,
    `生成时间：${new Date().toISOString().slice(0, 10)}`,
    `文章总数：${items.length}`,
    '',
    '说明：下面是站长的播客/博客文章索引与摘要。回答文章相关问题时优先引用这里的内容，',
    '不确定的细节不要编造，可以引导用户打开链接阅读全文。',
    '',
    '## 全部文章索引',
    '',
  ].join('\n');

  const indexLines = items.map(it => `- ${it.date} 《${it.title}》 ${it.link}`.trim());
  const detailLines = ['', '## 近期文章摘要', ''];
  // 摘要按发布时间从新到旧，占用剩余预算
  let budget = MAX_CHARS - head.length - indexLines.join('\n').length - 200;
  for (const it of items) {
    const line = `- 《${it.title}》${it.excerpt ? '：' + it.excerpt.slice(0, 180) : ''}`;
    if (budget - line.length < 0) break;
    budget -= line.length + 1;
    detailLines.push(line);
  }

  let md = head + indexLines.join('\n') + '\n' + detailLines.join('\n') + '\n';
  if (md.length > MAX_CHARS) md = md.slice(0, MAX_CHARS) + '\n…（已截断）\n';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.log(`OK ${items.length} 篇 -> ${OUT} (${md.length} 字符)`);
}

main().catch(e => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
