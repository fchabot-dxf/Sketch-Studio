// Element tree view. Click a node to select its element.

import { store, subscribe, select } from './store.js';

let root, curDoc = null;

export function init(container) {
  root = container;
  subscribe(render);
}

function render(s) {
  if (s.doc !== curDoc) {
    curDoc = s.doc;
    build();
  }
  highlight();
}

function build() {
  root.innerHTML = '';
  if (!store.doc) {
    root.innerHTML = '<div class="empty small">No document</div>';
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'tree-list';
  ul.append(nodeFor(store.doc));
  root.append(ul);
}

function nodeFor(el) {
  const li = document.createElement('li');

  const label = document.createElement('div');
  label.className = 'tree-node';
  label.textContent = el.tagName + (el.id ? ` #${el.id}` : '');
  label._el = el;
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    select(el);
  });
  li.append(label);

  const kids = [...el.children];
  if (kids.length) {
    const childUl = document.createElement('ul');
    for (const k of kids) childUl.append(nodeFor(k));
    li.append(childUl);
  }
  return li;
}

function highlight() {
  for (const n of root.querySelectorAll('.tree-node')) {
    n.classList.toggle('active', n._el === store.selected);
  }
}
