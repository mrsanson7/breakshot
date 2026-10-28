/** Tiny DOM helper: h('div.cls#id', {attrs}, children). */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [base, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(base as K);
  for (const r of rest) {
    if (r.startsWith('.')) el.classList.add(r.slice(1));
    else if (r.startsWith('#')) el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
