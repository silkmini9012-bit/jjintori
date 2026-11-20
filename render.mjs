// 서버(server.mjs)와 브라우저(app.js)가 같이 쓰는 렌더링 도구.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '');

export const kDate = (iso) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(iso));

export const kStamp = (iso) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(iso));

export const kDay = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };

// data-live="blog.subscribers" 같은 경로를 데이터에서 찾아 표시용 문자열로 바꿉니다.
export function liveValue(data, path) {
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), data);
  if (v == null) return null;
  if (path === 'updatedAt') return kStamp(v);
  if (path === 'blai.asOf') return kDay(v);
  return typeof v === 'number' ? num(v) : String(v);
}

export function postsHTML(posts = []) {
  return posts.slice(0, 6).map((p, i) => {
    const size = i === 0 ? 'w800' : 'w400';
    const pic = p.thumb
      ? `<span class="post__pic"><img src="${esc(p.thumb)}?type=${size}" alt="" width="400" height="400" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
      : '';
    return `<li class="post${i === 0 ? ' post--lead' : ''}">
          <a class="post__link" href="${esc(p.url)}">${pic}<span class="post__title">${esc(p.title)}</span></a>
          <p class="post__meta"><time datetime="${esc(p.date)}">${kDate(p.date)}</time><span>공감 ${num(p.likes)}</span><span>댓글 ${num(p.comments)}</span></p>
        </li>`;
  }).join('\n        ');
}

export function keywordsHTML(words = []) {
  return words.map((w) => `<li>${esc(w)}</li>`).join('');
}
