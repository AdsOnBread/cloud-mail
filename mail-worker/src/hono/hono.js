import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';
import { allowedOrigin } from '../security/app-access';

app.use('*', cors({ origin: (origin, c) => allowedOrigin(c.req.raw, c.env) ? origin : '', credentials: true }));

app.onError((err, c) => {
	c.header('Cache-Control','no-store');
	if (err.name === 'BizError') {
		console.log(err.message);
	} else {
		console.error(err);
	}

	if (err.message === `Cannot read properties of undefined (reading 'get')`) {
		return c.json(result.fail('KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'put')`) {
		return c.json(result.fail('KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'prepare')`) {
		return c.json(result.fail('D1 database not bound',502));
	}

	if (err.message?.includes('D1_ERROR: no such column')) {
		return c.json(result.fail('Please update the database as documented',502));
	}

	const status = Number.isInteger(err.code) && err.code >= 400 && err.code <= 599 ? err.code : 500;
	return c.json(result.fail(err.message, err.code), c.req.path.startsWith('/mobile/v1/') ? status : 200);
});

export default app;


