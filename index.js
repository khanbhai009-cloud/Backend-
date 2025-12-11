import 'dotenv/config';
import express from 'express';
import fetch from "node-fetch";
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from "firebase/app";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    collection,
    query,
    where,
    getDocs,
    serverTimestamp
} from "firebase/firestore";

// CONFIG
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

const REWARD_AMOUNT = 500;
const WEB_APP_URL = "https://khanbhai009-cloud.github.io/Tg-bot";
const WELCOME_IMAGE_URL = "https://i.ibb.co/932298pT/file-32.jpg";

// FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyCY64NxvGWFC_SZxcAFX3ImNQwY3H-yclw",
    authDomain: "tg-web-bot.firebaseapp.com",
    projectId: "tg-web-bot",
    storageBucket: "tg-web-bot.firebasestorage.app",
    messagingSenderId: "69446541874",
    appId: "1:69446541874:web:1ad058194db70530ff922b"
};

// INIT FIREBASE
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// EXPRESS
const app = express();
app.use(express.json());

// CREATE TELEGRAM BOT (NO POLLING)
const bot = new TelegramBot(BOT_TOKEN);

// SET WEBHOOK URL
const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;

await fetch(
  `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}`
);

console.log("✔ Webhook set to:", WEBHOOK_URL);


// -------------------- HELPERS --------------------

function extractReferralId(raw) {
    if (!raw) return null;
    let clean = raw.replace(/[\s?=]+/g, "");
    if (clean.toLowerCase().startsWith("ref")) clean = clean.substring(3);
    return clean || null;
}

async function createOrUpdateUser(userId, name, referralId = null) {
    const refUser = doc(db, "users", String(userId));
    const snap = await getDoc(refUser);

    if (!snap.exists()) {
        const data = {
            id: String(userId),
            name,
            photoURL: "",
            coins: 0,
            reffer: 0,
            refferBy: referralId || null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false,
            rewardgiven: false,
        };
        await setDoc(refUser, data);
        return data;
    } else {
        let existing = snap.data();
        let updateData = {};

        if (!existing.refferBy && referralId)
            updateData.refferBy = referralId;

        if (existing.rewardgiven === undefined)
            updateData.rewardgiven = false;

        if (Object.keys(updateData).length > 0) {
            await updateDoc(refUser, updateData);
            return { ...existing, ...updateData };
        }

        return existing;
    }
}

async function grantReward(userId, referrerId) {
    if (String(userId) === String(referrerId)) return;

    const refRef = doc(db, "users", String(referrerId));
    await updateDoc(refRef, {
        coins: increment(REWARD_AMOUNT),
        reffer: increment(1)
    });

    const userRef = doc(db, "users", String(userId));
    await updateDoc(userRef, {
        rewardgiven: true,
        frontendOpened: false
    });

    await setDoc(doc(db, "ref_rewards", String(userId)), {
        userId,
        referrerId,
        reward: REWARD_AMOUNT,
        createdAt: serverTimestamp()
    });

    try {
        await bot.sendMessage(referrerId, 
            `🎉 Aapne ${REWARD_AMOUNT} coins kamaaye!`,
            { parse_mode: "Markdown" }
        );
    } catch {}
}


// -------------------- TELEGRAM UPDATE HANDLER --------------------

app.post("/webhook", async (req, res) => {
    const update = req.body;

    bot.processUpdate(update); // IMPORTANT!
    res.sendStatus(200);
});


// -------------------- BOT COMMANDS --------------------

bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || "User";

    const refId = extractReferralId(match[1]?.trim());
    await createOrUpdateUser(chatId, name, refId);

    const caption = `
👋 Welcome ${name}

🔥 Daily Tasks  
🔥 Mini Apps  
🔥 Referral Bonus  
🔥 Auto Wallet System  

Tap START to begin earning!
`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "▶ Open App", web_app: { url: WEB_APP_URL } }],
            [{ text: "📢 Channel", url: "https://t.me/finisher_tech" }],
            [{ text: "🌐 Community", url: "https://t.me/finisher_techg" }]
        ]
    };

    try {
        await bot.sendPhoto(chatId, WELCOME_IMAGE_URL, {
            caption,
            reply_markup: keyboard
        });
    } catch {
        await bot.sendMessage(chatId, caption, { reply_markup: keyboard });
    }
});


// -------------------- FRONTEND OPEN ENDPOINT --------------------

app.post("/frontend-open", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.json({ ok: false });

    const userRef = doc(db, "users", String(userId));
    const snap = await getDoc(userRef);

    if (!snap.exists()) return res.json({ ok: false });

    const data = snap.data();

    if (!data.frontendOpened)
        await updateDoc(userRef, { frontendOpened: true });

    if (data.refferBy && !data.rewardgiven) {
        await grantReward(userId, data.refferBy);
        return res.json({ ok: true, msg: "Reward given" });
    }

    return res.json({ ok: true });
});


// -------------------- WORKER --------------------

async function referralWorker() {
    const q = query(collection(db, "users"), where("frontendOpened", "==", true));
    const snaps = await getDocs(q);

    for (let docSnap of snaps.docs) {
        const data = docSnap.data();
        if (data.refferBy && !data.rewardgiven) {
            await grantReward(docSnap.id, data.refferBy);
        } else {
            await updateDoc(doc(db, "users", docSnap.id), { frontendOpened: false });
        }
    }
}

setInterval(referralWorker, 5000);


// -------------------- SERVER --------------------

app.get("/", (_, res) => res.send("Webhook backend running ✔"));

app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));