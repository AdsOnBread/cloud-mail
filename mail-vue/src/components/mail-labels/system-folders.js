// Keys are the existing mailbox route names. Hidden folders remain available under More.
export const systemFolders = [
  {id:'star',name:'Starred',translation:'starred',icon:'star-outline'},
  {id:'snoozed',name:'Snoozed',icon:'schedule-outline'},
  {id:'important',name:'Important',icon:'label-important-outline',defaultMode:'hide'},
  {id:'send',name:'Sent',translation:'sent',icon:'send-outline',permission:'email:send'},
  {id:'scheduled',name:'Scheduled',icon:'schedule-send-outline',conditional:true},
  {id:'draft',name:'Drafts',translation:'drafts',icon:'draft-outline',permission:'email:send',conditional:true},
  {id:'all',name:'All Mail',icon:'all-inbox-outline',defaultMode:'hide'},
  {id:'archived',name:'Archived',icon:'archive-outline',defaultMode:'hide'},
  {id:'trash',name:'Trash',icon:'delete-outline',defaultMode:'hide'},
];
export const folderMode=(folder,choices)=>choices[folder.id] || folder.defaultMode || 'show';
