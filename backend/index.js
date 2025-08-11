import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid';
// import { PaymentsApi, Configuration } from 'yookassa-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// const config = new Configuration({
//     shopId: process.env.YOOKASSA_SHOP_ID,
//     secretKey: process.env.YOOKASSA_SECRET_KEY,
// });
// const paymentsClient = new PaymentsApi(config);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(e => console.error("MongoDB connection error:", e));

const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    hhAccessToken: String,
    hhRefreshToken: String,
    hhExpiresAt: Date,
    resumeId: String,
    filters: Object,
    subscribed: { type: Boolean, default: false },
});
const User = mongoose.model("User", userSchema);

// --- OAuth hh.ru ---
app.get("/auth/hh", (req, res) => {
    const { telegramId } = req.query;
    if (!telegramId) return res.status(400).send("telegramId required");
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.HH_CLIENT_ID,
        redirect_uri: process.env.HH_REDIRECT_URI,
        state: telegramId,
    });
    res.redirect(`https://hh.ru/oauth/authorize?${params.toString()}`);
});

app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state: telegramId } = req.query;
        if (!code || !telegramId) return res.status(400).send("Missing code or state");

        const tokenRes = await axios.post("https://hh.ru/oauth/token", null, {
            params: {
                grant_type: "authorization_code",
                client_id: process.env.HH_CLIENT_ID,
                client_secret: process.env.HH_CLIENT_SECRET,
                redirect_uri: process.env.HH_REDIRECT_URI,
                code,
            },
        });

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        const user = await User.findOneAndUpdate(
            { telegramId },
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token,
                hhExpiresAt: expiresAt,
            },
            { upsert: true, new: true }
        );

        res.send(`Авторизация успешна! Можно закрыть это окно и вернуться в Telegram.\nTelegram ID: ${telegramId}`);
    } catch (error) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).send("Ошибка авторизации");
    }
});

// --- Получить данные пользователя ---
app.get("/user/:telegramId", async (req, res) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Получить резюме пользователя с HH ---
app.get("/user/:telegramId/resumes", async (req, res) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user || !user.hhAccessToken) return res.status(404).json({ error: "Нет токена HH или пользователь" });

        const hhRes = await axios.get("https://api.hh.ru/resumes/mine", {
            headers: { Authorization: `Bearer ${user.hhAccessToken}` },
        });
        res.json(hhRes.data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Выбрать резюме ---
app.post("/user/:telegramId/selectResume", async (req, res) => {
    try {
        const { resumeId } = req.body;
        if (!resumeId) return res.status(400).json({ error: "resumeId обязателен" });

        const user = await User.findOneAndUpdate(
            { telegramId: req.params.telegramId },
            { resumeId },
            { new: true }
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Обновить фильтры ---
app.post("/user/:telegramId/filters", async (req, res) => {
    try {
        const filters = req.body;
        const user = await User.findOneAndUpdate(
            { telegramId: req.params.telegramId },
            { filters },
            { new: true }
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Проверить подписку ---
app.get("/user/:telegramId/subscription", async (req, res) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json({ subscribed: user.subscribed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Создать платеж (пример для ЮKassa или Stripe) ---
// инициализация клиента ЮKass

// app.post('/payment/create', async (req, res) => {
//     const { telegramId, amount } = req.body;
//     if (!telegramId || !amount) return res.status(400).json({ error: 'telegramId и amount обязательны' });
//
//     try {
//         const idempotenceKey = uuidv4(); // уникальный ключ для идемпотентности
//
//         const payment = await paymentsClient.createPayment({
//             amount: {
//                 value: amount.toFixed(2),
//                 currency: 'RUB',
//             },
//             confirmation: {
//                 type: 'redirect',
//                 return_url: `${process.env.BACKEND_URL}/payment/confirm?telegramId=${telegramId}`,
//             },
//             description: `Оплата подписки бота для telegramId: ${telegramId}`,
//         }, idempotenceKey);
//
//         // Сохрани в базе, если нужно, payment.id и статус
//
//         res.json({ paymentUrl: payment.confirmation.confirmation_url });
//     } catch (error) {
//         console.error('Ошибка создания платежа:', error);
//         res.status(500).json({ error: 'Ошибка создания платежа' });
//     }
// });
//
//
// // --- Вебхук для оплаты (ЮKassa или Stripe) ---÷
// app.post('/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//     try {
//         const event = JSON.parse(req.body.toString());
//
//         // Пример проверки события оплаты
//         if (event.event === 'payment.succeeded') {
//             const paymentId = event.object.id;
//             const telegramIdFromDesc = event.object.description.match(/telegramId: (\d+)/)[1];
//
//             // Обновляем пользователя в базе — подписка активна
//             await User.findOneAndUpdate(
//                 { telegramId: telegramIdFromDesc },
//                 { subscribed: true }
//             );
//
//             console.log(`Оплата прошла успешно для telegramId=${telegramIdFromDesc}, paymentId=${paymentId}`);
//         }
//
//         res.status(200).send('OK');
//     } catch (e) {
//         console.error('Ошибка вебхука ЮKassa:', e);
//         res.status(400).send('Error');
//     }
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});
