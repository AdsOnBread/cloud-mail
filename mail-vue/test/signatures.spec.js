import {it,expect} from 'vitest';
import {replaceSignature,signatureId} from '../src/components/mail-signatures/content';
it('replaces only the editable signature and preserves another sender’s quoted signature',()=>{
 const body=document.createElement('div');
 body.innerHTML='<div>Reply</div><div class="cloudmail-reply-quote"><div class="cloudmail-signature">Original footer</div></div>';
 const work={id:'work',html:'<strong>Team</strong>'};
 replaceSignature(body,work,true,true);
 expect(signatureId(body)).toBe('work');
 expect(body.children[1].innerHTML).toContain('<strong>Team</strong>');
 expect(body.children[1].textContent).not.toContain('--');
 replaceSignature(body,{id:'other',html:'Other'},true,true);
 expect(body.querySelectorAll('[data-signature-id]')).toHaveLength(1);
 replaceSignature(body,null,true,true);
 expect(body.textContent).toBe('ReplyOriginal footer');
});
it('keeps a writing line ahead of the signature and uses the default delimiter',()=>{
 const body=document.createElement('div');
 replaceSignature(body,{id:'work',html:'Team'},false,false);
 expect(body.firstChild.innerHTML).toBe('<br>');
 expect(body.lastChild.textContent).toBe('-- Team');
});
it('moves the active signature when quote placement changes on a saved reply',()=>{
 const body=document.createElement('div');
 body.innerHTML='<div>Reply</div><div class="cloudmail-reply-quote">Original</div>';
 const signature={id:'work',html:'Team'};
 replaceSignature(body,signature,false,true);
 expect(body.lastChild.textContent).toBe('-- Team');
 replaceSignature(body,signature,true,true);
 expect(body.children[1].textContent).toBe('Team');
 replaceSignature(body,signature,false,true);
 expect(body.lastChild.textContent).toBe('-- Team');
});
