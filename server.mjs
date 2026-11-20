// 찐토리 소개 사이트 서버
//   node server.mjs          사이트를 http://localhost:5173 에서 열고, /api/blog 로 네이버 블로그 숫자를 실시간(10분 캐시)으로 내려줍니다.
//   node server.mjs --once   data/blog.json 스냅샷만 새로 쓰고 끝냅니다. 정적 호스팅에서는 이걸 주기적으로 돌리면 됩니다.
// 외부 패키지 없이 Node 18 이상에서 돌아갑니다.
//
// 협업 문의 메일(POST /api/contact): 네이버 SMTP로 silksun9012@naver.com 에 직접 보냅니다.
//   네이버 메일 환경설정에서 IMAP/SMTP 사용을 켜고, 비밀번호(2단계 인증이면 애플리케이션 비밀번호)를
//   환경변수로 넘겨 실행하세요. 비밀번호는 파일에 적지 마세요.
//     PowerShell:  $env:NAVER_APP_PASSWORD = "비밀번호"; node server.mjs

import http from 'node:http';
import tls from 'node:tls';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveValue, postsHTML, keywordsHTML } from './render.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const BLOG_ID = 'silksun9012';
const PORT = Number(process.env.PORT) || 5173;
const TTL = 10 * 60 * 1000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (jjintori-site)', Referer: `https://m.blog.naver.com/${BLOG_ID}` };
const SNAPSHOT = join(ROOT, 'data', 'blog.json');

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

const kstDate = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

// ── 협업 문의 메일 ─────────────────────────────────────────────
const MAIL_USER = process.env.NAVER_ID || BLOG_ID;
const MAIL_FROM = `${MAIL_USER}@naver.com`;
const MAIL_TO = process.env.MAIL_TO || 'silksun9012@naver.com';
const MAIL_PASS = process.env.NAVER_APP_PASSWORD || '';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encWord = (s) => `=?UTF-8?B?${b64(s)}?=`;
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

function buildMessage({ subject, text, replyTo }) {
  const headers = [
    `From: ${encWord('찐토리 사이트')} <${MAIL_FROM}>`,
    `To: <${MAIL_TO}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${wrap76(b64(text))}`;
}

// 네이버 SMTP(smtp.naver.com:465, SSL)로 메일 한 통을 보냅니다.
function smtpSend(mail) {
  return new Promise((resolve, reject) => {
    const steps = [
      [null, 220],
      ['EHLO jjintori-site', 250],
      ['AUTH LOGIN', 334],
      [b64(MAIL_USER), 334],
      [b64(MAIL_PASS), 235],
      [`MAIL FROM:<${MAIL_FROM}>`, 250],
      [`RCPT TO:<${MAIL_TO}>`, 250],
      ['DATA', 354],
      [`${buildMessage(mail)}\r\n.`, 250],
      ['QUIT', 221],
    ];
    let i = 0;
    let buf = '';
    const sock = tls.connect(465, 'smtp.naver.com', { servername: 'smtp.naver.com' });
    sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP 응답 시간 초과')); });
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buf += chunk;
      if (!buf.endsWith('\r\n')) return;
      const lines = buf.trimEnd().split('\r\n');
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last)) return; // 여러 줄 응답이 아직 끝나지 않음
      buf = '';
      const code = Number(last.slice(0, 3));
      if (code !== steps[i][1]) {
        sock.destroy();
        const hint = steps[i][1] === 235 ? ' (아이디, 비밀번호, SMTP 사용 설정을 확인하세요)' : '';
        reject(new Error(`SMTP ${last}${hint}`));
        return;
      }
      i += 1;
      if (i >= steps.length) { sock.end(); resolve(); return; }
      sock.write(`${steps[i][0]}\r\n`);
    });
  });
}

const recent = new Map(); // IP별 최근 전송 시각, 10분에 5통까지
function allow(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 5) return false;
  list.push(now);
  recent.set(ip, list);
  return true;
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleContact(req, res) {
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { success: false, message: 'POST only' });
  if (!MAIL_PASS) return send(503, { success: false, message: 'smtp-not-configured' });
  let data;
  try { data = JSON.parse(await readBody(req)); } catch { return send(400, { success: false, message: 'bad request' }); }
  if (data._honey) return send(200, { success: true });
  const clip = (s, n) => String(s ?? '').trim().slice(0, n);
  const shop = clip(data.shop, 100);
  const reach = clip(data.reach, 200);
  const offer = clip(data.offer, 5000);
  if (!shop || !reach || !offer) return send(422, { success: false, message: 'missing fields' });
  if (!allow(req.socket.remoteAddress)) return send(429, { success: false, message: 'too many requests' });
  const replyTo = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(reach) ? reach : null;
  try {
    await smtpSend({
      subject: `[찐토리 협업 문의] ${shop}`,
      text: `가게 이름: ${shop}\n연락처: ${reach}\n\n${offer}\n\n찐토리 소개 사이트 문의 양식에서 보냈습니다.`,
      replyTo,
    });
    send(200, { success: true });
  } catch (err) {
    console.error('문의 메일 전송 실패:', err.message);
    send(502, { success: false, message: 'smtp-failed' });
  }
}

export async function buildData() {
  const [info, list, visitorXml, blai] = await Promise.all([
    get(`https://m.blog.naver.com/api/blogs/${BLOG_ID}`),
    get(`https://m.blog.naver.com/api/blogs/${BLOG_ID}/post-list?categoryNo=0&itemCount=30&page=1`),
    get(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${BLOG_ID}`, 'text').catch(() => ''),
    readFile(join(ROOT, 'data', 'blai.json'), 'utf8').then(JSON.parse).catch(() => null),
  ]);

  const b = info.result;
  const visitors = [...visitorXml.matchAll(/id="(\d{4})(\d{2})(\d{2})" cnt="(\d+)"/g)]
    .map((m) => ({ date: `${m[1]}-${m[2]}-${m[3]}`, count: Number(m[4]) }));
  const finished = visitors.filter((v) => v.date !== kstDate());
  const avg = finished.length ? Math.round(finished.reduce((s, v) => s + v.count, 0) / finished.length) : null;

  const items = list.result.items;
  const now = Date.now();
  const posts = items.slice(0, 12).map((it) => ({
    title: it.titleWithInspectMessage,
    url: `https://blog.naver.com/${BLOG_ID}/${it.logNo}`,
    date: new Date(it.addDate).toISOString(),
    likes: it.sympathyCnt,
    comments: it.commentCnt,
    category: it.categoryName,
    place: it.placeName || null,
    thumb: it.thumbnailList?.[0]?.encodedThumbnailUrl || it.thumbnailUrl || null,
  }));

  return {
    updatedAt: new Date().toISOString(),
    blog: {
      name: b.blogName,
      url: `https://blog.naver.com/${BLOG_ID}`,
      subscribers: b.subscriberCount,
      totalVisitors: b.totalVisitorCount,
      todayVisitors: b.dayVisitorCount,
      avgVisitors: avg,
      visitors,
      postsLast30: items.filter((it) => now - it.addDate <= 30 * 86400e3).length,
    },
    posts,
    blai,
  };
}

// index.html 안의 기본값(스크립트 없이 열어도 보이는 숫자와 최근 글)도 최신 데이터로 바꿔 둡니다.
async function bakeHTML(data) {
  const file = join(ROOT, 'index.html');
  let html = await readFile(file, 'utf8');
  html = html.replace(/(data-live="([\w.]+)"[^>]*>)([^<]*)(<)/g, (m, open, path, _old, close) => {
    const v = liveValue(data, path);
    return v == null ? m : open + v + close;
  });
  html = html.replace(/(<!-- posts:start -->)[\s\S]*?(<!-- posts:end -->)/, `$1\n        ${postsHTML(data.posts)}\n        $2`);
  if (data.blai?.keywords) html = html.replace(/(data-keywords>)[\s\S]*?(<\/ul>)/, `$1${keywordsHTML(data.blai.keywords)}$2`);
  await writeFile(file, html, 'utf8');
}

async function refreshSnapshot() {
  const data = await buildData();
  await writeFile(SNAPSHOT, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await bakeHTML(data).catch((err) => console.error('index.html 기본값 갱신 실패:', err.message));
  return data;
}

if (process.argv.includes('--once')) {
  const d = await refreshSnapshot();
  console.log(`data/blog.json 갱신: 이웃 ${d.blog.subscribers}, 누적 방문자 ${d.blog.totalVisitors}, 최근 글 ${d.posts.length}편`);
  process.exit(0);
}

let cache = null;
let cachedAt = 0;
let pending = null;

async function blogData() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  pending ??= refreshSnapshot()
    .then((d) => { cache = d; cachedAt = Date.now(); return d; })
    .catch(async (err) => {
      console.error('네이버 데이터 갱신 실패:', err.message);
      if (cache) return { ...cache, stale: true };
      const old = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
      return { ...old, stale: true };
    })
    .finally(() => { pending = null; });
  return pending;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/contact') { await handleContact(req, res); return; }
  if (pathname === '/api/blog') {
    try {
      const data = await blogData();
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': TYPES['.json'] });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || /[\\/]\.|server\.mjs$/.test(rel)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`찐토리 사이트: http://localhost:${PORT}`);
  console.log(MAIL_PASS ? `협업 문의 메일: 네이버 SMTP로 ${MAIL_TO} 에 보냅니다.` : '협업 문의 메일: NAVER_APP_PASSWORD 가 없어 네이버 SMTP 전송은 꺼져 있습니다.');
});
