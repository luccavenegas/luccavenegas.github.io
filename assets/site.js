/* Small interaction details: scroll reveal, active nav link, nav border on scroll, video pause buttons. */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Nav border appears after a little scroll
  const nav = document.querySelector('.nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Scroll reveal (fade-up), staggered within a group
  const targets = document.querySelectorAll('.reveal');
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(t => io.observe(t));
  } else {
    targets.forEach(t => t.classList.add('in'));
  }

  // Active nav link for the section in view
  const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const map = new Map();
  links.forEach(a => { const s = document.querySelector(a.getAttribute('href')); if (s) map.set(s, a); });
  if (map.size && 'IntersectionObserver' in window) {
    const nio = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          links.forEach(l => l.removeAttribute('aria-current'));
          map.get(e.target).setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    map.forEach((_, s) => nio.observe(s));
  }

  // Pause/play button on autoplaying looped videos
  document.querySelectorAll('video[autoplay][loop]').forEach(v => {
    const wrap = v.parentElement; if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vid-toggle'; b.setAttribute('aria-label', 'Pause video'); b.textContent = '❚❚';
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (v.paused) { v.play(); b.textContent = '❚❚'; b.setAttribute('aria-label', 'Pause video'); }
      else { v.pause(); b.textContent = '▶'; b.setAttribute('aria-label', 'Play video'); }
    });
    wrap.appendChild(b);
    if (reduce) { v.pause(); b.textContent = '▶'; }
  });
})();
