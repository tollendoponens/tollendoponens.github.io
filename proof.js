// Click-through derivation on the About page, in the Show-line style of
// logic-course software (Kalish–Montague). Each click on the box reveals
// the next line; the last step closes the derivation with DD, cancelling
// "Show" and boxing the lines beneath. Once closed it stays finished: the
// box stops being clickable. Works with Enter/Space too. Without JavaScript
// the finished derivation shows in full.
(function () {
  const box = document.querySelector('[data-proof]');
  if (!box) return;

  const lines  = [...box.querySelectorAll('[data-step]')];
  const status = document.querySelector('.proof__status'); // sits just outside the box

  // Read aloud to screen-reader users as each step appears.
  const notes = [
    'Line 1: Show P.',
    'Line 2: P or Q, premise.',
    'Line 3: not Q, premise.',
    'Line 4: P, by modus tollendo ponens from lines 2 and 3.',
    'P matches the Show line, so the derivation closes: DD.',
  ];
  const last = notes.length - 1;
  let step = 0;

  function render(animate) {
    lines.forEach(el => {
      const n = Number(el.dataset.step);
      el.hidden = n > step;
      el.classList.toggle('proof__line--new', animate && n === step);
    });
    if (animate) status.textContent = notes[step];
  }

  function finish() {
    box.classList.add('proof--done');
    box.classList.remove('proof--live');
    box.removeEventListener('click', advance);
    box.removeEventListener('keydown', onKey);
    box.removeAttribute('role');
    box.removeAttribute('tabindex');
    box.setAttribute('aria-label', 'Derivation of P from P or Q and not Q, complete');
  }

  function advance() {
    if (step === last) return;
    step += 1;
    render(true);
    if (step === last) finish();
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
  }

  box.addEventListener('click', advance);
  box.addEventListener('keydown', onKey);
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', 'Derivation of P. Press to show the next step.');
  box.tabIndex = 0;
  box.classList.remove('proof--done');
  box.classList.add('proof--live');
  render(false);
}());
