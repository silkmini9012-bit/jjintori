// 서버(server.mjs)와 브라우저(app.js)가 같이 쓰는 렌더링 도구.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '');

// 실행 환경(ICU)에 따라 'AM'처럼 찍히지 않도록 한국 시간으로 직접 만듭니다.
const kst = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return { mo: d.getUTCMonth() + 1, da: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };

export const kDate = (iso) => { const t = kst(iso); return `${t.mo}월 ${t.da}일`; };

export const kStamp = (iso) => { const t = kst(iso); const h12 = t.h % 12 || 12; return `${t.mo}월 ${t.da}일 ${t.h < 12 ? '오전' : '오후'} ${h12}:${String(t.mi).padStart(2, '0')}`; };

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
          <p class="post__meta"><time datetime="${esc(p.date)}">${kDate(p.date)}</time><span>댓글 ${num(p.comments)}</span></p>
        </li>`;
  }).join('\n        ');
}

export function keywordsHTML(words = []) {
  return words.map((w) => `<li>${esc(w)}</li>`).join('');
}
