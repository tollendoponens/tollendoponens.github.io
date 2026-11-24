// Shared masthead and footer, injected on every page.
(function () {
  const here = location.pathname.split('/').pop() || 'index.html';
  const pages = [
    ['index.html', 'Home'],
    ['publications.html', 'Publications'],
    ['about.html', 'About'],
  ];

  const items = pages
    .map(([href, label]) =>
      `<li><a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a></li>`)
    .join('');

  document.currentScript.insertAdjacentHTML('beforebegin', `
<header class="masthead">
  <div class="wrap">
    <a class="masthead__name" href="index.html">Victor Chung</a>
    <ul class="masthead__menu">
      ${items}
      <li><a class="masthead__cv" href="cv.pdf" target="_blank" rel="noopener">CV ↗</a></li>
    </ul>
  </div>
</header>`);

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend',
      `<footer class="colophon">© ${new Date().getFullYear()} Victor Chung</footer>`);
  });

  // The CV buttons don't open the CV: a click shows a small popup under the button instead.
  let note, timer;
  function hideNote() {
    if (note) note.classList.remove('cv-note--open');
  }
  document.addEventListener('click', e => {
    const cv = e.target.closest('a[href="cv.pdf"]');
    if (!cv) { hideNote(); return; }
    e.preventDefault();
    if (!note) {
      note = document.createElement('div');
      note.className = 'cv-note';
      note.setAttribute('role', 'status');
      note.textContent = 'Pride is a cardinal sin.';
      document.body.appendChild(note);
    }
    const r = cv.getBoundingClientRect();
    const w = note.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8);
    note.style.left = `${left}px`;
    note.style.top = `${r.bottom + 8}px`;
    note.classList.add('cv-note--open');
    clearTimeout(timer);
    timer = setTimeout(hideNote, 2500);
  });
  window.addEventListener('scroll', hideNote, { passive: true });
}());
