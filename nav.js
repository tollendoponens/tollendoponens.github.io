(function () {
  const page = location.pathname.split('/').pop() || 'index.html';
  const links = [
    { href: 'index.html',    label: 'home' },
    { href: 'about.html',    label: 'about' },
  ];

  const linksHTML = links
    .map(l => `<a href="${l.href}"${page === l.href ? ' class="active"' : ''}>${l.label}</a>`)
    .join('');

  const html = `
<nav>
  <div class="nav-inner">
    <div class="nav-title"><a href="index.html" style="color:inherit;text-decoration:none;">Victor Chung</a></div>
    <div class="nav-links">${linksHTML}</div>
  </div>
</nav>`;

  document.currentScript.insertAdjacentHTML('beforebegin', html);
}());
