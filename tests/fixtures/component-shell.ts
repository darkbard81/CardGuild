/**
 * The empty shell a component test mounts into.
 *
 * It stands in for `main.ts` and does two things: hide every screen the shell ships with,
 * and say the page is ready. The component under test then reveals its own screen, which is
 * what the real app does too — without it, a loadout test measures a page that is also
 * showing the Adventure card and the whole combat stage.
 *
 * Nothing here authenticates, fetches or connects, so a component test cannot start passing
 * or failing for a reason that lives on the server.
 */
const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("The app shell is missing its #app root.");
for (const screen of root.querySelectorAll<HTMLElement>(":scope > section")) screen.hidden = true;
root.dataset.ready = "true";
