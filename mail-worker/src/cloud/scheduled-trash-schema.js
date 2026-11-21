// A trashed scheduled message uses the regular Trash reader, retention and attachment
// permissions. Recover its original draft even when a legacy client removes Trash.
export const scheduleFields = "'$.scheduledAt','$.scheduleKey','$.scheduleError','$.retryAt','$.scheduledUnread','$.scheduledInbox','$.scheduledInboxEdit','$.scheduledWakeAt','$.scheduledPreviousPlacement'";
const trashFields = "'$.trashEdit','$.trashSendAt','$.trashState','$.resumeSchedule'";

export const scheduledTrashSchema = [
  `CREATE TABLE IF NOT EXISTS scheduled_trash_operations (
    user_id INTEGER NOT NULL, edit TEXT NOT NULL, nonce TEXT NOT NULL, selection TEXT NOT NULL,
    resumed INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,edit))`,
  'CREATE INDEX IF NOT EXISTS idx_trash_operation_age ON scheduled_trash_operations(created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_trash ON email(user_id,scheduled_draft_id) WHERE scheduled_draft_id IS NOT NULL',
  `CREATE TRIGGER IF NOT EXISTS restore_scheduled_trash AFTER UPDATE OF trashed_at ON email
    WHEN OLD.scheduled_draft_id IS NOT NULL AND OLD.trashed_at IS NOT NULL AND NEW.trashed_at IS NULL BEGIN
      INSERT INTO draft_files(attachment_id,draft_id,user_id,key,filename,mime_type,size,content_id)
        SELECT related,NEW.scheduled_draft_id,user_id,key,filename,mime_type,size,content_id
        FROM attachments WHERE email_id=NEW.email_id AND user_id=NEW.user_id;
      DELETE FROM attachments WHERE email_id=NEW.email_id AND user_id=NEW.user_id;
      UPDATE cloud_drafts SET
        state=CASE WHEN json_extract(data,'$.resumeSchedule')=1 THEN 'scheduled' ELSE 'draft' END,
        data=json_set(CASE WHEN json_extract(data,'$.resumeSchedule')=1 THEN
          json_remove(json_set(data,'$.scheduledAt',json_extract(data,'$.trashSendAt'),'$.scheduledUnread',1-NEW.unread,
            '$.scheduleKey','cloudmail.schedule/'||lower(hex(randomblob(16)))),${trashFields},'$.retryAt','$.scheduleError')
          ELSE json_remove(data,${trashFields},${scheduleFields}) END,
          '$.labelIds',(SELECT json_group_array(label_id) FROM mailbox_label_members WHERE user_id=NEW.user_id AND email_id=NEW.email_id)),
        version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE draft_id=NEW.scheduled_draft_id AND user_id=NEW.user_id AND state='trashed';
      DELETE FROM email WHERE email_id=NEW.email_id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS purge_scheduled_trash AFTER DELETE ON email
    WHEN OLD.scheduled_draft_id IS NOT NULL AND OLD.trashed_at IS NOT NULL BEGIN
      UPDATE cloud_drafts SET state='deleted',data='{}',version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE draft_id=OLD.scheduled_draft_id AND user_id=OLD.user_id AND state='trashed';
    END`,
];
