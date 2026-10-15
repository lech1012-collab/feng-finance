/** Wait for the real page or modal, including transient IndexedDB re-queries. */
export async function sceneFingerprint(page) {
  return page.evaluate(() => {
    const scope =
      document.querySelector("dialog[open]") || document.querySelector("main");
    if (!scope) return null;
    const visible = (e) =>
      e.getClientRects().length > 0 &&
      !e.closest('[inert],[aria-hidden="true"]');
    const loading = [...scope.querySelectorAll('[role="status"]')].some(
      (e) =>
        visible(e) &&
        /^Loading(?: your finances)?(?:…|\.\.\.)$/u.test(e.textContent.trim()),
    );
    const heading = [...scope.querySelectorAll("h1,h2")]
      .find(visible)
      ?.textContent.trim();
    if (loading || !heading) return null;
    return JSON.stringify({
      text: scope.innerText,
      heading,
      width: innerWidth,
      height: innerHeight,
    });
  });
}

export async function waitForReadyScene(page, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let previous,
    stable = 0;
  while (Date.now() < deadline) {
    const current = await sceneFingerprint(page);
    stable = current && current === previous ? stable + 1 : 0;
    previous = current;
    if (current && stable >= 2) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      if ((await sceneFingerprint(page)) === current) return current;
      stable = 0;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(
    "The actual UI did not become ready and stable for a screenshot.",
  );
}
