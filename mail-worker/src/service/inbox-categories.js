import BizError from '../error/biz-error.js';

const categories = new Set(['primary', 'promotions', 'social', 'updates', 'forums']);
export function checkCategory(value) {
	if (!categories.has(value)) throw new BizError('Choose an inbox category.', 400);
	return value;
}

// Classify the first received message once per conversation. Explicit filing always wins.
// Ordinary personal correspondence is Primary when no narrower rule matches.
export const categoryQuery = `, categorized AS (
  SELECT g.*,COALESCE(manual.category, CASE
    WHEN sender.send_email LIKE '%@googlegroups.com' OR sender.send_email LIKE '%@groups.io'
      OR sender.send_email LIKE 'forum@%' OR sender.send_email LIKE 'discourse@%' THEN 'forums'
    WHEN sender.send_email LIKE '%@facebookmail.com' OR sender.send_email LIKE '%@linkedin.com'
      OR sender.send_email LIKE '%@mail.instagram.com' OR sender.send_email LIKE '%@pinterest.com'
      OR sender.send_email LIKE '%@e.linkedin.com' THEN 'social'
    WHEN sender.send_email LIKE 'newsletter@%' OR sender.send_email LIKE 'offers@%'
      OR sender.send_email LIKE 'deals@%' OR sender.send_email LIKE 'promotions@%'
      OR sender.subject LIKE '% off today%' OR sender.subject LIKE '%weekly newsletter%' THEN 'promotions'
    WHEN sender.send_email LIKE 'notifications@%' OR sender.send_email LIKE 'receipts@%'
      OR sender.send_email LIKE 'billing@%' OR sender.send_email LIKE 'alerts@%'
      OR sender.subject LIKE 'your receipt%' OR sender.subject LIKE 'order confirmation%'
      OR sender.subject LIKE 'security alert%' THEN 'updates'
    ELSE 'primary' END) AS category
    FROM grouped g LEFT JOIN email sender ON sender.email_id=g.category_source
    LEFT JOIN mailbox_categories manual ON manual.change_id=g.category_override)`;

export const categorySchema = `CREATE TABLE IF NOT EXISTS mailbox_categories (
  change_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL, category TEXT NOT NULL,
  UNIQUE(user_id,email_id))`;

export async function fileCategory(db, userId, ids, category) {
	checkCategory(category);
	const changes = [];
	for (let offset = 0; offset < ids.length; offset += 30) {
		const batch = ids.slice(offset, offset + 30);
		changes.push(
			db
				.prepare(
					`INSERT OR REPLACE INTO mailbox_categories(user_id,email_id,category)
      VALUES ${batch.map(() => '(?,?,?)').join(',')}`,
				)
				.bind(...batch.flatMap((id) => [userId, id, category])),
		);
	}
	await db.batch(changes);
}
