/** Inspect scrollable overflow without hiding it from the assertion. Diagnostic
 * subtree changes are synchronous and fully restored before returning. */
export async function browserLayout(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  return page.evaluate(() => {
    const width = innerWidth, scroll = document.documentElement.scrollWidth;
    const value = { width, scroll, scrollX, body: document.body.scrollWidth, viewport: visualViewport?.width, offenders: [], contentOverflows: [], textOverflows: [], impacts: [] };
    if (scroll <= width + 1) return value;
    const nodes = [...document.querySelectorAll("body *")];
    const describe = node => ({ tag: node.tagName, cls: typeof node.className === "string" ? node.className : "svg", rect: node.getBoundingClientRect().toJSON(), client: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX });
    value.offenders = nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width && r.right > width + 1; }).slice(0,12).map(describe);
    value.contentOverflows = nodes.filter(node => node.getBoundingClientRect().width && node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX === "visible").slice(0,20).map(describe);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && value.textOverflows.length < 10) {
      const node = walker.currentNode, range = document.createRange(); range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width && rect.right > width + 1) value.textOverflows.push({ text: node.textContent.slice(0,80), parent: node.parentElement?.className, rect: rect.toJSON() });
    }
    for (const selector of ["main", ".workspace-header", ".sidebar", ".mobile-nav", ".toasts", ".studio-home-top", ".studio-home-heading", ".creative-overview", ".studio-workspace", ".studio-workspace-head", ".studio-home-filters", ".studio-home-empty", ".sr-only"]) {
      const matched = [...document.querySelectorAll(selector)], styles = matched.map(node => node.getAttribute("style"));
      for (const node of matched) node.style.setProperty("display","none","important");
      value.impacts.push({ selector, scrollWhileHidden: document.documentElement.scrollWidth });
      matched.forEach((node,index) => { if (styles[index] === null) node.removeAttribute("style"); else node.setAttribute("style",styles[index]); });
    }
    value.scrollAfterRestore = document.documentElement.scrollWidth;
    return value;
  });
}
