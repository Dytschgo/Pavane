export async function openNavigation(page) {
  const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
  if (!(await drawer.isVisible())) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await drawer.waitFor();
  }
}

export async function closeNavigation(page) {
  const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
  if (await drawer.isVisible()) {
    await drawer
      .getByRole("button", { name: "Close navigation", exact: true })
      .click();
    await drawer.waitFor({ state: "hidden" });
  }
}

export async function openConnections(page) {
  await openNavigation(page);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Your connections", exact: true })
    .waitFor();
  await page
    .getByRole("dialog", { name: "Chats", exact: true })
    .waitFor({ state: "hidden" });
}
