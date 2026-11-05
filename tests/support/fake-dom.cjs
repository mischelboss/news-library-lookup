// A deliberately small DOM, just enough to run extension/spiegel.js without any dependency.
// Supported selectors: comma lists, descendant combinators, tag names, and [attr], [attr="v"], [attr~="v"].

function parseSelector(text) {
  return text.split(',').map(part => part.trim().split(/\s+/).map(compound => {
    const found = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/i.exec(compound);
    if (!found) throw new Error(`Unsupported selector in fake DOM: ${compound}`);
    const attrs = [...found[2].matchAll(/\[([\w-]+)(?:(~?=)"([^"]*)")?\]/g)].map(a => ({ name: a[1], op: a[2], value: a[3] }));
    return { tag: found[1].toLowerCase(), attrs };
  }));
}

function matchesCompound(el, { tag, attrs }) {
  return (!tag || el.tagName.toLowerCase() === tag) && attrs.every(({ name, op, value }) => {
    if (!el.hasAttribute(name)) return false;
    const actual = el.getAttribute(name);
    if (!op) return true;
    return op === '=' ? actual === value : actual.split(/\s+/).includes(value);
  });
}

function matchesChain(el, chain) {
  let index = chain.length - 1;
  if (!matchesCompound(el, chain[index])) return false;
  index -= 1;
  for (let node = el.parent; index >= 0 && node; node = node.parent) {
    if (node.nodeType === 1 && matchesCompound(node, chain[index])) index -= 1;
  }
  return index < 0;
}

const kebab = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.style = { cssText: '' };
    this.top = 0;
    this.dataset = new Proxy({}, {
      get: (_, prop) => this.getAttribute(`data-${kebab(String(prop))}`) ?? undefined,
      set: (_, prop, value) => { this.setAttribute(`data-${kebab(String(prop))}`, String(value)); return true; },
    });
  }
  get isConnected() { let node = this; while (node.parent) node = node.parent; return node === this.ownerDocument; }
  get href() { const value = this.attributes.get('href'); return value === undefined ? '' : new URL(value, 'https://www.spiegel.de/').href; }
  set href(value) { this.attributes.set('href', String(value)); }
  get textContent() { return this.children.map(child => child.nodeType === 3 ? child.data : child.textContent).join(''); }
  set textContent(value) { this.children = [{ nodeType: 3, data: String(value), parent: this }]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? { nodeType: 3, data: node } : node;
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  replaceWith(node) {
    const siblings = this.parent.children;
    siblings[siblings.indexOf(this)] = node;
    node.parent = this.parent;
    this.parent = null;
  }
  attachShadow() { this.shadowRoot = new FakeElement('shadow-root', this.ownerDocument); this.shadowRoot.nodeType = 11; return this.shadowRoot; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  getBoundingClientRect() { return { top: this.top }; }
  matches(selector) { return parseSelector(selector).some(chain => matchesChain(this, chain)); }
  querySelectorAll(selector) {
    const chains = parseSelector(selector);
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.nodeType !== 1) continue;
        if (chains.some(chain => matchesChain(child, chain))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document', null);
    this.ownerDocument = this;
    this.html = this.createElement('html');
    this.body = this.createElement('body');
    this.append(this.html);
    this.html.append(this.body);
  }
  createElement(tag) { return new FakeElement(tag, this); }
  // h('article', { 'aria-label': 'x' }, child, 'text') builds an element tree.
  h(tag, attrs = {}, ...children) {
    const el = this.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.append(...children);
    return el;
  }
}

// Collects children of a shadow root of an element, skipping the <style> element.
const shadowChildren = host => host.shadowRoot.children.filter(child => child.tagName !== 'STYLE');

module.exports = { FakeDocument, shadowChildren };
