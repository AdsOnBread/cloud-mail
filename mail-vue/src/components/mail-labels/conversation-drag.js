import { ref } from "vue";

const type = "application/x-phooey-mail-move";
export const dropTarget = ref(null);
export const draggingConversations = ref(false);
let drag;

export function endConversationDrag(source, element) {
  if (!drag || drag.source !== source || (element && drag.element !== element)) return;
  drag = undefined;
  draggingConversations.value = false;
  dropTarget.value = null;
}

export function startConversationDrag(event, source, accepts, move) {
  const token = crypto.randomUUID();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(type, token);
  drag = { source, element:event.currentTarget, accepts, move, token };
  dropTarget.value = null;
  draggingConversations.value = true;
}

function eligible(event, id) {
  return drag && event.dataTransfer?.types.includes(type) && drag.accepts(id);
}

export function hoverDestination(event, id) {
  if (!eligible(event, id)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  dropTarget.value = id;
}

export function leaveDestination(event, id) {
  if (dropTarget.value === id && !event.currentTarget.contains(event.relatedTarget)) dropTarget.value = null;
}

export function dropConversations(event, id) {
  if (!eligible(event, id) || event.dataTransfer.getData(type) !== drag.token) return;
  event.preventDefault();
  const { source, move } = drag;
  endConversationDrag(source);
  move(id);
}
