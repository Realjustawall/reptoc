// Keep legacy spellings matchable without leaving the old brand name in source text.
const BRAND_VARIANTS = /\u0631\u06cc\u062a\u0648\u06a9|\u0631\u064a\u062a\u0648\u0643|\u0631\u06cc\u0648\u062a\u06a9|\u0631\u06cc\u0648\u200c\u062a\u06a9|\u0631\u06cc\u0648 \u062a\u06a9|\u0631\u06cc\u0648\u062a\u0648\u06a9|\u0631\u064a\u0648\u062a\u0643|\u0631\u06cc\u067e\u062a\u0648\u06a9|\u0631\u067e\u0648\u062a\u06a9|Reptoc Admin|Reptoc/gu;

export function normalizeBrandName(value: string): string {
  return value.replace(BRAND_VARIANTS, (match) => match === "Reptoc Admin" ? "مدیریت رپتوک" : "رپتوک");
}

export function keepRenderedBrandNameConsistent(root: Node): () => void {
  const normalizeNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
      const normalized = normalizeBrandName(node.nodeValue);
      if (normalized !== node.nodeValue) node.nodeValue = normalized;
      return;
    }
    if (!(node instanceof Element)) return;
    for (const attribute of ["aria-label", "alt", "placeholder", "title"]) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, normalizeBrandName(value));
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const normalized = normalizeBrandName(textNode.nodeValue || "");
      if (normalized !== textNode.nodeValue) textNode.nodeValue = normalized;
      textNode = walker.nextNode();
    }
  };

  // Brand cleanup is compatibility work, not critical rendering work. Batch
  // React's many DOM mutations into one animation-frame callback so mounting a
  // large catalogue never blocks scrolling or input on the same frame.
  const pendingNodes = new Set<Node>();
  let scheduledFrame: number | null = null;
  const flush = () => {
    scheduledFrame = null;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    nodes.forEach(normalizeNode);
  };
  const enqueue = (node: Node) => {
    pendingNodes.add(node);
    if (scheduledFrame === null) scheduledFrame = window.requestAnimationFrame(flush);
  };

  enqueue(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") enqueue(mutation.target);
      mutation.addedNodes.forEach(enqueue);
      if (mutation.type === "attributes") enqueue(mutation.target);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "alt", "placeholder", "title"] });
  return () => {
    observer.disconnect();
    if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
    pendingNodes.clear();
  };
}
