require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
	res.status(200).send('Bot is running');
});

app.listen(port, () => {
	console.log(`HTTP server ${port}-portda ishga tushdi.`);
});

const botToken = process.env.BOT_TOKEN;
const adminId = Number(process.env.ADMIN_ID);
const storageChannelId = process.env.STORAGE_CHANNEL_ID;

if (!botToken || !process.env.ADMIN_ID || !storageChannelId || !Number.isFinite(adminId)) {
	throw new Error('BOT_TOKEN, ADMIN_ID va STORAGE_CHANNEL_ID .env faylida to\'g\'ri sozlanishi kerak.');
}

const bot = new Telegraf(botToken);
const movies = [];
const adminSessions = new Map();
const settingsPath = path.join(__dirname, 'settings.json');
let settings;
try {
	settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
	settings = { mandatoryChannels: [] };
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
if (!Array.isArray(settings.mandatoryChannels)) settings.mandatoryChannels = [];
if (!Array.isArray(settings.helperAdmins)) settings.helperAdmins = [];
if (!Array.isArray(settings.users)) settings.users = [];
if (!Array.isArray(settings.serials)) settings.serials = [];

function saveSettings() {
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function isAdmin(ctx) {
	return ctx.from && (ctx.from.id === adminId || settings.helperAdmins.includes(ctx.from.id));
}

function isOwner(ctx) {
	return ctx.from && ctx.from.id === adminId;
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function adminKeyboard() {
	return {
		keyboard: [
			['📊 Statistika'],
			['🎬 Kino qo\'shish'],
			['📺 Serial qo\'shish'],
			['📢 Majburiy obuna'],
			['🗄 Omborxona kanali'],
			['👥 Yordamchi adminlar'],
			['📣 Hammaga xabar yuborish'],
			['❌ Yopish'],
		],
		resize_keyboard: true,
		is_persistent: true,
	};
}

function helperAdminsKeyboard() {
	return {
		inline_keyboard: [
			[{ text: '➕ Yordamchi admin qo\'shish', callback_data: 'admin:helpers:add' }],
			[{ text: '📋 Yordamchilar ro\'yxati', callback_data: 'admin:helpers:list' }],
			[{ text: '⬅️ Admin panel', callback_data: 'admin:home' }],
		],
	};
}

function beginContentAdd(ctx, kind) {
	adminSessions.set(ctx.from.id, { step: 'code', kind });
	const prompt = kind === 'serial'
		? 'Yangi serial kodi yoki mavjud serialga qism qo‘shish uchun uning kodini yuboring:'
		: 'Kino uchun unikal kodni yuboring:';
	return ctx.reply(prompt);
}

function serialEpisodesKeyboard(serialIndex, episodes) {
	const buttons = episodes.map((episode, index) => ({
		text: `${index + 1}-qism`,
		callback_data: `serial:episode:${serialIndex}:${index}`,
	}));
	const inlineKeyboard = [];
	for (let index = 0; index < buttons.length; index += 4) {
		inlineKeyboard.push(buttons.slice(index, index + 4));
	}
	return { inline_keyboard: inlineKeyboard };
}

async function showSerial(ctx, serialIndex) {
	const serial = settings.serials[serialIndex];
	await ctx.reply(`📺 ${serial.title}\nMavjud qismlar: ${serial.episodes.length}`, {
		reply_markup: serialEpisodesKeyboard(serialIndex, serial.episodes),
	});
}

async function showAdminStatistics(ctx) {
	await ctx.reply(
		`📊 Statistika\nKinolar: ${movies.length}\nSeriallar: ${settings.serials.length}\nFoydalanuvchilar: ${settings.users.length}\nMajburiy kanallar: ${settings.mandatoryChannels.length}\nYordamchi adminlar: ${settings.helperAdmins.length}`,
		{ reply_markup: { inline_keyboard: [[{ text: '📋 Barcha kinolar ro\'yxati', callback_data: 'admin:list_movies' }]] } },
	);
}

async function showStorageChannel(ctx) {
	try {
		const channel = await ctx.telegram.getChat(storageChannelId);
		await ctx.reply(`🗄 Omborxona kanali: ${channel.title || channel.username || storageChannelId}\nID: <code>${escapeHtml(storageChannelId)}</code>`, {
			parse_mode: 'HTML',
		});
	} catch (error) {
		console.error('Omborxona kanalini tekshirishda xatolik:', error);
		await ctx.reply(`🗄 Omborxona kanali ID: <code>${escapeHtml(storageChannelId)}</code>\nKanalga bot admin sifatida qo‘shilganini tekshiring.`, {
			parse_mode: 'HTML',
		});
	}
}

function mandatoryChannelsKeyboard() {
	return {
		inline_keyboard: [
			[{ text: '➕ Kanal qo\'shish', callback_data: 'admin:mandatory:add' }],
			[{ text: '✏️ Kanalni tahrirlash', callback_data: 'admin:mandatory:edit_list' }],
			[{ text: '🗑 Kanalni o\'chirish', callback_data: 'admin:mandatory:delete_list' }],
			[{ text: '📋 Kanallar ro\'yxati', callback_data: 'admin:mandatory:list' }],
			[{ text: '⬅️ Admin panel', callback_data: 'admin:home' }],
		],
	};
}

async function showMandatoryChannels(ctx) {
	const channelList = settings.mandatoryChannels.length
		? settings.mandatoryChannels.map((channel) => `• ${channel.title}`).join('\n')
		: 'Hozircha majburiy kanal qo\'shilmagan.';
	await ctx.reply(`Majburiy obuna kanallari:\n${channelList}`, {
		reply_markup: mandatoryChannelsKeyboard(),
	});
}

async function showMandatoryChannelSelection(ctx, action) {
	if (settings.mandatoryChannels.length === 0) {
		await ctx.reply('Hozircha majburiy obuna kanali qo\'shilmagan.', {
			reply_markup: { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'admin:mandatory' }]] },
		});
		return;
	}
	const icon = action === 'edit' ? '✏️' : '🗑';
	const channelRows = settings.mandatoryChannels.map((channel, index) => [{
		text: `${icon} ${channel.title.slice(0, 45)}`,
		callback_data: `admin:mandatory:${action}:${index}`,
	}]);
	channelRows.push([{ text: '⬅️ Orqaga', callback_data: 'admin:mandatory' }]);
	await ctx.reply('Kerakli kanalni tanlang:', {
		reply_markup: { inline_keyboard: channelRows },
	});
}

async function resolveMandatoryChannel(ctx, identifier) {
	const chat = await ctx.telegram.getChat(identifier);
	if (chat.type !== 'channel') throw new Error('Faqat Telegram kanalini qo\'shish mumkin.');

	const botUser = await ctx.telegram.getMe();
	const botMembership = await ctx.telegram.getChatMember(chat.id, botUser.id);
	if (botMembership.status !== 'administrator' && botMembership.status !== 'creator') {
		throw new Error('Botni kanalga administrator qilib qo\'shing.');
	}

	const username = chat.username || '';
	const inviteLink = username
		? `https://t.me/${username}`
		: (await ctx.telegram.createChatInviteLink(chat.id)).invite_link;
	return {
		chatId: String(chat.id),
		title: chat.title || `@${username}`,
		username,
		inviteLink,
	};
}

async function checkMandatorySubscriptions(ctx) {
	const missing = [];
	let checkFailed = false;
	for (const channel of settings.mandatoryChannels) {
		try {
			const member = await ctx.telegram.getChatMember(channel.chatId, ctx.from.id);
			const subscribed = ['creator', 'administrator', 'member'].includes(member.status)
				|| (member.status === 'restricted' && member.is_member);
			if (!subscribed) missing.push(channel);
		} catch (error) {
			console.error(`Majburiy obunani tekshirishda xatolik (${channel.chatId}):`, error);
			missing.push(channel);
			checkFailed = true;
		}
	}
	return { missing, checkFailed };
}

async function showSubscriptionPrompt(ctx, status) {
	const channelButtons = status.missing.map((channel) => [{
		text: `📢 ${channel.title.slice(0, 45)}`,
		url: channel.inviteLink,
	}]);
	channelButtons.push([{ text: '✅ Obunani tekshirish', callback_data: 'subscription:check' }]);
	const message = status.checkFailed
		? 'Kanal obunasini tekshirib bo\'lmadi. Keyinroq qayta urinib ko\'ring.'
		: 'Botdan foydalanish uchun quyidagi kanalga obuna bo\'ling.';
	await ctx.reply(message, { reply_markup: { inline_keyboard: channelButtons } });
}

async function showWelcome(ctx) {
	await ctx.reply(
		'Xush kelibsiz! Kinoni olish uchun uning kodini yuboring. Masalan: <code>101</code>',
		{ parse_mode: 'HTML' },
	);
}

bot.use(async (ctx, next) => {
	if (ctx.from && !settings.users.includes(ctx.from.id)) {
		settings.users.push(ctx.from.id);
		saveSettings();
	}
	if (!ctx.from || isAdmin(ctx)) return next();
	if (ctx.updateType !== 'message' && ctx.updateType !== 'callback_query') return next();
	if (ctx.updateType === 'message' && /^\/start(?:@\w+)?(?:\s|$)/i.test(ctx.message.text || '')) {
		return next();
	}
	if (ctx.updateType === 'callback_query' && ctx.callbackQuery.data === 'subscription:check') {
		return next();
	}

	const status = await checkMandatorySubscriptions(ctx);
	if (status.missing.length === 0) return next();
	if (ctx.updateType === 'callback_query') {
		await ctx.answerCbQuery('Avval barcha kanallarga obuna bo\'ling.').catch(() => {});
	}
	await showSubscriptionPrompt(ctx, status);
});

bot.start(async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			const status = await checkMandatorySubscriptions(ctx);
			if (status.missing.length > 0) {
				await showSubscriptionPrompt(ctx, status);
				return;
			}
		}
		await showWelcome(ctx);
	} catch (error) {
		console.error('Start xabarini yuborishda xatolik:', error);
	}
});

bot.action('subscription:check', async (ctx) => {
	try {
		const status = await checkMandatorySubscriptions(ctx);
		if (status.missing.length > 0) {
			await ctx.answerCbQuery('Hali barcha kanallarga obuna bo\'lmagansiz.');
			await showSubscriptionPrompt(ctx, status);
			return;
		}
		await ctx.answerCbQuery('Obuna tasdiqlandi.');
		await showWelcome(ctx);
	} catch (error) {
		console.error('Obunani qayta tekshirishda xatolik:', error);
		await ctx.answerCbQuery('Tekshirishda xatolik yuz berdi.').catch(() => {});
	}
});

bot.action(/^serial:episode:(\d+):(\d+)$/, async (ctx) => {
	try {
		const serial = settings.serials[Number(ctx.match[1])];
		const episode = serial && serial.episodes[Number(ctx.match[2])];
		if (!episode) {
			await ctx.answerCbQuery('Bu qism topilmadi.');
			return;
		}

		await ctx.answerCbQuery();
		try {
			await ctx.telegram.copyMessage(ctx.chat.id, storageChannelId, episode.messageId);
		} catch (copyError) {
			console.error('Serial qismini copyMessage bilan yuborib bo\'lmadi:', copyError);
			if (episode.mediaType === 'document') {
				await ctx.replyWithDocument(episode.fileId);
			} else {
				await ctx.replyWithVideo(episode.fileId);
			}
		}
	} catch (error) {
		console.error('Serial qism callbackida xatolik:', error);
		await ctx.answerCbQuery('Qismni yuborishda xatolik yuz berdi.').catch(() => {});
	}
});

bot.command('admin', async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			await ctx.reply('Bu buyruqdan foydalanishga ruxsatingiz yo\'q.', { parse_mode: 'HTML' });
			return;
		}

		await ctx.reply('🛠 Admin Panel', {
			reply_markup: adminKeyboard(),
		});
	} catch (error) {
		console.error('Admin panelini yuborishda xatolik:', error);
		await ctx.reply('Admin panelini ochishda xatolik yuz berdi.', { parse_mode: 'HTML' }).catch(() => {});
	}
});

async function openMandatoryChannels(ctx) {
	let queryAnswered = false;
	try {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	await ctx.answerCbQuery();
	queryAnswered = true;
	await showMandatoryChannels(ctx);
} catch (error) {
	console.error('Majburiy obuna menyusini ochishda xatolik:', error);
	if (!queryAnswered) await ctx.answerCbQuery('Menyuni ochib bo\'lmadi.').catch(() => {});
	await ctx.reply('Majburiy obuna menyusini ochishda xatolik yuz berdi.').catch(() => {});
}
}

bot.action('admin:mandatory', openMandatoryChannels);
bot.action('admin:mandatory_channels', openMandatoryChannels);

bot.action('admin:mandatory:edit_list', async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	await ctx.answerCbQuery();
	await showMandatoryChannelSelection(ctx, 'edit');
});

bot.action('admin:mandatory:delete_list', async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	await ctx.answerCbQuery();
	await showMandatoryChannelSelection(ctx, 'delete');
});

bot.action('admin:mandatory:list', async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	await ctx.answerCbQuery();
	const channelList = settings.mandatoryChannels.length
		? settings.mandatoryChannels.map((channel) => `• ${channel.title}`).join('\n')
		: 'Hozircha majburiy kanal qo\'shilmagan.';
	await ctx.reply(`Majburiy obuna kanallari:\n${channelList}`, {
		reply_markup: { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'admin:mandatory' }]] },
	});
});

bot.action('admin:mandatory:add', async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	adminSessions.set(ctx.from.id, { step: 'mandatory_add' });
	await ctx.answerCbQuery();
	await ctx.reply('Kanal username yoki ID sini yuboring (masalan: @kanal yoki -1001234567890):');
});

bot.action(/^admin:mandatory:(edit|delete):(\d+)$/, async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	const [, action, indexValue] = ctx.match;
	const index = Number(indexValue);
	if (!settings.mandatoryChannels[index]) {
		await ctx.answerCbQuery('Kanal topilmadi.');
		return;
	}
	if (action === 'edit') {
		adminSessions.set(ctx.from.id, { step: 'mandatory_edit', index });
		await ctx.answerCbQuery();
		await ctx.reply('Yangi kanal username yoki ID sini yuboring:');
		return;
	}

	settings.mandatoryChannels.splice(index, 1);
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
	await ctx.answerCbQuery('Kanal o\'chirildi.');
	await showMandatoryChannels(ctx);
});

bot.action('admin:home', async (ctx) => {
	if (!isAdmin(ctx)) {
		await ctx.answerCbQuery('Ruxsat yo\'q.');
		return;
	}
	await ctx.answerCbQuery();
	await ctx.reply('🛠 Admin Panel', { reply_markup: adminKeyboard() });
});

bot.action('admin:helpers:add', async (ctx) => {
	if (!isOwner(ctx)) {
		await ctx.answerCbQuery('Faqat asosiy admin boshqara oladi.');
		return;
	}
	adminSessions.set(ctx.from.id, { step: 'helper_admin_add' });
	await ctx.answerCbQuery();
	await ctx.reply('Yordamchi adminning Telegram ID raqamini yuboring:');
});

bot.action('admin:helpers:list', async (ctx) => {
	if (!isOwner(ctx)) {
		await ctx.answerCbQuery('Faqat asosiy admin boshqara oladi.');
		return;
	}
	await ctx.answerCbQuery();
	if (settings.helperAdmins.length === 0) {
		await ctx.reply('Yordamchi adminlar ro\'yxati bo\'sh.', { reply_markup: helperAdminsKeyboard() });
		return;
	}
	const helperRows = settings.helperAdmins.map((userId) => [{
		text: `🗑 ${userId}`,
		callback_data: `admin:helpers:remove:${userId}`,
	}]);
	helperRows.push([{ text: '⬅️ Yordamchi adminlar', callback_data: 'admin:helpers:home' }]);
	await ctx.reply(`Yordamchi adminlar (${settings.helperAdmins.length}):`, {
		reply_markup: { inline_keyboard: helperRows },
	});
});

bot.action('admin:helpers:home', async (ctx) => {
	if (!isOwner(ctx)) {
		await ctx.answerCbQuery('Faqat asosiy admin boshqara oladi.');
		return;
	}
	await ctx.answerCbQuery();
	await ctx.reply('👥 Yordamchi adminlar:', { reply_markup: helperAdminsKeyboard() });
});

bot.action(/^admin:helpers:remove:(\d+)$/, async (ctx) => {
	if (!isOwner(ctx)) {
		await ctx.answerCbQuery('Faqat asosiy admin boshqara oladi.');
		return;
	}
	const userId = Number(ctx.match[1]);
	settings.helperAdmins = settings.helperAdmins.filter((helperId) => helperId !== userId);
	saveSettings();
	await ctx.answerCbQuery('Yordamchi admin o\'chirildi.');
	await ctx.reply('👥 Yordamchi adminlar:', { reply_markup: helperAdminsKeyboard() });
});

bot.action('admin:add_movie', async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			await ctx.answerCbQuery('Ruxsat yo\'q.');
			return;
		}

		await ctx.answerCbQuery();
		await beginContentAdd(ctx, 'movie');
	} catch (error) {
		console.error('Kino qo\'shish bosqichini boshlashda xatolik:', error);
	}
});

bot.action('admin:list_movies', async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			await ctx.answerCbQuery('Ruxsat yo\'q.');
			return;
		}

		await ctx.answerCbQuery();
		if (movies.length === 0) {
			await ctx.reply('Hozircha kinolar ro\'yxati bo\'sh.', { parse_mode: 'HTML' });
			return;
		}

		const movieList = movies
			.map((movie) => `<code>${escapeHtml(movie.code)}</code> — ${escapeHtml(movie.title)}`)
			.join('\n');
		await ctx.reply(`<b>Kinolar ro\'yxati (${movies.length}):</b>\n${movieList}`, {
			parse_mode: 'HTML',
		});
	} catch (error) {
		console.error('Kinolar ro\'yxatini yuborishda xatolik:', error);
		await ctx.reply('Ro\'yxatni olishda xatolik yuz berdi.', { parse_mode: 'HTML' }).catch(() => {});
	}
});

bot.on('text', async (ctx) => {
	try {
		const text = ctx.message.text.trim();
		const session = isAdmin(ctx) ? adminSessions.get(ctx.from.id) : undefined;
		if (isAdmin(ctx)) {
			switch (text) {
				case '📊 Statistika':
					await showAdminStatistics(ctx);
					return;
				case '🎬 Kino qo\'shish':
					await beginContentAdd(ctx, 'movie');
					return;
				case '📺 Serial qo\'shish':
					await beginContentAdd(ctx, 'serial');
					return;
				case '📢 Majburiy obuna':
					await showMandatoryChannels(ctx);
					return;
				case '🗄 Omborxona kanali':
					await showStorageChannel(ctx);
					return;
				case '👥 Yordamchi adminlar':
					if (!isOwner(ctx)) {
						await ctx.reply('Faqat asosiy admin yordamchi adminlarni boshqara oladi.');
						return;
					}
					await ctx.reply('👥 Yordamchi adminlar:', { reply_markup: helperAdminsKeyboard() });
					return;
				case '📣 Hammaga xabar yuborish':
					adminSessions.set(ctx.from.id, { step: 'broadcast' });
					await ctx.reply('Barcha foydalanuvchilarga yuboriladigan xabar matnini kiriting:');
					return;
				case '❌ Yopish':
					adminSessions.delete(ctx.from.id);
					await ctx.reply('Admin panel yopildi.', { reply_markup: { remove_keyboard: true } });
					return;
				case '📋 Kinolar ro\'yxati':
					await ctx.telegram.sendMessage(ctx.chat.id, 'Kinolar ro\'yxati:', {
						reply_markup: { inline_keyboard: [[{ text: '📊 Barcha kinolar ro\'yxati', callback_data: 'admin:list_movies' }]] },
					});
					return;
			}
		}

		if (session && session.step === 'helper_admin_add' && isOwner(ctx)) {
			const helperId = Number(text);
			if (!Number.isSafeInteger(helperId) || helperId <= 0 || helperId === adminId) {
				await ctx.reply('Yaroqli Telegram ID yuboring:');
				return;
			}
			if (!settings.helperAdmins.includes(helperId)) settings.helperAdmins.push(helperId);
			saveSettings();
			adminSessions.delete(ctx.from.id);
			await ctx.reply(`Yordamchi admin qo\'shildi: ${helperId}`, { reply_markup: helperAdminsKeyboard() });
			return;
		}

		if (session && session.step === 'broadcast' && isAdmin(ctx)) {
			adminSessions.delete(ctx.from.id);
			let delivered = 0;
			let failed = 0;
			for (const userId of settings.users) {
				try {
					await ctx.telegram.sendMessage(userId, text);
					delivered += 1;
				} catch (error) {
					failed += 1;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			await ctx.reply(`Xabar yuborildi: ${delivered}\nYuborilmadi: ${failed}`);
			return;
		}

		if (session && (session.step === 'mandatory_add' || session.step === 'mandatory_edit') && !text.startsWith('/')) {
			try {
				const channel = await resolveMandatoryChannel(ctx, text);
				const duplicateIndex = settings.mandatoryChannels.findIndex((item) => item.chatId === channel.chatId);
				if (session.step === 'mandatory_add' && duplicateIndex !== -1) {
					await ctx.reply('Bu kanal allaqachon majburiy obunaga qo\'shilgan.');
					return;
				}
				if (session.step === 'mandatory_edit' && duplicateIndex !== -1 && duplicateIndex !== session.index) {
					await ctx.reply('Bu kanal allaqachon ro\'yxatda bor. Boshqa kanal yuboring:');
					return;
				}

				if (session.step === 'mandatory_add') settings.mandatoryChannels.push(channel);
				else settings.mandatoryChannels[session.index] = channel;
				fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
				adminSessions.delete(ctx.from.id);
				await ctx.reply(`Majburiy kanal saqlandi: ${channel.title}`);
				await showMandatoryChannels(ctx);
			} catch (error) {
				await ctx.reply(`Kanalni saqlab bo\'lmadi: ${error.message}`);
			}
			return;
		}

		const movieCommand = text.match(/^\/k(?:@\w+)?(?:\s*([^\s@]+))?(?:@\w+)?$/i);
		if (text.startsWith('/') && !movieCommand) return;
		if (movieCommand && !movieCommand[1]) {
			await ctx.reply('Kino kodini kiriting. Masalan: <code>/k101</code>', {
				parse_mode: 'HTML',
			});
			return;
		}
		const movieCode = movieCommand ? movieCommand[1] : text;
		const serialIndex = settings.serials.findIndex((serial) => serial.code === movieCode);
		if (serialIndex !== -1 && !(session && session.step === 'code')) {
			await showSerial(ctx, serialIndex);
			return;
		}

		if (session && session.step === 'code' && !movieCommand) {
			const existingSerialIndex = settings.serials.findIndex((serial) => serial.code === movieCode);
			if (session.kind === 'serial' && existingSerialIndex !== -1) {
				const serial = settings.serials[existingSerialIndex];
				session.code = serial.code;
				session.title = serial.title;
				session.episodeNumber = serial.episodes.length + 1;
				session.step = 'episode_video';
				await ctx.reply(`“${serial.title}” uchun ${session.episodeNumber}-qism videosini yuboring:`);
				return;
			}

			if (movies.some((movie) => movie.code === movieCode)
				|| (session.kind !== 'serial' && existingSerialIndex !== -1)
				|| (session.kind === 'serial' && movies.some((movie) => movie.code === movieCode))) {
				await ctx.reply('Bu kod band. Boshqa unikal kod kiriting:', { parse_mode: 'HTML' });
				return;
			}

			session.code = movieCode;
			session.step = 'title';
			await ctx.reply(`${session.kind === 'serial' ? 'Serial' : 'Kino'} nomini kiriting:`, { parse_mode: 'HTML' });
			return;
		}

		if (session && session.step === 'title') {
			if (!text) {
				await ctx.reply('Nom bo\'sh bo\'lmasligi kerak. Qayta kiriting:', { parse_mode: 'HTML' });
				return;
			}

			session.title = text;
			session.step = session.kind === 'serial' ? 'episode_video' : 'video';
			const uploadPrompt = session.kind === 'serial'
				? 'Endi serialning 1-qism videosini video yoki document sifatida yuboring:'
				: 'Endi kino videosini video yoki document sifatida yuboring:';
			await ctx.reply(uploadPrompt, {
				parse_mode: 'HTML',
			});
			return;
		}

		const movie = movies.find((item) => item.code === movieCode);
		if (!movie) {
			await ctx.reply('😕 Kino topilmadi. Kodni tekshirib, qayta yuboring.', {
				parse_mode: 'HTML',
			});
			return;
		}

		try {
			await ctx.telegram.copyMessage(ctx.chat.id, storageChannelId, movie.messageId);
		} catch (copyError) {
			console.error('copyMessage xatoligi, video file_id orqali yuborilmoqda:', copyError);
			await ctx.replyWithVideo(movie.fileId, { parse_mode: 'HTML' });
		}
	} catch (error) {
		console.error('Matnli xabarni qayta ishlashda xatolik:', error);
		await ctx.reply('So\'rovni bajarishda xatolik yuz berdi. Qayta urinib ko\'ring.', {
			parse_mode: 'HTML',
		}).catch(() => {});
	}
});

bot.on(['video', 'document'], async (ctx) => {
	try {
		const session = isAdmin(ctx) ? adminSessions.get(ctx.from.id) : undefined;
		if (!session || (session.step !== 'video' && session.step !== 'episode_video')) return;

		const uploadedFile = ctx.message.video || ctx.message.document;
		const existingSerial = session.kind === 'serial'
			? settings.serials.find((serial) => serial.code === session.code)
			: undefined;
		const episodeNumber = session.kind === 'serial' ? (existingSerial?.episodes.length || 0) + 1 : undefined;
		const title = session.kind === 'serial'
			? `Serial: ${escapeHtml(session.title)}\n${episodeNumber}-qism`
			: escapeHtml(session.title);
		const caption = `<b>${title}</b>\nKod: <code>${escapeHtml(session.code)}</code>`;
		const storedMessage = ctx.message.video
			? await ctx.telegram.sendVideo(storageChannelId, uploadedFile.file_id, {
					caption,
					parse_mode: 'HTML',
				})
			: await ctx.telegram.sendDocument(storageChannelId, uploadedFile.file_id, {
					caption,
					parse_mode: 'HTML',
				});

			if (session.kind === 'serial') {
				const serial = existingSerial || { code: session.code, title: session.title, episodes: [] };
				const episode = {
					messageId: storedMessage.message_id,
					fileId: uploadedFile.file_id,
					mediaType: ctx.message.video ? 'video' : 'document',
				};
				serial.episodes.push(episode);
				if (!existingSerial) settings.serials.push(serial);
				saveSettings();
				adminSessions.delete(ctx.from.id);

				try {
					await ctx.telegram.sendMessage(storageChannelId, `#SERIAL_BACKUP\n<pre>${escapeHtml(JSON.stringify({
						code: serial.code,
						title: serial.title,
						episode: serial.episodes.length,
						...episode,
					}))}</pre>`, { parse_mode: 'HTML' });
				} catch (backupError) {
					console.error('Serial qismi saqlandi, lekin backup xabarini yozishda xatolik:', backupError);
				}

				await ctx.reply(
					`Serial qismi saqlandi.\nKod: <code>${escapeHtml(serial.code)}</code>\nQism: ${serial.episodes.length}\nNom: ${escapeHtml(serial.title)}`,
					{ parse_mode: 'HTML' },
				);
				return;
			}

		const movie = {
			code: session.code,
			title: session.title,
			messageId: storedMessage.message_id,
			fileId: uploadedFile.file_id,
		};
		movies.push(movie);

		try {
			const backupText = `#DATA_BACKUP\n<pre>${escapeHtml(JSON.stringify(movie))}</pre>`;
			await ctx.telegram.sendMessage(storageChannelId, backupText, { parse_mode: 'HTML' });
		} catch (backupError) {
			console.error('Kino qo\'shildi, lekin backup xabarini saqlashda xatolik:', backupError);
			await ctx.reply('Kino saqlandi, ammo zaxira xabarini saqlashda xatolik yuz berdi.', {
				parse_mode: 'HTML',
			});
			adminSessions.delete(ctx.from.id);
			return;
		}

		adminSessions.delete(ctx.from.id);
		await ctx.reply(
			`Kino muvaffaqiyatli saqlandi.\nKod: <code>${escapeHtml(movie.code)}</code>\nNom: ${escapeHtml(movie.title)}`,
			{ parse_mode: 'HTML' },
		);
	} catch (error) {
		console.error('Video yoki hujjatni saqlashda xatolik:', error);
		await ctx.reply('Faylni saqlashda xatolik yuz berdi. Video faylini qayta yuboring.', {
			parse_mode: 'HTML',
		}).catch(() => {});
	}
});

bot.catch((error, ctx) => {
	console.error(`Telegram update xatoligi (${ctx.update.update_id}):`, error);
});

process.on('unhandledRejection', (reason) => {
	console.error('Kutilmagan promise xatoligi:', reason);
});

process.on('uncaughtException', (error) => {
	console.error('Kutilmagan dastur xatoligi:', error);
});

bot.launch().then(() => {
	console.log('Telegram bot ishga tushdi.');
}).catch((error) => {
	console.error('Botni ishga tushirishda xatolik:', error);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
