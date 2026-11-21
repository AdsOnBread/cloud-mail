// A large existing mailbox can require several bounded indexing requests.
// Stop retrying when the user changes their search, mailbox or session.
export async function searchPage(fetchPage,current,onPreparing) {
  const token=localStorage.getItem('token');
  const valid=()=>current() && localStorage.getItem('token')===token;
  while (valid()) {
    const page=await fetchPage();
    if (!valid()) return null;
    if (!page?.preparingSearch) return page;
    onPreparing();
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return null;
}
