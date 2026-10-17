// Exact matches protect customized labels and user-authored content during upgrades.
export const permissionDefaults = [
  [
    1,
    "\u90ae\u4ef6",
    "Emails"
  ],
  [
    2,
    "\u90ae\u4ef6\u5220\u9664",
    "Delete Email"
  ],
  [
    3,
    "\u90ae\u4ef6\u53d1\u9001",
    "Send Email"
  ],
  [
    4,
    "\u4e2a\u4eba\u8bbe\u7f6e",
    "Settings"
  ],
  [
    5,
    "\u7528\u6237\u6ce8\u9500",
    "Delete User"
  ],
  [
    6,
    "\u7528\u6237\u4fe1\u606f",
    "All Users"
  ],
  [
    7,
    "\u7528\u6237\u67e5\u770b",
    "View User"
  ],
  [
    8,
    "\u5bc6\u7801\u4fee\u6539",
    "Change Password"
  ],
  [
    9,
    "\u72b6\u6001\u4fee\u6539",
    "Change Status"
  ],
  [
    10,
    "\u6743\u9650\u4fee\u6539",
    "Change Role"
  ],
  [
    11,
    "\u7528\u6237\u5220\u9664",
    "Delete User"
  ],
  [
    12,
    "\u7528\u6237\u6536\u85cf",
    "Star User"
  ],
  [
    13,
    "\u6743\u9650\u63a7\u5236",
    "Role"
  ],
  [
    14,
    "\u8eab\u4efd\u67e5\u770b",
    "View Role"
  ],
  [
    15,
    "\u8eab\u4efd\u4fee\u6539",
    "Change Role"
  ],
  [
    16,
    "\u8eab\u4efd\u5220\u9664",
    "Delete Role"
  ],
  [
    17,
    "\u7cfb\u7edf\u8bbe\u7f6e",
    "System Settings"
  ],
  [
    18,
    "\u8bbe\u7f6e\u67e5\u770b",
    "View Settings"
  ],
  [
    19,
    "\u8bbe\u7f6e\u4fee\u6539",
    "Change Settings"
  ],
  [
    21,
    "\u90ae\u7bb1\u4fa7\u680f",
    "Email Address"
  ],
  [
    22,
    "\u90ae\u7bb1\u67e5\u770b",
    "View Email"
  ],
  [
    23,
    "\u90ae\u7bb1\u6dfb\u52a0",
    "Add Email"
  ],
  [
    24,
    "\u90ae\u7bb1\u5220\u9664",
    "Delete Email"
  ],
  [
    25,
    "\u7528\u6237\u6dfb\u52a0",
    "Add User"
  ],
  [
    26,
    "\u53d1\u4ef6\u91cd\u7f6e",
    "Reset Send Count"
  ],
  [
    27,
    "\u90ae\u4ef6\u5217\u8868",
    "All Mail"
  ],
  [
    28,
    "\u90ae\u4ef6\u67e5\u770b",
    "View Email"
  ],
  [
    29,
    "\u90ae\u4ef6\u5220\u9664",
    "Delete Email"
  ],
  [
    30,
    "\u8eab\u4efd\u6dfb\u52a0",
    "Add Role"
  ],
  [
    31,
    "\u5206\u6790\u9875",
    "Analytics"
  ],
  [
    32,
    "\u6570\u636e\u67e5\u770b",
    "View Data"
  ],
  [
    33,
    "\u6ce8\u518c\u5bc6\u94a5",
    "Invite Code"
  ],
  [
    34,
    "\u5bc6\u94a5\u67e5\u770b",
    "View Code"
  ],
  [
    35,
    "\u5bc6\u94a5\u6dfb\u52a0",
    "Add Code"
  ],
  [
    36,
    "\u5bc6\u94a5\u5220\u9664",
    "Delete Code"
  ]
];
export const defaultNotice = "This project is for learning and discussion. Do not use it for illegal activities.\n<br>\nFollow local laws. The author accepts no legal responsibility.";
export async function upgradeEnglishDefaults(db) {
	const statements = permissionDefaults.map(([id, oldName, name]) =>
		db.prepare("UPDATE perm SET name = ? WHERE perm_id = ? AND name = ?").bind(name, id, oldName));
	statements.push(db.prepare("UPDATE role SET name = ? WHERE role_id = 1 AND name = ?").bind("Standard User", "\u666e\u901a\u7528\u6237"));
	statements.push(db.prepare("UPDATE role SET description = ? WHERE role_id = 1 AND description = ?").bind("Standard mailbox permissions", "\u53ea\u6709\u666e\u901a\u4f7f\u7528\u6743\u9650"));
	statements.push(db.prepare("UPDATE setting SET notice_content = ? WHERE notice_content = ?").bind(defaultNotice, "\u672c\u9879\u76ee\u4ec5\u4f9b\u5b66\u4e60\u4ea4\u6d41\uff0c\u7981\u6b62\u7528\u4e8e\u8fdd\u6cd5\u4e1a\u52a1\n<br>\n\u8bf7\u9075\u5b88\u5f53\u5730\u6cd5\u89c4\uff0c\u4f5c\u8005\u4e0d\u627f\u62c5\u4efb\u4f55\u6cd5\u5f8b\u8d23\u4efb"));
	await db.batch(statements);
}
