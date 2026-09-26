require('dotenv').config();

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

function isAdmin(ctx) {
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
		inline_keyboard: [
			[{ text: '➕ Yangi kino qo\'shish', callback_data: 'admin:add_movie' }],
			[{ text: '📊 Barcha kinolar ro\'yxati', callback_data: 'admin:list_movies' }],
		],
	};
}

bot.start(async (ctx) => {
	try {
		await ctx.reply(
			'Xush kelibsiz! Kinoni olish uchun uning kodini yuboring. Masalan: <code>101</code>',
			{ parse_mode: 'HTML' },
		);
	} catch (error) {
		console.error('Start xabarini yuborishda xatolik:', error);
	}
});

bot.command('admin', async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			await ctx.reply('Bu buyruqdan foydalanishga ruxsatingiz yo\'q.', { parse_mode: 'HTML' });
			return;
		}

		await ctx.reply('Admin panel:', {
			parse_mode: 'HTML',
			reply_markup: adminKeyboard(),
		});
	} catch (error) {
		console.error('Admin panelini yuborishda xatolik:', error);
		await ctx.reply('Admin panelini ochishda xatolik yuz berdi.', { parse_mode: 'HTML' }).catch(() => {});
	}
});

bot.action('admin:add_movie', async (ctx) => {
	try {
		if (!isAdmin(ctx)) {
			await ctx.answerCbQuery('Ruxsat yo\'q.');
			return;
		}

		adminSessions.set(ctx.from.id, { step: 'code' });
		await ctx.answerCbQuery();
		await ctx.reply('Yangi kino uchun unikal kodni yuboring:', { parse_mode: 'HTML' });
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
		if (text.startsWith('/')) return;

		const session = isAdmin(ctx) ? adminSessions.get(ctx.from.id) : undefined;
		if (session && session.step === 'code') {
			if (movies.some((movie) => movie.code === text)) {
				await ctx.reply('Bu kod band. Boshqa unikal kod kiriting:', { parse_mode: 'HTML' });
				return;
			}

			session.code = text;
			session.step = 'title';
			await ctx.reply('Kino yoki serial nomini kiriting:', { parse_mode: 'HTML' });
			return;
		}

		if (session && session.step === 'title') {
			if (!text) {
				await ctx.reply('Nom bo\'sh bo\'lmasligi kerak. Qayta kiriting:', { parse_mode: 'HTML' });
				return;
			}

			session.title = text;
			session.step = 'video';
			await ctx.reply('Endi kino videosini video yoki document sifatida yuboring:', {
				parse_mode: 'HTML',
			});
			return;
		}

		const movie = movies.find((item) => item.code === text);
		if (!movie) {
			await ctx.reply('Bu kod bo\'yicha kino topilmadi. Kodni tekshirib, qayta yuboring.', {
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
		if (!session || session.step !== 'video') return;

		const uploadedFile = ctx.message.video || ctx.message.document;
		const caption = `<b>${escapeHtml(session.title)}</b>\nKod: <code>${escapeHtml(session.code)}</code>`;
		const storedMessage = ctx.message.video
			? await ctx.telegram.sendVideo(storageChannelId, uploadedFile.file_id, {
					caption,
					parse_mode: 'HTML',
				})
			: await ctx.telegram.sendDocument(storageChannelId, uploadedFile.file_id, {
					caption,
					parse_mode: 'HTML',
				});

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
