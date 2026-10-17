import { attachment } from '../mobile/service';
import userContext from '../security/user-context';
import app from '../hono/hono';

app.get('/oss/*', async (c) => {
	const key = c.req.path.split('/oss/')[1];
	return attachment(c,userContext.getUserId(c),{key});
});


