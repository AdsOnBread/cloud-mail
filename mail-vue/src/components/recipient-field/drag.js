import {shallowRef} from "vue";

// The browser only carries an opaque gesture ID. Resolve the mailbox address
// against the live source field at drop time, including across docked drafts.
const mime = "application/x-phooey-recipient";
export const recipientDragSession = Symbol();
export const recipientDrop = shallowRef(null);
let drag;

export function endRecipientDrag(field) {
  if (drag?.field!==field) return;
  drag=null;
  recipientDrop.value=null;
}

export function startRecipientDrag(event,field,index) {
  const session=field.session();
  if (!session || !event.dataTransfer) return event.preventDefault();
  const token=crypto.randomUUID();
  event.dataTransfer.effectAllowed="move";
  event.dataTransfer.setData(mime,token);
  const chip=event.currentTarget.closest(".recipient-chip");
  if (chip) event.dataTransfer.setDragImage(chip,12,14);
  drag={token,field,index,address:field.address(index),element:event.currentTarget,session};
  recipientDrop.value=null;
}

function accepts(event,field) {
  return drag && event.dataTransfer?.types.includes(mime) && drag.element.isConnected &&
    drag.element.getClientRects().length && drag.field.session()===drag.session && field.session()===drag.session &&
    drag.field.address(drag.index)===drag.address;
}

export function hoverRecipient(event,field,index) {
  if (!accepts(event,field)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect="move";
  recipientDrop.value={field,index};
}

export function leaveRecipient(event,field) {
  if (recipientDrop.value?.field===field && !event.currentTarget.contains(event.relatedTarget)) recipientDrop.value=null;
}

export function dropRecipient(event,field,index) {
  if (!accepts(event,field) || event.dataTransfer.getData(mime)!==drag.token) return;
  event.preventDefault();
  event.stopPropagation();
  const {field:source,index:from,address}=drag;
  endRecipientDrag(source);
  const name=source.name(address);
  // Commit any text the user was editing before the gesture. This can shift
  // both the dragged chip and the insertion point in the same field.
  const origin=source.prepare();
  const destination=source===field ? origin : field.prepare();
  const sourceIndex=origin.position(from);
  let targetIndex=destination.position(index);
  origin.addresses.splice(sourceIndex,1);
  if (origin===destination && sourceIndex<targetIndex) targetIndex--;
  const existing=destination.addresses.findIndex(a=>a.toLowerCase()===address.toLowerCase());
  if (existing===-1) destination.addresses.splice(targetIndex,0,address);
  if (source!==field) source.write(origin.addresses);
  if (existing===-1 && name!==address) field.remember(address,name);
  field.write(destination.addresses);
  field.focus(existing===-1 ? targetIndex : existing);
}
