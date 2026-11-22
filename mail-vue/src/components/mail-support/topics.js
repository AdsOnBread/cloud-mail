export const helpTopics = [
  {
    id:'drafts', title:'Find and reopen a saved draft', permission:'email:send', route:'draft', action:'Open Drafts',
    steps:['Open Drafts in the sidebar. Select the subject to continue writing.',
      'For a saved reply, you can also open the conversation marked Draft. The reply appears underneath its original message.'],
  },
  {
    id:'labels', title:'Create and apply labels', route:'label-settings', action:'Manage labels',
    steps:['Click the plus beside Labels in the sidebar. Enter a name and choose Create.',
      'Select your conversations and choose Label as. In the simple toolbar, Label as is under More. Check the labels you want and choose Apply.'],
  },
  {
    id:'schedule', title:'Schedule or cancel a send', permission:'email:send', route:'scheduled', action:'Open Scheduled',
    steps:['Address your message, open the arrow beside Send, and choose Schedule send. Pick a suggested time or set a date and time.',
      'To change the message or its delivery time, open it in Scheduled and choose Cancel send. You can edit the draft and schedule it again.'],
  },
  {
    id:'signature', title:'Create an email signature', permission:'email:send', route:'setting', action:'Open General settings',
    steps:['Open Settings, choose See all settings, and find Signature under General. Choose Create new, give the signature a name, and enter its text.',
      'Choose a signature for new messages or replies and save your changes. You can also choose a signature while writing.'],
  },
  {
    id:'trash', title:'Restore a message from Trash', permission:'email:delete', route:'trash', action:'Open Trash',
    steps:['Open Trash in the sidebar. Under More Trash actions, choose Restore to previous location for a selected message.',
      'To put an ordinary message in the Inbox instead, choose Move to and then Inbox. A deleted scheduled message can be restored to Drafts.'],
  },
];
