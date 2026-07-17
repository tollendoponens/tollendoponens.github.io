window.papers = [
  {
    title:    "When to Limit the Market",
    status:   "forthcoming",
    pdf:      "",
    abstract: "Gregory Robson (2023) argues that a moral objection to the market is successful only if it shows that a representative sample of business activity is unethical. He calls this the Normative Representativeness Requirement (NRR). I argue that we should not endorse the NRR for two reasons. First, an objection can be successful even if it fails to satisfy the NRR. Second, Robson motivates the NRR by appealing to a general epistemic requirement against hasty generalizations, yet this epistemic requirement only applies when one attempts a generalization—and objections to markets need not do so.",
    journal:  "Business Ethics Journal Review",
    date:     "2026",
    link:     "",
    tags:     ["markets"],
  },
];

const abstractBlock = a => a
  ? `<span class="abstract-toggle" onclick="toggleAbstract(this)">+ abstract</span>
      <div class="abstract hidden">${a}</div>`
  : '';

window.toggleAbstract = function (el) {
  const abs = el.nextElementSibling;
  abs.classList.toggle('hidden');
  el.textContent = abs.classList.contains('hidden') ? '+ abstract' : '− abstract';
};

window.renderPublications = function (container) {
  container.innerHTML = window.papers
    .filter(p => p.status === 'published' || p.status === 'forthcoming')
    .map(p => {
      const titleHTML = p.link ? `<a class="link" href="${p.link}" target="_blank">${p.title}</a>` : p.title;
      const verb = p.status === 'forthcoming' ? 'Forthcoming in' : 'Published in';
      const journalPart  = p.journal  ? `${verb} <i>${p.journal}</i>` : '';
      const pdfPart      = p.pdf      ? ` · <a class="link" href="papers/${p.pdf}" target="_blank">pdf</a>` : '';
      const abstractPart = p.abstract ? ` · ${abstractBlock(p.abstract)}` : '';
      return `    <div class="item">
      <div class="item-title">${titleHTML}</div>
      <div class="item-meta">${journalPart}${pdfPart}${abstractPart}</div>
    </div>`;
    })
    .join('\n\n');
};

window.renderFilter = function (container) {
  const tags = [...new Set(window.papers.flatMap(p => p.tags))];
  container.innerHTML = ['all', ...tags].map((t, i) =>
    `<button${i === 0 ? ' class="active"' : ''} onclick="filterSelection(this, '${t}')">${t}</button>`
  ).join('\n');
};

window.filterSelection = function (btn, category) {
  document.querySelectorAll('.filter button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  for (const paper of document.getElementsByClassName('paper')) {
    paper.classList.toggle('hidden', !(category === 'all' || paper.classList.contains(category)));
  }
};

window.renderPapers = function (container) {
  container.innerHTML = window.papers.map(p => {
    const classes  = ['paper', ...p.tags].join(' ');
    const metaRight = (p.status === 'published' || p.status === 'forthcoming') && p.journal ? p.journal : 'Draft';
    const pdfPart  = p.pdf ? `<a href="papers/${p.pdf}" target="_blank">pdf</a>` : '';
    return `  <div class="${classes}">
    <div class="title">${p.title}</div>
    <div class="meta">${p.date} · ${metaRight}</div>
    <div class="links">${pdfPart} ${abstractBlock(p.abstract)}</div>
  </div>`;
  }).join('\n\n');
};
