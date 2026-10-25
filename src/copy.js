'use strict';
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const el = document.getElementById(button.dataset.copy);
  if (!el) return;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(el.textContent);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Select code to copy';
  }
  setTimeout(() => { button.textContent = original; }, 2500);
});
