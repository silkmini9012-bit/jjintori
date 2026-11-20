import { liveValue, postsHTML, keywordsHTML } from './render.mjs';

const REFRESH = 10 * 60 * 1000;
// GitHub Pages에는 server.mjs 가 없으니 /api 주소는 건너뜁니다.
const HAS_SERVER = !location.hostname.endsWith('github.io');

async function load() {
  for (const url of HAS_SERVER ? ['/api/blog', 'data/blog.json'] : ['data/blog.json']) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch { /* 다음 경로 시도 */ }
  }
  return null;
}

function apply(data) {
  document.querySelectorAll('[data-live]').forEach((el) => {
    const v = liveValue(data, el.dataset.live);
    if (v != null && el.textContent !== v) el.textContent = v;
  });
  const list = document.querySelector('[data-posts]');
  if (list && data.posts?.length) list.innerHTML = postsHTML(data.posts);
  const kw = document.querySelector('[data-keywords]');
  if (kw && data.blai?.keywords?.length) kw.innerHTML = keywordsHTML(data.blai.keywords);
}

async function refresh() {
  const data = await load();
  if (data) apply(data);
}

// 메인 사진 띠: 화면에 보일 때만 흐르고, 마우스를 올리거나 키보드로 고르면 멈춥니다.
document.querySelectorAll('[data-loop]').forEach((el) => {
  const btn = el.querySelector('[data-loop-toggle]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const s = { seen: false, hover: false, focus: false, held: false };
  const sync = () => {
    el.classList.toggle('is-running', s.seen && !s.hover && !s.focus && !s.held && !reduce.matches);
    if (btn) {
      btn.textContent = s.held ? '재생' : '멈춤';
      btn.setAttribute('aria-label', s.held ? '사진 다시 움직이기' : '사진 움직임 멈추기');
      btn.setAttribute('aria-pressed', String(s.held));
    }
  };
  btn?.addEventListener('click', () => { s.held = !s.held; sync(); });
  [['pointerenter', 'hover', true], ['pointerleave', 'hover', false], ['focusin', 'focus', true], ['focusout', 'focus', false]]
    .forEach(([type, key, val]) => el.addEventListener(type, (e) => { if (e.target === btn && key === 'focus') return; s[key] = val; sync(); }));
  new IntersectionObserver(([entry]) => { s.seen = entry.isIntersecting; sync(); }).observe(el);
  reduce.addEventListener?.('change', sync);
  sync();
});

refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

// 협업 문의: Web3Forms(web3forms.com)가 silksun9012@naver.com 으로 메일을 전달합니다.
// 칸 이름(name)이 그대로 메일 본문의 항목 이름이 되므로 한글로 둡니다.
const form = document.querySelector('form[data-endpoint]');
if (form) {
  const help = form.querySelector('[aria-live]');
  const button = form.querySelector('button[type="submit"]');
  const mailLink = document.querySelector('[data-mailto]');
  const field = (id) => form.querySelector(`#${id}`);
  const subject = () => `[찐토리 협업 문의] ${field('shop').value.trim() || '가게 이름'}`;
  const body = () => `가게 이름: ${field('shop').value.trim()}\n연락처: ${field('reach').value.trim()}\n\n${field('offer').value.trim()}`;

  const syncMailto = () => {
    if (mailLink) mailLink.href = `mailto:${form.dataset.to}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(body())}`;
  };
  form.addEventListener('input', syncMailto);
  syncMailto();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const required = [...form.querySelectorAll('[required]')];
    required.forEach((f) => f.toggleAttribute('aria-invalid', !f.value.trim()));
    const empty = required.find((f) => !f.value.trim());
    if (empty) { help.textContent = '비어 있는 칸이 있어요. 세 칸 모두 채워 주세요.'; empty.focus(); return; }
    const trap = form.elements.namedItem('botcheck');
    if (trap && trap.checked) return;

    const reach = field('reach').value.trim();
    const fd = new FormData(form);
    const endpoint = form.dataset.endpoint;
    fd.set('access_key', form.dataset.web3formsKey);
    fd.set('subject', subject());
    fd.set('from_name', `${field('shop').value.trim()} (찐토리 사이트)`);
    fd.delete('botcheck');
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reach)) fd.set('replyto', reach);

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = '보내는 중…';
    help.textContent = '';

    // 1순위: 이 사이트 서버(server.mjs)가 네이버 SMTP로 직접 보냅니다.
    //        서버가 없거나(GitHub Pages 등) SMTP 설정이 안 됐으면 Web3Forms로 보냅니다.
    const direct = !HAS_SERVER ? { status: 0, out: {} } : await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ shop: field('shop').value, reach, offer: field('offer').value }),
    }).then(async (r) => ({ status: r.status, out: await r.json().catch(() => ({})) })).catch(() => ({ status: 0, out: {} }));

    if (direct.status === 429 || direct.status === 422) {
      help.textContent = direct.status === 429 ? '짧은 시간에 여러 번 보내셨어요. 10분 뒤에 다시 보내 주세요.' : '비어 있는 칸이 있어요. 세 칸 모두 채워 주세요.';
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = '협업 문의하기';
      return;
    }

    try {
      let ok = direct.status === 200 && direct.out.success === true;
      if (!ok) {
        const res = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: fd });
        const out = await res.json().catch(() => ({}));
        ok = res.ok && String(out.success) === 'true';
        if (!ok) throw new Error(out.message || String(res.status));
      }
      if (ok) {
        help.textContent = '문의가 찐토리 네이버 메일로 전송됐어요. 확인하고 남겨 주신 연락처로 답을 드릴게요.';
        form.reset();
        syncMailto();
      }
    } catch (err) {
      console.warn('문의 전송 실패:', err.message);
      help.textContent = '전송되지 않았어요. 아래 메일 앱으로 쓰기를 누르거나 silksun9012@naver.com 으로 직접 보내 주세요.';
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = '협업 문의하기';
    }
  });
}
