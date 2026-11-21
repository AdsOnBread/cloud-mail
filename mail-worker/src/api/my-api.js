import {lastSchedule} from '../cloud/scheduled';
import {readGeneralSettings} from '../cloud/general-settings';
import app from '../hono/hono';
import userService from '../service/user-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/my/loginUserInfo', async (c) => {
	const userId = userContext.getUserId(c);
	const [user, generalSettings, recentSchedule] = await Promise.all([userService.loginUserInfo(c, userId), readGeneralSettings(c.env.db, userId), lastSchedule(c.env.db,userId)]);
	return c.json(result.ok({...user, generalSettings,lastSchedule:recentSchedule}));
});

app.put('/my/resetPassword', async (c) => {
	await userService.resetPassword(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.delete('/my/delete', async (c) => {
	await userService.delete(c, userContext.getUserId(c));
	return c.json(result.ok());
});


