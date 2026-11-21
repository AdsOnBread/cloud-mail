// A large existing mailbox can require several bounded indexing requests.
// Stop retrying when the user changes their search, mailbox or session.
export async function searchPage(fetchPage,current,onPreparing) {
  const token=localStorage.getItem('token');
  for (;;) {
    if (!current() || localStorage.getItem('token')!==token) return null;
    const page=await fetchPage();
    if (!page?.preparingSearch) return page;
    if (!current()) return null;
    onPreparing();
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
