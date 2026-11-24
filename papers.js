window.papers = [
  {
    title:    "When to Limit the Market",
    status:   "published",
    pdf:      "robson.pdf",
    abstract: "Gregory Robson (2023) argues that a moral objection to the market is successful only if it shows that a representative sample of business activity is unethical. He calls this the Normative Representativeness Requirement (NRR). I argue that we should not endorse the NRR for two reasons. First, an objection can be successful even if it fails to satisfy the NRR. Second, Robson motivates the NRR by appealing to a general epistemic requirement against hasty generalizations, yet this epistemic requirement only applies when one attempts a generalization—and objections to markets need not do so.",
    journal:  "Business Ethics Journal Review",
    volume:   "13",
    issue:    "6",
    pages:    "32–37",
    doi:      "10.12747/j1m06",
    date:     "2026",
    link:     "https://doi.org/10.12747/j1m06",
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

// Show or hide the abstract that belongs to this button.
window.toggleWorkAbstract = function (btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  panel.hidden = !panel.hidden;
  btn.setAttribute('aria-expanded', String(!panel.hidden));
};

// Fill an <ol class="works"> with published and forthcoming papers.
window.renderPublications = function (list) {
  const out = window.papers.filter(p => p.status === 'published' || p.status === 'forthcoming');
  list.innerHTML = out.map((p, i) => {
    const id = `abstract-${i}`;
    // Citation line under the title: Journal 13(6): 32–37
    let venue = '';
    if (p.journal) {
      let cite = `<i>${p.journal}</i>`;
      if (p.volume) cite += ` ${p.volume}${p.issue ? `(${p.issue})` : ''}`;
      if (p.pages)  cite += `${p.volume ? ':' : ','} ${p.pages}`;
      if (p.status === 'forthcoming') cite = `Forthcoming in ${cite}`;
      venue = `<p class="work__venue">${cite}</p>`;
    }
    const title = p.link ? `<a href="${p.link}" target="_blank" rel="noopener">${p.title}</a>` : p.title;
    const docIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    const actions = [
      p.pdf      && `<a class="work__action" href="papers/${p.pdf}" target="_blank" rel="noopener">${docIcon}<span>pdf</span></a>`,
      p.abstract && `<button type="button" class="work__action work__toggle" aria-expanded="false" aria-controls="${id}" onclick="toggleWorkAbstract(this)"><span>abstract</span></button>`,
    ].filter(Boolean).join('');
    const abstract = p.abstract ? `<p class="work__abstract" id="${id}" hidden>${p.abstract}</p>` : '';
    // Row layout: year | title + venue | links, with the abstract opening underneath.
    return `<li class="work">
  <span class="work__year">${p.date || ''}</span>
  <div class="work__main">
    <h2 class="work__title">${title}</h2>
    ${venue}
  </div>
  <div class="work__actions">${actions}</div>
  ${abstract}
</li>`;
  }).join('\n');
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
