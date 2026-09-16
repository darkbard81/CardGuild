import { RingMenu } from "../../src/dom/ring-menu";
import "./component-shell";

interface RingFixture {
  ring: RingMenu;
  events: Array<{ kind: "select" | "hover"; id: string | null }>;
  show: () => void;
  retired?: HTMLElement;
}
declare global { interface Window { ringFixture: RingFixture } }

const root = document.createElement("div");
root.id = "ring-test-root";
Object.assign(root.style, { position: "fixed", inset: "0" });
root.hidden = true;
document.body.append(root);
const events: RingFixture["events"] = [];
const ring = new RingMenu(root, {
  onHover: id => events.push({ kind: "hover", id }),
  onSelect: id => events.push({ kind: "select", id }),
  onDismiss: () => ring.hide(),
});
window.ringFixture = { ring, events, show: () => ring.show({ x: 400, y: 300 }, "Test target", [
  { id: "strike", actionId: "strike", label: "Strike", cost: "●" },
  { id: "stride", actionId: "stride", label: "Stride", cost: "●" },
]) };

window.ringFixture.show();
