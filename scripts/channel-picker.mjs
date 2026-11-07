// Use the same visible sidebar picker on desktop and in the mobile menu.
// Each successful mobile selection closes the menu, so reopen it for every action.
export async function openChannelMenu(page) {
  const opener = page.getByRole('button', { name: '메뉴 열기', exact: true });
  if (await opener.isVisible() && await opener.getAttribute('aria-expanded') !== 'true') await opener.click();
  await page.waitForFunction(() => {
    const picker = document.querySelector('.sidebar select[aria-label="보기 채널"]');
    if (!picker) return false;
    const bounds = picker.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth + 1;
  });
}

export async function selectChannel(page, value) {
  await openChannelMenu(page);
  await page.getByRole('combobox', { name: '보기 채널', exact: true }).selectOption(String(value));
}

export async function closeChannelMenu(page) {
  const opener = page.getByRole('button', { name: '메뉴 열기', exact: true });
  if (await opener.isVisible() && await opener.getAttribute('aria-expanded') === 'true') {
    await page.getByRole('button', { name: '메뉴 닫기', exact: true }).click();
  }
}
