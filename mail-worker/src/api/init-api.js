import app from '../hono/hono';
import { dbInit } from '../init/init';
import { equalSecret } from '../security/app-access';

app.post('/init', async (c) => {
	if (!await equalSecret(c.req.header('X-Cloudmail-Init-Secret'), c.env.init_secret)) {
		return c.json({ code: 403, error: 'INIT_ACCESS_REQUIRED', message: 'Invalid initialization credential.' }, 403);
	}
	return dbInit.init(c);
})
