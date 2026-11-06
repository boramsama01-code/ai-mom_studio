import assert from 'node:assert/strict';

/** Real built-dialog geometry: short descriptions must use the text column. */
export async function studioStartChoiceMeasurements(page) {
  const choices = page.locator('.studio-create-form .studio-start-options > button');
  await choices.first().waitFor({ state: 'visible' });
  return choices.evaluateAll(buttons => buttons.map(button => {
    const description = button.querySelector('p'), heading = button.querySelector('strong'), icon = button.querySelector('svg');
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const style = getComputedStyle(description);
    return { heading: heading.textContent, description: description.textContent, button: rect(button), text: rect(description), title: rect(heading), icon: rect(icon),
      lineHeight: Number.parseFloat(style.lineHeight), gridTemplateColumns: getComputedStyle(button).gridTemplateColumns,
      descriptionGridColumn: style.gridColumnStart, descriptionScrollWidth: description.scrollWidth, descriptionClientWidth: description.clientWidth };
  }));
}

export async function assertStudioStartLayout(page, measured) {
  const values = measured ?? await studioStartChoiceMeasurements(page);
  assert.equal(values.length, 2, 'both manual start choices must remain available');
  for (const value of values) {
    assert(value.button.width >= 48 && value.button.height >= 48, `${value.heading}: at least48px hit area`);
    assert(Math.abs(value.text.x - value.title.x) <= 1, `${value.heading}: description must align with heading, not the icon column`);
    assert(value.text.x >= value.icon.right + 4, `${value.heading}: description must follow the icon column`);
    assert(value.text.width >= Math.min(160, value.button.width * .55), `${value.heading}: description is too narrow (${value.text.width}px)`);
    assert(value.text.height <= value.lineHeight * 3 + 1, `${value.heading}: short Korean description must fit within three natural lines`);
    assert(value.text.right <= value.button.right + 1 && value.descriptionScrollWidth <= value.descriptionClientWidth + 1, `${value.heading}: description must not overflow`);
  }
  const choices = page.locator('.studio-create-form .studio-start-options > button');
  for (const choice of await choices.all()) {
    await choice.scrollIntoViewIfNeeded();
    assert(await choice.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === node || node.contains(hit)); }), 'manual choice must be reachable');
  }
  return values;
}
