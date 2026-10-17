import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';
import { accessGate, allowedOrigin } from './security/app-access';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)
		const gate = await accessGate(req, env);
		if (gate) {
            if (req.headers.get('Origin') && allowedOrigin(req,env)) {
                const headers=new Headers(gate.headers);
                headers.set('Access-Control-Allow-Origin',req.headers.get('Origin'));
                headers.set('Access-Control-Allow-Credentials','true');headers.set('Vary','Origin');
                return new Response(gate.body,{status:gate.status,headers});
            }
            return gate;
        }
		// Old storage URLs must never bypass mailbox ownership checks.
		if (url.pathname.startsWith('/attachments/')) {
			url.pathname = '/api/mobile/v1/attachment-by-key';
			url.searchParams.set('key', new URL(req.url).pathname.slice(1));
			req = new Request(url, req);
		}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (url.pathname.startsWith('/static/')) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		if (c.cron === '*/30 * * * *') {
			await analysisService.refreshEchartsCache({ env })
			return;
		}

		await env.db.prepare('DELETE FROM app_auth_limits WHERE bucket < ?').bind(Math.floor(Date.now()/60000)-1440).run();
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await emailService.autoClean({ env })
		await analysisService.refreshEchartsCache({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
