import {copyBody,printDocument} from '@/utils/print-document';

export function renderDraft(doc, draft) {
  doc.title = draft.subject || 'Draft';
  const header = doc.createElement('header');
  const title = doc.createElement('h1');
  title.textContent = draft.subject || '(no subject)';
  header.append(title);
  for (const [label, value] of [['From',draft.sendEmail],['To',draft.receiveEmail?.join(', ')],['Cc',draft.cc?.join(', ')],['Bcc',draft.bcc?.join(', ')]]) {
    if (!value) continue;
    const line = doc.createElement('div');
    const name = doc.createElement('strong');
    name.textContent = label + ': ';
    line.append(name, value);
    header.append(line);
  }
  const body = doc.createElement(draft.plainText ? 'pre' : 'main');
  if (draft.plainText) body.textContent = draft.text;
  else {
    const template = doc.createElement('template');
    template.innerHTML = draft.content;
    copyBody(template.content, body, doc);
  }
  doc.body.append(header, body);
  const files = draft.attachments.filter(file => !file.contentId);
  if (files.length) {
    const footer = doc.createElement('footer');
    footer.textContent = 'Attachments: ' + files.map(file => file.filename).join(', ');
    doc.body.append(footer);
  }
}

export function printDraft(draft) {
  return printDocument(doc=>renderDraft(doc,draft));
}
